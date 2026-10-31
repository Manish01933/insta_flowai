#!/usr/bin/env node
/**
 * InstaFlow AI — RESCUE: ek command me project ki poora jaanch + theek karna.
 *
 * Ye script kaam kaise karti hai:
 *   1. Is machine + Railway link ki jaanch (login, sahi project).
 *   2. LIVE project ko bahar se probe karta hai (jaise koi customer dekhta hai).
 *   3. Jo KHUD theek ho sakta hai wo khud theek karti hai:
 *        - missing config (non-secret) -> Railway par set kar deti hai
 *        - purana / toota hua build    -> dobara build + deploy
 *        - server hang / crash         -> redeploy (restart)
 *   4. Dobara verify: naya build live hua, customer ka data safe hai.
 *   5. SIMPLE REPORT (Hinglish): main karan, kya kiya, kya aapko karna hai.
 *   6. Poora detail rescue-report.txt me save.
 *
 * Usage (cmd se):
 *   rescue.cmd                  <- normal: jaanch + jo theek ho sake khud theek
 *   rescue.cmd --check          <- sirf jaanch, kuch bhi badalta nahi
 *   rescue.cmd --redeploy       <- chahe sab theek ho, fresh build + deploy
 *   rescue.cmd --url=https://x  <- doosre host par (default https://www.thefgt.in)
 *
 * Optional: RESCUE_ID_TOKEN env (owner ka Firebase ID token) de do to ops-page
 * wala "project rukne ka karan" notification bhi report me aa jata hai.
 *
 * Suraksha rules:
 *   - Secret values (API keys, META_APP_SECRET, ENCRYPTION_MASTER_KEY) kabhi
 *     print/set nahi hote — sirf NAAM check hote hain.
 *   - ENCRYPTION_MASTER_KEY kabhi auto-set nahi hota: ek baar set hone ke baad
 *     badalne se SARE customers ke Instagram tokens unreadable ho jate hain.
 *   - Deploy ke baad /healthz ke customer counts compare hote hain. Counts zero
 *     ho gaye = volume mounted nahi — script ROZ deti hai aur aage nahi badhti.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── FGT-IDs.html se (section 1 + 6). Badalne par FGT-IDs bhi update karein. ──
const EXPECTED_PROJECT_ID = '0c21ed12-cba7-4ef3-84ab-22e2fa1fc88a';
const EXPECTED_PROJECT_NAME = 'carefree-commitment';
const EXPECTED_ENV_ID = '5d35108b-ab5e-410e-9ecd-7e01cfa9c74d';
const EXPECTED_SERVICE_ID = '07754fab-6640-455f-8a2d-4038ad2b04f9';
const EXPECTED_SERVICE_NAME = 'insta_flowai';

// ── Config jo auto-set ho sakti hai (koi secret nahi; source: DEPLOY.md + FGT-IDs).
//    Sirf TAB set hoti hai jab MISSING hon — jo set hai use kabhi chhua nahi jata.
function safeEnv(BASE) {
  return {
    NODE_ENV: 'production',
    APP_URL: BASE,
    META_REDIRECT_URI: `${BASE}/api/instagram/oauth/callback`,
    META_VERIFY_TOKEN: 'instaflow_secure_verify_token',
    META_APP_ID: '1226093629512976',
    IG_APP_ID: '2315015095917318',
    OPENROUTER_MODEL: 'inclusionai/ling-3.0-flash',
    GEMINI_MODEL: 'gemini-flash-latest',
    IG_GRAPH_API_VERSION: 'v23.0',
    DATA_DIR: '/data',
    FIREBASE_PROJECT_ID: 'gen-lang-client-0888289051',
    WEBHOOK_DEDUPE_TTL_MS: '1800000',
    CHAT_RETENTION_DAYS: '30',
    OWNER_TENANT_IDS: '5eurbDvqjpWY8ElOI7xVlm4s6852',
    OWNER_EMAILS: 'manish98886@gmail.com',
    COMP_TENANT_IDS: 'hZX1uQttCtdd70ijRaN2maZnnin1,dtEYzKGPl7SzjXC2yJDYLFjOedA2',
  };
}

// ── Secrets / optional: kabhi auto-set nahi. Sirf missing hone par command dikhao.
//    value kahan milegi — wo bhi likha hai.
const MANUAL_ENV = [
  { name: 'OPENROUTER_API_KEY', where: 'OpenRouter dashboard ya .env me (DEPLOY.md)', critical: true },
  { name: 'GEMINI_API_KEY', where: 'Google AI Studio ya .env me', critical: true },
  { name: 'META_APP_SECRET', where: 'Meta app dashboard (app 1226093629512976) -> App Secret', critical: true },
  { name: 'IG_APP_SECRET', where: 'Meta app dashboard (app 2315015095917318)', critical: false },
  {
    name: 'ENCRYPTION_MASTER_KEY',
    where: 'purani .env / host me — DHYAAN: agar ye kho gaya to purane Instagram tokens padhe nahi ja sakte. EK BAAR SET HONE KE BAAD KABHI NA BADLEIN.',
    critical: true,
  },
  { name: 'RAZORPAY_KEY_ID', where: 'Razorpay dashboard (billing ON karna ho to)', critical: false },
  { name: 'RAZORPAY_KEY_SECRET', where: 'Razorpay dashboard', critical: false },
  { name: 'RAZORPAY_WEBHOOK_SECRET', where: 'Razorpay webhook settings', critical: false },
  { name: 'COMPLAINT_WHATSAPP_TO', where: 'owner ka WhatsApp number (alerts ke liye)', critical: false },
  { name: 'CALLMEBOT_API_KEY', where: 'callmebot.com se free key (alerts ke liye)', critical: false },
];

// ── CLI flags ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};
if (flag('--help') || flag('-h')) {
  console.log(`
InstaFlow rescue — project jaanch + auto-fix

  rescue.cmd             jaanch + jo theek ho sake khud theek karo
  rescue.cmd --check     sirf jaanch (kuch badalta nahi)
  rescue.cmd --redeploy  fresh build + deploy, chahe sab theek ho
  rescue.cmd --url=URL   doosre host par (default https://www.thefgt.in)
`);
  process.exit(0);
}
const CHECK_ONLY = flag('--check');
const FORCE_DEPLOY = flag('--redeploy');
const BASE = (value('--url') || 'https://www.thefgt.in').replace(/\/+$/, '');
const ID_TOKEN = (value('--id-token') || process.env.RESCUE_ID_TOKEN || '').trim();

// ── Output helpers (Hinglish, cmd-friendly) ────────────────────────────────
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const yellow = (s) => paint('33', s);
const bold = (s) => paint('1', s);

const logLines = [];
function say(msg = '') {
  console.log(msg);
  logLines.push(msg.replace(/\u001b\[[0-9;]*m/g, ''));
}
function phase(title) {
  say('');
  say(bold(`===== ${title} =====`));
}
const ok = (msg) => say(`  ${green('OK       ')} ${msg}`);
const fixed = (msg) => say(`  ${green('THEEK KIYA')} ${msg}`);
const manual = (msg) => say(`  ${yellow('AAPKO KARO')} ${msg}`);
const warn = (msg) => say(`  ${yellow('DHYAAN    ')} ${msg}`);
const bad = (msg) => say(`  ${red('PROBLEM   ')} ${msg}`);

// Findings (report ke liye tag ke saath). `resolved` tab set hota hai jab fix()
// ya verify() us condition ko dobara check karke theek paata hai — varna report
// theek ho chuki problem ko bhi "abhi bhi problem" bolta rehta.
const findings = [];
const note = (tag, text) => findings.push({ tag, text, resolved: false });
const resolveFinding = (prefix) => {
  for (const f of findings) {
    if (f.tag === 'PROBLEM' && f.text.startsWith(prefix)) f.resolved = true;
  }
};

// ── Child processes ────────────────────────────────────────────────────────
// Windows par `npm` aur `railway` .cmd shims hain — unhe ek poori command line
// ki tarah chalate hain (shell:true + string; saare args space-free hain).
// Node scripts hamesha process.execPath + args array, BINA shell — taaki
// "Program Files" jaisi paths me spaces hon to bhi spawn toote nahi.
function shellRun(cmdline, opts = {}) {
  const res = spawnSync(cmdline, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    failed: res.status !== 0 || Boolean(res.error),
  };
}
function nodeRun(scriptArgs, opts = {}) {
  const res = spawnSync(process.execPath, scriptArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    failed: res.status !== 0 || Boolean(res.error),
  };
}

// ── HTTP probes (customer ki nazar se) ─────────────────────────────────────
async function get(pathname, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${BASE}${pathname}`, { ...init, signal: controller.signal });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* html/text — aise hi chalega */ }
    return { status: res.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}
const tryGet = async (p, init) => {
  try { return await get(p, init); } catch (err) { return { error: String(err?.message || err) }; }
};

function localBuildId() {
  const assets = path.join(ROOT, 'dist', 'assets');
  if (!fs.existsSync(assets)) return '';
  const main = fs.readdirSync(assets).find((f) => /^main-.*\.js$/.test(f));
  return main ? main.replace(/\.js$/, '') : '';
}

// ── Railway CLI ────────────────────────────────────────────────────────────
function railway(cmdArgs) {
  return shellRun(`railway ${cmdArgs.join(' ')}`, { timeout: 120_000 });
}

function railwayVariables() {
  const res = railway(['variables', '--json']);
  if (res.failed) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    // Shape: { KEY: "value" } ya { variables: {...} } — dono se sirf NAAM chahiye.
    const obj = parsed && parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed;
    return new Set(Object.keys(obj || {}));
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — machine + Railway link
// ════════════════════════════════════════════════════════════════════════════
function phase1Machine() {
  phase('1/5 — Is machine ki taiyari');

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 22) ok(`Node.js v${process.versions.node}`);
  else warn(`Node.js v${process.versions.node} — project ko v22+ chahiye (package.json engines)`);

  let status = railway(['status', '--json']);
  if (status.failed) {
    const out = `${status.stdout}${status.stderr}`.toLowerCase();
    if (/login|not authenticated|unauthenticated/.test(out)) {
      if (CHECK_ONLY) {
        bad('Railway login nahi hai. Fix mode me ye script `railway login` khud chalati hai.');
        return false;
      }
      manual('Railway login karo — browser khulega, wahan account select karo...');
      const login = railway(['login']);
      if (login.failed) {
        bad(`Railway login fail: ${(login.stderr || login.stdout).slice(0, 200)}`);
        manual('Khud chalao: railway login');
        return false;
      }
      status = railway(['status', '--json']);
    }
  }
  if (status.failed) {
    bad(`Railway status nahi chal raha: ${(status.stderr || status.stdout).slice(0, 200)}`);
    manual('Railway CLI install hai? nahi to: npm i -g @railway/cli');
    return false;
  }

  let projectId = '';
  try { projectId = JSON.parse(status.stdout)?.id || ''; } catch { /* text output */ }
  const statusText = railway(['status']).stdout;

  const linkedRight =
    projectId === EXPECTED_PROJECT_ID &&
    (statusText.includes(EXPECTED_SERVICE_NAME) || statusText.includes(EXPECTED_PROJECT_NAME));

  if (linkedRight) {
    ok(`Railway link sahi hai: project ${EXPECTED_PROJECT_NAME}, service ${EXPECTED_SERVICE_NAME}`);
    return true;
  }

  if (CHECK_ONLY) {
    bad(`Ye folder galat Railway project se linked hai (mila: ${projectId || 'unknown'}).`);
    manual(`Fix mode chalao — ya khud: railway link -p ${EXPECTED_PROJECT_ID} -e ${EXPECTED_ENV_ID} -s ${EXPECTED_SERVICE_ID}`);
    return false;
  }

  warn(`Railway link theek nahi (mila: ${projectId || 'unknown'}) — sahi project se link kar raha hoon...`);
  const linked = railway(['link', '-p', EXPECTED_PROJECT_ID, '-e', EXPECTED_ENV_ID, '-s', EXPECTED_SERVICE_ID]);
  if (linked.failed) {
    bad(`railway link fail: ${(linked.stderr || linked.stdout).slice(0, 200)}`);
    manual(`Khud chalao: railway link -p ${EXPECTED_PROJECT_ID} -e ${EXPECTED_ENV_ID} -s ${EXPECTED_SERVICE_ID}`);
    return false;
  }
  ok('Sahi project se link kar diya (carefree-commitment / insta_flowai)');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — live diagnose
// ════════════════════════════════════════════════════════════════════════════
async function diagnose() {
  phase(`2/5 — Project abhi kaisa hai? (${BASE})`);

  const probe = { problems: [], health: null, liveBuildId: '', counts: null, envNames: null };

  const health = await tryGet('/healthz');
  if (health.error || health.status !== 200 || health.body?.status !== 'ok') {
    probe.problems.push('SERVER_DOWN');
    bad(`Server jawab nahi de raha (/healthz: ${health.error || `HTTP ${health.status}`})`);
  } else {
    ok('/healthz ok');
    probe.health = health.body;
    probe.counts = {
      active: health.body.activeSubscriptions ?? 0,
      trialing: health.body.trialingSubscriptions ?? 0,
      pending: health.body.pendingCheckouts ?? 0,
    };
    say(`       customers: ${probe.counts.active} active / ${probe.counts.trialing} trial / ${probe.counts.pending} pending`);
  }

  const version = await tryGet('/api/version');
  if (!version.error && version.status === 200) {
    probe.liveBuildId = String(version.body?.buildId || '');
    say(`       live build: ${probe.liveBuildId || '(unknown)'}`);
    const local = localBuildId();
    if (local) say(`       yahan ka build: ${local}`);
    if (local && probe.liveBuildId && probe.liveBuildId !== local) {
      probe.problems.push('STALE_DEPLOY');
      bad(`Live par PURANA build hai (live ${probe.liveBuildId} != ${local}) — is workspace ka code deployed nahi hai`);
    } else if (!local) {
      probe.problems.push('NO_LOCAL_BUILD');
      warn('Yahan dist/ nahi hai — pehle build karna padega');
    } else {
      ok('Live build isi workspace se hai');
    }
  } else if (!probe.problems.includes('SERVER_DOWN')) {
    probe.problems.push('SERVER_DOWN');
    bad('/api/version bhi nahi mila');
  }

  // Apps + bot + Instagram config — customer ke raste se.
  const app = await tryGet('/app');
  if (app.error || app.status !== 200 || !/InstaFlow/i.test(app.text || '')) {
    probe.problems.push('APP_BROKEN');
    bad('/app customer dashboard serve nahi kar raha');
  } else ok('/app customer dashboard theek hai');

  const ops = await tryGet('/ops');
  const opsBundle = ops.text && (/assets\/ops-[A-Za-z0-9_-]+\.js/.test(ops.text) || /\/src\/ops\.tsx/.test(ops.text));
  if (ops.error || ops.status !== 200 || !opsBundle) {
    probe.problems.push('OPS_BUNDLE_MISSING');
    bad('/ops ke saath owner-console bundle deploy me nahi hai');
  } else ok('/ops owner console theek hai');

  const sim = await tryGet('/api/simulate-dm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'default_tenant' },
    body: JSON.stringify({
      message: 'Price kya hai?',
      systemPrompt: 'You are a helpful assistant. Answer in one short line.',
      knowledgeBase: 'Price Rs 2500.',
      conversationHistory: [],
    }),
  });
  if (sim.error) {
    probe.problems.push('AI_DEAD');
    bad(`AI check fail: ${sim.error}`);
  } else if (sim.status === 429) {
    warn('AI check abhi rate-limit me hai — kuch minute baad dobara --check chalao');
  } else if (sim.status === 200 && sim.body?.provider && sim.body.provider !== 'fallback') {
    ok(`AI jawab de raha hai (provider=${sim.body.provider}, model=${sim.body.model})`);
  } else {
    probe.problems.push('AI_DEAD');
    bad(`AI jawab NAHI de raha — canned reply ja raha hai (provider=${sim.body?.provider || '?'})`);
  }

  const ig = await tryGet('/api/instagram/status', { headers: { 'x-tenant-id': 'default_tenant' } });
  if (ig.error || ig.status !== 200) {
    warn('Instagram config check nahi ho paya');
  } else {
    const redirect = String(ig.body?.oauthRedirectUri || '');
    const webhook = String(ig.body?.webhookUrl || '');
    const host = new URL(BASE).hostname;
    const redirectOk = redirect.startsWith('https://') && redirect.includes(host);
    const webhookOk = webhook.startsWith('https://') && webhook.includes(host);
    if (redirectOk && webhookOk && ig.body?.oauthClientId) {
      ok('Instagram OAuth redirect + webhook + app id sahi hain');
    } else {
      probe.problems.push('OAUTH_MISCONFIG');
      bad(`Instagram config galat: redirect=${redirect || 'missing'}, webhook=${webhook || 'missing'}, clientId=${ig.body?.oauthClientId || 'missing'}`);
    }
  }

  // Config (env) audit — sirf NAAM, values kabhi print nahi.
  probe.envNames = railwayVariables();
  const safe = safeEnv(BASE);
  const missingSafe = Object.keys(safe).filter((k) => !probe.envNames?.has(k));
  const missingManual = MANUAL_ENV.filter((m) => !probe.envNames?.has(m.name));
  if (!probe.envNames) {
    warn('Railway variables nahi padh paya — env audit skip');
  } else if (!missingSafe.length && !missingManual.length) {
    ok('Host par saari config maujood hai');
  } else {
    if (missingSafe.length) {
      probe.problems.push('ENV_MISSING');
      bad(`Host par config missing (auto-set ho sakti hai): ${missingSafe.join(', ')}`);
    }
    for (const m of missingManual) {
      if (m.critical) probe.problems.push('ENV_MISSING_SECRET');
      warn(`Host par ${m.name} missing hai — value ${m.where}`);
      note('MANUAL', `${m.name} missing — ${m.where}`);
    }
  }

  return probe;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — khud theek karo
// ════════════════════════════════════════════════════════════════════════════
async function fix(probe) {
  phase('3/5 — Jo khud theek ho sakta hai, theek kar raha hoon');

  if (CHECK_ONLY) {
    warn('--check mode: kuch bhi nahi badla. Theek karne ke liye bina --check ke chalao.');
    return { envChanged: false };
  }

  let envChanged = false;

  // (a) Missing non-secret config -> set.
  const safe = safeEnv(BASE);
  const missingSafe = Object.keys(safe).filter((k) => !probe.envNames?.has(k));
  if (probe.envNames && missingSafe.length) {
    const pairs = missingSafe.map((k) => `${k}=${safe[k]}`);
    const res = railway(['variable', 'set', ...pairs, '--skip-deploys']);
    if (res.failed) {
      bad(`Config set nahi hui: ${(res.stderr || res.stdout).slice(0, 200)}`);
      manual(`Khud chalao: railway variable set ${pairs.join(' ')}`);
    } else {
      fixed(`Host par config set kar di: ${missingSafe.join(', ')}`);
      note('FIXED', `Missing config set: ${missingSafe.join(', ')}`);
      resolveFinding('ENV_MISSING:');
      envChanged = true;
    }
  }

  // (b) Missing secrets -> sirf command + value kahan milegi. (Note diagnose
  //     me already add ho chuke hain; yahan sirf command dikhati hai.)
  const missingManual = probe.envNames ? MANUAL_ENV.filter((x) => !probe.envNames.has(x.name)) : [];
  for (const m of missingManual) {
    manual(`railway variable set ${m.name}=<value>   — value: ${m.where}`);
  }

  // (c) Build.
  let local = localBuildId();
  const needBuild = FORCE_DEPLOY || !local || (probe.liveBuildId && local && probe.liveBuildId !== local);
  if (needBuild) {
    say('  ... build ho raha hai (npm run build) — 1-2 minute');
    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
      const install = shellRun('npm install');
      if (install.failed) {
        bad(`npm install fail:\n${(install.stderr || install.stdout).slice(-600)}`);
        return { envChanged };
      }
    }
    const build = shellRun('npm run build');
    if (build.failed) {
      bad(`BUILD FAIL:\n${(build.stderr || build.stdout).slice(-800)}`);
      note('PROBLEM', 'BUILD_FAIL: npm run build fail — code me error hai, pehle wo theek karo');
      manual('Error upar hai. Agar samajh na aaye to mujhe (Buffy ko) ye output bhejo.');
      return { envChanged };
    }
    local = localBuildId();
    fixed(`Build ready: ${local}`);
    note('FIXED', `Local build: ${local}`);
    resolveFinding('NO_LOCAL_BUILD');
  } else {
    ok(`Build pehle se ready hai (${local})`);
  }

  // (c) Deploy — zaroorat ho to.
  const serverDown = probe.problems.includes('SERVER_DOWN');
  const stale = probe.liveBuildId && local && probe.liveBuildId !== local;
  let deployed = false;

  if (FORCE_DEPLOY || serverDown || stale || probe.problems.includes('APP_BROKEN') || probe.problems.includes('OPS_BUNDLE_MISSING')) {
    say('  ... deploy ho raha hai (railway up --detach) — phir live hone ka intezaar');
    const up = railway(['up', '--detach']);
    if (up.failed) {
      bad(`Deploy fail: ${(up.stderr || up.stdout).slice(-400)}`);
      note('PROBLEM', 'DEPLOY_FAIL: railway up fail');
      return { envChanged };
    }
    deployed = true;
    fixed('Deploy bhej diya');
    note('FIXED', 'railway up --detach — fresh deploy');
  } else if (envChanged) {
    say('  ... config apply karne ke liye restart (railway redeploy)');
    const redeploy = railway(['redeploy', '--yes']);
    if (redeploy.failed) {
      bad(`Redeploy fail: ${(redeploy.stderr || redeploy.stdout).slice(-400)}`);
      return { envChanged };
    }
    deployed = true;
    fixed('Restart bhej diya');
    note('FIXED', 'railway redeploy — config apply');
  } else {
    ok('Deploy ki zaroorat nahi — live project isi code par hai');
  }

  // (d) Wait for it to come up with the build we expect.
  if (deployed) {
    say('  ... live hone ka intezaar (har 10s ek check, zyada se zyada 6 minute)');
    const deadline = Date.now() + 360_000;
    let live = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      const v = await tryGet('/api/version');
      live = String(v.body?.buildId || '');
      if (v.status === 200 && live) {
        if (!local || live === local) {
          fixed(`Live ho gaya: build ${live}`);
          // Deploy safal = ye conditions ab nahi rahi (code = isi workspace ka).
          resolveFinding('STALE_DEPLOY');
          resolveFinding('SERVER_DOWN');
          resolveFinding('APP_BROKEN');
          resolveFinding('OPS_BUNDLE_MISSING');
          break;
        }
        say(`       abhi purana hi hai (${live})...`);
      } else {
        say('       server abhi start ho raha hai...');
      }
    }
    if (local && live && live !== local) {
      bad(`6 minute baad bhi live build ${live} hai, umeed thi ${local}`);
      note('PROBLEM', 'DEPLOY_TIMEOUT: 6 minute baad bhi naya build live nahi hua');
    }
  }

  return { envChanged };
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 4 — dobara verify (data safety + smoke)
// ════════════════════════════════════════════════════════════════════════════
async function verify(before) {
  phase('4/5 — Dobara verify');

  const health = await tryGet('/healthz');
  const after = health.body
    ? {
        active: health.body.activeSubscriptions ?? 0,
        trialing: health.body.trialingSubscriptions ?? 0,
        pending: health.body.pendingCheckouts ?? 0,
      }
    : null;

  if (after && before) {
    const same = after.active === before.active && after.trialing === before.trialing && after.pending === before.pending;
    const zeroed = before.active + before.trialing + before.pending > 0 && after.active + after.trialing + after.pending === 0;
    if (zeroed) {
      bad('DATA KHATRE ME: deploy ke baad customer counts ZERO ho gaye — volume mounted nahi hai');
      note('PROBLEM', 'DATA_AT_RISK: counts zero — DATA_DIR volume check karo (Railway dashboard -> service -> volume /data)');
      manual('Railway dashboard -> insta_flowai service -> Settings -> Volumes: /data mount verify karo');
    } else if (same) {
      ok(`Customer data SAFE hai — counts same: ${after.active} active / ${after.trialing} trial / ${after.pending} pending`);
      note('OK', `Data safe: ${after.active}/${after.trialing}/${after.pending}`);
    } else {
      warn(`Counts badle: ${before.active}/${before.trialing}/${before.pending} -> ${after.active}/${after.trialing}/${after.pending} (subscription activity ho sakti hai)`);
    }
  }

  // Smoke sweep — customer wale saare raaste.
  say('  ... smoke test chal raha hai (poora sweep)');
  const smokeArgs = ['scripts/smoke-test.mjs', `--url=${BASE}`];
  if (CHECK_ONLY) smokeArgs.push('--no-ai'); // check mode me AI credits na kharch hon
  const smoke = nodeRun(smokeArgs, { timeout: 300_000 });
  const tail = (smoke.stdout || '').trim().split('\n').slice(-6).join('\n       ');
  if (smoke.failed) {
    bad(`Smoke test FAIL (exit ${smoke.code}):\n       ${tail}`);
    note('PROBLEM', `SMOKE_FAIL: smoke test fail (exit ${smoke.code})`);
  } else {
    ok(`Smoke test PASS:\n       ${tail}`);
    note('OK', 'Smoke test pass');
    resolveFinding('SMOKE_FAIL');
  }
  if (after) resolveFinding('SERVER_DOWN');

  return after;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 5 — simple report
// ════════════════════════════════════════════════════════════════════════════
const CAUSE_TEXT = {
  DATA_AT_RISK: 'Customer ka data volume par save nahi ho raha (sabse gambhir).',
  SERVER_DOWN: 'Server chal hi nahi raha — site poori band hai.',
  ENV_MISSING: 'Host par zaroori config (settings) missing thi.',
  ENV_MISSING_SECRET: 'Host par secret keys missing hain — bot AI/Meta se baat nahi kar pa raha.',
  STALE_DEPLOY: 'Live par purana code tha — aapke is folder ke fixes deployed nahi the.',
  NO_LOCAL_BUILD: 'Is folder me build nahi tha.',
  APP_BROKEN: 'Customer dashboard toot gaya tha.',
  OPS_BUNDLE_MISSING: 'Ops console (aapka control panel) deploy me tha hi nahi.',
  AI_DEAD: 'AI jawab nahi de raha tha — bot sirf canned reply bhej raha tha.',
  OAUTH_MISCONFIG: 'Instagram connect ka redirect/webhook galat tha — customer connect nahi kar paate.',
  BUILD_FAIL: 'Code build nahi ho raha — source me error hai.',
  DEPLOY_FAIL: 'Deploy bhejne me hi fail ho gaya (Railway CLI).',
  DEPLOY_TIMEOUT: 'Deploy bheja tha par live nahi hua (timeout).',
  SMOKE_FAIL: 'Customer wale raaste theek nahi — smoke test fail hua.',
};

async function report(before, after) {
  phase('5/5 — Simple report');

  // Ops-page notification echo (optional).
  if (ID_TOKEN) {
    const health = await tryGet('/api/owner/health', { headers: { Authorization: `Bearer ${ID_TOKEN}` } });
    const rc = health.body?.rootCause;
    if (rc) {
      say(`  Ops page notification: ${rc.code} (${rc.affected}/${rc.accounts} accounts, severity=${rc.severity})`);
      say(`  Wahi karan ops page ke banner par bhi simple shabdon me likha hota hai: ${BASE}/ops`);
    }
  }

  const unresolved = findings.filter((f) => f.tag === 'PROBLEM' && !f.resolved);
  const doneFixes = findings.filter((f) => f.tag === 'FIXED');
  const todos = findings.filter((f) => f.tag === 'MANUAL');

  // MAIN KARAN = sabse gambhir baaki problem (priority order me). Har PROBLEM
  // note CODE: se shuru hota hai, isliye prefix se hi mil jata hai.
  const CAUSE_PRIORITY = [
    'DATA_AT_RISK', 'SERVER_DOWN', 'ENV_MISSING_SECRET', 'BUILD_FAIL', 'DEPLOY_FAIL',
    'DEPLOY_TIMEOUT', 'STALE_DEPLOY', 'AI_DEAD', 'OAUTH_MISCONFIG', 'SMOKE_FAIL',
    'ENV_MISSING', 'APP_BROKEN', 'OPS_BUNDLE_MISSING', 'NO_LOCAL_BUILD',
  ];
  const hit = CAUSE_PRIORITY.map((code) => unresolved.find((f) => f.text.startsWith(code))).find(Boolean);
  const mainKaran = hit
    ? CAUSE_TEXT[hit.text.split(':')[0]] || hit.text
    : findings.some((f) => f.tag === 'FIXED')
      ? 'Jo dikkat thi wo theek ho gayi — detail neeche.'
      : 'Koi problem nahi mili — project theek chal raha hai.';

  say('');
  say(bold('================ SIMPLE REPORT ================'));
  say(`PROJECT: ${BASE}`);
  say('');
  say(`MAIN KARAN (project rukne / gadbad ka): ${mainKaran}`);
  say('');
  if (doneFixes.length) {
    say('MAINE KHUD THEEK KIYA:');
    doneFixes.forEach((f, i) => say(`  ${i + 1}. ${f.text}`));
  } else {
    say('MAINE KHUD THEEK KIYA: kuch nahi — sab theek tha.');
  }
  say('');
  if (todos.length) {
    say('AAPKO KARNA HAI (main inke bina value nahi le sakta):');
    todos.forEach((f, i) => say(`  ${i + 1}. ${f.text}`));
  } else {
    say('AAPKO KARNA HAI: kuch nahi.');
  }
  say('');
  say(`DATA SAFE HAI: ${after ? 'haan — counts check kiye' : 'confirm nahi ho paya (/healthz nahi mila)'}`);
  say(`FINAL STATUS: ${unresolved.length ? red(`ABHI BHI ${unresolved.length} PROBLEM`) : green('SAB THEEK')}`);
  say('Poora detail: rescue-report.txt');
  say('===============================================');

  // File report.
  const lines = [
    `InstaFlow rescue report — ${new Date().toISOString()}`,
    `Target: ${BASE}   mode: ${CHECK_ONLY ? 'check-only' : 'fix'}${FORCE_DEPLOY ? ' +forced redeploy' : ''}`,
    '',
    ...logLines,
    '',
    '--- findings ---',
    ...findings.map((f) => `[${f.tag}] ${f.text}`),
  ];
  fs.writeFileSync(path.join(ROOT, 'rescue-report.txt'), lines.join('\n'), 'utf8');
  say('');
  say('rescue-report.txt save ho gaya (is folder me).');

  return unresolved.length ? 1 : 0;
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  say('');
  say(bold('InstaFlow AI — RESCUE (project jaanch + auto-fix)'));
  say(`Target: ${BASE}  |  mode: ${CHECK_ONLY ? 'sirf jaanch (--check)' : 'jaanch + theek karna'}${FORCE_DEPLOY ? ' + fresh deploy' : ''}`);

  if (!phase1Machine()) {
    say('');
    say(red('Machine/Railway theek nahi — uske bina project tak nahi pahunch sakte.'));
    say('Upar wale steps karo, phir rescue.cmd dobara chalao.');
    return 1;
  }

  const probe = await diagnose();
  for (const p of probe.problems) note('PROBLEM', `${p}: ${CAUSE_TEXT[p] || p}`);
  const before = probe.counts;

  await fix(probe);
  const after = await verify(before);
  return report(before, after);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\nRescue script crash ho gayi:', err);
    try {
      fs.appendFileSync(path.join(ROOT, 'rescue-report.txt'), `\nCRASH: ${String(err?.stack || err)}\n`);
    } catch { /* report file bhi na mile to koi baat nahi */ }
    process.exit(1);
  });
