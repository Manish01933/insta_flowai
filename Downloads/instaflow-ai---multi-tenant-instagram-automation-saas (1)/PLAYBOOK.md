# PLAYBOOK — InstaFlow AI ko roz kaise chalana hai

Ye doc do sawaalon ka jawab deta hai: **customer ko kya karna hai** aur **aapko kya karna hai**.
Technical setup ke liye `DEPLOY.md` padho; Meta ki technical detail `META_SETUP.md` me hai.

---

## 0. Do log, do kaam

| | Customer (jo paisa deta hai) | Aap (owner / operator) |
|---|---|---|
| Login kahan | `https://www.thefgt.in/` → sign up → `/app` | `https://www.thefgt.in/ops` |
| Kya karta hai | Instagram connect, knowledge base, leads | har account dekhta hai, help karta hai, paisa |
| Roz kitna time | 10 minute ek baar (setup), phir sirf leads | 10-15 minute |
| Kaun decide karta hai | apna plan, apna content | pricing, kisko allow karna hai |

Dashboard me aapko **Ops Console** ka purple button dikhta hai (sirf owner account me) — wahi `/ops` kholta hai.

### 0.1 Kaun kis cheez ka maalik hai (boundaries)

| Cheez | Customer | Aap (admin) |
|---|---|---|
| Apna Instagram connect / disconnect / dobara verify | ✅ | ✅ (kharab ho to theek karne ke liye) |
| Apna knowledge base, bot ka prompt, apni leads | ✅ | ✅ (API level par) |
| Apna plan lena / badalna / cancel karna | ✅ | ❌ (sirf customer khud kar sakta hai) |
| Pricing, trial ki lambai, kisko allow karna | ❌ | ✅ |
| Sab accounts ki health (plan, bot on/off, Instagram status, counts, errors) | ❌ | ✅ |

Ek zaroori baat saaf-saaf: **`/ops` ki screen par kisi customer ka naam, email ya DM ka text nahi dikhta** — bas uid,
plan, bot on/off, Instagram handle, aur ginti (leads / chats / documents) plus attention flags. Lekin **API level par
owner ke paas cross-tenant read ka poora access hai** (`isOwnerIdentity` ka wahi hissa hai jo aapko doosre tenant ka
data padhne deta hai). Yaani privacy ka bharosa UI par nahi, aapke vyavhaar par tika hai — isliye console ki screen
ko aisa hi rakho (sirf counts aur status), aur customer ke content ko chup-chaap na dekho.

---

## 1. Customer ka safar (10-15 minute)

Customer ko sirf itna batana hai. Ye wahi order hai jo dashboard ke "Getting started" me dikhta hai.

1. **thefgt.in** kholo → *Try free for 3 days* → Google ya email/password se account banao.
   Card ki zaroorat nahi. 3 din ka trial turant chalu ho jata hai.
2. **Step 1 — Trial/plan.** Trial **3 din** ka hai. Trial ke baad Starter / Growth / Agency me se koi bhi
   (₹999 / ₹2,499 / ₹4,999 per month).
3. **Step 2 — Instagram connect.** Customer ka Instagram **Professional (Business ya Creator)** hona chahiye,
   aur ek Facebook Page se juda hona chahiye. Ye step sabse mushkil hai — **neeche point 5 padho, ye hi
   aapki asli diwar hai.**
4. **Step 3 — Knowledge Base.** Yahi wo cheez hai jisse bot jawab deta hai. Screen pe ek click ka
   **"5 starter documents"** button hai: woh price, timing, location, kya included hai, aur
   booking/cancellation — panch documents likh deta hai, jisme sirf `[brackets]` bharne hote hain.
   Har document ke pencil icon se baad me edit bhi ho jata hai. Save automatic hai.
5. **Step 4 — Simulator.** Customer wahan khud bot se baat karke dekh sakta hai ki jawab sahi hai ya nahi.
   Live customers ko bhejne se pehle ye zaroor karna chahiye.
6. **Step 5 — Verify it is live.** "Verify Live Connection" dabane par Meta se token dobara check hota hai.
7. **Booking page.** Har account ka apna public page banta hai (`/book/<username>`). Customer ise apne
   Instagram bio me daal deta hai. Form bharne par lead seedha **Inbox** ke "New leads" me aati hai.
8. **Roz ka kaam (customer ke liye).** Inbox kholo → nayi leads dekho → WhatsApp button se seedha baat karo.
   Khud baat karni ho to chat me **human takeover** on kar do, bot ruk jata hai.
9. **Jo sawaal bot nahi samajh paya**, woh Knowledge Base screen pe
   *"Customers asked — the bot had no answer"* list me aa jata hai. Ek line likh kar jawab do, gap band.

---

## 2. Aapka kaam — abhi (one-time)

Ye cheezein **abhi bhi baaki hain** aur inke bina product poori tarah kaam nahi karega:

| # | Kaam | Kyun zaroori hai |
|---|---|---|
| 1 | **Live deploy** (`railway login` → `railway up`) | `/ops` console, onboarding stepper aur AI assistant host par gaye hi nahi. Aaj live `/ops` customer dashboard dikhata hai. |
| 2 | **Meta App Review** | Iske bina aapke naye customers apna Instagram connect kar hi nahi sakte (point 5). |
| 3 | **`OWNER_EMAILS=manish98886@gmail.com`** host par | Warna owner gate sirf uid se chalega. |
| 4 | **`SUPPORT_EMAIL`, `SUPPORT_PHONE`, `BUSINESS_NAME`, `BUSINESS_ADDRESS`** | Contact page aur live smoke check inhi par depend karte hain. |
| 5 | **Razorpay verification** root URL (`https://www.thefgt.in/`) ke saath resubmit | Iske bina asli payment nahi ho sakta. |
| 6 | **OpenRouter / Gemini key rotate** | Jo secret chat me paste ho chuke hain, unhe badal do. |

Sabse pehle aur sabse aakhri kaam ye ek command hai — ye batati hai ki kya chalu hai aur kya nahi:

```bash
npm run readiness -- --url=https://www.thefgt.in
```

Ye bahar se (jaise ek naya customer dekh raha ho) check karti hai: deploy purana hai ya nahi, `/ops` bundle
sach me gayi hai ya nahi, DM ka jawab AI de raha hai ya canned "we received your message", OAuth callback
sahi domain par hai ya nahi, support email set hai ya nahi. Jo check bahar se ho hi nahi sakta woh `SKIP`
aata hai aur **pass nahi** gina jaata.  
Owner gate (`OWNER_EMAILS`) check karne ke liye apna token de sakte ho:

```bash
READINESS_ID_TOKEN=<owner ka firebase id token> npm run readiness -- --url=https://www.thefgt.in
```

Token kahan se: `/app` par sign in karke DevTools → Application → IndexedDB → `firebaseLocalStorage` →
us entry ka `stsTokenManager.accessToken`.

---

## 3. Aapka kaam — roz (10-15 minute)

Roz yahi 4 cheezein, isi order me:

1. **`/ops` kholo.** Sabse upar *"N need attention"* likha hota hai — koi account jiska bot band hai, trial
   khatam ho gaya, ya Instagram disconnect ho gaya. Wahi se pata chalta hai kisko call karna hai.
2. **Har customer ke Inbox me human takeover wale chat dekho.** Bot ne jo chhod diya, wahan se deal band hoti hai.
3. **Knowledge Base ke gaps dekho.** Agar 2 ya 3 customers ne same sawaal poocha hai, uska document likh do —
   ye ek hi baar ka kaam sab customers ke liye hai.
4. **Trial khatam hone wale accounts ko WhatsApp karo.** Trial sirf 3 din ka hai, isliye trial shuru hone ke
   doosre din hi message kar dena behtar hai.

Hafte me ek baar: naye leads kitni bani, kaun trial me aaya, kis account par error aa raha hai.

---

## 4. Naya customer laane ka script (copy-paste)

Signup ke baad ye message bhejo — isme wahi 4 cheezein hain jo customer ko karni hain:

> Namaste! InstaFlow AI me aapka account ban gaya hai.
> 3 cheezein karni hain, 10 minute lagenge:
> 1. `https://www.thefgt.in/app` kholkar sign in karein.
> 2. *Getting started* me **Connect Instagram** dabayein (Instagram Professional hona chahiye).
> 3. **Knowledge Base** me "5 starter documents" button dabayein, phir har `[bracket]` ki jagah apna
>    price/timing likh dein.
> Uske baad *Simulator* me khud ek DM bhejkar dekh lein — bot aapke hi likhe jawab dega. Koi dikkat aaye to
> seedha mujhe bhej dein.

Customer ko batane layak 3 line ka jawab, jab woh pooche "mera bot kis-cheez ka jawab dega": bot sirf
knowledge base ki lines se jawab deta hai, kuch banakar nahi bolta, aur jo line nahi hai woh sawaal aapki
list me aa jata hai.

---

## 5. ⚠️ Sabse badi rukavat: naya customer apna Instagram connect nahi kar payega

`META_SETUP.md` me ye pehle se likha hua hai (section *"One-click OAuth connect (optional)"*):

> the account must be a tester **or the app must pass App Review**. The current account was connected by
> pasting a long-lived `IGAA…` token, which bypasses both of those requirements.

Matlab: **aapka apna account** (@desi_tour001) token paste karke juda hua hai, isliye aapka bot chalta hai.

**27 Sep 2026 ko Meta ne app ko live mode me switch kar diya tha** — aaj Meta dashboard me ye likha hua hai
(`Alert Inbox`: *"My_business_bot switched to live mode"*). Isliye "app development mode me hai" wali baat **galat**
thi. Asli wajah permissions ki access-level hai: *Use cases → Instagram API → Permissions and features* me teen
teen permission — `instagram_business_basic` (59 calls), `instagram_business_manage_comments` (40) aur
`instagram_business_manage_messages` (40) — **"Ready for testing"**, yaani **Standard access**. Standard access
ka matlab: sirf woh accounts jinhe app me **role** (admin/developer/**tester**) mila hai, wahi authorize kar sakte hain.
Naya customer wahin atak jayega. Us page ka step 5 — *"Complete app review"* — ab tak **nahi** hua hai, aur wahi
Advanced access deta hai.

Do options hain:

- **Turant (aaj hi chalane ke liye):** har naye customer ki Instagram id ko Meta App Dashboard me tester ke
  roop me add karo, phir woh connect kar lega. Har customer ke liye manual kaam hai — kuch customers ke
  liye theek, 100 ke liye nahi.
- **Asli fix (ek baar ka kaam, phir sabke liye):** Meta App Review me `instagram_business_basic`,
  `instagram_business_manage_comments` aur `instagram_business_manage_messages` ke liye Advanced access
  maango — screen recording + privacy policy URL ke saath. Reviewers ka pehla kaam privacy policy aur
  **data deletion instructions URL** kholna hota hai, aur wahan abhi bhi purana host + ek placeholder URL
  (`https://www.facebook.com/`) padi hui hai — pehle woh theek karo, warna review wapas aa jayega.

Isliye jab tak App Review pass nahi hota, "customer khud signup karke chalu kar lega" — ye baat poori sach nahi hai.

---

## 6. Jab customer phans jaye — kaun kya karega

| Customer kya bolta hai | Asli wajah | Kaun theek karega |
|---|---|---|
| "Connect Instagram dabaya, error aa gaya" | Meta app Development mode me hai / account tester nahi hai | **Aap** (Meta dashboard me tester add karo) |
| "Invalid redirect_uri" | Redirect URL Meta app me save nahi hai | **Aap** (Meta > Instagram business login > Redirect URL) |
| "Bot galat ya adhoora jawab de raha hai" | Knowledge base khali hai ya line adhoori hai | **Customer** (starter documents + edit) |
| "DM ka jawab hi nahi aata" | Token expire / account disconnect / human takeover on hai | `/ops` dekho → customer ko *Verify Live Connection* bolne bolo |
| "Price galat bata raha hai" | Knowledge base me purana price likha hai | **Customer** (pencil icon se edit) — save khud ho jata hai |
| "Lead nahi mili" | Customer ne booking form nahi bhara (bot ne sirf link diya) | Customer ko **Inbox** me dekho, wahan "New leads" me hoti hai |
| "Plan khatam ho gaya, bot band hai" | Trial 3 din me khatam / plan expire | Customer *Plan & billing* se plan le |

Rule: **Instagram/Meta ki dikkat aapki hai, content ki dikkat customer ki.** Isi wajah se knowledge base me
har cheez customer ke haath me hai, aur Meta ka poora setup aapke haath me.

---

## 7. Paisa

- **Trial:** 3 din, card nahi. `TRIAL_DAYS=3`.
- **Plans:** Starter ₹999 / Growth ₹2,499 / Agency ₹4,999 — per month.
- **Payment:** Razorpay (UPI, card, netbanking, wallet). Paise katne se pehle customer plan aur amount dekhta hai.
- **Cancel:** `Plan & billing` se kabhi bhi. Cancel ke baad paid period poora chalta hai.
- **Trial khatam hone par:** bot band ho jata hai, dashboard customer ko batata hai ki kaunsa plan lena hai.

⚠️ Trial expire aur `past_due` ka poora raasta **ab tak ek baar bhi end-to-end test nahi hua hai** — live par
8 trialing subscriptions hain, isliye ye test hona chahiye taaki koi paid customer galti se block na ho jaye.

---

## 8. Aaj ki honest status

| Cheez | Status |
|---|---|
| Landing page, pricing, policy pages | ✅ live |
| Customer dashboard `/app` | ✅ live |
| Bot ka DM jawab (aapke account par) | ❌ **live par lagbhag toota hua hai** — 29 Sep ko 6 DM probes me 5 baar canned "we received your message" (`provider=fallback`) aaya (3 se 50 second ke beech), aur ek baar Gemini se asli jawab 14.6 second me. Wajah: live par purana build chal raha hai jiska OpenRouter model retire ho chuka hai, isliye har DM pehle OpenRouter par fail hota hai aur phir Gemini par girta hai — Gemini slow hai aur hamesha jawab nahi deta. Fix code me hai + boot par model check, par **deploy ke bina live par kuch nahi badlega**. |
| Owner console `/ops` | ⚠️ code taiyaar, **deploy nahi hua** |
| Onboarding stepper + AI help assistant | ⚠️ code taiyaar, **deploy nahi hua** |
| Knowledge base starter documents + inline edit | ⚠️ code taiyaar, **deploy nahi hua** |
| Naya customer khud Instagram connect kare | ❌ App **live** hai (27 Sep) par teen Instagram permissions abhi bhi **Standard access** ("Ready for testing") me hain, isliye sirf app testers connect kar sakte hain — App Review (Advanced access) baaki. **App Review ke saare Meta-side prerequisites 29 Sep ko pura ho gaye**: business verification ✅, platform = Website ✅, app ka naam `FlowAI` ✅, domains/privacy/terms URLs ✅, data-deletion callback ✅, submission me sirf 3 wahi permissions jo code sach me use karta hai ✅. Ab sirf reviewer instructions + test account + screencast bharne hain — dono ka text `META_SETUP.md` me paste-ready pada hai |
| Meta ka data-deletion raasta | ⚠️ Code taiyaar hai (callback sach me delete karta hai + `/data-deletion` aur `/data-deletion-status` pages) par **deploy nahi hua**, isliye live par abhi bhi jhoota 200 (SPA shell) milta hai |
| App Review test account | ✅ banaya (`manish98886+metareviewer@gmail.com`), starter knowledge base seed kiya, trial chalu — par trial sirf **3 din** ka hai, isliye host par `COMP_TENANT_IDS` me daalna zaroori hai warna review ke dauraan hi paywall aa jayega |
| Meta ka data-deletion raasta | ⚠️ Code taiyaar hai (callback sach me delete karta hai + `/data-deletion` aur `/data-deletion-status` pages) par **deploy nahi hua**, isliye live par abhi bhi jhoota 200 (SPA shell) milta hai |
| Asli payment (Razorpay) | ❌ verification baaki |
