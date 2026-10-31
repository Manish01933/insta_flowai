# Changelog — InstaFlow AI

All notable changes to this project. Entries are **only** included where the
change is evidenced (code, code comments with dates, deploy records, or file
timestamps). Where a date could not be established, the entry is marked
**NEEDS VERIFICATION** rather than guessed.

Format follows [Keep a Changelog](https://keepachangelog.com/) sections.

---

## Unreleased

### Fixed
- **Connect fix dialog: `SERVER_NOT_READY` now gives the right instruction for the
  exact failure, and never hands the owner a dead localhost link to send a
  customer.** The steps were generic ("fix the app id / secret / redirect URI",
  "put *this* URI in the Meta whitelist") even when `readiness.code` already named
  the real cause — on localhost that advice was actively wrong (Meta can never
  whitelist or redirect to localhost). `src/i18n.tsx` adds code-specific steps for
  `REDIRECT_NOT_REACHABLE` (connect from the deployed app instead), `NO_APP_ID`
  and `IG_APP_SECRET_MISSING`; `src/OpsConsole.tsx` picks them via `fixStepsKey`.
  The customer-message block is replaced by a warning on an unreachable host (and
  its copy button hidden), and the "Connect with Meta" link is now built from the
  server's own redirect-URI origin (`connectOriginOf`) instead of
  `window.location.origin`, so an owner on localhost copies the live
  `https://www.thefgt.in/app` link rather than `http://localhost:3000/app`.
  Verified live on both: localhost dialog (2026-10-15) and the deployed
  `main-hLZEgb8o` on www.thefgt.in/ops (customer message + copy button present,
  correct link). 
- **`npm run build` can no longer emit a development bundle when a local `.env`
  carries `NODE_ENV=development`** (this is what made the readiness check's
  "live frontend matches the bundle in dist/" comparison fail even for identical
  source). Vite surfaces `.env`'s NODE_ENV as `VITE_USER_NODE_ENV` and applies it
  *after* the config resolves, so the built dashboard shipped development React
  (warning strings included) with chunk hashes that could never match the host's
  production build. `vite.config.ts` now forces `NODE_ENV=production` and skips
  `.env` loading for build commands (nothing in `src/` reads `import.meta.env`);
  dev mode is untouched. Verified: plain `npm run build` reproduces the exact
  deployed hash (`main-NIb8TJPN`).

### Added
- **`rescue.cmd` — one file to run in cmd when the project breaks: it diagnoses
  the live site from the outside, repairs whatever it can by itself, and prints a
  simple Hinglish report.** `scripts/rescue.mjs` behind it walks five phases:
  machine/Railway link (auto-links the right project if this folder is linked to
  the wrong one), live probes (health, build id vs `dist/`, both apps, a real AI
  reply, Instagram OAuth config), auto-fix (missing **non-secret** config is set
  on the host from the documented values in FGT-IDs/DEPLOY.md — secrets are only
  *reported*, with the exact `railway variable set` command and where to find the
  value; `ENCRYPTION_MASTER_KEY` is never touched, since rotating it orphans
  every stored Instagram token; stale or broken builds are rebuilt and shipped
  with `railway up --detach`; a hung service is redeployed), re-verify (the live
  build id must match the local bundle and the `/healthz` customer counts must be
  **unchanged** — a zeroed count stops the script with a loud DATA_AT_RISK warning
  because it means the `/data` volume is not mounted), and finally a SIMPLE
  REPORT naming the main cause, what the script fixed itself, and what still
  needs a human. `--check` diagnoses without changing anything, `--redeploy`
  forces a fresh build+deploy. Full detail lands in `rescue-report.txt`.
  Verified end-to-end against production (2026-10-15): config auto-set +
  redeploy + smoke 34/34 + counts unchanged + exit-code semantics checked in
  both modes.
- **Ops Console: a "Project notification" banner that names, in the simplest
  words, the MAIN reason the project is stopped.** The console already had
  eleven counters and a technical incident list — everything an engineer needs
  and nothing an owner can read at a glance. `server/rootCause.ts` reduces the
  same real facts the health endpoint already computes to ONE cause: platform
  conditions (storage write failures, Meta webhook failures) outrank
  per-account causes because they break everybody at once, otherwise the cause
  covering the most accounts wins ("main karan"), and severity escalates to
  "PROJECT RUK GAYA" only when no account in the fleet can currently reply.
  `src/RootCauseBanner.tsx` renders it at the top of the console — cause,
  "kya karein" line, and the `rescue.cmd` hint — in both languages, with its own
  60s auto-refresh. 16 unit tests in `scripts/root-cause.test.ts` pin every
  branch (winner selection, tie-breaks, resolved incidents ignored). Verified
  live on www.thefgt.in/ops (2026-10-15): billing cause picked correctly
  ("6/14 accounts... plan/trial khatam"), Hinglish + English both render.
- **Ops Console: the three remaining customer-error fix actions — retry queue, trial
  extend, shared-account routing — are now one-click from the portal.**

  The console could already diagnose connects, pause bots and clear billing rows, but
  three common customer complaints still needed a script or a code change: "reply nahi
  aaya" (a send stuck in the retry queue), "trial khatam ho gaya" (only fixable by
  wiping the billing row), and two tenants holding one Instagram account (badge-only,
  with the shadowed tenant's DMs silently dropped).

  - `POST /api/owner/retry-queue` (owner) — `list` reads the queued/failed sends with
    attempts, next attempt and last error; `retry` (one job) / `retryAll` promote due
    jobs and run them through the *same* sender as the automatic sweeper; `discard`
    drops a job the customer no longer needs. Backed by `server/retryQueue.ts`
    `listRetryJobs` / `promoteRetryJob` / `discardRetryJob`.
  - `POST /api/owner/tenants/trial-extend` (owner) — extends the **current period** of
    a billing row by 1–90 days (`server/planStore.ts` `extendSubscriptionDays`),
    keeping plan, history and status intact — the safe alternative to `billing/reset`.
  - `POST /api/owner/connections/route` (owner) — `list` shows every Instagram account
    held by two tenants with the tenant its DMs reach today; posting an
    `instagramAccountId` + `tenantId` persists the routing decision
    (`connectionStore.resolveSharedAccountRouting`), so the webhook stops dropping the
    shadowed tenant's messages (KNOWN_ISSUES A4).
  - Ops Console UI — three new panels: stuck/failed sends with per-job **Retry now** /
    **Discard** and **Retry all now**, a trial-extend form (tenant + days → result
    with the new expiry), and the shared-account roster with a **Route to this tenant**
    button per holder. All bilingual via `src/i18n.tsx`.
  - `scripts/hands-on-fix-actions.test.ts` — 42 end-to-end checks that drive the exact
    store code the endpoints call (isolated temp `DATA_DIR`), with the hands-on test
    results in `docs/HANDS_ON_TEST_REPORT.md`.

- **Every account now has a readable username, and the owner's own connects are free
  forever.**

  Two gaps that both came down to the same thing — the only identifier in the product
  was unusable. A tenant id is a Firebase uid (28 opaque characters), so support
  conversations and the Ops Console both read as "bhaiya wo `vYifwGWUHROQD1jRzpyixITakJ3`
  wala account"; and the free-forever list lived in `COMP_TENANT_IDS`, an env var, so
  the operator's own test connections kept expiring their 3-day trial mid-test —
  a self-inflicted support ticket ("Free Trial plan has expired — renew it" on an
  account the team owns).

  - `server/profileStore.ts` — `profiles.json`: one **set-once** username per tenant,
    case-insensitive unique, validated server-side (3-30 chars, letters/digits/dot/
    underscore, reserved names such as `owner`/`ops`/`support` refused). The uid stays
    the storage key, so this is a display/lookup layer that cannot move data between
    tenants.
  - `GET /api/profile` · `POST /api/profile/username` (tenant) — the dashboard asks
    once, in a blocking dialog with no skip button, because a readable name *is* the
    feature. A second write is `409 USERNAME_LOCKED`.
  - `POST /api/owner/tenants/username-reset` (owner) — the only way a username ever
    changes; the freed name returns to the pool and the customer is asked again.
  - `server/compStore.ts` — `comped-tenants.json`: the runtime half of the comped
    list. `/api/owner/tenants/free-forever` toggles it from the console, and the
    **OAuth start route marks a tenant `owner-connected` when the verified caller is
    an owner** — the literal rule "whatever account the owner connects stays free".
    `isCompedTenant()` merges it with `COMP_TENANT_IDS` (which still wins as the
    bootstrap), and `decideAccess` is unchanged: comped means `allowed: true` with no
    expiry.
  - Ops Console — the username (searchable, so it is what support actually types),
    the customer's uid underneath it, a `Free forever` badge with what put it there
    (`owner ne connect kiya` / `team ne on kiya` / `env COMP_TENANT_IDS se`), and both
    actions: the free-forever toggle and the username reset.

  Two deliberate limits: the `owner-connected` mark is written from the caller's
  **verified identity**, never from anything in the request, so a customer's connect
  cannot mark itself free; and the free-forever toggle is reversible, because a
  customer marked by mistake has to be returnable to normal billing from the same
  screen.
- **“Token rejected by Meta” now names the root cause instead of one instruction that
  can fail the same way twice.**

  The console already detected a refused token, but the only thing it could say was
  "the customer has to reconnect" — which is the wrong first step in the most common
  case. Live evidence (2026-10-08): Meta's refusal was
  `The user has not authorized application 2315015095917318`, and `/healthz` shows
  `oauthApp.clientId` is that same id. That is not a foreign token: it is this app's own
  token whose **user-level grant is gone** (the customer removed the app in Instagram,
  or the tester invite is still pending), so pressing Reconnect before fixing the grant
  reproduces the identical error — and the product looks broken a second time.

  - `server/connectFix.ts` — `classifyTokenRefusal()` reads Meta's verbatim sentence
    into `NOT_AUTHORIZED_THIS_APP` · `NOT_AUTHORIZED_OTHER_APP` · `TOKEN_EXPIRED` ·
    `PASSWORD_CHANGED` · `UNKNOWN`, and reports the `appId` Meta named plus whether it
    is one of ours. Pure string work: no extra Meta call, unit-testable without Meta.
    Exposed on the plan as `facts.tokenRefusal` (`null` unless Meta actually refused).
  - Ops Console — for a refused token the matching sentence and step are rendered
    **first**, before the generic reconnect step, with the app id interpolated; the
    short cause label is added to the evidence list. Both languages live in
    `src/i18n.tsx` like every other owner-facing sentence.

  Read together with the badge beside it: **“Allowed”** is our own tester-queue
  bookkeeping, **“Token rejected by Meta”** is Meta's live answer. Both being true at
  once is the whole shape of this bug.
- **"Instagram not connected" now says WHY, and one button does everything the
  server is allowed to do about it.**

  Read from live production data on 2026-10-08: the console had six accounts short of
  a working connection, and every one of them rendered as the same three words. The
  causes were four completely different things — a handle nobody had invited yet, an
  invite sent that the customer never accepted, tenants whose handle was never learned
  at all, and one token Meta refuses — and only one of them is fixable by clicking
  Connect again. Worse, the most common refusal (Instagram's access gate) left **no
  server-side trace at all**, and a refused connect never reaches account discovery,
  so the server did not even know which handle to invite.

  - `server/connectAttemptStore.ts` (new) — `connect-attempts.json`: why each attempt
    ended. Written by the OAuth callback *and* by the dashboard
    (`POST /api/instagram/connect-report`), because the worst refusals render inside
    Meta's popup and never call back. It also captures the handle on a blocked
    attempt — the only place that handle ever exists.
  - `server/connectFix.ts` (new) — classifies an account into one of nine blockers
    (`ALREADY_OK`, `RECONNECT_NEEDED`, `REVERIFY_NEEDED`, `SERVER_NOT_READY`,
    `TRY_FAILED`, `INVITE_NOT_SENT`, `INVITE_SENT_WAITING`, `HANDLE_UNKNOWN`,
    `SHARED_ACCOUNT`) with the evidence behind it. Structured, never prose: every
    sentence the owner reads comes from `src/i18n.tsx`, in both languages.
  - `POST /api/owner/tenants/connect-fix` (owner) — the button. It performs the two
    fixes the server may make (a **live Meta re-check** of a stored token, and
    **writing the learned handle into the tester queue**, `ensureHandleRecorded`) and
    returns the plan plus what it changed. `connect-fix-all` returns the same for
    every account at once and makes **no Meta calls** on purpose.
  - Ops Console — an **“Instagram juda nahi (N)”** panel with a Fix button per
    account, an all-accounts roster, the last attempt verbatim (`Meta ne kaha: …`),
    and a card holding: the cause, numbered steps, the exact redirect URI, the app id
    an invite must be accepted on, the handle already on the clipboard, the Meta Roles
    link, and a paste-ready customer message. The page is explicit that two steps are
    human — Meta has no API for adding an Instagram tester, and nobody can press Allow
    for the customer — instead of implying the click finishes the job.
  - Customer dashboard — a shared-account warning (below), since "Connected" on a
    silent bot was the other half of the same confusion.

- **One Instagram account connected by two tenants is now detected (a real bug found
  in live data).**

  `connections.json` on 2026-10-08 held `@nexusaibundle` and `@thenutritionhut001`
  connected by **two tenants each**. `igAccountIndex` maps an Instagram account id to
  exactly one tenant, so one of each pair receives its customers' DMs, finds no
  connection, and drops them — while its own dashboard reads a healthy "Connected".

  - `connectionStore.getSharedInstagramAccounts` (new, read from the same index the
    webhook uses) plus `listTenantsForInstagramAccountId`; `saveConnection` logs
    `SHARED_INSTAGRAM_ACCOUNT` naming both tenants and which one now owns the routing.
  - `SafeConnectionStatus.sharedWith` is computed on read, so the warning disappears
    by itself the moment the duplicate is disconnected (a stored flag would go stale).
  - Row badge + `summary.sharedInstagramAccounts`, the other tenant named in the
    account's profile, a `SHARED_ACCOUNT` plan for the shadowed tenant, a line in
    `/healthz`, and a warning on the customer's own dashboard.
  - **A second, silent bug fixed on the way:** `disconnectAccount` deleted the
    account-id index entry unconditionally. That was harmless while one account could
    only belong to one tenant, and became live when one belongs to two: the console
    tells the owner to "disconnect the duplicate", and doing so deleted the *other*
    tenant's routing, silencing the bot that was working. It now only removes an entry
    that still points at the tenant being disconnected (proved by reverting the line
    and watching the test fail with `undefined`).
  - **Not auto-resolved on purpose:** flipping which tenant owns the routing would move
    live DMs from one customer's bot to another's, which is worse than the bug — see
    `docs/KNOWN_ISSUES.md` A4, which is still open.

- **The owner can take an account off the console's list, or delete it for good —
  and a deleted account can no longer come back for a second free trial.**

  The Ops Console had exactly one way to make a customer row stop being a problem:
  nothing. A customer who cancelled their package kept their row forever, so the
  list slowly filled with accounts nobody works on, and a junk or test signup could
  not be removed at all. Two actions now exist, deliberately unequal:

  - **Hide** (`POST /api/owner/tenants/hide`) — off the list, nothing deleted. The
    connection, inbox, leads, AI settings and plan are untouched, so a live bot
    keeps answering and the customer notices nothing; the row comes back with one
    press from the panel that lists hidden accounts.
  - **Delete** (`POST /api/owner/tenants/delete`) — every server-side record gone,
    behind a typed confirmation (the account's handle or its tenant id).

  - `server/accountRemovalStore.ts` (new) — `account-removal.json`: the hidden list
    and the tombstones. A tombstone remembers only a tenant id, when, who, the last
    handle, and *counts* of what went — enough to answer "did you delete my
    account?" in a support conversation, and useless as a copy of anyone's data.
  - `server/tenantRemoval.ts` (new) — the purge, in one ordered place: snapshot the
    handle → delete from every store → write the tombstone **last**, so a failure
    part-way through can never leave an account that still has data but is refused a
    trial. Erases the connection and its encrypted token, the subscription and any
    abandoned order, leads, chats, AI settings, tester request, bot switch, open KB
    questions, and that account's unrouted-delivery alerts.
  - Per-tenant removal helpers added where none existed:
    `planStore.deleteSubscriptionForTenant` (a *cancelled* row still counted as a
    customer and still blocked a trial), `testerRequestStore.deleteTesterRequest`,
    `botControlStore.clearBotControl`,
    `deliveryAlertStore.forgetUnroutedDeliveriesForAccount`.
  - `planStore.startTrial` now refuses a deleted account (`trial.accountRemoved`,
    English + Hinglish). Without it the delete was invisible from the customer's
    side: the billing row was gone, so the same account could sign in and claim a
    fresh free trial the same day.
  - Ops Console — "Hide" / "Delete" in the account profile, a typed confirmation
    dialog whose button stays disabled until the value matches, a hidden-accounts
    panel with **Restore**, a collapsed deleted-accounts list, `hidden` / `removed`
    counters, and a banner stating the outcome of the last action. The `subtitle`
    and `readOnly` copy were corrected too: this page is no longer read-only.
  - `/healthz` gained `accountsHidden` / `accountsRemoved` (counts only — the tenant
    ids stay behind the owner gate).

- **A tester invite can no longer be sent to the wrong Meta app without
  anybody noticing — and a dead connection can no longer look healthy.**

  Production evidence behind this (read from the live host, 2026-10-07): the
  tester queue had real customers waiting, `connections.json` held six accounts,
  and two failure modes were completely invisible from inside the product.
  1. **Invites arrived from a different Meta app.** Instagram's
     "Tester invites" screen showed `FlowAI - IG` (the app this server logs in
     with) *and* `aiastrovision-IG` — a second app of the same developer account.
     An invite accepted on the second app looks identical on the customer's
     phone, but the connect then either fails on Meta's access gate or stores a
     token this server cannot use, and **the bot stays silent**.
  2. **A DM arrived for an account with no connection.** The log had
     `No active connection found for incoming IG Account ID 17841434784408449`
     with `"Hi"` — Meta delivered the message, no connected account matched, and
     it was dropped. The routing decision is correct (answering from another
     tenant's token would be a cross-tenant leak); the silence was not.
  Separately, one of the six connected accounts (`@sofficial_sehaj`) had a token
  Meta now refuses — `The user has not authorized application 2315015095917318` —
  while its row kept reading `CONNECTED`.

  - `server/appIdentity.ts` (new) — states which app this deployment connects
    through: `oauthClientId` (the `client_id` Meta sees, so the app an invite has
    to be accepted on) **separate from** `facebookAppId` (the app the dashboard
    and roles URLs are keyed by). Conflating the two is why the "add tester"
    deep link was built from the Instagram app id and sent the operator to a
    page with no app on it.
  - `server/connectionHealth.ts` (new) — one cheap `GET /me` per connected
    account answers the question `lastVerifiedAt` never did: *does Meta still
    accept this token for THIS app?* Classified as `OK` / `NEEDS_REAUTH` /
    `UNREACHABLE` (rate limits and transport errors are deliberately **not**
    reported as a broken account). Runs after every OAuth connect, on a
    6-hourly sweep, and from `noteSendAuthFailure()` when a reply is refused.
  - `server/deliveryAlertStore.ts` (new) — `unrouted-deliveries.json` on the
    volume: how many DMs arrived with nothing behind them, and which accounts.
    Repeats from one account collapse to a single row so one loud customer
    cannot hide the others.
  - `server/connectionStore.ts` — `liveState` / `liveDetail` / `liveCheckedAt` /
    `liveUsername` per connection, written by `markConnectionLiveCheck()`.
    Deliberately **additive**: a token Meta refuses does not change `status`, so
    a working account never disappears from its own inbox or booking page.
  - New routes: `POST /api/owner/connections/health` (sweep every account),
    `POST /api/instagram/health` (one account; a body `tenantId` is honoured
    **only** for an owner), `POST /api/owner/delivery-alerts/clear` (clears the
    list, keeps the count). All owner-gated like the bot switch.
  - `/healthz` gained `oauthApp`, `connectionsNeedingReauth` and
    `unroutedDeliveries`; `/api/owner/tenants` gained `oauthApp` (both ids),
    `unroutedDeliveries`, `row.instagram.liveState` / `liveDetail` /
    `liveCheckedAt` and the `tokenRejected` attention flag — which sorts with the
    urgent rows, because only the customer can fix it.
  - Ops Console: an amber "DMs with no connection" panel (account, sender,
    preview) next to the bot strip; the app id every invite must be accepted on,
    printed with a copy button above the tester queue; a "Reconnect needed"
    column in each customer's profile with a "check now" button. Customer
    dashboard: a rose banner + a `Reconnect needed` status pill instead of a
    green `Connected`, because saying "connected" while the bot cannot answer was
    the original confusion.
  - Verified locally against the built bundle with a real signed webhook: an
    unrouted DM is counted and named in `/healthz`, a second DM from the same
    account collapses to one row while the total grows, a token Meta refuses is
    classified `NEEDS_REAUTH` (live check), the state survives a restart and
    reaches `/healthz` as `connectionsNeedingReauth: 1`, and all three owner
    routes answer `401` anonymously.
  - Documented in `docs/KNOWN_ISSUES.md` (A3), `CLIENT_CONNECT_CHECKLIST.md`,
    `docs/API.md`, `docs/PROJECT_STRUCTURE.md`, `docs/DATABASE.md` §2.14.
- **Bot-to-bot loop defence** (`server/botGuard.ts`) and **a per-customer bot
  on/off switch** (`server/botControlStore.ts`). Both come from one real incident:
  two Instagram accounts were connected to InstaFlow, the operator DMed one from
  the other by mistake, both bots answered each other, a third connected account
  joined in, and there was **no button anywhere that could stop it**.
  - `server/botGuard.ts` — three tiers, cheapest first: (1) the sender's id is an
    InstaFlow-connected account ⇒ block; (2) the sender's `@username`, resolved
    through Meta's User Profile API and compared *strictly* against every connected
    handle ⇒ block; (3) a reply-burst cap (`IG_REPLY_BURST_MAX`, default 8 per
    `IG_REPLY_BURST_WINDOW_MS`, default 5 min) per conversation, which stops any
    loop shape even when the identity lookup fails. Blocked messages are **not**
    stored, so a loop cannot grow the inbox either. Counters + a 40-entry ring
    buffer (never a message body) are exposed to the Ops Console.
    Note: a webhook `sender.id` is an Instagram-scoped id, not the stored account
    id, which is why tier 2 exists; on Standard Access that lookup fails with code
    190 and the guard deliberately falls back to the burst cap instead of failing.
  - `server/botControlStore.ts` — `bot-control.json` on the `DATA_DIR` volume: one
    switch per tenant plus a global brake. **Absence means enabled**, so a fresh
    deploy or a corrupt file can never mute a paying account; `setAllBots()` clears
    per-tenant records in both directions so "stop everything" really means
    everything. `decideAccess()` now checks the switch **before** owner/comped, so
    the brake stops the operator's own account too.
  - New owner-only routes `POST /api/owner/bots/control` and
    `POST /api/owner/bots/control-all`; a manual inbox reply on a paused account
    returns `409 { code: 'BOT_PAUSED' }` — a paused account is a hard stop, because
    during the incident a human reply would have restarted the flood.
  - Ops Console: a bot-control strip (global brake, loop-guard state, refused-DM
    counter, last 5 guard events), a pause/resume button on **every** customer row,
    and the same switch inside each customer's expanded profile.
  - `/healthz` gained `botIsolationEnabled`, `botGuard`, `botsPausedAll` and
    `botsSwitchedOff`; `/api/owner/tenants` gained `botGuard` + `botControl` and
    `row.bot.paused` / `row.bot.pausedSource`; the attention flag `botPaused`
    distinguishes "the team stopped this on purpose" from a billing block.
  - New env vars (`IG_ISOLATE_CONNECTED_ACCOUNTS`, `IG_RESOLVE_SENDER_USERNAMES`,
    `IG_REPLY_BURST_MAX`, `IG_REPLY_BURST_WINDOW_MS`) documented in
    `docs/ENVIRONMENT.md` §7c/§7d and `.env.example`; new i18n key `access.paused`.
  - Verified locally against the production bundle (real signed webhooks, two
    connected accounts) and at module level (21 checks), then **deployed to
    production** (`buildId main-D122I9A9`) and re-verified live: `/healthz` exposes
    the new fields, the Ops Console bundle carries the switch, and all three owner
    routes still answer `401` to an anonymous caller.
  - Documented in `docs/DATABASE.md` §2.12/§2.13, `docs/ARCHITECTURE.md`,
    `docs/API.md`, `docs/ENVIRONMENT.md` §7c/§7d.
- **Public complaint form** (`GET /complaint`, `POST /api/complaints`, embedded on
  `/contact`): a customer enters their id, a mobile / WhatsApp number and the
  problem, and the complaint is pushed to the owner's own WhatsApp.
  - `server/complaintStore.ts` — `complaints.json`, stored **before** delivery is
    attempted so a relay outage can never lose a complaint; atomic write, 1000-record
    cap, 365-day retention, `notified` / `notifyError` per record.
  - `server/ownerNotify.ts` — the only module that knows the destination number
    (`COMPLAINT_WHATSAPP_TO`) and the relay key (`CALLMEBOT_API_KEY`); it parses the
    relay's verdict from the **last block** of the response, because the relay echoes
    the message back and a customer who writes "error" must not be recorded as a
    failed delivery.
  - Owner-only `GET /api/owner/complaints` + `POST /api/owner/complaints/resolve`,
    and a complaints panel in the Ops Console showing the WhatsApp delivery state.
  - Honeypot + `complaintRateLimited` (6/hour by IP).
- `docs/DATABASE.md` §2.11, `docs/API.md`, `docs/ENVIRONMENT.md` §7b,
  `docs/SECURITY.md` §10/§13, `docs/KNOWN_ISSUES.md` §E, `docs/PROJECT_STRUCTURE.md`
  entry for the same.

### Changed
- **The owner's mobile number is no longer published.** `SUPPORT_PHONE` is no
  longer rendered on `/contact`, `/refund-policy`, `/data-deletion` or any public
  footer; those spots now link to `/complaint`. The number survives only as the
  server-side `COMPLAINT_WHATSAPP_TO` secret.
- `/healthz` `supportContactConfigured` now means "support email + a reachable
  public contact route" rather than "email + phone", and it gained
  `complaintWhatsAppConfigured`, `complaintWhatsAppTarget` (masked),
  `complaintsOpen` and `complaintsUndelivered`.
- `scripts/smoke-test.mjs` gained checks that `/complaint` serves the form,
  that `/contact` and `/complaint` publish **no** phone number or `wa.me` link,
  that a junk submission is rejected, and that the complaint relay is configured.
- **Support email replaced** on the host (`SUPPORT_EMAIL`) and in the operator
  docs referenced below.

### Added
- `docs/` documentation set: `ARCHITECTURE.md`, `AI_SYSTEM.md`,
  `META_INSTAGRAM.md`, `DATABASE.md`, `ENVIRONMENT.md`, `DEPLOYMENT.md`,
  `PROJECT_STRUCTURE.md`, `API.md`, `SECURITY.md`, `TESTING.md`,
  `KNOWN_ISSUES.md`, `HANDOVER.md`, `AI_CODING_AGENT_PROMPT.md`, `INDEX.md`,
  `DOCUMENTATION_AUDIT.md`.
- `INSTAFlow_AI_Project_Handover_Manual.pdf` (single-file handover manual, no
  secrets).
- `CHANGELOG.md` (this file).
- Rewrote `README.md` (the previous file was the AI Studio boilerplate) and
  `.env.example` (all placeholders, every supported variable).

### Changed
- Documentation only — **no application code or behaviour was modified.**
- **Ops pages: every main-point counter is now highlighted with its own accent
  (colour bar + tint + icon).** The Ops Console summary grid (11 counters) and
  the Onboarding board metrics (8 counters) were rows of identical tiles; each
  counter now carries a distinct left colour bar, tint and icon so it is
  recognisable at a glance — e.g. Bot blocked (rose/Ban), Reconnect needed
  (red/KeyRound), Needs attention (amber/triangle), On trial (purple/timer).
  Problem counters keep their loud colours. UI only — no behaviour change.

---

### Fixed
- **Preemptive fixes for dated Meta platform changes (proactive risk audit,
  2026-10-14).** Checked the codebase against Meta's published deadlines
  (Graph API version schedule, Instagram Messaging changelog) and fixed what
  would have broken without warning:

  - `META_GRAPH_API_VERSION` was pinned to **v21.0**, which expires
    **2027-01-21** — and an expired pin fails *silently* (Meta falls the call
    forward to the next usable version). It now defaults to `v23.0` and is
    overridable via `META_GRAPH_API_VERSION` env (`server/metaApi.ts`).
  - Meta is migrating the legacy `share` attachment to **`ig_post`**. Product
    detection keyed on `share` only, so when Meta flips a tenant's payload the
    text-less product-page DMs would silently drop again. `server/inboundMessage.ts`
    now accepts `product` / `share` / `ig_post` product payloads via one
    `isProductAttachment()` helper; 5 new tests in
    `scripts/inbound-message.test.ts` (28 total, all passing).
  - Railway's build logs revealed production runs **Node 20.20.2** (EOL since
    Apr 2026) because `engines` said `>=20.0.0`. Bumped to `>=22.0.0` so the
    next build selects a supported runtime (`docs/KNOWN_ISSUES.md` §G9).
  - `npm audit fix` cleared 1 high (`source-map-js` DoS). The remaining 4 highs
    are gRPC-*server*-side advisories in the firebase dependency chain, not
    reachable from this app's client-only Firestore usage — documented in
    `docs/KNOWN_ISSUES.md` §G8 instead of taking npm's breaking firebase@9
    downgrade.

  Full dated risk register (10 entries, incl. the ones that need no change:
  deprecated Message Tags, sticker format, 7-day ad window, Commerce API
  removal): [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) §G.

## 2026-10-14 (2)

### Fixed
- **The bot answered profile DMs but never replied to product-page inquiries
  (Instagram Shops product detail page).**

  A DM opened from a product page carries product context
  (`message.referral.product.id` per Meta's webhook docs, or a product
  attachment) and often **no text at all**. The webhook's first gate skipped any
  message without `message.text` — so a buyer who tapped "Message" on a product
  card got silence, while the same buyer typing from the profile message box got
  an AI reply. Confirmed against Meta's webhook reference: product-page
  messages arrive on the same `messages` event as ordinary DMs, with the
  product recorded as referral metadata, not as a separate event type.

  - New `server/inboundMessage.ts` (pure, unit-tested): classifies an incoming
    message as typed text, product inquiry (with or without text), or a genuine
    non-message (read receipt / sticker / lone reaction). Text-less product
    inquiries become a clearly-labelled stand-in
    (`[Product inquiry] … (product id: …)`) instead of being dropped — never a
    fabricated customer quote. Product id is read from `message.referral.product`
    and from `product` / `share-with-product` attachments.
  - `server.ts` webhook: the gate now drops only messages with nothing to
    answer; the AI system prompt gains a product-context instruction so the
    first reply acknowledges the listing and offers help with it (still bounded
    by the Knowledge Base and the answering rules).

  Verified end-to-end against the local dev server with a **signed** Meta-style
  delivery (real HMAC signature): a text-less product referral produced
  `AI reply generated via openrouter` and a product-aware greeting recorded in
  the inbox; an image-only control message was still dropped (unchanged
  behaviour). `scripts/inbound-message.test.ts` 23/23,
  `scripts/ai-reply.test.ts` 40/40, `scripts/onboarding.test.ts` 43/43,
  `tsc --noEmit` and `npm run build` clean.

  **Deployed to production the same day** and re-verified there with the same
  signed product-page delivery: `AI reply generated via openrouter
  (inclusionai/ling-3.0-flash)` and the send step ran (the fake test recipient
  is rejected by Meta as expected — counted as a permanent failure, no retries,
  no connection flag). `/healthz` counts unchanged (`trialing: 7`,
  `pendingCheckouts: 3`). Note: `/healthz` `buildId` stays
  `main-D2WbOH4s` because `readBuildId()` stamps the frontend bundle hash and
  this fix is server-side only.

---

## 2026-10-14

### Fixed
- **Every DM (and every Simulator test) again answered with the same canned
  reply: the default OpenRouter model had vanished from the catalogue entirely.**

  Symptom reported as "message fir se ek hi reply aa raha hai". Reproduced with
  a direct `generateAiReply()` probe: three attempts, all failed — OpenRouter
  HTTP 404 *"No endpoints found for inclusionai/ling-3.0-flash-sante"* (the paid
  slug chosen on 2026-10-09 is gone from the catalogue; only
  `inclusionai/ling-3.0-flash`, `ling-3.0-flash-vl` and `ling-3.1-flash` remain),
  then Gemini HTTP 503 *"high demand"* on `gemini-flash-latest`, then a Gemini
  timeout — so the whole fallback chain collapsed into `AI_FALLBACK_REPLY`.

  - `server/aiService.ts` — default is now `inclusionai/ling-3.0-flash`, verified
    live before switching: HTTP 200 in 2.2 s with a correct Hinglish answer,
    ~$0.021/1M prompt + ~$0.063/1M completion tokens (~₹0.002 per reply).
  - The bare slugs `ling-3.0-flash-sante` / `ling-3.0-flash-fin` (with and
    without `:free`) added to `RETIRED_OPENROUTER_MODELS`, and the regex safety
    net extended to match the bare `sante`/`fin` families — a host still carrying
    any of them is remapped to the default with a warning. Bare
    `ling-3.0-flash` and `ling-3.0-flash-vl` are deliberately NOT matched (alive).
  - **Gemini double-attempt bug fixed:** when OpenRouter failed, `generateAiReply`
    tried Gemini in the fallback block AND again in step 2 ("if OpenRouter is not
    configured" did not actually check that) — two full Gemini rounds just to
    produce the canned reply. Gemini is now attempted at most once per reply.
  - Gemini backup model: `callGemini` now retries once on `gemini-2.5-flash`
    when the configured model fails (measured same day: `gemini-flash-latest`
    503 "high demand", `gemini-2.5-flash` OK in 1.5 s).

  Verified after the change: `scripts/ai-reply.test.ts` 40/40,
  `scripts/onboarding.test.ts` 43/43, `tsc --noEmit` clean, `npm run build`
  clean; local `POST /api/simulate-dm` answered 3/3 with `provider: openrouter`
  and KB-grounded Hinglish replies (no canned fallback), and the forced
  OpenRouter-failure path answered via Gemini with exactly one Gemini attempt.

  **Deployed to production the same day** (`railway up`, build `main-D2WbOH4s`,
  host `OPENROUTER_MODEL` also updated to the new default). Verified live after
  the deploy: `/healthz` shows `aiModel: inclusionai/ling-3.0-flash`, the
  volume-backed counts survived (`trialing: 7`, `pendingCheckouts: 3` — unchanged
  from pre-deploy), and `POST /api/simulate-dm` on the live host answered 2/2
  with `provider: openrouter` and KB-grounded Hinglish replies.

---

## 2026-10-09

### Fixed
- **Every DM fell through to the canned "we received your message" reply: the
  default OpenRouter model had gone paid-only.**

  `inclusionai/ling-3.0-flash-sante:free` has been the default since 2026-09-29.
  On 2026-10-09 the live host answered `POST /api/simulate-dm` with
  `provider: fallback`, `model: standard-support` after ~18 s, and OpenRouter
  answers the id itself with HTTP 404 — *"This model is unavailable for free. The
  paid version is available now - use this slug instead:
  `inclusionai/ling-3.0-flash-sante`"*. This is the third retirement of this one
  setting, and it fails silently by design: the customer gets a polite sentence
  instead of an error, which is why it took a `readiness` run to notice.

  - `server/aiService.ts` — the default is now the **paid** slug
    `inclusionai/ling-3.0-flash-sante`, picked by measurement rather than by tier.
    Three identical Hinglish calls per model with the production key:
    `google/gemma-4-31b-it:free` **1/3** (HTTP 429, shared-pool rate limit),
    `nvidia/nemotron-3-super-120b-a12b:free` **2/3** (one empty completion) and
    `inclusionai/ling-3.0-flash-sante` **3/3** at a 2.1 s median. A rate-limited
    default is indistinguishable from a dead bot, because both end in the same
    canned sentence. Cost: ~$0.042 / 1M prompt tokens and ~$0.1232 / 1M completion
    tokens, about ₹0.005 per reply — a host that wants zero cost can still pin
    `OPENROUTER_MODEL` to a `:free` id.
  - `inclusionai/ling-3.0-flash-sante:free` added to `RETIRED_OPENROUTER_MODELS`.
    That dead id is the value still sitting in the production host's env, so this
    remap is the part that lets a deploy fix production without an env edit.
  - The regex safety net narrowed to
    `/ling-3\.0-flash[a-z0-9-]*:free|llama-3\.3-70b/`. The previous
    `/ling-3\.0-flash/` form also matched the paid slug, which is alive and
    working — it would have quietly replaced a healthy model with the default.

  Verified end-to-end after the change, with the production value still set: a real
  `generateAiReply()` call returned `provider: openrouter`,
  `model: inclusionai/ling-3.0-flash-sante`, ~2.1 s, Hinglish answer.
  Shipped to production on 2026-10-14 (build `main-D2WbOH4s`) together with the
  2026-10-14 fix below — and superseded by it: the model this entry set
  (`ling-3.0-flash-sante`) was itself retired from the catalogue days later,
  which is the incident the 2026-10-14 entry documents.

---

## 2026-10-06

### Added
- **Tester-request username prefill**: a customer on the blocked-connect screen
  now gets their Instagram handle suggested from the connected account, their
  sign-in email or their display name (`src/instagramUsername.ts`,
  `suggestInstagramUsername`), with a note explaining where it came from.
- Owner-only tip line added to the tester-request form copy.

### Changed
- **Operator wording**: user-facing "owner" strings replaced with **"Team Fgt"**
  throughout the UI (`src/i18n.tsx`). Code identifiers (`isOwner`, `OWNER_EMAILS`,
  `OWNER_TENANT_IDS`) intentionally unchanged.
- **Homepage/landing branding**: added the "FUTURE GROWTH AND TECHNOLOGY" brand
  heading (with the smaller "InstaFlow AI SaaS" line) above the hero title on the
  landing page and the dashboard sign-in screen.

### Fixed
- No functional fix in this entry — the above are the changes shipped in deploy
  `6aec5a8f-22e5-4e58-aa08-2313a80bcbcb` (SUCCESS, 2026-10-06 18:09 +05:30).

### Tested
- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0 (`dist/server.cjs` 236.6 kB).
- Unit-checked `suggestInstagramUsername` against handles, `@` handles, profile
  URLs with query strings, emails, `+tag` emails, display names and empty input.
- Live site verified to serve the new bundle (`main-C_9--yL0.js`) and the new
  branding strings.

---

## 2026-10-04

### Changed
- **`server/metaApi.ts`**: Instagram Login and Facebook Login handling reworked —
  token-flavour auto-detection (`isInstagramLoginToken`), routing to
  `graph.instagram.com` for `IG…` tokens, `exchangeForLongLivedInstagramToken`
  made a soft failure with a reason (`getLastLongLivedExchangeError`), and
  `formatMetaError` extended to explain the Meta access-gate (code 100) case.

*(Date from file timestamp; specific change list from reading the module.)*

---

## 2026-10-03

### Added
- `scripts/oauth-token-probe.js` — probe an OAuth token against Meta endpoints.
- `scripts/extend-trials.py` — one-off trial extension helper.

### Changed
- **`server/planStore.ts`**: `TRIAL_DAYS` set to **5**; `normalizeTrialLengths()`
  added so previously-issued trials are shortened to the configured length
  (shorten-only, idempotent).

---

## 2026-10-02

### Added
- `META_APP_REVIEW_SUBMISSION_PACK.md`, `OAUTH_ACCESS_VERIFICATION_RUNBOOK.md` —
  operator material for the Meta Access Verification / App Review submission.

---

## 2026-10-01

### Added
- `TEST_PLAN_TWO_TENANT_LIVE_DM.md` — two-tenant live-DM test plan.
- `CLIENT_CONNECT_CHECKLIST.md` — per-client connect checklist.

### Changed
- **`server/connectionStore.ts`**: strict account matching in
  `getTenantByInstagramAccountId` (the previous single-tenant fallback was
  removed as a cross-tenant leak); `getTenantByInstagramUsername` added for the
  public booking page with an ambiguity guard.
- **Lead capture** (`server/leadStore.ts`) and booking-page slugs introduced.

---

## 2026-09-29

### Fixed
- **AI silently dead**: the previously configured OpenRouter free model
  (`inclusionai/ling-3.0-flash-fin:free`) was retired, so every DM fell through to
  Gemini and then to the canned reply. Replaced with
  `inclusionai/ling-3.0-flash-sante:free`, added `RETIRED_OPENROUTER_MODELS`
  remapping, the 9-second abort timeout, and `verifyOpenRouterModelAtBoot()` so a
  dead model shows up in the deploy log.
- **Duplicate AI replies**: webhook de-duplication moved from memory to
  `processed-messages.json` on the volume (`server/messageDedupe.ts`).

### Changed
- Inbox history and human-takeover state moved from an in-memory `Map` in
  `server.ts` to the volume-backed `server/chatStore.ts`.

### Added
- `DEPLOY.md` (operator deployment notes).

---

## 2026-09-27 / 2026-09-28

### Added — initial production SaaS build (**NEEDS VERIFICATION** for exact dates)
- `server.ts` route table, `server/auth.ts` (Firebase token verification without
  firebase-admin), `server/encryption.ts` (AES-256-GCM), `server/tenantSettings.ts`
  (system prompt + knowledge base), `server/kbGapStore.ts` (unanswered-question
  tracking), `server/onboardingStore.ts`, `server/publicCopy.ts` + `server/i18n.ts`
  (server-rendered landing/pricing/legal pages, English + Hindi),
  `server/payments.ts` (Razorpay), `server/opsOverview.ts` (owner console data).
- Two-entry Vite build (`index.html` customer app, `ops.html` owner console).
- Meta app published to live mode (2026-09-27, per operator notes).

> The project predates the first commit captured in this repository's history.
> Everything earlier than 2026-09-27 is **NEEDS VERIFICATION** and is deliberately
> not reconstructed here.

---

## Pending (planned / recommended, **not implemented**)

### Planned
- **AI provider abstraction** (Provider Adapter) so a provider can be swapped
  without touching call sites — [`AI_SYSTEM.md`](docs/AI_SYSTEM.md) §12.
- **Meta Tech Provider / Access Verification** completion so customers can connect
  without a tester invite — [`KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) A1.
- **Automated test suite** for the pure logic modules and the tenant-routing
  regression — [`TESTING.md`](docs/TESTING.md) §5.
- **Security headers, explicit CORS, `trust proxy`** — [`SECURITY.md`](docs/SECURITY.md).
- **Backup automation** for the volume — [`DEPLOYMENT.md`](docs/DEPLOYMENT.md#9-backup--restore).
- **Bug fixes** listed in [`KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) (trial-length
  copy, hardcoded analytics cards, per-tenant KB gaps).
