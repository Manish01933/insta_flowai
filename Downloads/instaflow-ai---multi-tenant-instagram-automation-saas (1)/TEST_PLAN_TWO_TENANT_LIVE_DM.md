# Two-Tenant Live DM Isolation Test Plan

**Goal:** prove with REAL Instagram DMs (no simulator) that Tenant A's DM is answered only from
Tenant A's KB/AI and Tenant B's DM only from Tenant B's KB/AI — and that no tenant can receive or
use the other's Knowledge Base, products, prices, business profile, conversations, or IG token/account.

**Status: BLOCKED on user actions** — needs a second genuinely connected Instagram Professional
account. Nothing in this plan modifies OAuth, tenant isolation, or deployment code.

---

## 0. What is already proven (no action needed)

| Layer | Evidence |
|---|---|
| Strict webhook routing | `getTenantByInstagramAccountId` matches IG account → tenant by exact index; single-tenant fallback removed; unknown IG account rejected live: `No active connection found for IG Account 1784…449` |
| Per-tenant AI context | Webhook handler loads `getTenantAiContext(tenantId)` per resolved tenant; simulator already proved both directions with 2 tenants + demo |
| Per-tenant token storage | connections.json keyed by tenant uid, token AES-256-GCM encrypted, never leaves the server |
| Per-tenant billing gate | DM answered only if that tenant has trial/plan active |

What is NOT yet proven end-to-end: a **real inbound DM to two different connected accounts in the
same session**, verifying each reply came from its own tenant's KB.

---

## 1. Prerequisites (user actions)

- [ ] **1.1** Tenant A = existing: signup `manish98886@gmail.com` tenant `5eurbDvqjpWY8ElOI7xVlm4s6852`,
      IG **@thenutritionhut033** (connected, supplement KB). Start its 3-day trial or keep comp active.
- [ ] **1.2** Tenant B = the isolation-test signup (or a new one):
      `tenant2@isolation-test.example.com` tenant `KVrpKyhbO8XmCMTfQ0PwoY59WQB3`,
      KB = salon docs (Glow & Go Salon, haircut ₹299). Start the trial on this tenant too
      (Connections → Start 3-day free trial) — without a plan the bot legally will NOT answer.
- [ ] **1.3** A **second real Instagram Professional account** (Business or Creator) that the user
      controls, e.g. a salon-named handle. Personal accounts cannot connect.
- [ ] **1.4** Add that IG account as an **Instagram Tester** on Meta app `2315015095917318`
      (App Dashboard → App roles → Roles → Add Instagram Testers → accept the invite from the IG
      app's Settings → Website permissions → Apps and Websites → Tester invitations).
      *Needed because Advanced Access is still pending App Review.*
- [ ] **1.5** Connect it: sign in at `https://www.thefgt.in/app` as Tenant B → Connections →
      **Connect Instagram with Meta** → authorize that IG account. Confirm the dashboard shows
      `Connected` and the IG Business ID differs from Tenant A's `17841480425133208`.

---

## 2. Test steps (real DMs)

Send from **two different real Instagram consumer accounts** (friend's phone, or the other
tenant's owner account — must NOT be the business account itself):

| # | From | To | Message (customer language) | Expected reply source |
|---|------|----|------------------------------|----------------------|
| T1 | Consumer 1 | **Tenant A** @thenutritionhut033 | "whey protein ka rate kya hai?" | Supplement KB tone (The Nutrition Hut persona). Prices are placeholders → "team se confirm" |
| T2 | Consumer 2 | **Tenant B** (salon IG) | "haircut ka price kya hai?" | **₹299** + WhatsApp 98765-43210 — salon KB |
| T3 | Consumer 1 (same person) | **Tenant B** (salon IG) | "The Nutrition Hut se whey ka rate milta hai kya?" | Salon bot must NOT know whey/Nutrition Hut — "knowledge base mein information nahi" style KB-miss |
| T4 | Consumer 2 (same person) | **Tenant A** @thenutritionhut033 | "haircut ka price? Glow & Go Salon kahan hai?" | Supplement bot must NOT know salon data |

### Isolation checks after T1–T4

- [ ] **Knowledge Base / products / prices / business profile**
      - T2 reply mentions ONLY salon facts; T1 reply ONLY supplement facts.
      - T3 reply contains no whey price, no Nutrition Hut data, no supplement offers.
      - T4 reply contains no ₹299, no Glow & Go Salon, no salon timings.
- [ ] **Conversations**
      - Sign in as Tenant A → Inbox: shows ONLY its own chat(s). Search for the salon test text → absent.
      - Sign in as Tenant B → Inbox: shows ONLY its own chat(s). Search for the whey test text → absent.
- [ ] **Instagram token / account**
      - Railway logs during T1–T4 (see §3): each webhook delivery resolves to the correct tenant ID;
        there is exactly ONE `Active indexed accounts` list containing BOTH IG account IDs, and each
        message is answered with the token of the receiving tenant only.
      - Tenant A dashboard still shows its own IG account + `AES-256-GCM Encrypted`; Tenant B shows
        only its own. Neither dashboard ever lists the other account.
- [ ] **Webhook routing evidence**
      - For every DM, log line `DM from <sender> to <IG-account-id>` is followed by tenant resolution
        and `Generating AI reply` — no `No active connection found` for A/B accounts (that error is
        expected ONLY for unrelated/unknown accounts).

## 3. Evidence collection (safe, no secrets)

```bash
# watch live webhook + routing lines (values are account IDs, not secrets)
wsl -e bash -lc "export PATH=\$HOME/.railway/bin:\$PATH; cd ~/instaflow && railway logs --service insta_flowai" \
  | grep -E 'WEBHOOK|DM |Active indexed|No active connection|Generating AI reply|tenant'
```

## 4. Verdict rules

- **PASS** = T1–T4 all answered as expected AND all isolation checkboxes hold AND zero
  cross-tenant log lines.
- **FAIL** = any reply contains the other tenant's KB facts, a wrong tenant inbox shows the other
  tenant's conversation, or a log line resolves an IG account to the wrong tenant ID
  (→ stop, do not ship; report the exact log line).
- **BLOCKED** = prerequisite missing (second IG account not connected / tester not accepted /
  no plan on Tenant B). Record which checkbox in §1 failed.

## 5. If FAIL happens (contingency)

Isolation bug would live in the webhook → `getTenantByInstagramAccountId` → `getTenantAiContext`
chain (server/connectionStore.ts, server/tenantSettings.ts, server.ts DM handler). Freeze deploys,
capture the log line showing the mismatch, and re-verify with the simulator matrix before touching code.
