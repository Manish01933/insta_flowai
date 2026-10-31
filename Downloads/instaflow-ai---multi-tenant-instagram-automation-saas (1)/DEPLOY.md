# Deploying InstaFlow AI

This app is a **single Node process** (Express + Vite build output). It needs:

- a host that runs a long-lived Node process (**not** a static host, **not** serverless functions)
- a public **HTTPS** URL (Meta rejects plain HTTP for webhooks and OAuth redirects)
- **persistent disk** for connected Instagram accounts
- one shared `.env` worth of secrets injected as environment variables

---

## 1. What only you can provide

| # | Item | Why it is needed | Where |
|---|------|------------------|-------|
| 1 | **Railway or Render account** (login) | Hosting. I cannot authenticate as you. | railway.com / render.com |
| 2 | **A domain** (optional) | A custom URL. Without one you get a free `<service>.up.railway.app` / `.onrender.com` subdomain with TLS. | Any registrar, or Cloudflare |
| 3 | **`META_APP_SECRET`** | OAuth token exchange. **Still empty — this is the current hard blocker.** | Meta App → Settings → Basic → App Secret |
| 4 | **Meta dashboard edits** | Whitelist the domain, subscribe webhooks. | developers.facebook.com |
| 5 | **Firebase console edits** | Authorize the domain, enable sign-in providers. | console.firebase.google.com |

Steps 3–5 are per-domain. **A free quick-tunnel hostname rotates on every restart, so those steps have to be redone each time — a real deploy fixes that permanently.**

---

## 2. Repository prerequisite (do this first)

There is currently **no git repository for this project**. The enclosing repo is your
Windows home directory (`C:/Users/thenu`) and its `origin` points at an unrelated
project (`astrovision-botV2`). Deploying via "connect GitHub" would ship the wrong
tree, so pick one:

**Option A — own repo (recommended, gives you CI + rollbacks)**

```bash
cd "instaflow-ai---multi-tenant-instagram-automation-saas (1)"
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<you>/<new-repo>.git
git push -u origin main
```

Then in Railway: *New Project → Deploy from GitHub repo*.

**Option B — deploy straight from this folder (no git at all)**

```bash
cd "instaflow-ai---multi-tenant-instagram-automation-saas (1)"
railway login          # opens the browser; you must complete this
railway init
railway up
```

The Railway CLI (v4.44.0) is already installed.

**Option C — redeploy the project that is ALREADY live (the normal case)**

`https://www.thefgt.in` is already running on Railway. Do **not** run `railway init`
again — that would create a second, empty project. Instead link this folder to the
existing one and push:

```bash
cd "C:/Users/thenu/Downloads/instaflow-ai---multi-tenant-instagram-automation-saas (1)"
railway login          # one time, opens the browser
railway link           # pick the existing project + environment + service (interactive,
                       #   safest); the ids recorded for this project are
                       #   project 0c21ed12-cba7-4ef3-84ab-22e2fa1fc88a,
                       #   environment 5d35108b-ab5e-410e-9ecd-7e01cfa9c74d,
                       #   service 07754fab-6640-455f-8a2d-4038ad2b04f9 —
                       #   confirm them with `railway status` before trusting them
railway status         # MUST name thefgt.in's service. If it does not, stop.
railway up --detach    # builds from this folder and ships it
```

Verify the deploy instead of assuming it:

```bash
npm run readiness -- --url=https://www.thefgt.in    # expect READY
npm run smoke     -- --url=https://www.thefgt.in    # expect 28/28
```

The build id in `/api/version` must become the same one `dist/` produced locally
(`npm run build` then look at `dist/assets/main-*.js`), and the counts in `/healthz`
(`activeSubscriptions`, `trialingSubscriptions`, `pendingCheckouts`) must be
**unchanged** after the deploy. Those numbers come from `DATA_DIR`, so if they reset
to zero the volume is not mounted and every customer's Instagram connection was just
lost — stop and fix `DATA_DIR` before telling anyone the deploy is fine.

---

## 3. Environment variables to set on the host

Set every one of these in the host dashboard (there is no `.env` on the server).
Build in `NODE_ENV=production` — that is what makes Express serve `dist/` instead
of starting Vite dev middleware.

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | required, switches to serving the built bundle |
| `APP_URL` | `https://<your-domain>` | **no trailing slash**; used for webhook + redirect URLs |
| `OPENROUTER_API_KEY` | your key | primary AI provider |
| `OPENROUTER_MODEL` | `inclusionai/ling-3.0-flash` | primary model. **Paid but nearly free** (~$0.021 per 1M prompt tokens, ~$0.063 per 1M completion tokens — about ₹0.002 per DM reply, ₹2 per thousand). Chosen 2026-10-14 after the previous slug (`inclusionai/ling-3.0-flash-sante`) vanished from OpenRouter's catalogue entirely (HTTP 404 "No endpoints found"), every call fell through to Gemini and then to the canned reply, and a dead default is indistinguishable from a dead bot. Set a `:free` id here to trade that reliability back for zero cost — free ids share a pool and were measured rate-limiting us (1/3 and 2/3 success). A retired name left behind on the host is remapped to the default (with a warning in the logs) so the bot does not go quietly dead; the server also verifies at boot that the resolved model still exists and prints `[ai] OpenRouter model "..." is available` or a loud error. `/healthz` reports `aiModel` (what it would call) and `aiModelConfigured` (what the host says) |
| `GEMINI_API_KEY` | your key | fallback provider |
| `GEMINI_MODEL` | `gemini-flash-latest` | fallback model. If it fails (e.g. HTTP 503 "high demand"), one stable backup model (`gemini-2.5-flash`) is tried automatically before the canned reply |
| `META_APP_ID` | your app id | |
| `META_APP_SECRET` | **your app secret** | also verifies webhook signatures |
| `IG_APP_ID` | Instagram app id | only for **Instagram Login** apps — see below |
| `IG_APP_SECRET` | Instagram app secret | only for **Instagram Login** apps |
| `IG_GRAPH_API_VERSION` | `v23.0` (optional) | graph.instagram.com version |
| `META_VERIFY_TOKEN` | `instaflow_secure_verify_token` | must match Meta webhook config |
| `META_REDIRECT_URI` | `https://<your-domain>/api/instagram/oauth/callback` | must match Meta exactly |
| `ENCRYPTION_MASTER_KEY` | a long random secret | **see warning below** |
| `DATA_DIR` | `/data` | path of the mounted volume — see next section |
| `WEBHOOK_DEDUPE_TTL_MS` | `1800000` (optional) | how long processed webhook message IDs are remembered |
| `CHAT_RETENTION_DAYS` | `30` (optional) | how many days of inbox chat history are kept |
| `WEBHOOK_SIGNATURE_MODE` | `enforce` (optional) | `warn` accepts unverified deliveries — temporary escape hatch, see below |
| `RAZORPAY_KEY_ID` | your Razorpay key id | **optional — billing is off until this and the secret are set** |
| `RAZORPAY_KEY_SECRET` | your Razorpay key secret | never send this to the browser |
| `RAZORPAY_WEBHOOK_SECRET` | webhook secret from Razorpay | required for `/api/webhooks/razorpay` to accept anything |
| `OWNER_TENANT_IDS` | `5eurbDvqjpWY8ElOI7xVlm4s6852` | comma-separated tenant ids that never need a plan (your own + comped accounts), and the only accounts allowed to read a *different* tenant's data for support (logged as `OWNER_ACCESS`) |
| `OWNER_EMAILS` | `owner@example.com` | owner accounts by **sign-in address** — for when you know your email but not your uid. Set this (or put the address in `OWNER_TENANT_IDS` — any entry with an `@` counts as an email) to open `/ops`. The uid is learned from the verified token on the first sign-in and stored in `DATA_DIR/owner-uids.json` |
| `COMP_TENANT_IDS` | *(empty)* | comma-separated tenant ids that keep working with **no plan and no expiry**, but get **no owner powers** (they cannot read another tenant's data). Use it for Meta App Review test accounts and goodwill customers — the 3-day trial is shorter than App Review takes |
| `FIREBASE_PROJECT_ID` | `gen-lang-client-0888289051` | the project whose sign-in tokens the API accepts; falls back to `firebase-applet-config.json`, but set it so auth never depends on that file being uploaded |
| `PORT` | provided by the host | server falls back to 3000 |

### Turning billing on (self-serve plans)

Out of the box **billing is off**: the dashboard offers the 3-day free trial, the
public `/plans` page renders, but `POST /api/subscription/checkout` answers `503`
and every tenant's bot keeps replying. That is deliberate — a half-configured
payment flow must never be able to lock a paying customer out of their own bot.

To start selling:

0. **Register this domain as your website in Razorpay first.** Dashboard →
   *Account & Settings* → *Website and app settings* → *Website details* → add
   `https://<your-domain>`. Until this is done Razorpay's risk engine blocks
   **every** live payment and no customer can buy, no matter how correct the
   integration is. The failure looks like this in the Razorpay dashboard:

   ```
   status: failed
   error_reason: payment_risk_check_failed
   error_description: Payment blocked as website does not match registered website(s)
   ```

   Note the money in that case is only a bank **hold**, not a capture
   (`captured: false`) — it reverses on its own in 3-7 working days, so there is
   nothing to refund. If the field is not editable, reply on the Razorpay ticket
   asking them to add the domain, and be aware that shared free subdomains like
   `*.up.railway.app` are often rejected outright: a custom domain is effectively
   required to take money.

   Two rules from Razorpay apply to the submission itself:
   - The additional website **must follow the same business model** as the first
     one, otherwise they tell you to create a separate Razorpay account (same
     login is fine).
   - Because our checkout is behind a login they ask for a **test account
     email + password** so a reviewer can walk the payment flow. Create a throwaway
     tenant for this (`/app` → sign up) instead of handing over a real account,
     and keep the credentials in a password manager.

   Submitted domains appear under *Websites & API keys* as `Under review` for
   24-48 hours. Once approved, **nothing needs changing on the server**: the same
   API key works across every approved website.

1. In the Razorpay dashboard create API keys and set `RAZORPAY_KEY_ID` +
   `RAZORPAY_KEY_SECRET` on the service.
2. Add a webhook endpoint pointing at
   `https://<your-domain>/api/webhooks/razorpay`, subscribed to
   `payment.captured`, `order.paid` and `payment.authorized`, and set
   `RAZORPAY_WEBHOOK_SECRET` to the secret Razorpay shows. Without the secret the
   endpoint answers `401` to everything (including real captures), so activate
   subscriptions stay pending. `payment.authorized` is needed on accounts set to
   manual capture: the server captures the hold itself so a "paid but no plan"
   customer cannot happen.
3. Set `OWNER_TENANT_IDS` to your own tenant id first — or, if you do not have the
uid handy, set `OWNER_EMAILS` to the address you sign in with and let the server
learn the uid on your first sign-in (it refuses `/ops` until then). From the
moment the keys
exist, the webhook's billing gate starts refusing AI replies for tenants with no
live subscription — owners included. `OWNER_TENANT_IDS` is the escape hatch.

   Accounts that must stay usable without a plan but must **not** get support
   powers go in `COMP_TENANT_IDS` instead: the trial still expires, but
   `decideAccess` keeps returning `allowed: true, reason: "comped account"`. That
   is what keeps a Meta App Review test account alive for the week (or more) the
   review takes, and it is intentionally weaker than `OWNER_TENANT_IDS`.
4. Buy one plan yourself (real ₹999, cheapest) and confirm `/healthz` reports
   `activeSubscriptions` going from 0 to 1 and the dashboard's plan card switching
   from "Koi plan active nahi hai" to the plan name.

Activation happens twice on purpose: the browser callback
(`POST /api/subscription/verify`) verifies the Razorpay signature and re-fetches
the payment from Razorpay for the authoritative amount/status, and the webhook
activates on `payment.captured`/`order.paid` for the case where the customer
closes the tab mid-payment. Both are idempotent, so whichever lands first wins.

A tenant whose subscription has lapsed does **not** lose data or messages: the
webhook still records the DM in the inbox and skips only the AI reply, so the
owner can answer manually and renew.

### When a payment succeeds but the plan does not turn on

The customer is not stuck and does not need to contact anybody: the dashboard
shows **"Paise kat gaye par plan nahi mila? Payment check karo"**, which calls
`POST /api/subscription/recheck`. That looks up the last order the tenant opened
(remembered in `subscriptions.json` under `pendingOrders`) directly at Razorpay,
captures it if it is only authorised, activates it if it went through, and
otherwise prints Razorpay's own failure reason. So a missed webhook — endpoint
down during a deploy, secret rotated and not saved — self-heals.

Check the same things by hand:

```bash
curl -u "$RAZORPAY_KEY_ID:$RAZORPAY_KEY_SECRET" "https://api.razorpay.com/v1/payments?count=10"
curl -u "$RAZORPAY_KEY_ID:$RAZORPAY_KEY_SECRET" "https://api.razorpay.com/v1/orders/<order_id>/payments"
```

The `status`/`error_reason` on the payment is the ground truth. Note that a
`failed` payment with `captured: false` means Razorpay never took the money, so
never "refund" it — the customer's bank reverses the hold on its own.

### Which Meta flavour does your app use?

There are two incompatible Instagram messaging APIs and the tokens are not
interchangeable:

| Flavour | Permissions | Host | Token prefix |
|---|---|---|---|
| Instagram API **with Facebook login** | `instagram_basic`, `instagram_manage_messages`, `pages_show_list` | `graph.facebook.com` | `EAA…` |
| Instagram API **with Instagram Login** | `instagram_business_basic`, `instagram_business_manage_messages` | `graph.instagram.com` | `IGAA…` |

Check which permissions your app's Graph API Explorer offers: if they are the
`instagram_business_*` ones, your app is provisioned for **Instagram Login**.
Those apps have **no** "Facebook Login → Valid OAuth Redirect URIs" page at all,
so the Facebook dialog always answers `URL blocked`; set `IG_APP_ID` +
`IG_APP_SECRET` (Meta App Dashboard → Instagram product page → *Instagram app ID
/ secret*) and the connect flow switches to `instagram.com/oauth/authorize`
automatically. Pasting an `IGAA…` token into the dashboard's direct-token form
works even without those two variables, because the token itself identifies the
flavour.

### Which secret signs the webhook deliveries?

Facebook-Login deliveries are signed with the **app secret** (`META_APP_SECRET`).
Instagram-Login deliveries are signed with the **Instagram app secret**
(`IG_APP_SECRET`) — a different value. If `IG_APP_SECRET` is missing, real DMs
still arrive but are dropped with `401 INVALID_SIGNATURE` and the logs show:

```
WEBHOOK_SIGNATURE_REJECTED: signature mismatch against META_APP_SECRET
```

Every rejection also logs `WEBHOOK_DIAGNOSTICS:` with the header Meta sent, the
body byte count/hash, and a truncated payload preview — that is the fastest way
to tell a genuinely delivered DM apart from a misconfigured secret.

To check the secret you do hold is the right one for the Facebook app:

```bash
curl "https://graph.facebook.com/oauth/access_token?client_id=<APP_ID>&client_secret=<SECRET>&grant_type=client_credentials"
```

An `access_token` response means the secret is valid; an `OAuthException` means it
is not. If it is valid, a signature mismatch can only come from a *different*
secret (i.e. the other flavour) — set the missing one instead of touching the
working one.

If you need the bot answering **right now** and cannot fetch the secret yet, set
`WEBHOOK_SIGNATURE_MODE=warn` on the service. The bot then processes deliveries
it cannot verify (logging `WEBHOOK_SIGNATURE_SKIPPED` for each). This is a
temporary debugging mode, not a deployment posture: anyone who knows the webhook
URL could inject a fake DM in that window, so switch back to `enforce` as soon as
the correct secret is in place.

> ⚠️ **`ENCRYPTION_MASTER_KEY` must never change once real accounts are connected.**
> It encrypts the stored Instagram access tokens. If it changes (or is lost),
> every previously connected account becomes undecryptable and users must
> reconnect. Keep a copy in a password manager.

---

## 4. Persistent storage — required, easy to miss

Connected accounts are stored in `.data/connections.json` (encrypted tokens).
The default location lives **inside the app directory**, which on Railway, Render,
Cloud Run and Vercel is **wiped on every deploy and restart**. Without a volume,
everything works in testing and then silently loses all connections after the
first redeploy.

- **Railway:** *Service → Settings → Volumes → New Volume*, mount path `/data`, then set `DATA_DIR=/data`.
- **Render:** add a `disk` to `render.yaml` (mount path `/data`), then set `DATA_DIR=/data`.

At startup in production the server now logs a warning if `DATA_DIR` is unset.

`DATA_DIR` also holds:

- `processed-messages.json` — the dedupe window for Meta webhook message IDs.
  Meta retries a delivery whenever our endpoint is slow or a deploy restarts the
  container mid-request; because the IDs are on the volume, a retry after a
  restart is recognised as a duplicate instead of sending the same AI reply to
  the customer a second time.
- `inbox-chats.json` — the dashboard's "Live Customer Chat Inbox": conversation
  history **and** the per-conversation human-takeover flag. Without the volume
  every customer conversation is erased by the next redeploy.
- `tenant-settings.json` — each tenant's **system prompt and knowledge base**,
  i.e. exactly what the bot is allowed to answer real DMs from
  (`GET`/`PUT /api/tenant-settings`). Without the volume the bot silently falls
  back to the generic default prompt after a redeploy and forgets the
  operator's business details.
- `kb-gaps.json` — **customer questions the knowledge base could not answer**
  (`GET /api/kb-gaps`). Only the bot sees what customers actually ask, so it
  files each unanswered question here grouped by wording, and the dashboard shows
  them as a to-do list. Detection is explicit rather than guessed: the reply
  prompt asks the model to append `[[NO_KB_ANSWER]]`, which the webhook strips
  before sending and records as a gap.
- `subscriptions.json` — which tenant bought which plan and when it renews
  (`GET /api/subscription`). Losing this file means every paying customer looks
  unsubscribed, so it must live on the volume alongside the connections.
- `leads.json` — enquiries submitted on the public booking page
  (`/book/<instagram-username>`). These are people who are not InstaFlow users
  and have no other copy of their details, so a wipe here silently loses real
  sales leads.

---

## 5. After the first successful deploy

Point the new domain at the app everywhere:

1. **Verify it is live**
   - `GET /` → the app loads
   - `GET /healthz` → `200` with `{"status":"ok",...}`; this is also the
     Railway healthcheck path, so a build must serve it before traffic is cut over
   - `GET /api/instagram/status` → `200`
   - `GET /privacy-policy`, `GET /terms-of-service` → `200`
   - `GET /api/webhook/instagram?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=TEST123` → echoes `TEST123`
   - `POST /api/webhook/instagram` with no `X-Hub-Signature-256` header → `401`
     (proves signature enforcement is on)

   All of the above in one command (add `--e2e` to also exercise the signed
   webhook + dedupe path, requires `META_APP_SECRET` in the environment):

   ```bash
   npm run smoke -- --url=https://<your-domain>
   META_APP_SECRET=<secret> npm run smoke -- --url=https://<your-domain> --e2e
   ```

   The smoke run also pins the **build id**: the shell served at `/app` must carry
   the same `window.__BUILD_ID__` that `GET /api/version` reports, and must be sent
   with `Cache-Control: no-store`. Those two checks exist because an open dashboard
   tab keeps running the bundle it loaded — the classic way a deployed fix looks
   like it never shipped. That mismatch is what the dashboard's *"Nayi version
   deploy ho gayi hai — Reload karo"* bar reports to the person staring at it, and
   `GET /healthz` → `buildId` is the fastest way to see which bundle is live.

   The smoke test answers *"is the server healthy"*. Its sibling answers the
   blunter question — **is the product switched on?** — and checks things the
   smoke test never looks at: whether the deployed frontend matches this
   workspace (`dist/`), whether `/ops` really ships the owner-console bundle,
   whether a DM gets an AI answer instead of the canned fallback, whether the
   OAuth callback points at this domain, and whether a payment reviewer would
   find a support email.

   ```bash
   npm run readiness -- --url=https://<your-domain>
   READINESS_ID_TOKEN=<owner token> npm run readiness -- --url=https://<your-domain>
   ```

   It exits non-zero when something required is missing, so it can gate a
   release. Checks it cannot judge from outside are printed as SKIP and are
   never counted as passing.

2. **Meta App Dashboard**
   - App Domains: `<your-domain>`
   - **Instagram Login apps** (permissions `instagram_business_*`, no "Valid OAuth
     Redirect URIs" page anywhere): Use cases → Instagram API → *API setup with
     Instagram login* → **4. Set up Instagram business login → Set up → Redirect
     URL** = `https://<your-domain>/api/instagram/oauth/callback`. Empty here is
     what produces `Invalid request: Invalid redirect_uri` on instagram.com;
     see META_SETUP.md for the screenshot-level walkthrough.
   - Facebook Login apps → Settings → Valid OAuth Redirect URIs: `https://<your-domain>/api/instagram/oauth/callback`
   - Client OAuth Login = **Yes**, Web OAuth Login = **Yes**
   - Webhooks → Instagram: callback `https://<your-domain>/api/webhook/instagram`, verify token `instaflow_secure_verify_token`
   - Subscribe to fields: `messages`, `messaging_postbacks`
   - Privacy Policy URL `/privacy-policy`, Terms `/terms-of-service`
   - **User data deletion → Callback URL** (not the instructions-URL box):
     `https://<your-domain>/api/webhook/data-deletion`. Meta form-encodes a
     `signed_request`; the server verifies the HMAC with `META_APP_SECRET` then
     `IG_APP_SECRET`, erases that user's connection/token, conversations, leads
     and AI settings, and answers with a real `confirmation_code` plus a status
     URL. The two customer-facing pages are `/data-deletion` (how to ask) and
     `/data-deletion-status?code=…` (what happened to a request). A redeploy is
     required before either page exists on the host — a missing page returns the
     SPA shell with a `200`, which is why `npm run readiness` asserts their
     contents instead of their status code.

3. **Firebase Console**
   - Authentication → Settings → **Authorized domains**: add `<your-domain>`
   - Authentication → Sign-in method: enable **Email/Password** and **Google**
     (currently `PASSWORD_LOGIN_DISABLED`)

---

### Public pages vs the dashboard

`GET /` is a **server-rendered public home page** (hero, how it works, features,
pricing, FAQ, policy links) and the dashboard is served at **`/app`**. That split
matters twice: a visitor arriving from Instagram or an ad must see what is being
sold before being asked to log in, and payment/Meta reviews look at the root of
the domain — a bare login box fails a "website must be live and functional"
review. `/plans` remains the full pricing page.

The home page is plain HTML on purpose, so it renders even if the JS bundle
never loads. Its only script forwards people who are *already* signed in
(detected from Firebase's `localStorage` session) straight to `/app`.

### Changing the free-trial length

The trial length is one constant: **`TRIAL_DAYS`** in `server/planStore.ts` (currently
`3`). Everything customer-visible reads from it — the dashboard button label, the
`trialDays` field on `/api/plans` and `/api/subscription`, and the refund-policy
wording.

A subscription row stores its own end date, so lowering `TRIAL_DAYS` does **not**
rewrite trials that already exist. On the next load, `loadSubscriptions()`
normalises them: any trial longer than the configured length is shortened to
`grantedAt + TRIAL_DAYS`. It only ever shortens, never extends, never touches a
paid plan, and is idempotent, so it is safe on every deploy. The server log says
what it did:

```
[plans] Shortened 3 trial(s) to the current 3-day setting
```

Two consequences worth knowing before you change the constant:

- a trial granted more than `TRIAL_DAYS` ago becomes **expired** the moment the
  new length loads (the tenant then sees "plan expired — renew", and because the
  trial is one-time they cannot start another);
- a **local dev server does not reload itself** — `tsx server.ts` keeps the
  constants it started with, so an old terminal keeps serving the old trial
  length until you restart it. That is the usual reason two servers disagree.

### Language: English by default, Hindi one tap away

The product ships bilingual — English first, with a हिंदी / English switch in the
header of every screen (dashboard, landing page, pricing page, booking page) and
on the login card.

| Where | What lives there |
| --- | --- |
| `src/i18n.tsx` | Dashboard strings, the switch component, the default language (`DEFAULT_LANG`) |
| `server/publicCopy.ts` | Landing page, pricing page and booking-page copy, plus the English plan taglines |
| `server/i18n.ts` | Language detection and the messages the API returns to a person |

Two rules keep it honest: every dashboard entry is `[hindi, english]`, and the
Hindi value is the wording that was already shipping — so Hindi mode is exactly
the app that existed before, and only the English side is new. Labels that read
the same in both languages (`Buy`, `Copy`, `Knowledge Base`, `WhatsApp`) are left
inline rather than routed through the translator.

How the choice travels:

- the switch writes `localStorage['instaflow.lang']` **and** the `if_lang` cookie;
- server-rendered pages accept `?lang=en|hi` (the switch links) and pin the same
  cookie, so a choice made on the landing page survives to `/app`;
- an API error follows the cookie too, which is why an English customer never
  sees a Hinglish "Trial pehle liya ja chuka hai" in the notification banner;
- `Accept-Language` is the fallback when nothing else is set.

To flip the default to Hindi, change the single `DEFAULT_LANG` constant in **both**
`src/i18n.tsx` and `server/i18n.ts` (they are deliberately duplicated so the
browser bundle never imports server code).

---

## 5c. Getting the website approved by Razorpay

Razorpay reviews the domain before it activates payments, and it rejects on what
it can *see* — not on what exists elsewhere. A submission of
`https://<domain>/app` was rejected because `/app` is the dashboard: a reviewer
opening it gets a login box, no products, no prices, no policies, no way to
reach a human.

**Submit the root URL** (`https://<domain>/`) — that is the server-rendered
public page with the product, pricing and policies, and it loads without JS.

What the reviewer needs to find, and where it lives now:

| Requirement | URL |
|---|---|
| Product explained + pricing | `/` and `/plans` |
| Terms of Service (incl. refunds, governing law) | `/terms-of-service` |
| Privacy Policy | `/privacy-policy` |
| **Refund & Cancellation Policy** | `/refund-policy` |
| **Contact Us** (email, phone, hours) | `/contact` |

Every one of those is linked from the footer of every public page, so a crawler
reaches them without a sitemap. Check them all in one command:

```bash
for p in / /plans /privacy-policy /terms-of-service /refund-policy /contact; do
  printf '%-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://<domain>$p)"
done
```

Set the contact identity before resubmitting — these are the details the
reviewer and your customers will actually use:

```
SUPPORT_EMAIL="you@yourdomain.in"
SUPPORT_PHONE="+91…"          # Razorpay prefers a reachable phone number
BUSINESS_NAME="…"             # legal/brand name as on the bank account
BUSINESS_ADDRESS="…"          # city + state is enough for a service business
```

Two things that raise approval odds further:

1. **Use a real domain.** A `*.up.railway.app` address is a hosting subdomain,
   and reviewers treat it as a template rather than a business. A custom domain
   (`instaflowai.in`, ~₹700/yr) also fixes the bio link and the Meta review in
   one move.
2. **Submit the URL you will keep.** If the domain changes after approval, the
   Razorpay website and the Meta OAuth redirect URI both have to be updated.

---

## 5d. Moving to a custom domain

The public URL is baked into six different systems. One missed entry breaks a
feature silently: forget Firebase and nobody can log in, forget the Meta
redirect URI and every new customer's "Connect Instagram" fails with
`Invalid redirect_uri` — that exact failure cost a day of debugging.

Do these in order. Keep the old domain working until the last step.

**Where this runbook has actually landed (2026-09-28):** the live domain is
`https://www.thefgt.in` on GoDaddy nameservers, with `thefgt.in` forwarding to
it (301) — steps 1, 2 and 3 are done, plus the Meta redirect URI, the Meta
webhook callback URL, and the `APP_URL` / `META_REDIRECT_URI` variables.
`https://instaflowai-instaflow-deploy.up.railway.app` still serves the same app
and is kept as the fallback, so nothing created before the move breaks. What is
still on the old host: the policy URLs in Meta → App settings → Basic, and the
website URL on the Razorpay account.

**1. Registrar**

Buy the domain, and prefer `.co.in`/`.in` for an Indian business. Note that
`instaflowai.in` is currently registered and parked on
`dns-suspended.com` (registry hold), so it cannot be pointed at anything —
`instaflowai.co.in` or `getinstaflow.in` resolve that.

**2. Railway → Settings → Networking → Custom Domain**

Add the domain. Railway returns **two** records per hostname and both are
required — the CNAME is not enough:

| Type | Name | Value |
|---|---|---|
| CNAME | the hostname (`www`) | `<random>.up.railway.app` |
| TXT | `_railway-verify.<hostname>` | `railway-verify=<token>` |

Without the TXT, Railway never marks the domain verified and every request to
it returns **404** even though the CNAME resolves perfectly. If you have the
project token you can add the domain from the CLI instead of the dashboard:

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Project-Access-Token: $RAILWAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation($i: CustomDomainCreateInput!) { customDomainCreate(input: $i)
       { id domain syncStatus status { verified verificationToken
       dnsRecords { hostlabel recordType requiredValue currentValue status } } } }",
       "variables":{"i":{"domain":"www.thefgt.in","environmentId":"<env>",
       "projectId":"<project>","serviceId":"<service>"}}}'
```

`dnsRecords[].currentValue` echoes what Railway can actually see at the
registrar, so a mismatch there is the fastest way to spot a record you forgot
to delete.

### The apex problem (read before choosing a registrar path)

Railway resolves a custom domain with a **CNAME**, and DNS forbids a CNAME at the
zone apex — so the apex only works at providers that fake it with CNAME
flattening or ALIAS records. Railway's docs list **GoDaddy as not supporting
either**, alongside AWS Route 53, Azure DNS, Hostinger and NameSilo. Two ways
out:

* **Move the nameservers to Cloudflare** (free). Cloudflare flattens the apex
  CNAME itself, so `thefgt.in` *and* `www.thefgt.in` both work with normal
  Railway-issued certificates. Best option if you want the apex to be the
  canonical URL, since Razorpay reviewers tend to open the bare domain.
* **Stay on GoDaddy and make `www` canonical.** A CNAME at `www` is ordinary
  DNS and works everywhere; point the apex at it with GoDaddy's *Forwarding*
  (GoDaddy's own docs now state *"Forwarding over HTTPS is now available on all
  forwarded domains"* — older blog posts claiming it is HTTP-only are stale).
  Then: only add `www` as the Railway custom domain, delete the GoDaddy `A @`
  record that the old host used, and submit `https://www.thefgt.in/` to
  Razorpay. This is the path `thefgt.in` took.

Do **not** leave the apex added in Railway when you use forwarding — it will
never verify, and Railway keeps retrying the certificate for it forever.

**3. Firebase Console → Authentication → Settings → Authorized domains**

Add the new domain (**both** `thefgt.in` and `www.thefgt.in` if you use
forwarding — Firebase compares the origin, and a redirect does not count).
Firebase blocks sign-in from unlisted origins, so this is the step that
silently locks every customer out if skipped.

**4. Railway variables**

```
APP_URL="https://instaflowai.co.in"
META_REDIRECT_URI="https://instaflowai.co.in/api/instagram/oauth/callback"
SUPPORT_EMAIL / SUPPORT_PHONE / BUSINESS_NAME / BUSINESS_ADDRESS
```

**5. Meta App Dashboard**

| Where | What |
|---|---|
| Instagram API setup → *4. Set up Instagram business login* → Redirect URL | **Add** `https://<new-domain>/api/instagram/oauth/callback` (keep the old entry until cutover) |
| Instagram API setup → *3. Configure webhooks* | Update the callback URL to `https://<new-domain>/api/webhook/instagram`, re-verify, keep the same verify token |
| App settings → Basic | Privacy Policy, Terms and Data Deletion URLs on the new domain; add the domain to App Domains |

**6. Razorpay**

Website URL = the new root (`https://<new-domain>/`, never `/app`). Add a second
webhook endpoint for `https://<new-domain>/api/webhooks/razorpay` with the same
`RAZORPAY_WEBHOOK_SECRET`, and disable the old one only after the new domain is
live.

**7. Prove it before dropping the old domain**

```bash
npm run smoke -- --url=https://<new-domain>
```

Your own machine will usually still be serving the *old* provider's cached
record for up to the old TTL, so a bare run fails with the previous host's 404
and looks like a broken deploy. Pin the request to the new edge instead — the
Host header and the certificate check still use the real domain, which is
exactly what Meta's servers do:

```bash
npm run smoke -- --url=https://<new-domain> --resolve-ip=<edge-ip>
# edge ip: nslookup -type=A <random>.up.railway.app 1.1.1.1
```

Run both before and after the `APP_URL` switch: 24/24 both times means the
move changed nothing a customer can see.

Then, by hand: log in on the new domain, connect an Instagram account through
the OAuth button, and send one real DM. Connections themselves survive the
move — the stored tokens belong to the Instagram account, not to the domain —
but booking links and any cached public URL are regenerated from `APP_URL`.

---

### Who is allowed to read a tenant's data

A tenant id is not a secret — it is the customer's Firebase uid, printed on their
own dashboard. So the header alone can never be the key. Every `/api` route is
behind `attachTenant` (`server.ts`), which resolves the tenant from a **verified
Firebase ID token** and refuses the request otherwise:

| Caller | What it can reach |
| --- | --- |
| No token | `401 AUTH_REQUIRED` — except the public paths below |
| Bad / expired token | `401 INVALID_TOKEN` |
| Valid token, own uid claimed | that account |
| Valid token, **another** tenant claimed | served as the token's own tenant, and logged as `TENANT_MISMATCH` |
| Valid token from a uid in `OWNER_TENANT_IDS` (or an email in `OWNER_EMAILS`) | the tenant it names — logged as `OWNER_ACCESS` (this is the support path) |
| No token, `x-tenant-id: default_tenant` | Demo Mode only, which holds nothing but its own empty data |

Deliberately public, each for a reason: `GET /api/version`, `GET /api/plans`,
`GET /api/book/<slug>`, `POST /api/book/<slug>` (a visitor filling the form),
the Meta webhook + data-deletion routes (HMAC-signed by Meta) and the Razorpay
webhook + OAuth callback. Everything else needs a sign-in.

Implementation notes worth keeping: tokens are verified in `server/auth.ts`
against Google's published RS256 certificates (`crypto.verify`, no
`firebase-admin` and no service-account file); the project id comes from
`FIREBASE_PROJECT_ID`, falling back to `firebase-applet-config.json`. The
dashboard attaches the token in exactly one place, `src/api.ts` (`apiFetch`),
which also defaults the `x-tenant-id` header and retries once after a forced
token refresh, so a tab left open overnight recovers silently.

Two consequences to expect:

- a browser tab loaded **before** this change starts 401-ing until it is
  reloaded (it is still sending header-only requests);
- the demo simulator is the only AI endpoint reachable without signing in, so it
  has its own budget — 25 messages per visitor per 15 minutes, and 200 across
  the whole demo — answering `429` when it runs out.

### Checking a customer's account

Support starts with "is this customer's bot working?". There is no tenant list in
the dashboard (each login only ever sees its own account), so there is a
read-only script for it:

```
npm run check-tenant -- <tenantId> --as-you                # live site, signs in as you
npm run check-tenant -- <tenantId> --as-you --url=http://localhost:3000
npm run check-tenant -- <tenantId> --as-you --json         # raw payloads
```

`--as-you` asks for your own `OPS_EMAIL` / `OPS_PASSWORD` (or reads them from the
environment) and signs in with them; the password goes only to Google's identity
endpoint and nothing is written to disk. Alternatively `--token=<firebase-id-token>`
takes a token you copy from a browser session (`localStorage` →
`firebase:authUser:*` → `stsTokenManager.accessToken`, valid about an hour).
Either way the sign-in must belong to an owner: a uid listed in
`OWNER_TENANT_IDS`, or the address on the verified token (an `@` entry in
`OWNER_TENANT_IDS`, or `OWNER_EMAILS`) — that is
the only way one account can read a different one.

The tenant id is the customer's Firebase **uid**: Firebase Console →
Authentication → Users → UID, or the `Tenant ID:` line on their own dashboard.
The card prints plan/trial + days left, whether the bot is allowed to reply and
why not, Instagram connection (username, when the token was last verified, last
error), knowledge-document count, unanswered questions, leads, conversations on
human takeover, and a verdict line. It only reads — nothing it calls changes a
customer's account.

For "did that DM actually get answered?", read the server log, where one message
leaves a trail of exact lines:

| Log line | Meaning |
| --- | --- |
| `Received incoming DM from <id> for IG Account <igId>: "..."` | Meta delivered the message |
| `AI reply generated via <provider> ...` | the bot answered |
| `AI reply skipped for tenant <id> (<reason>)` | billing gate closed the bot (the message is still saved to the inbox) |
| `Human takeover is active for <chat>` | automation paused for that thread on purpose |
| `Skipping duplicate message mid: ...` | Meta re-delivered; de-dupe caught it |
| `No active connection found for incoming IG Account ID ...` | the account is not connected in THIS environment |

```
railway logs --service insta_flowai | grep -i "<tenantId>"
```

---

## 6. Before opening it to real users

- ✅ **Webhook signature verification is implemented.** `POST /api/webhook/instagram`
  verifies Meta's `X-Hub-Signature-256` (HMAC-SHA256 over the raw request body,
  timing-safe compare) and answers `401 INVALID_SIGNATURE` on any mismatch.
  Note the fail-open case: if `META_APP_SECRET` is *missing* the server cannot
  verify at all, so it logs `WEBHOOK_SIGNATURE_SKIPPED` on every delivery and
  continues. `/healthz` reports `webhookSignatureEnforced` so you can confirm the
  secret is actually present in the running container.
- 🔑 **Rotate the API keys** that were pasted into chat (OpenRouter, Gemini) and
  set the new ones only in the host dashboard.
- ⛔ **Do not leave the service wired to an incomplete repo.** A GitHub source with
  auto-deploy will overwrite a working deployment on the next push. Keep
  `Source` disconnected (or fix the repo) before pushing anything.
- ✅ **Tenant isolation is token-based.** Every `/api` route resolves its tenant
  from a verified Firebase ID token (`server/auth.ts`), not from an
  `x-tenant-id` header, so a leaked uid cannot be used to read someone else's
  leads or inbox. Anonymous callers get `401`; the only no-sign-in path is Demo
  Mode's own empty tenant. Run the smoke test against an anonymous shell and the
  refusal is asserted check-by-check — set `SMOKE_ID_TOKEN=<token>` to run the
  signed-in variants of those same checks instead.
- Confirm `.env` and `.data/` are never committed (both are in `.gitignore`).
