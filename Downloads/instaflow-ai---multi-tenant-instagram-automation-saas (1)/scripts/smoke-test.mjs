#!/usr/bin/env node
/**
 * Post-deploy smoke test for InstaFlow AI.
 *
 * Verifies the things that actually break a live webhook bot: the app boots,
 * the AI provider answers, Meta's challenge handshake works, and — most
 * importantly — unsigned webhook deliveries are rejected while correctly
 * signed ones are accepted and de-duplicated.
 *
 * It also checks the self-serve product surface a customer touches: the pricing
 * page, the plan catalogue, and the public booking page (including that an
 * unknown handle 404s instead of leaking a broken form).
 *
 * Usage:
 *   node scripts/smoke-test.mjs                                  # localhost:3000
 *   node scripts/smoke-test.mjs --url=https://my-app.up.railway.app
 *   SMOKE_BASE_URL=https://my-app.up.railway.app npm run smoke
 *
 * Environment (optional, enables the signed-webhook checks):
 *   META_APP_SECRET      - when set, a signed delivery is sent and de-dupe is asserted
 *   META_VERIFY_TOKEN    - defaults to instaflow_secure_verify_token
 *   SMOKE_RESOLVE_IP     - pin DNS to one edge IP (see --resolve-ip)
 *   SMOKE_ID_TOKEN       - a Firebase ID token from a signed-in session. Set it
 *                          and the tenant endpoints are checked as a customer;
 *                          leave it out and they are checked for rejecting
 *                          anonymous callers
 *
 * Flags:
 *   --url=<base url>   target server (default http://localhost:3000)
 *   --no-ai            skip the AI reply check (no provider credits spent)
 *   --e2e              also POST a full fake DM and assert the retry is deduped
 *   --resolve-ip=<ip>  send every request to this IP while keeping the real Host
 *                      header and validating the real certificate
 */

import crypto from 'crypto';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const equals = args.find((a) => a.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  // `--url http://localhost:3999` (a space) is how people actually type it. It
  // used to be ignored in silence, so the run quietly tested whatever was on the
  // default port instead and reported on a server nobody meant to check.
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return undefined;
};

const BASE_URL = (value('--url') || process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const RUN_AI = !flag('--no-ai');
const RUN_E2E = flag('--e2e');

const APP_SECRET = process.env.META_APP_SECRET || '';
const ID_TOKEN = process.env.SMOKE_ID_TOKEN || '';
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'instaflow_secure_verify_token';

// Moving to a custom domain has a chicken-and-egg problem: Railway says the
// domain is verified and the certificate is valid long before the resolver on
// your own machine stops serving the *old* provider's cached record. During
// that window this script would test the OLD host while claiming to test the
// new one — the worst possible outcome, because it looks like a passing or
// failing code change rather than a stale cache.
//
// `--resolve-ip` removes that ambiguity: every request is forced to one edge IP
// while the Host header and the TLS certificate check still use the real
// domain, which is exactly the request Meta's own servers make.
const RESOLVE_IP = value('--resolve-ip') || process.env.SMOKE_RESOLVE_IP || '';

if (RESOLVE_IP) {
  const https = await import('node:https');
  const tls = await import('node:tls');
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.protocol !== 'https:') {
      return Promise.reject(new Error('--resolve-ip only supports https targets'));
    }
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: RESOLVE_IP,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: init.method || 'GET',
          servername: url.hostname,
          headers: { ...(init.headers || {}), host: url.host },
          // The socket connects to a bare IP, so tell Node which name the
          // certificate actually has to be valid for.
          checkServerIdentity: (_host, cert) => tls.checkServerIdentity(url.hostname, cert),
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
              text: async () => body,
              json: async () => JSON.parse(body),
            });
          });
        },
      );
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  };
}

const results = [];
let failures = 0;

function record(name, ok, detail = '', required = true) {
  results.push({ name, ok, detail, required });
  if (!ok && required) failures += 1;
  const mark = ok ? 'PASS' : required ? 'FAIL' : 'SKIP';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`\nInstaFlow AI smoke test → ${BASE_URL}${RESOLVE_IP ? ` (pinned to ${RESOLVE_IP})` : ''}\n`);

  // 1. The public home page — what a visitor (and any payment-provider review of
  // this domain) sees before logging in.
  const root = await fetch(`${BASE_URL}/`);
  const rootBody = await root.text();
  const landingHeadline =
    /khud handle ho jaayein/i.test(rootBody) || /Let Instagram DMs answer themselves/i.test(rootBody);
  record(
    'GET / serves the public landing page',
    root.status === 200 && landingHeadline && /\u20b9/.test(rootBody) && /\/plans/.test(rootBody),
    `HTTP ${root.status}, ${rootBody.length} bytes`
  );

  // 1a-ii. Both languages have to be real, not decorative: each one must render
  // its own headline, carry the switch, and pin the choice in a cookie so the
  // next page (and the API's error messages) follow the reader.
  const [enPage, hiPage] = await Promise.all([
    fetch(`${BASE_URL}/?lang=en`),
    fetch(`${BASE_URL}/?lang=hi`),
  ]);
  const [enBody, hiBody] = await Promise.all([enPage.text(), hiPage.text()]);
  const enCookie = (enPage.headers.get('set-cookie') || '').includes('if_lang=en');
  const hiCookie = (hiPage.headers.get('set-cookie') || '').includes('if_lang=hi');
  record(
    'GET / serves English and Hindi, and remembers the choice',
    /Let Instagram DMs answer themselves/i.test(enBody) &&
      /khud handle ho jaayein/i.test(hiBody) &&
      /langswitch/.test(enBody) &&
      /langswitch/.test(hiBody) &&
      enCookie &&
      hiCookie,
    `en=${enPage.status}${enCookie ? ' +cookie' : ''}, hi=${hiPage.status}${hiCookie ? ' +cookie' : ''}`
  );

  // 1a-ii. The policy pages a payment provider reviews before it activates a
  // payment account. These must be real server-rendered pages: the SPA shell
  // answers 200 for any path, so a status code alone proves nothing — each page
  // is asserted on its own marker text and on NOT being the dashboard shell.
  const reviewPages = [
    { path: '/refund-policy', marker: /Duplicate or double charge/i, label: 'Refund & Cancellation Policy' },
    { path: '/contact', marker: /Contact Us/i, label: 'Contact Us' },
    { path: '/privacy-policy', marker: /Privacy Policy/i, label: 'Privacy Policy' },
    { path: '/terms-of-service', marker: /Terms of Service/i, label: 'Terms of Service' },
  ];

  for (const page of reviewPages) {
    try {
      const res = await fetch(`${BASE_URL}${page.path}`);
      const body = await res.text();
      const isRealPage = page.marker.test(body) && !body.includes('id="root"');
      record(
        `${page.path} serves a real ${page.label} page`,
        res.status === 200 && isRealPage,
        res.status !== 200
          ? `HTTP ${res.status}`
          : isRealPage
            ? `${body.length} bytes`
            : 'served the dashboard shell instead of page content'
      );
    } catch (err) {
      record(`${page.path} serves a real ${page.label} page`, false, String(err.message));
    }
  }

  // 1a-iii. The complaint form replaced the owner's printed mobile number on the
  // public pages. These checks are the regression guard for that: the form must be
  // reachable, must be the contact route on /contact, and must never leak a phone
  // number or a WhatsApp deep link back into the browser.
  try {
    const formRes = await fetch(`${BASE_URL}/complaint`);
    const formBody = await formRes.text();
    const leaks = /wa\.me/i.test(formBody) || /tel:\+?\d/.test(formBody) || /Phone\s*\/\s*WhatsApp/i.test(formBody);
    record(
      '/complaint serves the public complaint form',
      formRes.status === 200 && /id="complaint-form"/.test(formBody) && /\/api\/complaints/.test(formBody),
      `HTTP ${formRes.status}, ${formBody.length} bytes`
    );
    record(
      'the complaint form publishes no phone number or WhatsApp link',
      !leaks,
      leaks ? 'a phone number or wa.me link is still rendered into the page' : 'no number published'
    );

    const contactRes = await fetch(`${BASE_URL}/contact`);
    const contactBody = await contactRes.text();
    const contactLeaks = /wa\.me/i.test(contactBody) || /Phone\s*\/\s*WhatsApp/i.test(contactBody);
    record(
      '/contact offers the complaint form instead of a phone number',
      contactRes.status === 200 && /id="complaint-form"/.test(contactBody) && !contactLeaks,
      !/id="complaint-form"/.test(contactBody)
        ? 'the complaint form is missing from /contact'
        : contactLeaks
          ? 'a phone number or wa.me link is still rendered into the page'
          : 'form present, no printed number'
    );

    // The public form must reject a junk submission. This asserts the validation
    // without creating a real record (and without pinging the owner's WhatsApp).
    const badRes = await fetch(`${BASE_URL}/api/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'x', contact: '1', problem: 'short' }),
    });
    record(
      'the complaint form rejects an incomplete submission',
      badRes.status === 400,
      `HTTP ${badRes.status}`
    );
  } catch (err) {
    record('/complaint serves the public complaint form', false, String(err.message));
  }

  // 1b. The dashboard itself lives at /app.
  const appShell = await fetch(`${BASE_URL}/app`);
  const appBody = await appShell.text();
  record(
    'GET /app serves the dashboard shell',
    appShell.status === 200 && /InstaFlow/i.test(appBody),
    `HTTP ${appShell.status}`
  );

  // 1c. Deploy awareness. An open dashboard tab keeps running the bundle it
  // loaded, however many times the server is redeployed underneath it — which
  // is how a fixed bug looks like it "came back". Two things make that
  // survivable: the shell must carry the build id it was built from so an open
  // tab can notice /api/version has moved on, and the shell itself must never
  // be cached, or a returning visitor never even asks for the new one.
  try {
    const versionRes = await fetch(`${BASE_URL}/api/version`);
    const { buildId } = await versionRes.json();
    const stamped = /window\.__BUILD_ID__="([^"]+)"/.exec(appBody);
    record(
      'the dashboard shell is stamped with the build it came from',
      Boolean(buildId) && Boolean(stamped) && stamped[1] === buildId,
      stamped ? `shell=${stamped[1]}, server=${buildId}` : 'no build id stamped into the shell'
    );
    record(
      'the dashboard shell is served uncached',
      /no-store/.test(appShell.headers.get('cache-control') || ''),
      `Cache-Control: ${appShell.headers.get('cache-control')}`
    );
  } catch (err) {
    record('the dashboard shell is stamped with the build it came from', false, String(err.message));
  }

  // 2. Healthcheck (this is what Railway gates cutovers on).
  let health = {};
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    health = await res.json();
    record(
      'GET /healthz reports ok',
      res.status === 200 && health.status === 'ok',
      `HTTP ${res.status}, aiProvider=${health.aiProvider}, inbox=${health.inboxConversations ?? 'n/a'}`
    );
    const signatureMode =
      health.webhookSignatureMode || (health.webhookSignatureEnforced ? 'enforce' : 'disabled');
    record(
      'webhook signature enforcement is ON',
      health.webhookSignatureEnforced === true,
      health.webhookSignatureEnforced
        ? 'enforced'
        : signatureMode === 'warn'
          ? 'WEBHOOK_SIGNATURE_MODE=warn — unverified deliveries are accepted (temporary!)'
          : 'no webhook secret configured on the server',
      false
    );
    // Not a hard failure locally (dev has no business details), but the loudest
    // warning in this file: an empty contact page is a common rejection reason.
    record(
      'public site names a contactable business (SUPPORT_EMAIL + public complaint form)',
      health.supportContactConfigured === true,
      health.supportContactConfigured
        ? 'configured'
        : 'set SUPPORT_EMAIL, BUSINESS_NAME and BUSINESS_ADDRESS on the host before submitting the domain for verification',
      false
    );
    // The complaint form still accepts and stores submissions without this, but
    // nobody is pinged on WhatsApp — the one silent failure worth shouting about.
    record(
      'complaints reach the owner on WhatsApp',
      health.complaintWhatsAppConfigured === true,
      health.complaintWhatsAppConfigured
        ? `relay configured for ${health.complaintWhatsAppTarget || 'the owner'}`
        : 'COMPLAINT_WHATSAPP_TO / CALLMEBOT_API_KEY are not set on the host — complaints are stored but nobody is notified',
      false
    );
  } catch (err) {
    record('GET /healthz reports ok', false, String(err.message));
  }

  // 3. Tenant-owned endpoints. These used to answer anyone who sent an
  // `x-tenant-id` header, and a tenant id is not a secret — so a customer's
  // connection, knowledge base, leads and DM history were one guessed uid away.
  // They now require a verified Firebase ID token. With SMOKE_ID_TOKEN set the
  // same checks run as a signed-in customer; without it, the checks assert the
  // opposite: anonymous callers are refused.
  const tenantHeaders = {
    'x-tenant-id': 'smoke-test-tenant',
    ...(ID_TOKEN ? { Authorization: `Bearer ${ID_TOKEN}` } : {}),
  };
  const tenantLabel = ID_TOKEN ? '(signed in)' : 'rejects an anonymous caller';

  const status = await fetch(`${BASE_URL}/api/instagram/status`, { headers: tenantHeaders });
  const statusData = await status.json().catch(() => ({}));
  record(
    `GET /api/instagram/status ${tenantLabel}`,
    ID_TOKEN ? status.status === 200 : status.status === 401 && statusData?.code === 'AUTH_REQUIRED',
    `HTTP ${status.status}${statusData?.code ? ` (${statusData.code})` : ''}`
  );

  // A token this app never issued must never be accepted, however real the
  // tenant header next to it looks.
  const forged = await fetch(`${BASE_URL}/api/leads`, {
    headers: { 'x-tenant-id': 'smoke-test-tenant', Authorization: 'Bearer not.a.real.token' },
  });
  record('a forged sign-in token is rejected', forged.status === 401, `HTTP ${forged.status} (expected 401)`);

  // Demo Mode has no account behind it, so it is let through — but only as the
  // demo tenant, which must never show another customer's data.
  const demoSub = await fetch(`${BASE_URL}/api/subscription`, { headers: { 'x-tenant-id': 'default_tenant' } });
  const demoSubData = await demoSub.json().catch(() => ({}));
  record(
    'the demo tenant still works without a sign-in',
    demoSub.status === 200 && typeof demoSubData?.access?.allowed === 'boolean',
    `HTTP ${demoSub.status}, allowed=${demoSubData?.access?.allowed}`
  );

  const demoLeads = await fetch(`${BASE_URL}/api/leads`, { headers: { 'x-tenant-id': 'default_tenant' } });
  const demoLeadsData = await demoLeads.json().catch(() => ({}));
  record(
    'the demo tenant only reaches its own leads',
    demoLeads.status === 200 &&
      Array.isArray(demoLeadsData?.leads) &&
      demoLeadsData.leads.every((lead) => lead.tenantId === 'default_tenant'),
    `${demoLeadsData?.leads?.length ?? 'n/a'} lead(s) visible`
  );

  // 3b. The per-tenant AI settings the webhook actually answers from.
  try {
    const res = await fetch(`${BASE_URL}/api/tenant-settings`, { headers: tenantHeaders });
    const data = await res.json().catch(() => ({}));
    const settings = data?.settings;
    record(
      `GET /api/tenant-settings ${tenantLabel}`,
      ID_TOKEN
        ? res.status === 200 && typeof settings?.systemPrompt === 'string' && settings.systemPrompt.length > 20
        : res.status === 401,
      `HTTP ${res.status}, customised=${settings?.customised}, documents=${settings?.knowledgeItems?.length ?? 0}`
    );
  } catch (err) {
    record(`GET /api/tenant-settings ${tenantLabel}`, false, String(err.message));
  }

  // 3c. Knowledge-base gap tracking (questions the bot could not answer).
  try {
    const res = await fetch(`${BASE_URL}/api/kb-gaps`, { headers: tenantHeaders });
    const data = await res.json().catch(() => ({}));
    record(
      `GET /api/kb-gaps ${tenantLabel}`,
      ID_TOKEN ? res.status === 200 && Array.isArray(data?.gaps) : res.status === 401,
      `HTTP ${res.status}, tracked=${data?.total ?? 'n/a'}`
    );
  } catch (err) {
    record(`GET /api/kb-gaps ${tenantLabel}`, false, String(err.message));
  }

  // 3d. Plans / subscription: a business owner can buy without us touching anything.
  try {
    const res = await fetch(`${BASE_URL}/api/plans`);
    const data = await res.json();
    const plans = Array.isArray(data?.plans) ? data.plans : [];
    record(
      'GET /api/plans returns purchasable plans',
      res.status === 200 && plans.length > 0 && plans.every((p) => typeof p.priceInr === 'number'),
      `HTTP ${res.status}, plans=${plans.map((p) => `${p.id}:${p.priceInr}`).join(', ') || 'none'}`
    );
  } catch (err) {
    record('GET /api/plans returns purchasable plans', false, String(err.message));
  }

  try {
    const res = await fetch(`${BASE_URL}/plans`);
    const body = await res.text();
    record(
      'GET /plans renders the public pricing page',
      res.status === 200 && /₹/.test(body) && /Most popular/i.test(body),
      `HTTP ${res.status}, ${(body.match(/₹[\d,]+/g) || []).join(' / ') || 'no prices found'}`
    );
  } catch (err) {
    record('GET /plans renders the public pricing page', false, String(err.message));
  }

  try {
    const res = await fetch(`${BASE_URL}/api/subscription`, { headers: tenantHeaders });
    const data = await res.json().catch(() => ({}));
    record(
      `GET /api/subscription reports access ${tenantLabel}`,
      ID_TOKEN
        ? res.status === 200 && typeof data?.access?.allowed === 'boolean'
        : res.status === 401,
      `HTTP ${res.status}, allowed=${data?.access?.allowed} (${data?.access?.reason}), payments=${data?.payments?.configured}`
    );
  } catch (err) {
    record(`GET /api/subscription reports access ${tenantLabel}`, false, String(err.message));
  }

  // 3e. Public booking page: unknown handles must fail closed, not show a form.
  try {
    const res = await fetch(`${BASE_URL}/book/smoke-test-no-such-handle`);
    const body = await res.text();
    record(
      'GET /book/<unknown> returns 404',
      res.status === 404 && /not found/i.test(body),
      `HTTP ${res.status}`
    );
  } catch (err) {
    record('GET /book/<unknown> returns 404', false, String(err.message));
  }

  try {
    const res = await fetch(`${BASE_URL}/api/leads`, { headers: tenantHeaders });
    const data = await res.json().catch(() => ({}));
    record(
      `GET /api/leads ${tenantLabel}`,
      ID_TOKEN ? res.status === 200 && Array.isArray(data?.leads) : res.status === 401,
      `HTTP ${res.status}, newLeads=${data?.stats?.newLeads ?? 'n/a'}`
    );
  } catch (err) {
    record(`GET /api/leads ${tenantLabel}`, false, String(err.message));
  }

  // 3f. An unsigned Razorpay webhook must never activate a plan.
  try {
    const res = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    });
    record('unsigned Razorpay webhook is rejected', res.status === 401, `HTTP ${res.status} (expected 401)`);
  } catch (err) {
    record('unsigned Razorpay webhook is rejected', false, String(err.message));
  }

  // 3g. The owner's billing reset must refuse a caller who is not the owner.
  //
  // Sent as the demo tenant on purpose. The API auth middleware answers 401 for
  // *any* unknown `/api/` path, so an anonymous request would pass this check even
  // if the route were missing from the build — it proves nothing. Clearing the
  // middleware is what makes the answer meaningful: the route has to exist to
  // reach its own guard, and the guard has to answer 403, because this is the one
  // route that can clear a *paying* customer's billing row by accident.
  //
  // `default_tenant` mirrors DEMO_TENANT_ID in server.ts; if that constant is ever
  // renamed, this check fails loudly rather than passing on a 401 it did not mean.
  try {
    const res = await fetch(`${BASE_URL}/api/owner/billing/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'default_tenant' },
      body: JSON.stringify({ dryRun: true }),
    });
    const data = await res.json().catch(() => null);
    record(
      'a non-owner caller is refused by the owner billing reset',
      res.status === 403 && data?.code === 'OWNER_ONLY',
      `HTTP ${res.status}${data?.code ? ` (${data.code})` : ''}`
    );
  } catch (err) {
    record('a non-owner caller is refused by the owner billing reset', false, String(err.message));
  }

  // 4. Unsigned webhook deliveries must be rejected when a secret is configured.
  const unsigned = await fetch(`${BASE_URL}/api/webhook/instagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: 'instagram', entry: [] }),
  });
  record(
    'unsigned webhook POST is rejected',
    health.webhookSignatureEnforced ? unsigned.status === 401 : unsigned.status === 200,
    `HTTP ${unsigned.status} (${health.webhookSignatureEnforced ? 'expected 401' : 'accepted because enforcement is off'})`
  );

  // 5. Meta's GET verification handshake.
  const challenge = `smoke-${Date.now()}`;
  const verify = await fetch(
    `${BASE_URL}/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=${challenge}`
  );
  const verifyBody = (await verify.text()).trim();
  record(
    'webhook GET challenge is echoed',
    verify.status === 200 && verifyBody === challenge,
    `HTTP ${verify.status}, body="${verifyBody}"`
  );

  // 6. Correctly signed delivery is accepted (and a repeat is deduped).
  if (APP_SECRET) {
    const payload = JSON.stringify({
      object: 'instagram',
      entry: RUN_E2E
        ? [
            {
              id: `smoke-account-${Date.now()}`,
              messaging: [
                {
                  sender: { id: `smoke-sender-${Date.now()}` },
                  recipient: { id: `smoke-account-${Date.now()}` },
                  message: { mid: `smoke-mid-${Date.now()}`, text: 'Smoke test ping' },
                },
              ],
            },
          ]
        : [],
    });

    const send = async () => {
      const signature = crypto.createHmac('sha256', APP_SECRET).update(Buffer.from(payload)).digest('hex');
      return fetch(`${BASE_URL}/api/webhook/instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
        body: payload,
      });
    };

    const signed = await send();
    record('signed webhook POST is accepted', signed.status === 200, `HTTP ${signed.status}`);

    if (RUN_E2E) {
      // Meta retries a delivery; a second reply must NOT be generated. The
      // dedupe cache is on the volume, so this also asserts persistence.
      const retry = await send();
      record('duplicate delivery is accepted but deduped', retry.status === 200, `HTTP ${retry.status}`);
      if (health.dedupeTrackedIds !== undefined) {
        const after = await (await fetch(`${BASE_URL}/healthz`)).json();
        record(
          'dedupe store recorded the message id',
          Number(after.dedupeTrackedIds) >= 1,
          `dedupeTrackedIds=${after.dedupeTrackedIds}`
        );
      }
    }
  } else {
    record('signed webhook POST is accepted', false, 'set META_APP_SECRET to run this check', false);
  }

  // 7. The AI provider actually answers.
  if (RUN_AI) {
    try {
      // The simulator is a tenant route, so it needs a verified token — but the
      // demo tenant is reachable without one by design, which keeps this check
      // runnable in a plain (anonymous) shell too.
      const res = await fetch(`${BASE_URL}/api/simulate-dm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': ID_TOKEN ? 'smoke-test-tenant' : 'default_tenant',
          ...(ID_TOKEN ? { Authorization: `Bearer ${ID_TOKEN}` } : {}),
        },
        body: JSON.stringify({ message: 'Reply with the single word: pong' }),
      });
      const data = await res.json();
      if (res.status === 429) {
        // The demo simulator has a per-visitor budget (it is the only AI endpoint
        // reachable without signing in). Hitting it means the guard works, not
        // that the provider is down — so this is not a failure.
        record('AI provider generates a reply', false, 'demo budget exhausted (429) — rerun in a few minutes', false);
      } else {
        // `provider: 'fallback'` is the canned "we received your message" reply,
        // and it is why this check used to pass while the bot was effectively
        // dead: on 2026-09-29 the configured OpenRouter model had been retired, so
        // every DM quietly fell through to nothing usable, and the only symptom
        // was a reply that looked fine in a log line. A reply that no AI produced
        // is not an AI that answers, so it fails here instead.
        const provider = String(data.provider || '');
        record(
          'AI provider generates a reply',
          res.status === 200 &&
            typeof data.reply === 'string' &&
            data.reply.trim().length > 0 &&
            provider !== 'fallback',
          `HTTP ${res.status}, provider=${data.provider}, model=${data.model}, reply="${String(data.reply || '').slice(0, 50)}"` +
            (provider === 'fallback'
              ? ' — NO AI ANSWERED: check the configured model still exists at the provider, then the API keys'
              : '')
        );
      }
    } catch (err) {
      record('AI provider generates a reply', false, String(err.message));
    }
  }

  const failed = results.filter((r) => !r.ok && r.required);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length) {
    console.error(`Smoke test FAILED: ${failed.map((r) => r.name).join(', ')}\n`);
    process.exit(1);
  }
  console.log('Smoke test passed.\n');
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
