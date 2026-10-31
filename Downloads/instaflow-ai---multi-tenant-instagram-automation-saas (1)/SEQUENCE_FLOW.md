# Sequence Flow — InstaFlow AI ko end tak chalu karne ka order

Bana: **9 October 2026** · Ye file order batati hai, dohrati nahi. Detail ke liye:
[CLIENT_CONNECT_CHECKLIST.md](CLIENT_CONNECT_CHECKLIST.md) (connect ke 2 raste),
[OAUTH_ACCESS_VERIFICATION_RUNBOOK.md](OAUTH_ACCESS_VERIFICATION_RUNBOOK.md) (Access Verification + ek OAuth retry),
[TEST_PLAN_TWO_TENANT_LIVE_DM.md](TEST_PLAN_TWO_TENANT_LIVE_DM.md) (live-DM isolation test).

Har step par teen cheezein likhi hain: **Kaun** karega · **Kya chahiye** · **Proof** (kaise pata chalega ki ho gaya).

**Secrets is file me nahi jaate** (AGENTS.md rule). Keys/values sirf host env me ya aapke haath se.

---

## 0. Aaj ki sthiti (sab 9 Oct 2026 ko verify kiya)

| Cheez | Aaj ka sach | Proof |
|---|---|---|
| Local dev | `http://localhost:3000` chalu, PID 13180 | `/healthz` 200, `/app` + `/ops` render |
| Local tests | `npm run smoke` 31/33 | 2 FAIL sirf production-only checks (build-id stamp, `no-store`) |
| Prod build | `main-CIfyZfIM`, `nodeEnv=production` | `https://www.thefgt.in/healthz` |
| Prod OAuth | flavour `instagram_login`, `clientId 2315015095917318` | `/healthz` → `oauthApp` |
| Prod webhook | signature enforce ON, secrets `META_APP_SECRET` + `IG_APP_SECRET` | `/healthz` |
| Prod accounts | **20 total · 0 paying · 13 trial · 14 bot blocked (billing) · 13 IG not connected · 2 reconnect needed · 4 paused by team** | `/ops` (read-only, 11:02 AM) |
| Prod AI | `aiProvider=OpenRouter` par asli reply **Gemini** se aata hai (5.9s) → OpenRouter call fail ho rahi hai | readiness DM check |
| Go-live gate | **NOT READY** — 3 blockers: deployed frontend vs `dist/` drift, complaints WhatsApp off, payments off | `npm run readiness --url=https://www.thefgt.in` |
| Railway CLI | installed (4.44.0) par **login nahi** | `railway whoami` → Unauthorized |
| Local `.env` gap | `IG_APP_SECRET` khaali → local par connect flow Facebook-Login flavour chalta hai, prod (Instagram Login) jaisa nahi | boot log |

**Jo customers ka bot abhi chup hai (prod console se, handle + uid pair kiya):**

| Handle | Tenant uid | Wajah | Plan |
|---|---|---|---|
| `@desi_tour001` | `vYifWVGUWHRQOD1jRzpyixIiaKJ3` | token 7 Oct ko Meta ne reject kiya · trial 8 Oct ko khatam (billing blocked) | reconnect + billing |
| `@sofficial_sehaj` | `RQ6diKbq1vb6IPUAsYQutWMQ23T2` | token 6 Oct ko Meta ne reject kiya | reconnect (trial 11 Oct tak valid) |

---

## 0.5 Decisions locked (9 Oct 2026)

| Cheez | Aapka decision | Iska matlab |
|---|---|---|
| Pehla target | **`@desi_tour001`** (uid `vYifWVGUWHRQOD1jRzpyixIiaKJ3`) | Isi par pehle end-to-end proof — lekin iska trial 8 Oct ko khatam hai, to **billing pehle** theek karna padega |
| Payments | **Off rahega**; blocked bots comp/trial se unblock | 14 blocked bots ko `Hamesha free karo` (comp) se turant chalu kiya ja sakta hai — Razorpay ki zaroorat nahi |
| Access mode | **Railway + Meta dono kaam aap khud karo**, main verify karunga | Main abhi bhi Meta dashboard **read-only** padh sakta hoon (session mil gaya), par koi change aap karoge |

### Meta par abhi kya dikha (read-only, 9 Oct)

- `developers.facebook.com` par main **Manish Jaiswal** ke roop me signed in hoon; app **FlowAI** khulta hai.
- Meta ka apna banner wahan likhta hai: **business-owned app ke roles ab Meta Business Suite se manage hote hain** ("Additional business users not listed below may also have roles…"). App roles page par filhaal sirf `Manish Jaiswal = Administrator` dikhta hai.
- ⚠️ **Instagram Testers ka section aaj teeno jagah nahi mila** (9 Oct, read-only check):
  1. Dashboard → **App roles → Roles** (`/apps/1226093629512976/roles/roles/`) — page ke poore text me `instagram`/`tester` ka **zero match**; sirf "App roles" + `Add People` hai.
  2. Dashboard → **Testing** (`/apps/1226093629512976/test/`) — sirf test users + Graph API Explorer + use case progress ("Manage messaging & content on Instagram — Testing in progress").
  3. **Business Suite → Settings → Apps → FlowAI** (ID `1226093629512976`, Owned by `the_nutritionhut`) — tabs sirf **Details / People / Partners / Connected assets**, `People = 1 person`; koi tester option nahi.
- Iska matlab: `/ops` ka **"Open Meta Roles page"** link **sahi app** par jaata hai (verified — "FlowAI - App roles" khulta hai, kyunki link Facebook app id `1226093629512976` se banta hai), par us page par tester add karne ka UI aaj **maujood hi nahi**. Isliye "tester add karo" wala raasta filhaal rukta hai → asli unblock **Tech Provider + Access Verification** (Rasta 1) hai. Beech ke samay me ye gap Meta developer support/community thread par report karna chahiye.
- `developers.facebook.com/apps/2315015095917318/` kholne par dashboard **nahi** khulta (apps list par redirect) — ye expected hai aur repo me documented hai: Instagram app id dashboard URL nahi hota ([server/appIdentity.ts:48-56](server/appIdentity.ts#L48-L56)). Dashboard hamesha **Facebook app id `1226093629512976`** se khulta hai.

### Ops Console ke exact buttons (code se verify kiye)

| Kaam | Console button | Route |
|---|---|---|
| Billing unblock (comp) | `Hamesha free karo` / `Make free forever` (badge: `Hamesha free` · `Free forever`) | `POST /api/owner/tenants/free-forever` ([server.ts:2939](server.ts#L2939)) · label [src/i18n.tsx:404-408](src/i18n.tsx#L404-L408) |
| Connection theek/check | `connect-fix` / `connect-fix-all` | [server.ts:2828](server.ts#L2828), [server.ts:2886](server.ts#L2886) |
| Token live health | connections health | `POST /api/owner/connections/health` ([server.ts:3158](server.ts#L3158)) |
| Bot ko DM ke bina test | self-test | `POST /api/owner/tenants/self-test` ([server.ts:3027](server.ts#L3027)) |
| Tester request queue | tester row status | `POST /api/owner/tester-requests/status` ([server.ts:2196](server.ts#L2196)) |

---

## 1. Aapko kya dena hai (access handover — lagbhag 10 minute)

> 9 Oct ka decision: **Meta aur Railway ke changes aap khud karoge**, main verify karunga. Isliye neeche har row par likha hai ki aapko kya karna hai aur main kya confirm karunga. Access dene ka ek hi hissa bacha hai — Railway logs (dekho row 1).

| # | Kya | Kaun | Main kya karunga |
|---|---|---|---|
| 1 | **Railway** | Aap — ya (a) terminal me ek baar `railway login` karwa do, ya (b) khud `railway logs --service insta_flowai` chala kar output paste karo (secrets nahi hote) | (a) me main logs khud padh lunga; (b) me main pasted output verify karunga |
| 2 | **Meta developer session** | ✅ Ho gaya — main is browser me `developers.facebook.com` par signed in hoon (read-only padhta hoon) | Roles / permissions / Tech Provider / Access Verification status — sab khud padh lunga |
| 3 | **Pehla IG account** | ✅ Decide ho gaya: `@desi_tour001` | Tester list me uska **Active/Pending** status verify karunga (Pending par connect rok dunga) |
| 4 | **2-tenant test ka doosra account** | Aap — ek second IG Professional account jiska aap owner ho | Live DM isolation test (real DMs, no simulator) |
| 5 | *(optional)* **Complaint WhatsApp** | Aap — `COMPLAINT_WHATSAPP_TO` + `CALLMEBOT_API_KEY` Railway env me (value chat me kabhi nahi) | `/healthz` → `complaintWhatsAppConfigured: true` verify karunga |
| 6 | *(decided)* **Payments** | Off rahega; blocked bots `Hamesha free karo` (comp) se unblock | `/healthz` → `paymentsConfigured` aur `/ops` ka blocked counter verify karunga |

> Secrets ke liye rule: value **kabhi chat me nahi**. Ya aap host/env me daalo, ya mujhe file ka path do — main usko host env me bhej dunga.

---

## 2. Sequence — kis order me kya hoga

### Phase 1 — Access handover + baseline (aap 5 min, main 5 min)
1. **Kaun:** main → prod `healthz` + `/ops` read (read-only) ✅ **already done** (9 Oct, 11:02 AM).
2. **Kaun:** main → Meta dashboard read-only ✅ **already done** (FlowAI app khulta hai, `Manish Jaiswal = Administrator`).
3. **Kaun:** aap → Railway ka ek raasta chuno: terminal me `railway login` (recommended) **ya** khud logs chala kar paste karo.
4. **Proof:** `railway whoami` email dikhaye, aur logs me aaj ka `WEBHOOK`/`DM` line aa jaye.

### Phase 2 — Chhupe hue bots wapas chalu (aaj, sabse zyada value)
Target order (aapka decision): **`@desi_tour001` pehle**, phir `@sofficial_sehaj`.

`@desi_tour001` ka special case: iska token 7 Oct ko reject hua **aur** trial 8 Oct ko khatam — isliye ise **do cheezein** chahiye, aur billing pehle:

0. **Kaun:** aap → `/ops` → us tenant (`vYifWVGUWHRQOD1jRzpyixIiaKJ3`, `@desi_tour001`) → **`Hamesha free karo`** (English UI me `Make free forever`) ya trial extend. Payments off rehne se yehi raasta hai.
   **Proof:** `/ops` par us card ka red `● Blocked` hat jaye, aur bot blocked counter 14 se ghat jaye.
1. **Kaun:** aap → tester add karne ki koshish karo — par pehle **Meta-side raasta confirm** karo, kyunki 9 Oct ke check me **Instagram Testers ka UI app dashboard aur Business Suite dono me nahi mila** (upar "Meta par abhi kya dikha" dekho). Isliye is step par ruk jaana normal hai; rukne par seedha **Rasta 1 (Tech Provider + Access Verification)** submit karna hi samajhdari hai — uske baad tester ki zaroorat hi nahi rehti (`CLIENT_CONNECT_CHECKLIST.md` Rasta 1).
2. **Kaun:** aap → us IG account ke phone se Instagram → Settings → Website permissions → Apps and Websites → **Tester Invites → Accept**.
3. **Kaun:** main → roles par **Active** confirm karunga (Pending par connect **nahi**).
4. **Kaun:** aap → us customer ke dashboard se **Connect Instagram with Meta** → permission screen par **Allow**.
5. **Kaun:** main → logs se verify: `Successfully connected Instagram Account @…` present, `Long-lived token exchange returned no token` absent.
6. **Kaun:** main → `/ops` ka **self-test** chalakar dikhaunga ki bot asli me jawab de raha hai (asli DM ke bina).
7. **Proof:** `/ops` me "Reconnect needed" 2 → 0, `/healthz` me `connectionsNeedingReauth` 0, aur us tenant ka self-test pass.

`@sofficial_sehaj` (trial 11 Oct tak valid) par baad me wahi 1–7, sirf step 0 ke bina.

### Phase 3 — Naya connect (role path) test
Wahi 1–5 steps ek naye account par, **ek hi OAuth attempt** — pehle logs padhunga, phir aap connect dabaoge, phir main log line verify karunga. Fail ho to fbtrace_id capture karke ruk jaunga (blind retry nahi).

**Rule:** ek failed try = ek asli Meta authorization barbaad. Isliye Active confirm hone se pehle Connect nahi.

### Phase 4 — Permanent fix: Access Verification (naye customers ke liye)
Yeh Phase 3 ke baad bhi zaroori hai — warna **role-less naya customer** connect nahi kar sakta.

1. **Kaun:** main → Meta me status padhunga: "Become a Tech Provider" card hai ya gaya, permissions par "Verification required" badge hai ya nahi, Access Verification submitted hai ya nahi.
2. **Kaun:** aap → jo bhi click sirf aap kar sakte ho: Tech Provider YES, AV form submit (categorization text [META_APP_REVIEW_SUBMISSION_PACK.md](META_APP_REVIEW_SUBMISSION_PACK.md) Part 5 me ready hai), identity/business proof.
3. **Kaun:** main → baaki sab: `SUPPORT_EMAIL=info@thefgt.in` already prod par set hai (`/healthz` → `supportContactConfigured: true`), business verification 29 Sep ko ho chuki.
4. **Proof:** Dashboard se Tech Provider card gayab + permissions par "Ready for testing" na likha ho.
5. **Samay:** Meta ka decision ~5 din. Tab tak sab kuch Phase 2/3 (role path) se chalta rahega.

### Phase 5 — Live DM loop proof (do tenant, asli DM)
[TEST_PLAN_TWO_TENANT_LIVE_DM.md](TEST_PLAN_TWO_TENANT_LIVE_DM.md) ke T1–T4 + isolation checkboxes.
- **Kaun:** aap → do consumer accounts se DM bhejo (alag phone).
- **Kaun:** main → `railway logs` par har DM ka routing, reply, aur cross-tenant leak check.
- **Proof:** T1–T4 ke expected jawab, zero cross-tenant line, `/ops` me "Bina connection wali DM" 0.

### Phase 6 — Go-live hygiene (readiness green)
| Kaam | Kaun | Proof |
|---|---|---|
| Deploy drift fix (`railway up` se current build live) | main, aapki permission ke baad | `/api/version` buildId == local `dist/assets/main-*.js` |
| `OPENROUTER_MODEL` badalna (aaj wala naam OpenRouter catalogue me nahi; har DM par ek fail round-trip) | main (env naam batakar) + aap value confirm | boot log: model available; DM reply provider=openrouter |
| Complaints WhatsApp relay | aap (keys), main verify | `/healthz` → `complaintWhatsAppConfigured: true` |
| Payments ON/OFF decision | aap | `/healthz` → `paymentsConfigured` |
| Final gate | main | `npm run readiness --url=https://www.thefgt.in` → **READY** + `npm run smoke` 33/33 |

### Phase 7 — App Review submission (jab aap bolo)
Submission `1361245572664447` abhi **pending** hai — main ise aapki explicit permission ke bina touch nahi karunga. Screencast, reviewer account (`manish98886+metareviewer@gmail.com`) aur reviewer mailbox (`meta.reviewer@thefgt.in`) ready hain.

### Phase 8 — Local housekeeping (optional, jab local par prod jaisa test karna ho)
`.env` me `IG_APP_SECRET` khaali hai → local par OAuth Facebook-Login flavour chalta hai. Value aap daalo (chat me nahi), phir local bhi `instagram_login` flavour par test ho sakega.

---

## 3. Verification gates (main yahi command chalata hoon)

```bash
# prod ki asli sthiti (secrets nahi dikhte)
curl -s https://www.thefgt.in/healthz

# go-live gate: READY ya NOT READY
npm run readiness --url=https://www.thefgt.in

# boot + webhook + auth + AI ka smoke
npm run smoke

# connect ke asli error ke liye (Railway login ke baad)
railway logs --service insta_flowai | grep -E 'Successfully connected|token exchange|No active connection|Unsupported request'
```

Owner-token wale 2 checks (owner recognised, tenant list) aaj **SKIP** hain kyunki unke liye `READINESS_ID_TOKEN` chahiye — wo main `/ops` console se hi dekh leta hoon, token chat me nahi mangunga.

---

## 4. Main kya nahi karunga (bina aapki permission)

- Deploy/publish (`railway up`), koi env var change, ya App Review submit — pehle poochhunga.
- Meta par destructive kuch bhi: assets/partners hatana, app↔portfolio link todna, tester remove karna.
- Secrets chat me lena/print karna, ya project files me likhna.
- Meta/Instagram par koi action **bina** is baat ke ki aapne uska zikr kiya ho — aur waha koi bhi cheez jo doosre insaan ko message bhejti hai, pehle confirm karunga.
- Blind OAuth retry: ek attempt = ek verification, aur uske baad log padhkar rukna.

## 5. Agar Phase 2/3 fail ho (contingency)

Log me `Unsupported request` / code 100 → account app ka role-holder nahi hai (sahi app par invite dobara) — code fix nahi hai.
`Token exchange returned no token` → us attempt ka fbtrace_id capture, Phase 4 (Access Verification) ka wait, aur sirf aapki permission par [OAUTH_ACCESS_VERIFICATION_RUNBOOK.md](OAUTH_ACCESS_VERIFICATION_RUNBOOK.md) Part C ka log line add karna.
