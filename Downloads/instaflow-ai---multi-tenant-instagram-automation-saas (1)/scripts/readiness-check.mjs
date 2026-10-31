#!/usr/bin/env node
/**
 * Go-live readiness check for InstaFlow AI.
 *
 * `npm run smoke` answers "is the server healthy right now". This script answers
 * the different, blunter question: **is the thing I sell actually switched on?**
 * A deploy can be perfectly healthy while the product is not sellable — the ops
 * console bundle never uploaded, the bot answering with the canned "we received
 * your message" reply, Instagram OAuth pointing at a domain nobody configured,
 * no support email for the payment provider to call.
 *
 * Every check is done from the outside, as a stranger's browser would, so it
 * cannot be fooled by a stale local `.env` or a dev server still running in
 * another terminal. Nothing here needs a secret except the two optional ones
 * below.
 *
 * Usage:
 *   node scripts/readiness-check.mjs
 *   node scripts/readiness-check.mjs --url=https://www.thefgt.in
 *   READINESS_BASE_URL=https://www.thefgt.in npm run readiness
 *
 * Optional env:
 *   READINESS_ID_TOKEN  a Firebase ID token from a signed-in session (the owner
 *                       account, to check the /ops gate). Without it the two
 *                       signed-in checks are reported as SKIP, never as a pass.
 *                       How to get one:
 *                         sign in at <base>/app  →  DevTools  →  Application
 *                         →  IndexedDB  →  firebaseLocalStorage  →  the entry's
 *                         stsTokenManager.accessToken
 *
 * Exit code is 1 when a required check fails, so it can gate a release.
 */

const args = process.argv.slice(2);
const value = (name) => {
  const equals = args.find((a) => a.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return undefined;
};

const BASE_URL = (value('--url') || process.env.READINESS_BASE_URL || 'https://www.thefgt.in').replace(/\/+$/, '');
const ID_TOKEN = (process.env.READINESS_ID_TOKEN || '').trim();
const HOSTNAME = new URL(BASE_URL).hostname;
// Some checks are only meaningful against a real host: whether OAuth points at
// the public domain, whether a payment provider is configured, whether a
// reviewer finds a support email. Against localhost they would always fail and
// teach the reader to ignore the output, so they are reported but not required.
const IS_HOSTED = BASE_URL.startsWith('https://');

const results = [];
const record = (name, ok, detail, required = true) => {
  results.push({ name, ok, detail, required });
  const mark = ok ? '\u001b[32mPASS\u001b[0m' : required ? '\u001b[31mFAIL\u001b[0m' : '\u001b[33mSKIP\u001b[0m';
  console.log(`${mark}  ${name}\n        ${detail}`);
};
/** A check that could not be judged from outside — never counted as a pass. */
const skip = (name, why) => record(name, false, why, false);
/** A check about the *host's* configuration: required only when checking a real host. */
const recordHost = (name, ok, detail) => record(name, ok, detail, IS_HOSTED);

const json = async (path, init) => {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body, headers: res.headers };
};

const section = (title) => console.log(`\n=== ${title} ===`);

async function main() {
  console.log(`\nInstaFlow go-live readiness — ${BASE_URL}\n`);

  // ---------------------------------------------------------------------
  // 0. What build is actually serving traffic?
  // ---------------------------------------------------------------------
  section('Build');
  let liveBuildId = '';
  try {
    const version = await json('/api/version');
    liveBuildId = String(version.body?.buildId || '');
    record(
      'the server reports which build it is running',
      version.status === 200 && Boolean(liveBuildId),
      liveBuildId || `HTTP ${version.status}`
    );
  } catch (err) {
    record('the server reports which build it is running', false, String(err.message));
  }

  // The comparison that matters: the dashboard bundle in `dist/` is the one the
  // next deploy would upload. If the names differ, what you tested locally is
  // not what your customers are using.
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const distAssets = path.join(process.cwd(), 'dist', 'assets');
    if (!fs.existsSync(distAssets)) {
      skip('the live frontend matches the bundle in dist/', 'no dist/ here — run `npm run build` first to compare');
    } else {
      const main = fs.readdirSync(distAssets).find((f) => /^main-.*\.js$/.test(f));
      const localId = main ? main.replace(/\.js$/, '') : '';
      // The build id is the customer dashboard bundle's filename, so this only
      // proves the *frontend* is current. A server-only fix (AI model, owner
      // gate) keeps the same id — check `aiModel` and the /ops bundle for those.
      record(
        'the live frontend matches the bundle in dist/ (frontend only)',
        Boolean(localId) && localId === liveBuildId,
        localId
          ? `live=${liveBuildId}, dist=${localId}` +
            (localId === liveBuildId ? '' : ' — THE DEPLOYED FRONTEND IS OLDER THAN THIS WORKSPACE')
          : 'no main-*.js in dist/assets'
      );
    }
  } catch (err) {
    skip('live build matches the bundle in dist/', String(err.message));
  }

  // ---------------------------------------------------------------------
  // 1. Both apps must exist in the deploy.
  // ---------------------------------------------------------------------
  section('Apps');

  const customerShell = await fetch(`${BASE_URL}/app`);
  const customerBody = await customerShell.text();
  record(
    '/app serves the customer dashboard',
    customerShell.status === 200 && /InstaFlow/i.test(customerBody),
    `HTTP ${customerShell.status}, ${customerBody.length} bytes`
  );

  // The SPA fallback answers 200 for any path, so a status code proves nothing
  // here. The only trustworthy signal is that the ops shell names its own
  // bundle: without `assets/ops-*.js` the route exists but the console does not.
  const opsShell = await fetch(`${BASE_URL}/ops`);
  const opsBody = await opsShell.text();
  // Production points at a built chunk; the dev server transforms the entry in
  // place, so it names the source file instead. Both mean the console exists.
  const opsBundle = /assets\/ops-[A-Za-z0-9_-]+\.js/.exec(opsBody) || /\/src\/ops\.tsx/.exec(opsBody);
  record(
    '/ops ships its own owner-console bundle',
    opsShell.status === 200 && Boolean(opsBundle),
    opsBundle
      ? opsBundle[0]
      : `HTTP ${opsShell.status}, ${opsBody.length} bytes — the ops bundle is NOT in this deploy (owner console unreachable on this host)`
  );

  // ---------------------------------------------------------------------
  // 2. The bot: the only part of the product a customer's customer sees.
  // ---------------------------------------------------------------------
  section('The bot');
  try {
    const started = Date.now();
    const sim = await json('/api/simulate-dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'default_tenant' },
      body: JSON.stringify({
        message: 'Price kya hai aur kitne din ka tour hai?',
        systemPrompt: 'You are the DM assistant for Desi Tours. Reply in Hinglish, briefly.',
        knowledgeBase: 'Price: Rs 2500 per person for 2 nights. Includes stay, breakfast and sightseeing.',
        conversationHistory: [],
      }),
    });
    const ms = Date.now() - started;
    const provider = String(sim.body?.provider || '');
    if (sim.status === 429) {
      skip('a real DM gets an AI answer (not the canned reply)', 'demo budget exhausted (429) — rerun in a few minutes');
    } else {
      // `provider: 'fallback'` is the canned "we received your message" text that
      // no AI produced. It is the exact symptom of the retired-model incident,
      // and it looks fine in a log line, so it is treated as a hard failure.
      record(
        'a real DM gets an AI answer (not the canned reply)',
        sim.status === 200 && provider && provider !== 'fallback' && String(sim.body?.reply || '').trim().length > 0,
        provider === 'fallback'
          ? `no AI answered in ${ms}ms — the provider fell through to the canned reply. Check the primary AI model (see /healthz aiModel; OPENROUTER_MODEL / OMNIROUTE_MODEL) and the API keys.`
          : `HTTP ${sim.status}, provider=${provider}, model=${sim.body?.model}, ${ms}ms, reply="${String(sim.body?.reply || '').slice(0, 60)}"`
      );
    }
  } catch (err) {
    record('a real DM gets an AI answer (not the canned reply)', false, String(err.message));
  }

  // ---------------------------------------------------------------------
  // 3. Health, config and the values a customer's browser depends on.
  // ---------------------------------------------------------------------
  section('Configuration');
  let health = {};
  try {
    const res = await json('/healthz');
    health = res.body || {};
    record('/healthz reports ok', res.status === 200 && health.status === 'ok', `HTTP ${res.status}`);

    // `aiModel` is the model the server resolved (after retired-name remapping) and is only
    // exposed by newer builds. If it is missing, the host is running an OLD build — which is
    // exactly the state that made every DM fall back to the canned reply — so it cannot PASS.
    const aiModelKnown = Boolean(health.aiModel);
    record(
      'an AI provider is configured on the host',
      aiModelKnown &&
        String(health.aiProvider || '') !== 'None' &&
        !/Warning/.test(String(health.aiProvider || '')),
      aiModelKnown
        ? `aiProvider=${health.aiProvider}, aiModel=${health.aiModel}, host model=${health.aiModelConfigured}`
        : `the host does not report which model it uses (aiModel is undefined) — it runs an OLDER build than this workspace. aiProvider=${health.aiProvider}`
    );

    record(
      'webhook deliveries are signature-enforced',
      Boolean(health.webhookSignatureEnforced),
      `${health.webhookSignatureMode}, secrets=${JSON.stringify(health.webhookSecretsConfigured)}`
    );

    recordHost(
      'support email is set and a public complaint route exists (payment providers look for these)',
      Boolean(health.supportContactConfigured),
      health.supportContactConfigured
        ? 'set'
        : 'SUPPORT_EMAIL / BUSINESS_NAME / BUSINESS_ADDRESS are empty on the host — a Razorpay reviewer cannot reach a human'
    );

    recordHost(
      'complaints are pushed to the owner on WhatsApp',
      Boolean(health.complaintWhatsAppConfigured),
      health.complaintWhatsAppConfigured
        ? `relay configured for ${health.complaintWhatsAppTarget || 'the owner'} (${health.complaintsOpen ?? 0} open)`
        : 'COMPLAINT_WHATSAPP_TO / CALLMEBOT_API_KEY are empty on the host — the complaint form still stores submissions, but nobody is notified'
    );

    recordHost(
      'payments are configured',
      Boolean(health.paymentsConfigured),
      `paymentsConfigured=${health.paymentsConfigured}, pendingCheckouts=${health.pendingCheckouts}, activeSubscriptions=${health.activeSubscriptions}, trialing=${health.trialingSubscriptions}`
    );
  } catch (err) {
    record('/healthz reports ok', false, String(err.message));
  }

  // ---------------------------------------------------------------------
  // 4. Instagram connect: the one step a new customer cannot fix themselves.
  // ---------------------------------------------------------------------
  section('Instagram connect');
  try {
    const res = await json('/api/instagram/status', { headers: { 'x-tenant-id': 'default_tenant' } });
    const body = res.body || {};
    const redirect = String(body.oauthRedirectUri || '');
    const webhook = String(body.webhookUrl || '');
    recordHost(
      'OAuth callback points at this same domain',
      redirect.startsWith('https://') && redirect.includes(HOSTNAME),
      redirect || 'not configured'
    );
    recordHost(
      'the webhook URL is https and on this domain',
      webhook.startsWith('https://') && webhook.includes(HOSTNAME),
      webhook || 'not configured'
    );
    record(
      'an Instagram app id is wired in',
      Boolean(body.oauthClientId),
      `clientId=${body.oauthClientId || 'missing'} (${body.oauthFlavour || '?'})`
    );
  } catch (err) {
    record('OAuth callback points at this same domain', false, String(err.message));
  }

  // Cannot be judged from outside: Meta only lets accounts with a role on the
  // app (admin/tester) complete the authorization while the app is in
  // Development mode. A new customer will be refused there, by Meta, even with
  // every check above passing.
  skip(
    'a brand-new customer can connect Instagram unaided',
    'cannot be checked from here — open the Meta app 1226093629512976 → Use cases → Instagram API → Permissions and features. `instagram_business_basic`, `instagram_business_manage_messages` and `instagram_business_manage_comments` must read Advanced access (App Review approved). The app itself is already Published (live mode, since 27 Sep) — while those permissions read "Ready for testing" (Standard access) this is FALSE for anyone who is not an app tester, which is every new customer.'
  );

  // ---------------------------------------------------------------------
  // 5. Meta compliance: the pages Meta's reviewers open before App Review.
  // ---------------------------------------------------------------------
  section('Meta compliance');
  for (const check of [
    {
      path: '/data-deletion',
      label: 'the data-deletion instructions page is real (not the app shell)',
      marker: /Delete it via Meta|confirmation code/i,
      hint: 'this is the SPA shell, so Meta\u2019s "User data deletion" URL (and App Review) would point at a page that does not exist',
    },
    {
      path: '/data-deletion-status',
      label: 'the data-deletion status page answers (Meta callback lands here)',
      marker: /Confirmation code|Add <code>\?code=/,
      hint: 'the callback hands Meta a status URL that leads nowhere',
    },
  ]) {
    // A missing page and the SPA shell both answer 200, so only the content can
    // tell them apart — assert on a marker that the real page always prints.
    try {
      const res = await fetch(`${BASE_URL}${check.path}`);
      const html = await res.text();
      const real = res.status === 200 && check.marker.test(html);
      record(check.label, real, real ? `${html.length} bytes` : `HTTP ${res.status}, ${html.length} bytes — ${check.hint}`);
    } catch (err) {
      record(check.label, false, String(err.message));
    }
  }

  // ---------------------------------------------------------------------
  // 6. The owner console gate — only judgeable with a real signed-in token.
  // ---------------------------------------------------------------------
  section('Owner console');
  if (!ID_TOKEN) {
    skip(
      'the signed-in owner account is recognised as owner',
      'set READINESS_ID_TOKEN to the owner\u2019s Firebase ID token to check this (see the header of this file)'
    );
  } else {
    try {
      const sub = await json('/api/subscription', { headers: { Authorization: `Bearer ${ID_TOKEN}` } });
      record(
        'the signed-in owner account is recognised as owner',
        sub.status === 200 && sub.body?.isOwner === true,
        `HTTP ${sub.status}, isOwner=${sub.body?.isOwner} — set OWNER_EMAILS or OWNER_TENANT_IDS on the host if false`
      );
    } catch (err) {
      record('the signed-in owner account is recognised as owner', false, String(err.message));
    }
    try {
      const tenants = await json('/api/owner/tenants', { headers: { Authorization: `Bearer ${ID_TOKEN}` } });
      const count = Array.isArray(tenants.body?.tenants) ? tenants.body.tenants.length : 0;
      record(
        'the owner can list every tenant',
        tenants.status === 200 && count > 0,
        tenants.status === 200 ? `${count} tenant(s)` : `HTTP ${tenants.status} ${tenants.body?.code || ''}`
      );
    } catch (err) {
      record('the owner can list every tenant', false, String(err.message));
    }
  }

  // ---------------------------------------------------------------------
  // Verdict
  // ---------------------------------------------------------------------
  const blockers = results.filter((r) => !r.ok && r.required);
  const skips = results.filter((r) => !r.ok && !r.required);
  console.log('');
  if (blockers.length) {
    console.log(`\u001b[31mNOT READY\u001b[0m — ${blockers.length} blocker(s):`);
    for (const b of blockers) console.log(`  - ${b.name}`);
  } else {
    console.log('\u001b[32mREADY\u001b[0m — every check that can be made from outside passed.');
  }
  if (skips.length) {
    console.log(`\n${skips.length} check(s) could not be judged from outside and are NOT counted as passing:`);
    for (const s of skips) console.log(`  - ${s.name}`);
  }
  console.log('');
  process.exit(blockers.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\nReadiness check crashed:', err);
  process.exit(1);
});
