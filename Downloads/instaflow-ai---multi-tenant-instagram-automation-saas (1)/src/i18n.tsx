import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Bilingual UI (English + Hindi).
 *
 * The product grew up in Hinglish, so two rules keep this simple and safe:
 *
 *  1. Every entry is `[hindi, english]`. The Hindi value is the copy that was
 *     already shipping — so switching to Hindi gives a customer today's exact
 *     app back, byte for byte, and no existing wording silently changes.
 *  2. Only strings that actually differ get a key. Labels that are the same in
 *     both languages ("Buy", "Copy", "Knowledge Base", "WhatsApp") stay inline
 *     in the JSX, because routing them through `t()` would add noise, not value.
 *
 * English is the default because the product is sold as English-first now; the
 * toggle is remembered per browser and mirrored into a cookie so the
 * server-rendered pages (landing, pricing, booking) and API error messages
 * answer in whatever language the visitor is reading.
 */
export type Lang = 'en' | 'hi';

export const DEFAULT_LANG: Lang = 'en';

const STORAGE_KEY = 'instaflow.lang';
/** Must match `LANG_COOKIE` in server/i18n.ts. */
const LANG_COOKIE = 'if_lang';

/** [hindi, english] */
const STRINGS: Record<string, [string, string]> = {
  // ── Stale-build banner ──────────────────────────────────────────────────
  'stale.text': [
    'Nayi version deploy ho gayi hai — is tab me abhi purana dashboard khula hua hai, isliye naye fixes yahan dikhenge nahi.',
    'A new version has been deployed — this tab is still running the old dashboard, so the new fixes will not show up here.',
  ],
  'stale.reload': ['Reload karo', 'Reload'],

  // ── Ops fix panels: retry queue · trial extend · shared-account routing ──
  'ops.retry.title': ['Retry queue — atke ya fail hue replies', 'Retry queue — stuck or failed replies'],
  'ops.retry.hint': [
    'Ye wo DMs hain jo customer tak nahi pahunche — reply bana tha, par bhejne me fail ya pending hai. "Retry now" use abhi bhejta hai; "Discard" hata deta hai (jab aapne customer ko khud jawab de diya ho).',
    'These DMs never reached the customer — the reply was drafted but the send failed or is still pending. "Retry now" sends one immediately; "Discard" drops it (when you have already answered the customer by hand).',
  ],
  'ops.retry.empty': ['Koi stuck send nahi — saare replies gaye.', 'No stuck sends — every reply went out.'],
  'ops.retry.all': ['Sab abhi retry karo', 'Retry all now'],
  'ops.retry.now': ['Ab retry karo', 'Retry now'],
  'ops.retry.discard': ['Hatao', 'Discard'],
  'ops.retry.done': [
    '{count} send(s) abhi bheje ja rahe hain',
    '{count} send(s) queued for immediate delivery',
  ],
  'ops.retry.doneNone': [
    'Kuch nahi hua — job shayad already delivered thi.',
    'Nothing changed — the job may have been delivered already.',
  ],
  'ops.trial.title': ['Trial / billing period extend karo', 'Extend a trial / billing period'],
  'ops.trial.hint': [
    'Billing row udaye bina current period ko N din aage badhata hai — plan, history aur status safe rehte hain. (Naya trial start karna customer ka apna "Start free trial" button hai.)',
    'Pushes the current period forward by N days without wiping the billing row — plan, history and status all survive. (Starting a new trial is the customer\'s own "Start free trial" button.)',
  ],
  'ops.trial.tenant': ['Tenant id ya username', 'Tenant id or username'],
  'ops.trial.days': ['Din (1–90)', 'Days (1–90)'],
  'ops.trial.go': ['Extend karo', 'Extend'],
  'ops.trial.busy': ['Ho raha hai…', 'Working…'],
  'ops.trial.done': ['Ho gaya: +{days} din — ab {date} tak active', 'Done: +{days} days — active until {date}'],
  'ops.shared.title': [
    'Shared Instagram account — routing decide karo',
    'Shared Instagram account — decide the routing',
  ],
  'ops.shared.hint': [
    'Ek Instagram account do tenants ne connect kiya hai. DMs sirf ek tak ja sakte hain — jo tenant yahan choose karoge, usi ko ab se is account ke messages milenge. Dusra tenant safe rehta hai, sirf us account ke DMs nahi milte.',
    'One Instagram account is connected by two tenants. Its DMs can only reach one of them — pick the tenant below and from now on this account\'s messages go there. The other tenant keeps all its data; it just stops receiving this account\'s DMs.',
  ],
  'ops.shared.route': ['Is tenant ko do', 'Route to this tenant'],
  'ops.shared.current': ['abhi yahan', 'current'],
  'ops.shared.routed': [
    'Ab is account ke DMs tenant {id} ko jayenge.',
    'This account\'s DMs now reach tenant {id}.',
  ],
  'ops.shared.none': [
    'Koi shared account nahi — sab accounts single-tenant hain.',
    'No shared accounts — every account belongs to one tenant.',
  ],

  // ── Account username (the customer's own readable name) ──────────────────
  // A tenant id is a Firebase uid: 28 opaque characters. This is the one place
  // the customer picks a name a human can read, and it is asked once.
  'username.title': ['Apna username chuno', 'Choose your username'],
  'username.hint': [
    'Ye aapki pehchaan hogi — team aur support aapka account isi naam se dhoondegi. Tenant id 28 characters ka hota hai, isliye har jagah yahi username dikhega.',
    'This is your identity here — the team finds your account by this name. A tenant id is 28 characters long, so every screen shows this username instead.',
  ],
  'username.rule': [
    '3-30 characters · letters, digits, dot ya underscore · letter/digit se shuru',
    '3-30 characters · letters, digits, dot or underscore · starts with a letter or digit',
  ],
  'username.placeholder': ['jaise: sharma.salon', 'e.g. sharma.salon'],
  'username.save': ['Set karo', 'Set it'],
  'username.saving': ['Set ho raha hai…', 'Setting…'],
  'username.lockedNote': [
    'Username ek hi baar set hota hai — badalna ho to team se kehna padega.',
    'A username is set once — changing it later needs the team.',
  ],
  'username.required': [
    'Ye screen skip nahi hoti: username ke bina aapka account kisi ko naam se yaad nahi rahega.',
    'This screen cannot be skipped: without a username nobody can refer to your account by name.',
  ],
  'username.err.TAKEN': ['Ye username kisi aur ne le liya — doosra try karo.', 'That username is taken — try another one.'],
  'username.err.INVALID': [
    'Format theek nahi: 3-30 characters, sirf letters/digits/dot/underscore, aur naam letter ya digit se shuru ho.',
    'Wrong format: 3-30 characters, only letters/digits/dot/underscore, starting with a letter or digit.',
  ],
  'username.err.RESERVED': ['Ye naam reserved hai — koi doosra chuno.', 'That name is reserved — pick another one.'],
  'username.err.LOCKED': [
    'Aapka username pehle se set hai — badalne ke liye team se kehna padta hai.',
    'Your username is already set — only the team can change it.',
  ],
  'username.err.GENERIC': ['Username set nahi hua — dobara try karo.', 'Could not set the username — please try again.'],

  // ── Knowledge-base starter pack ──────────────────────────────────────────
  // The empty screen was the biggest reason a new account never went live: the
  // bot had nothing to answer from. These four strings carry the whole fix, and
  // they have to say what the bot will do with the documents, not just offer a
  // button — otherwise "starter documents" sounds like demo content the
  // customer would be embarrassed to send to real customers.
  'kb.starterTitle': [
    '30 second me shuru karo — starter documents',
    'Start in 30 seconds — starter documents',
  ],
  'kb.starterHint': [
    'Ye wahi 5 cheezein hain jinhe har customer poochta hai: price, timing, location, kya included hai, aur booking/cancellation rule. Har line me [bracket] chhode hain — sirf apne number aur rule bhar do. Baad me kabhi bhi edit kar sakte ho, aur bot inhi lines se jawab dega.',
    'These are the five things every enquiry asks about: price, timings, location, what is included, and the booking/cancellation rule. Each line has [brackets] left for you — just fill in your own numbers and rules. You can edit any document later, and the bot answers from exactly these lines.',
  ],
  'kb.starterCta': ['{count} starter documents jodo', 'Add {count} starter documents'],
  // The count lives in the link ("2 left") and not in the confirmation, because
  // "1 starter documents jod diye" is the sentence a one-document customer would
  // otherwise read at the exact moment they are deciding whether we are careful.
  'kb.starterShort': ['Starter documents jodo — {count} baaki', 'Add starter documents — {count} left'],
  'kb.starterAdded': [
    'Starter documents jod diye — ab har [bracket] ki jagah apna number likho.',
    'Starter documents added — now replace each [bracket] with your own number.',
  ],
  'kb.starterAddedCount': [
    '{count} documents khali the, woh ab aa gaye — har [bracket] ki jagah apna number likho.',
    '{count} documents were missing and are now in the list — replace each [bracket] with your own number.',
  ],
  'kb.editAutoSave': ['Save karte hi apne aap AI ko chala jayega', 'Saves and reaches the AI on its own'],

  // ── Owner shortcut on the dashboard ─────────────────────────────────────
  // Rendered only for the owner account. The label is "Ops Console" in both
  // languages (like "Buy" or "Knowledge Base"), so only the tooltip gets a key.
  'ownerConsole.hint': [
    'Aap Team Fgt hain — poora console /ops pe khulta hai (uska apna login page hai).',
    'You are Team Fgt — the full console lives at /ops (its own sign-in page).',
  ],

  // ── Plan & billing ──────────────────────────────────────────────────────
  'billing.noPlan': [
    'Koi plan active nahi hai — ₹99 Launch Offer (first 100 customers, limited time) se chalu karo ya plan kharido.',
    'No plan active — start with the ₹99 Launch Offer (first 100 customers, limited time) or buy a plan.',
  ],
  'billing.botActive': ['Bot active hai', 'Bot is active'],
  'billing.paymentsNotConfigured': [
    'Payments abhi server pe configure nahi hain (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) — ₹99 Launch Offer turant kharid nahi paoge. WhatsApp par humse baat karo, hum manually chalu kar denge.',
    'Payments are not configured on the server yet (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) — the ₹99 Launch Offer cannot be bought right now. Message us on WhatsApp and we will activate it manually.',
  ],
  'billing.checkPayment': [
    'Paise kat gaye par plan nahi mila? Payment check karo',
    'Money deducted but no plan? Check the payment',
  ],
  'billing.intended1': ['Aapne', 'You picked'],
  'billing.intended2': ['plan chuna tha — neeche', 'plan — press'],
  'billing.intended3': ['dabayein. Ya koi doosra plan chuno, ya', 'below. Or choose another plan, or start with the'],
  'billing.intended4': ['₹99 Launch Offer se shuru karo.', '₹99 Launch Offer.'],
  'billing.yourPick': ['Aapki choice', 'Your pick'],
  'billing.trialStarted': ['3-din ka free trial chalu ho gaya.', 'Your 3-day free trial is now active.'],
  'billing.trialFailed': ['Trial start nahi ho paya.', 'The trial could not be started.'],
  'billing.trialFailedWith': ['Trial start nahi ho paya: {msg}', 'Could not start the trial: {msg}'],
  'billing.recheckOk': ['Payment mil gaya — {plan} plan active ho gaya.', 'Payment received — the {plan} plan is now active.'],
  'billing.recheckPending': ['Payment abhi confirm nahi hua.', 'The payment is not confirmed yet.'],
  'billing.recheckFailed': ['Payment check nahi ho paya: {msg}', 'Could not check the payment: {msg}'],
  'billing.checkoutFailed': ['Checkout start nahi ho paya.', 'Checkout could not be started.'],
  'billing.razorpayLoadFailed': [
    'Razorpay checkout load nahi hua — internet check karo.',
    'Razorpay checkout could not load — check your internet connection.',
  ],
  'billing.paymentDone': ['Payment done — {plan} plan active ho gaya.', 'Payment successful — the {plan} plan is now active.'],
  'billing.verifyFailed': ['Payment verify nahi ho paya.', 'The payment could not be verified.'],
  'billing.verifyFailedWith': ['Payment verify nahi ho paya: {msg}', 'Could not verify the payment: {msg}'],
  'billing.checkoutClosed': [
    'Payment complete nahi hua (checkout band ho gaya). Paise kat gaye hain to "Payment check karo" dabao — paisa hold hua ho to 3-7 working days me wapas aa jata hai.',
    'Payment was not completed (checkout was closed). If money was deducted, press "Check the payment" — a held amount comes back within 3-7 working days.',
  ],
  'billing.paymentFailedReason': ['Payment fail ho gaya — {reason}. ', 'Payment failed — {reason}. '],
  'billing.paymentFailed': ['Payment fail ho gaya. ', 'Payment failed. '],
  'billing.paymentFailedTail': [
    'Paise kat gaye hain to 3-7 working days me apne aap wapas aa jayenge.',
    'If money was deducted it returns automatically within 3-7 working days.',
  ],

  // ── Setup guide (Meta walkthrough) ──────────────────────────────────────
  'guide.step1Title': ['Instagram account Professional banao', 'Make the Instagram account Professional'],
  'guide.step1a': ['Account', 'The account must be'],
  'guide.step1or': ['ya', 'or'],
  'guide.step1link': ['hona chahiye aur ek', 'and linked to a'],
  'guide.step1tail': [
    'se linked (Instagram app → Settings → Account type). Personal account se DM automation kaam nahi karta.',
    '(Instagram app → Settings → Account type). DM automation does not work with a personal account.',
  ],
  'guide.step2Title': [
    'Meta dashboard kholo — Instagram API → API setup with Instagram login',
    'Open the Meta dashboard — Instagram API → API setup with Instagram login',
  ],
  'guide.step2a': [
    'Permissions, token, webhook aur login settings — sab isi ek page pe hain. Ye links aapke app',
    'Permissions, token, webhook and login settings are all on this one page. These links are already built for your app',
  ],
  'guide.step2b': ['ke liye pehle se bane hue hain.', '.'],
  'guide.openDashboard': ['Meta dashboard kholo', 'Open the Meta dashboard'],
  'guide.step3Title': ['Webhook connect karo (bot ko DM milne ke liye)', 'Connect the webhook (so the bot receives DMs)'],
  'guide.step3a': ['Usi page ke', 'On the same page, under'],
  'guide.step3b': [' me right column se', ', copy the'],
  'guide.step3c': [' aur', ' and'],
  'guide.step3d': [' copy karke paste karo →', ' from the right column and paste them →'],
  'guide.step3e': [' → phir ', ' → then subscribe to '],
  'guide.step3f': [' aur ', ' and '],
  'guide.step3g': [' subscribe karo.', '.'],
  'guide.openWebhook': ['Webhook page kholo', 'Open the webhook page'],
  'guide.step4Title': ['Redirect URL add karo (ek hi baar)', 'Add the redirect URL (one time only)'],
  'guide.step4a': ['me right column ka', ", paste the right column's"],
  'guide.step4b': [
    ' paste karke Save karo. Ye har naye customer ke liye dobara nahi karna padta — app ek hi hai, URL ek hi.',
    ' and save. This is not repeated for every new customer — one app, one URL.',
  ],
  'guide.openRedirect': ['Redirect URL page kholo', 'Open the redirect URL page'],
  'guide.step5Title': ['Bas — "Connect Instagram with Meta" dabao', 'That is it — press "Connect Instagram with Meta"'],
  'guide.step5a': ['Apne Instagram account se login karo aur', 'Log in with your Instagram account and tap'],
  'guide.step5b': [
    ' karo. Account khud detect ho jayega aur bot usi waqt se DM ka jawab dena shuru kar dega.',
    '. The account is detected automatically and the bot starts answering DMs from that moment.',
  ],
  'guide.step5c': ['Token ki zaroorat nahi', 'No token needed'],
  'guide.step5d': [
    '— neeche wala direct-token form sirf developer/testing ke liye hai.',
    '— the direct-token form below is for developers/testing only.',
  ],
  'guide.oauthWaitingA': ['Instagram page pe', 'The account is linked the moment you tap'],
  'guide.oauthWaitingB': [
    'dabane ke baad account jud jayega — ye tab har 4 second me khud check kar raha hai. Kuch dikhne me time lage to is tab pe wapas aao, update ho jayega.',
    'on the Instagram page — this tab checks every 4 seconds. If it takes a moment, come back to this tab and it will have updated.',
  ],

  // ── Direct token form (developers) ──────────────────────────────────────
  'manual.tokenWhere': ['Token kahan se milega?', 'Where do I get a token?'],
  'manual.tokenWhere1': ['Us account ko app me pehle', 'That account must first be added to the app as a'],
  'manual.tokenWhere2': ['banana padega, warna token kaam nahi karega.', '— otherwise the token will not work.'],
  'manual.generateToken': ['Token generate karo', 'Generate a token'],
  'manual.addTester': ['Tester add karo', 'Add a tester'],
  'manual.checkToken': ['Token check karo', 'Check the token'],

  // ── OAuth whitelist card ────────────────────────────────────────────────
  'oauth.openPage': ['Is page ko kholo', 'Open this page'],
  'oauth.sameUrlError': ['Same URL, phir bhi error', 'Same URL, still an error'],
  'oauth.clientIdNote1': ['Meta check karta hai ki redirect URL', 'Meta checks that the redirect URL is saved inside'],
  'oauth.clientIdNote2': ['me saved ho. URL sahi hone ke baad bhi', '. If you still get'],
  'oauth.clientIdNote3': [
    'aa raha ho, to aap kisi doosre app ka step 4 edit kar rahe ho — ye ID app ke naam ke neeche dikhti hai.',
    'even though the URL is correct, you are editing step 4 of a different app — this ID is shown under the app name.',
  ],

  // ── Knowledge base ──────────────────────────────────────────────────────
  'kb.bookingPage1': [
    'Ye public page tumhare hi knowledge documents se banta hai (packages, prices, policies). Customer apna naam, WhatsApp, dates aur pax bharta hai — lead seedha',
    'This public page is built from your own knowledge documents (packages, prices, policies). The customer fills in name, WhatsApp, dates and pax — the lead goes straight to',
  ],
  'kb.bookingPage2': [
    'me "New leads" me aati hai. Bot isi link ko bhejta hai jab customer ready ho, aur pehle message me nahi.',
    'under "New leads". The bot sends this link only once the customer is ready, not in the first message.',
  ],
  'kb.bookingHint': [
    'Instagram bio me bhi daal sakte ho. Jab tak knowledge documents khaali hain, page pe sirf form dikhta hai — packages add karte hi wahi cards page pe aa jayenge.',
    'You can put this in your Instagram bio too. While the knowledge documents are empty the page shows only the form — the moment you add packages, those cards appear on it.',
  ],

  // ── OAuth handoff messages ──────────────────────────────────────────────
  'oauth.pendingConnected': [
    'Connected to @{user} — ab is account ki DM ka jawab bot dega.',
    'Connected to @{user} — the bot will now answer DMs for this account.',
  ],
  'oauth.timeout': [
    'Instagram authorization complete nahi hua. Connect dobara dabao aur Instagram ke permission screen pe "Allow" zaroor karo.',
    'Instagram authorization was not completed. Press Connect again and make sure you tap "Allow" on Instagram\'s permission screen.',
  ],
  // The Meta window closed without connecting anything. Meta never redirects
  // back on a refusal — it renders its own error page in the popup — so the
  // dashboard is the only place the reason can be spelled out.
  'oauth.closedNoConnect': [
    'Meta window band ho gaya, par koi account connect nahi hua.',
    'The Meta window closed, but no account was connected.',
  ],
  'oauth.fbFlavour': [
    'Is server par IG_APP_ID / IG_APP_SECRET set nahi hain, isliye Facebook Login dialog khula. Instagram-Login wale Meta app me us dialog ka jawab hamesha "URL blocked" hota hai — neeche token wale form se connect karo, ya server par ye do values set karo.',
    'IG_APP_ID / IG_APP_SECRET are not set on this server, so the Facebook Login dialog opened. A Meta app provisioned for Instagram Login always answers "URL blocked" there — connect with the token form below, or set those two values on the server.',
  ],
  'oauth.localhostRedirect': [
    'Redirect URL localhost ka hai, aur Meta localhost ko accept nahi karta. Deployed app se connect karo, ya neeche token wala form use karo.',
    'The redirect URL points at localhost, which Meta never accepts. Connect from the deployed app, or use the token form below.',
  ],
  'oauth.otherHostRedirect': [
    'Meta is URL par wapas bhejta hai: {uri} — ye doosra host hai, isliye wahan wapas aane ke baad connect complete hota hai. Ye URL Meta me whitelisted hona chahiye.',
    'Meta sends the visitor back to {uri} — a different host, so the connection only completes there. That URL has to be whitelisted in Meta.',
  ],
  'oauth.whitelistReminder': [
    'Meta is exact URL par wapas bhejta hai: {uri} — ye Meta app me whitelisted hona chahiye, warna Meta "Invalid redirect_uri" ya "URL blocked" dikhata hai.',
    'Meta sends the visitor back to exactly {uri}. That URL has to be whitelisted in the Meta app, or Meta answers "Invalid redirect_uri" / "URL blocked".',
  ],

  'oauth.popupOpened': [
    'Instagram ka page khul gaya (nayi tab me). Wahan us Instagram account se login karke "Allow" dabao — yahi se uska account bot se judta hai, aur ye tab khud update ho jayega.',
    'The Instagram page opened in a new tab. Log in with that Instagram account and tap "Allow" — that is what links the account to the bot, and this tab updates by itself.',
  ],

  // Meta's access-level gate: role-less accounts cannot finish the connect, and
  // no amount of retrying fixes it. The dashboard is the only place the client
  // learns what actually unblocks them, so the two working paths get spelled out
  // instead of an error string they cannot act on.
  'oauth.gateTitle': [
    'Instagram ne is account ka connect roka hai — iska fix 2 minute ka hai',
    'Instagram blocked this account from connecting — the fix takes 2 minutes',
  ],
  'oauth.gateWhy': [
    'Ye tumhari galti ya app ki kharabi nahi hai: Meta naye accounts ko tab tak connect nahi hone deta jab tak wo hamari app ke "Tester" na ban jayein.',
    'This is not a fault in your account or the app: Meta does not let brand-new accounts connect until they are added as a "Tester" for our app.',
  ],
  'oauth.gateStep1': [
    'Team Fgt se bolo ki tumhara Instagram username app me "Instagram Tester" ke roop me add kare — 1 minute ka kaam.',
    'Ask Team Fgt to add your Instagram username as an "Instagram Tester" — a 1-minute job on their side.',
  ],
  'oauth.gateStep2': [
    'Uske baad apne Instagram app me: Settings → Website permissions → Apps and Websites → Tester Invites → hamari invite “Accept” karo.',
    'Then on your Instagram app: Settings → Website permissions → Apps and Websites → Tester Invites → Accept our invite.',
  ],
  'oauth.gateStep3': [
    'Invite accept hone ke baad wapas yahan aao aur dobara “Connect” dabao — ab Instagram ka permission screen khulega aur "Allow" ke baad connect ho jayega.',
    'Once the invite is accepted, come back here and press “Connect” again — the Instagram permission screen will open and "Allow" completes the connection.',
  ],
  'oauth.gateNote': [
    'Dhyan rakho: invite Accept karne se pehle Connect dabane se wahi error lauti hai. Pehle Accept, phir Connect.',
    'Important: pressing Connect before accepting the invite just returns the same error. Accept first, then Connect.',
  ],

  // The one thing the owner needs and the failed OAuth cannot supply: the handle.
  // Meta rejects the call before account discovery, so no username ever reaches
  // the server — the customer has to type it once, here.
  'tester.formTitle': [
    'Apna Instagram username humein bhej do',
    'Send us your Instagram username',
  ],
  'tester.formHint': [
    'Team Fgt isi handle ko Meta me “Instagram Tester” banayega. Humne box me tumhara handle pehle se bhar diya hai — galat ho to badal do.',
    'Team Fgt adds exactly this handle as an “Instagram Tester” on Meta. We filled the box in for you — change it if it is not your account.',
  ],
  'tester.prefillNote': [
    'Ye humne tumhare account se bhar diya hai — sirf check karke bhej do.',
    'Filled in from your account — just check it and send.',
  ],
  'tester.placeholder': ['@yourbrand', '@yourbrand'],
  'tester.submit': ['Username bhej do', 'Send username'],
  'tester.sending': ['Bhej rahe hain…', 'Sending…'],
  'tester.sentTitle': ['Mil gaya — @{username}', 'Got it — @{username}'],
  'tester.sentBody': [
    'Team Fgt ise Instagram Tester ke roop me add karega. Invite tumhare Instagram app me aayegi (Settings → Website permissions → Apps and Websites → Tester Invites) — Accept karne ke baad wapas aakar “Connect” dabana.',
    'Team Fgt will add this as an Instagram Tester. The invite arrives in your Instagram app (Settings → Website permissions → Apps and Websites → Tester Invites) — accept it, come back, then press “Connect”.',
  ],
  // Shown once the owner has actually marked the invite sent on the Ops Console,
  // so the customer stops waiting and knows the ball is in their court.
  'tester.statusPending': ['Team Fgt ke paas pahunch gaya — invite bhejna baaki hai.', 'With Team Fgt — the invite has not been sent yet.'],
  'tester.statusInvited': ['Team Fgt ne invite bhej diya hai — Instagram app me Accept karo.', 'Team Fgt has sent the invite — accept it in your Instagram app.'],
  'tester.statusDone': ['Add ho gaya — ab “Connect” dabao.', 'Added — press “Connect” now.'],
  'tester.changeHandle': ['Galti se dusra handle likh diya? Badal do', 'Typed the wrong handle? Change it'],
  'tester.error': ['Username bhej nahi paye: {msg}', 'Could not send the username: {msg}'],
  'tester.receivedTitle': ['Pahunch gaya — @{username}', 'Received — @{username}'],
  'tester.receivedBody': [
    'Aapki request humare paas pahunch gayi hai. InstaFlow AI team jaldi hi aapko invitation link bhejiwali hai. Wapas aakar yeh dashboard check karein.',
    'Your request has been received. The InstaFlow team will send your invitation shortly. Please check back here.',
  ],
  'tester.requestedAt': ['{time} pe maanga', 'Requested {time}'],
  'tester.identityNeededTitle': ['Identity confirm karni hai — @{username}', 'Identity confirmation needed — @{username}'],
  'tester.identityNeededBody': [
    'Team ne aapka Meta/Instagram identity confirm karna hai. Kripya apna sahi Meta ya Facebook email / username confirm karein taaki sahi invitation bheja ja sake.',
    'The team needs to confirm your Meta/Instagram identity. Please confirm your correct Meta/Facebook email or username so the right invitation can be sent.',
  ],
  'tester.readyTitle': ['Taiyaar hai — @{username}', 'Ready — @{username}'],
  'tester.readyBody': [
    'Team aapki invitation taiyaar kar rahi hai. Jaldi hi invitation link milega.',
    'The team is preparing your invitation. The invitation link will arrive shortly.',
  ],
  'tester.invitationSentTitle': ['Invitation taiyaar hai — @{username}', 'Your invitation is ready — @{username}'],
  'tester.invitationSentBody': [
    'Aapki InstaFlow AI invitation taiyaar hai. Neeche “Accept Invitation” dabakar Meta ki official page par jayein.',
    'Your InstaFlow AI invitation is ready! Click “Accept Invitation” below to go to Meta’s official page.',
  ],
  'tester.invitationUrlLabel': ['Invitation link', 'Invitation link'],
  'tester.acceptInvitation': ['Invitation Accept Karein', 'Accept Invitation'],
  'tester.metaLoginNote': [
    'Meta page par sahi Meta/Facebook account se login karke invitation accept karein.',
    'Log in with the correct Meta/Facebook account on Meta’s page and accept the invitation.',
  ],
  'tester.acceptancePendingTitle': ['Acceptance wait ho rahi hai', 'Waiting for acceptance confirmation'],
  'tester.acceptancePendingBody': [
    'Aapne invitation accept kar liya hai ya nahi, hum abhi confirm nahi kar paaye hain. Kripya invitation accept karein aur status refresh karein.',
    'We cannot yet confirm you accepted the invitation. Please complete the invitation acceptance and refresh the status.',
  ],
  'tester.acceptedTitle': ['Accepted — access confirm ho gaya', 'Invitation accepted — access confirmed'],
  'tester.acceptedBody': [
    'Aapki Instagram tester invitation accept ho gayi hai. Ab “Connect” dabakar apna Instagram account reconnect karein.',
    'Invitation accepted — access confirmed. Now press “Connect” to reconnect your Instagram account.',
  ],
  'tester.invitationFailedTitle': ['Invitation mein koi samasya aayi', 'Invitation issue'],
  'tester.invitationFailedBody': [
    'Invitation accept nahi ho payi ya expire ho gayi. Dobara request bhejne ke liye handle update karein.',
    'The invitation was not accepted or has expired. Update your handle to re-request.',
  ],
  'tester.retry': ['Dobara bhejo', 'Retry'],
  'tester.invitationAppContext': [
    'Yeh invitation isi Meta app par accept karni hai: {appId}',
    'This invitation must be accepted on this Meta app: {appId}',
  ],
  // Request received — the popup the customer sees right after onboarding, and
  // the same words on the persistent card so the message cannot be lost by
  // closing it.
  'tester.popupTitle': ['Request mil gayi!', 'Your request has been received!'],
  'tester.popupBody': [
    'InstaFlow AI team aapka account review karke jald hi invitation link bhejegi. Invitation milne ke baad apne portal me wapas aayein.',
    'The InstaFlow AI team will review your account and send you an invitation link shortly. Please return to your portal after receiving the invitation.',
  ],
  'tester.popupClose': ['Samajh gaya', 'Got it'],
  'tester.cardTitle': ['Tester invitation status', 'Tester invitation status'],
  'tester.iAccepted': ['Maine invitation accept kar li', 'I accepted the invitation'],
  'tester.confirming': ['Bhej rahe hain…', 'Sending…'],
  'tester.confirmedTitle': ['Confirmation mil gayi', 'Confirmation received'],
  'tester.confirmedBody': [
    'Team ab aapka account check karke status update karegi. Aap “Connect” dobara try kar sakte hain.',
    'The team will check your account and update the status. You can try “Connect” again.',
  ],
  'tester.acceptedUnverifiedTitle': ['Acceptance record hui (team-confirmed)', 'Acceptance recorded (team-confirmed)'],
  'tester.acceptedUnverifiedBody': [
    'Team ne acceptance record kar li hai. Meta ki taraf se automatic verification abhi available nahi hai, isliye yeh “unverified” hai — Connect dabakar confirm karein.',
    'The team recorded your acceptance. Meta provides no automatic verification yet, so this is unverified — press Connect to confirm.',
  ],
  'tester.accountNotAddedYet': [
    'Team abhi aapka handle Meta dashboard me add kar rahi hai. Uske baad invitation link yahan dikhega.',
    'The team is adding your handle in the Meta dashboard. Your invitation link will appear here after that.',
  ],

  // ── Customer activation lifecycle (owner + customer) ─────────────────────
  // Mirrors server/activationStore.ts ActivationStatus. These are what the
  // customer sees on their portal and what the Ops Console shows per tenant.
  'activation.status.CONNECTED_PENDING_ACTIVATION': [
    'Activation pending — team review karegi.',
    'Activation pending — team will review.',
  ],
  'activation.status.INVITATION_SENT': [
    'Invitation bhej di gayi — aapka intezaar hai.',
    'Invitation sent — waiting for you.',
  ],
  'activation.status.AWAITING_CUSTOMER_ACCEPTANCE': [
    'Aapki acceptance ka intezaar — invitation accept karein.',
    'Awaiting your acceptance — please accept the invitation.',
  ],
  'activation.status.AWAITING_TEST_DM': [
    'Test DM ka intezaar — doosre account se message bhejein.',
    'Awaiting your test DM — message from a second account.',
  ],
  'activation.status.FULLY_ACTIVE': [
    'Fully active — AI replies shuru ho gaye hain.',
    'Fully active — AI replies are live.',
  ],
  'activation.status.ACTION_REQUIRED': [
    'Aapse action chahiye — koi step baaki hai.',
    'Action required from you — a step is pending.',
  ],
  'activation.status.MESSAGE_SEND_FAILED': [
    'Message bhejna fail hua — team se sampark karein.',
    'Message send failed — contact the team.',
  ],

  'activation.cardTitle': ['Activation status', 'Activation status'],
  'activation.instagramAccount': ['Instagram account: @{username}', 'Instagram account: @{username}'],
  'activation.connectedAt': ['Connected: {time}', 'Connected: {time}'],
  'activation.lastAction': ['Last action: {action} by {by}', 'Last action: {action} by {by}'],
  'activation.notVerifiedNote': [
    'Acceptance Meta se automatic verify nahi hui hai — yeh team-recorded hai.',
    'Acceptance was not automatically verified by Meta — this is team-recorded.',
  ],

  // ── OPS activation panel (owner only) ────────────────────────────────────
  'ops.activation.title': ['New customer activation queue', 'New customer activation queue'],
  'ops.activation.hint': [
    'Naye connected Instagram accounts jinhe activation ki zaroorat hai.',
    'Newly connected Instagram accounts that need activation.',
  ],
  'ops.activation.col.handle': ['Handle', 'Handle'],
  'ops.activation.col.tenant': ['Tenant ID', 'Tenant ID'],
  'ops.activation.col.status': ['Status', 'Status'],
  'ops.activation.col.connected': ['Connected', 'Connected'],
  'ops.activation.col.actions': ['Actions', 'Actions'],
  'ops.activation.empty': ['Koi pending activation nahi.', 'No pending activations.'],
  'ops.activation.markInvitationSent': ['Mark Invitation Sent', 'Mark Invitation Sent'],
  'ops.activation.sendInstructions': ['Send Activation Instructions', 'Send Activation Instructions'],
  'ops.activation.confirmTestDm': ['Confirm Test DM', 'Confirm Test DM'],
  'ops.activation.requireAction': ['Require Action', 'Require Action'],
  'ops.activation.accountNotAdded': [
    'Pehle Meta dashboard me tester add karein.',
    'Add the tester in the Meta dashboard first.',
  ],
  'ops.activation.noConsent': [
    'Customer ne WhatsApp consent nahi diya — manual delivery.',
    'Customer has not consented to WhatsApp — manual delivery.',
  ],
  'ops.activation.instructionsSent': ['Instructions bhej di gayi.', 'Instructions sent.'],
  'ops.activation.instructionsFailed': [
    'Instructions bhejne mein samasya: {reason}.',
    'Failed to send instructions: {reason}.',
  ],
  'ops.activation.testDmConfirmed': ['Test DM confirm ho gaya — Fully Active.', 'Test DM confirmed — Fully Active.'],
  'ops.activation.actionRequiredNote': ['Reason: {reason}', 'Reason: {reason}'],
  'ops.activation.confirmDialog': [
    'Kya aap yeh action karna chahte hain?',
    'Are you sure you want to perform this action?',
  ],

  // ── OPS onboarding board (owner only, Feature 3/4) ───────────────────────
  'ops.onboarding.title': ['Onboarding board', 'Onboarding board'],
  'ops.onboarding.addedOn': ['Added: {date}', 'Added: {date}'],
  'ops.onboarding.date.all': ['Sab dates', 'All dates'],
  'ops.onboarding.date.today': ['Aaj', 'Today'],
  'ops.onboarding.date.yesterday': ['Kal', 'Yesterday'],
  'ops.onboarding.date.last7': ['Last 7 din', 'Last 7 days'],
  'ops.onboarding.date.last30': ['Last 30 din', 'Last 30 days'],
  'ops.onboarding.date.custom': ['Custom range', 'Custom range'],
  'ops.onboarding.date.showing': ['{count}/{total} customers', '{count}/{total} customers'],
  'ops.onboarding.date.noMatch': ['Is date range me koi customer nahi aya.', 'No customer was added in this date range.'],
  'ops.onboarding.metrics.total': ['Total customers', 'Total customers'],
  'ops.onboarding.metrics.today': ['Registered today', 'Registered today'],
  'ops.onboarding.metrics.freePlans': ['Free plans active', 'Free plans active'],
  'ops.onboarding.metrics.connected': ['Instagram connected', 'Instagram connected'],
  'ops.onboarding.metrics.awaitingReview': ['Awaiting review', 'Awaiting review'],
  'ops.onboarding.metrics.approved': ['Approved', 'Approved'],
  'ops.onboarding.metrics.needsAction': ['Needs customer action', 'Needs customer action'],
  'ops.onboarding.metrics.stalled': ['Stalled / failed', 'Stalled / failed'],
  'ops.onboarding.whatsappProvider': ['WhatsApp: {state}', 'WhatsApp: {state}'],
  'ops.onboarding.providerOn': ['Customer provider configured', 'Customer provider configured'],
  'ops.onboarding.providerOff': ['customer provider not configured — messages stay in the outbox with a manual copy', 'customer provider not configured — messages stay in the outbox with a manual copy'],
  'ops.onboarding.empty': ['Abhi koi onboarding record nahi.', 'No onboarding records yet.'],
  'ops.onboarding.noConsent': ['No consent', 'No consent'],
  'ops.onboarding.optedOut': ['Opted out', 'Opted out'],
  'ops.onboarding.registered': ['Registered: {at}', 'Registered: {at}'],
  'ops.onboarding.statusChanged': ['Status changed: {at}', 'Status changed: {at}'],
  'ops.onboarding.approved': ['Approved: {at}', 'Approved: {at}'],
  'ops.onboarding.action.requestInfo': ['Request info', 'Request info'],
  'ops.onboarding.action.review': ['Mark review pending', 'Mark review pending'],
  'ops.onboarding.action.regenerate': ['Regenerate KB draft', 'Regenerate KB draft'],
  'ops.onboarding.action.approveKb': ['Approve KB', 'Approve KB'],
  'ops.onboarding.action.approveCustomer': ['Approve customer', 'Approve customer'],
  'ops.onboarding.action.reconnect': ['Need reconnect', 'Need reconnect'],

  // ── Onboarding panel (Feature 1) ────────────────────────────────────────
  'onboarding.statusLabel': ['Onboarding', 'Onboarding'],
  'onboarding.status.REGISTERED': ['Registered', 'Registered'],
  'onboarding.status.FREE_PLAN_ACTIVE': ['Free plan active', 'Free plan active'],
  'onboarding.status.INSTAGRAM_CONNECTION_PENDING': ['Instagram connection judd rahi hai', 'Instagram connecting'],
  'onboarding.status.INSTAGRAM_CONNECTED': ['Instagram jud gaya', 'Instagram connected'],
  'onboarding.status.CONNECTION_FAILED': ['Connection fail — dobara try karo', 'Connection failed — retry'],
  'onboarding.status.BUSINESS_REVIEW_PENDING': ['Team business review kar rahi hai', 'Team is reviewing your business'],
  'onboarding.status.KNOWLEDGE_BASE_DRAFT': ['Knowledge Base draft bana', 'Knowledge Base draft created'],
  'onboarding.status.AWAITING_APPROVAL': ['Approval ka intezaar', 'Awaiting approval'],
  'onboarding.status.APPROVED': ['Approved', 'Approved'],
  'onboarding.status.NEEDS_CUSTOMER_ACTION': ['Aapse details chahiye', 'Needs your input'],
  'onboarding.status.REVIEW_REJECTED': ['Changes maange gaye', 'Changes requested'],
  'onboarding.status.SUSPENDED': ['Rok diya gaya', 'Suspended'],
  'onboarding.approvedLine': ['Aapki setup approve ho chuki hai.', 'Your setup has been approved.'],
  'onboarding.connected.success': [
    'Aapka Instagram account successfully connect ho gaya hai. InstaFlow team ab aapka business page review karke aapki Knowledge Base taiyaar karegi. Review complete hone par ya kisi extra setup ki zaroorat par hum aapko update karenge.',
    'Your Instagram account has been connected successfully. The InstaFlow team will now review your business page and prepare your Knowledge Base. We will notify you when the review is complete or if any additional setup is required.',
  ],
  'onboarding.connected.pendingReview': [
    'Aap abhi dashboard use karte hue unanswered sawalon ki list dekh sakte hain — team KB ready hone par batayegi.',
    'You can already watch the unanswered-questions list while the team gets your Knowledge Base ready.',
  ],
  'onboarding.freePlan.line1': [
    'Free Plan pehle activate karo — koi card nahi: 1 Instagram account, 200 AI replies/month, 20 knowledge documents. Card billi ke lie team baad me batayegi.',
    'Activate the Free Plan first — no card needed: 1 Instagram account, 200 AI replies/month, 20 knowledge documents. The team will discuss paid options later, if you want them.',
  ],
  'onboarding.freePlan.activate': ['Free Plan activate karo', 'Activate Free Plan'],
  'onboarding.freePlan.done': ['Free Plan chalega ✓', 'Free plan active ✓'],
  'onboarding.freePlan.error': ['Free Plan chali nahi — thodi der baad “Retry” dabao ya team se link karo.', 'Free plan activation failed — try again shortly or contact the team.'],
  'onboarding.form.instagram.section': ['Instagram Account', 'Instagram Account'],
  'onboarding.form.instagram.connected': ['Juda hua hai', 'Connected'],
  'onboarding.form.instagram.realAccount': ['Meta se asli account', 'Real account from Meta'],
  'onboarding.form.instagram.adminMatch': ['Admin tester matching ke liye', 'Admin uses this for tester matching'],
  'onboarding.form.instagram.notConnected': ['Instagram abhi juda nahi hai — Connection Center tab par apna Instagram Professional account jodein, phir contact details save karein.', 'Instagram is not connected yet. Connect your Instagram Professional account on the Connection Center tab, then save your contact details.'],
  'onboarding.form.instagram.connectBtn': ['Instagram jodein', 'Connect Instagram'],
  'onboarding.form.contactPerson': ['Contact person ka naam', 'Contact person name'],
  'onboarding.form.contactPersonRequired': [
    'Contact person ka naam zaroori hai.',
    'Contact person name is required.',
  ],
  'onboarding.form.whatsapp': ['WhatsApp number — zaroori hai (country code ke saath)', 'WhatsApp number — required (with country code)'],
  'onboarding.form.whatsappRequired': [
    'WhatsApp / mobile number dena zaroori hai — usi par aapko updates aur videos bhejte hain.',
    'A WhatsApp / mobile number is required — that is where we send you updates and videos.',
  ],
  'onboarding.form.savedNumber': ['Pehle se saved: {num}', 'Saved earlier: {num}'],
  'onboarding.form.language': ['Communication language', 'Communication language'],
  'onboarding.form.email': ['Email (optional)', 'Email (optional)'],
  'onboarding.form.consent': [
    'Onboarding aur account-status messages WhatsApp par bhejne ki consent (ye opt-out par har waqt band ho sakti hai).',
    'Consent to receive onboarding and account-status messages on WhatsApp (stop anytime via opt-out).',
  ],
  'onboarding.form.errorItem': ['{msg}', '{msg}'],
  'onboarding.form.save': ['Details save karo', 'Save details'],
  'onboarding.form.saving': ['Save ho raha hai…', 'Saving…'],
  'onboarding.form.saved': ['Save ho gaya ✓', 'Saved ✓'],
  'onboarding.form.optedOut': ['WhatsApp messages band kar diye gaye (opt-out).', 'WhatsApp messages are stopped (opted out).'],
  'onboarding.form.optOut': ['Opt-out', 'Opt out'],

  // ── Ops Console (owner only) ────────────────────────────────────────────
  'ops.nav': ['Ops Console', 'Ops Console'],
  'ops.title': ['Team Fgt Ops Console', 'Team Fgt Ops Console'],
  'ops.subtitle': [
    'Sirf Team Fgt account ke liye — saare customers ek jagah. Kuch bhi apne aap nahi hota: har badlav ek button dabane se hota hai, aur wo server log me OWNER_ACTION ke naam se likha jaata hai.',
    'Team Fgt account only — every customer in one place. Nothing happens on its own: every change needs a button, and each one is logged as OWNER_ACTION on the server.',
  ],
  'ops.forbidden': [
    'Ye view sirf Team Fgt account ko dikhta hai (server ne 403 diya). Apne account se login karo.',
    'This view is limited to the Team Fgt account (the server answered 403). Sign in with that account.',
  ],
  'ops.loading': ['Load ho raha hai…', 'Loading…'],
  'ops.refresh': ['Refresh', 'Refresh'],
  'ops.updatedAt': ['{time} pe update hua', 'Updated {time}'],
  'ops.failed': ['Data load nahi hua: {msg}', 'Could not load the data: {msg}'],
  'ops.paymentsOff': [
    'Payments abhi off hain, isliye har account ka bot chalu hai (koi plan zaroori nahi) aur trial {days} din ka hai.',
    'Payments are off, so every account keeps its bot running (no plan required) and the trial is {days} days.',
  ],
  'ops.search': ['Tenant ID ya @username se dhundo', 'Search by tenant id or @username'],
  'ops.empty': ['Abhi ek bhi account nahi hai.', 'No accounts yet.'],
  'ops.noMatch': ['Is search se koi account match nahi hua.', 'No account matched this search.'],

  // ── Ops Console: customer list sort/filter (date-wise browsing) ─────────
  'ops.sort.label': ['Sort karo', 'Sort'],
  'ops.sort.newest': ['Naya pehle (registered)', 'Newest first (registered)'],
  'ops.sort.oldest': ['Purana pehle (registered)', 'Oldest first (registered)'],
  'ops.sort.activityNewest': ['Last activity: naya pehle', 'Last activity: newest first'],
  'ops.sort.activityOldest': ['Last activity: purana pehle', 'Last activity: oldest first'],
  'ops.filter.label': ['Date filter', 'Date filter'],
  'ops.filter.all': ['Sab', 'All'],
  'ops.filter.today': ['Aaj', 'Today'],
  'ops.filter.yesterday': ['Kal', 'Yesterday'],
  'ops.filter.7d': ['Pichhle 7 din', 'Last 7 days'],
  'ops.filter.30d': ['Pichhle 30 din', 'Last 30 days'],
  'ops.filter.custom': ['Custom range', 'Custom range'],
  'ops.filter.customFrom': ['Se (date)', 'From (date)'],
  'ops.filter.customTo': ['Tak (date)', 'To (date)'],
  'ops.filter.field.created': ['Filter: registration date', 'Filtering by: registration date'],
  'ops.filter.field.activity': ['Filter: last activity', 'Filtering by: last activity'],
  'ops.col.registered': ['Registered', 'Registered'],
  'ops.date.unknown': ['Date nahi mili', 'Unknown date'],
  'ops.pager.prev': ['Pichhla', 'Prev'],
  'ops.pager.next': ['Agla', 'Next'],
  'ops.pager.showing': ['{start}–{end} / {total}', '{start}–{end} / {total}'],
  'ops.pager.page': ['Page {page}/{pages}', 'Page {page}/{pages}'],

  // ── Ops Console: System Health (customer health + incidents) ───────────
  'ops.health.title': ['System Health', 'System Health'],
  'ops.health.subtitle': [
    'Har customer ka real-time status — sirf recorded events se, koi fake value nahi.',
    'Every customer’s real status — built only from recorded events, never invented.',
  ],
  'ops.health.colCustomer': ['Customer', 'Customer'],
  'ops.health.colOverall': ['Status', 'Status'],
  'ops.health.colLastInbound': ['Last inbound DM', 'Last inbound DM'],
  'ops.health.colLastSendOk': ['Last successful reply', 'Last successful reply'],
  'ops.health.colLastFail': ['Last confirmed failure', 'Last confirmed failure'],
  'ops.health.colErrCategory': ['Error category', 'Error category'],
  'ops.health.status.healthy': ['Healthy', 'Healthy'],
  'ops.health.status.warning': ['Warning', 'Warning'],
  'ops.health.status.critical': ['Critical', 'Critical'],
  'ops.health.status.disconnected': ['Disconnected', 'Disconnected'],
  'ops.health.status.unknown': ['Unknown / no events', 'Unknown / no events'],
  'ops.health.pausedByOwner': ['Bot owner ne band kiya (jaan-boojh ke) — fault nahi', 'Bot paused by owner (deliberate) — not a fault'],
  'ops.health.ambiguousNote': ['Ek se zyada sends ka outcome uncertain (timeout/network) — dobara bheja nahi gaya, count ke liye dikha diya.', 'Some sends have uncertain outcomes (timeout/network) — never resent, shown as counters only.'],
  'ops.health.channels': ['Alert channels', 'Alert channels'],
  'ops.health.emailSetup': ['Email alerts: setup chahiye — ALERT_EMAIL_* host vars set karo', 'Email alerts: setup required — set the ALERT_EMAIL_* host variables'],
  'ops.health.emailOk': ['Email alerts: ON', 'Email alerts: ON'],
  'ops.health.whatsappOk': ['WhatsApp alerts: ON', 'WhatsApp alerts: ON'],
  'ops.health.whatsappOff': ['WhatsApp alerts: passive (not configured)', 'WhatsApp alerts: passive (not configured)'],
  'ops.health.escalation': ['Threshold: {sendFail} send-fail / {aiFail} AI-fail in {window} min · cooldown {cooldown} min', 'Threshold: {sendFail} send-fail / {aiFail} AI-fail per {window} min · cooldown {cooldown} min'],
  'ops.health.incidentsTitle': ['Incidents', 'Incidents'],
  'ops.health.incidentsEmpty': ['Koi incident nahi.', 'No incidents.'],
  'ops.health.incident.sevCritical': ['CRITICAL', 'CRITICAL'],
  'ops.health.incident.sevWarning': ['Warning', 'Warning'],
  'ops.health.incident.status.detected': ['Detected', 'Detected'],
  'ops.health.incident.status.acknowledged': ['Acknowledged', 'Acknowledged'],
  'ops.health.incident.status.investigating': ['Investigating', 'Investigating'],
  'ops.health.incident.status.resolved': ['Resolved', 'Resolved'],
  'ops.health.incident.occurrences': ['#times {count}', '#times {count}'],
  'ops.health.incident.acknowledge': ['Acknowledge', 'Acknowledge'],
  'ops.health.incident.investigate': ['Investigate', 'Investigate'],
  'ops.health.incident.resolve': ['Resolve', 'Resolve'],
  'ops.health.incident.notified': ['Delivered:', 'Delivered:'],
  'ops.health.incident.first': ['{n} baar flag hua, pehli baar {at} pe', 'flagged {n} time(s), first at {at}'],

  // ── Ops Console: project notification (root cause, simple language) ────
  'ops.root.title': ['Project notification — rukne ka karan', 'Project notification — why things stopped'],
  'ops.root.chipOk': ['THEEK HAI', 'ALL GOOD'],
  'ops.root.chipWarning': ['DIKKAT', 'PROBLEM'],
  'ops.root.chipCritical': ['PROJECT RUK GAYA', 'PROJECT STOPPED'],
  'ops.root.affected': ['{n}/{total} accounts', '{n}/{total} accounts'],
  'ops.root.rescueHint': [
    'Sabse aasaan tarika: apne computer par cmd kholein aur rescue.cmd chalayein — wo project ki jaanch karke jo khud theek ho sakta hai khud theek kar deta hai.',
    'Easiest fix: open cmd on your computer and run rescue.cmd — it checks the project and repairs whatever it can by itself.',
  ],
  'ops.root.ok.title': ['Sab theek chal raha hai — koi dikkat nahi mili.', 'Everything is running fine — no problem found.'],
  'ops.root.ok.fix': ['Kuch karne ki zaroorat nahi.', 'Nothing to do.'],
  'ops.root.storage.title': [
    'Server data save nahi kar pa raha — is wajah se project theek kaam nahi kar sakta.',
    'The server cannot save its data — that is why the project cannot work properly.',
  ],
  'ops.root.storage.fix': [
    'Jaldi se rescue.cmd chalao (ya Railway dashboard me /data volume mount check karo). Data save na hone par customer connections mit sakte hain.',
    'Run rescue.cmd now (or check the /data volume mount in the Railway dashboard). Without storage, customer connections can be lost.',
  ],
  'ops.root.webhook.title': [
    'Meta se aane wale DMs ruk gaye hain — bot ko messages hi nahi mil rahe.',
    'DMs from Meta have stopped arriving — the bot is not receiving messages.',
  ],
  'ops.root.webhook.fix': [
    'Webhook URL aur META_APP_SECRET check karo (rescue.cmd ye dono jaanchta hai). Uske baad Meta dashboard se webhook dobara test karo.',
    'Check the webhook URL and META_APP_SECRET (rescue.cmd tests both). Then re-test the webhook from the Meta dashboard.',
  ],
  'ops.root.token-expired.title': [
    '{n} accounts ki Instagram permission expire ho gayi — bot unke DMs ka jawab nahi de pa raha.',
    'The Instagram permission for {n} account(s) has expired — the bot cannot answer their DMs.',
  ],
  'ops.root.token-expired.fix': [
    'Customer ko "Connect Instagram with Meta" dobara dabwana hoga (Connect fix dialog ready-made message deta hai). Ye khud theek nahi hota.',
    'The customer must press "Connect Instagram with Meta" again (the Connect fix dialog has the ready-made message). This does not heal by itself.',
  ],
  'ops.root.billing.title': [
    '{n} accounts ka plan/trial khatam ho gaya — is wajah se unka bot band hai.',
    '{n} account(s) have run out of plan/trial — their bot is switched off for that reason.',
  ],
  'ops.root.billing.fix': [
    'Plan activate karo ya trial extend karo — ops page ke billing section se ek click me ho jata hai.',
    'Activate a plan or extend the trial — one click in the billing section of this page.',
  ],
  'ops.root.paused.title': [
    '{n} accounts ka bot pause kiya gaya hai — jawab isliye nahi ja rahe.',
    '{n} account(s) have their bot paused — that is why no replies go out.',
  ],
  'ops.root.paused.fix': [
    'Agar ye jaan-boojh kar pause kiya tha to kuch mat karo. Warna account row ka pause switch wapas on karo (aur Emergency brake check karo).',
    'If you paused it on purpose, do nothing. Otherwise flip the pause switch back on the account row (and check the Emergency brake).',
  ],
  'ops.root.disconnected.title': [
    '{n} accounts Instagram se jude hi nahi hain — unka bot kabhi jawab nahi de sakta.',
    '{n} account(s) are not connected to Instagram at all — their bot can never reply.',
  ],
  'ops.root.disconnected.fix': [
    'Un customers ko connect karwana hoga: Connect fix dialog me ready-made message hota hai jo unhe bhejna hai.',
    'Those customers must connect: the Connect fix dialog has a ready-made message to send them.',
  ],
  'ops.root.ai.title': [
    'AI jawab nahi de pa raha — bot sirf "message mila" wala canned reply bhej raha hai.',
    'The AI cannot answer — the bot is only sending the canned "we got your message" reply.',
  ],
  'ops.root.ai.fix': [
    'OPENROUTER_API_KEY / OPENROUTER_MODEL host par check karo. rescue.cmd ye jaanchta hai; /healthz me aiModel bhi dikhta hai.',
    'Check OPENROUTER_API_KEY / OPENROUTER_MODEL on the host. rescue.cmd tests this; /healthz also shows aiModel.',
  ],
  'ops.root.send-fail.title': [
    '{n} accounts ke jawab Instagram tak nahi pahunch rahe — Meta bhejne se mana kar raha hai.',
    'Replies for {n} account(s) are not reaching Instagram — Meta is refusing the sends.',
  ],
  'ops.root.send-fail.fix': [
    'Aam taur par token expire ya rate limit hota hai. Incident detail me exact error hota hai; zyadatar reconnect se theek ho jata hai.',
    'Usually a token expiry or rate limit. The incident detail has the exact error; a reconnect fixes most of these.',
  ],
  'ops.root.silent.title': [
    'Messages aa rahe hain par koi jawab nahi ja raha — bot chup hai.',
    'Messages arrive but nothing goes out — the bot has gone silent.',
  ],
  'ops.root.silent.fix': [
    'Ye sabse gambhir symptom hai: AI, sends, ya bot switch me se koi band hai. Neeche incident list me exact cause hota hai; rescue.cmd chalao.',
    'This is the most serious symptom: one of AI, sending, or the bot switch is off. The incident list below has the exact cause; run rescue.cmd.',
  ],
  'ops.root.incident.title': [
    'Ek khula incident hai — project par asar pad raha hai.',
    'There is an open incident affecting the project.',
  ],
  'ops.root.incident.fix': [
    'Neeche incident list dekho — uska detail line me wajah likhi hoti hai.',
    'Look at the incident list below — its detail line names the cause.',
  ],
  'ops.sum.tenants': ['Total accounts', 'Total accounts'],
  'ops.sum.active': ['Paying (active)', 'Paying (active)'],
  'ops.sum.trialing': ['Trial pe', 'On trial'],
  'ops.sum.blocked': ['Bot band', 'Bot blocked'],
  'ops.sum.paused': ['Team ne band kiya', 'Paused by team'],
  'ops.sum.noInstagram': ['Instagram juda nahi', 'Instagram not connected'],
  'ops.sum.reauth': ['Reconnect chahiye', 'Reconnect needed'],
  'ops.sum.tester': ['Tester invite baaki', 'Tester invites pending'],
  'ops.sum.attention': ['Dhyan chahiye', 'Needs attention'],
  'ops.col.account': ['Account', 'Account'],
  'ops.col.plan': ['Plan & billing', 'Plan & billing'],
  'ops.col.bot': ['Bot', 'Bot'],
  'ops.col.activity': ['Activity', 'Activity'],
  'ops.col.attention': ['Dhyan do', 'Attention'],
  'ops.owner': ['TEAM FGT', 'TEAM FGT'],
  'ops.noHandle': ['handle nahi mila', 'no handle'],
  'ops.noPlan': ['koi plan nahi', 'no plan'],
  'ops.noActivity': ['koi activity nahi', 'no activity'],
  'ops.igConnected': ['Instagram juda hua hai', 'Instagram connected'],
  'ops.igMissing': ['Instagram juda nahi — DM nahi aayegi', 'Instagram not connected — no DMs reach the bot'],
  'ops.planLeft': ['{date} tak · {days} din baaki', 'till {date} · {days} day(s) left'],
  'ops.planNoExpiry': ['koi expiry nahi (Team Fgt/comped)', 'no expiry (Team Fgt/comped)'],
  'ops.trialUsed': ['trial pehle le chuka hai', 'has already used the trial'],
  'ops.botOn': ['Chalu', 'Allowed'],
  'ops.botOff': ['Band', 'Blocked'],
  'ops.bot.pause': ['Bot band karo', 'Pause bot'],
  'ops.bot.resume': ['Bot chalu karo', 'Resume bot'],
  'ops.bot.pausedTenant': ['Team Fgt ne is account ka bot band kiya hua hai.', 'Team Fgt switched this bot off.'],
  'ops.bot.pausedGlobal': [
    'SAARE bots band hain (emergency brake).',
    'Every bot is paused — the emergency brake is on.',
  ],
  'ops.leads': ['Leads: {count} ({fresh} naye)', 'Leads: {count} ({fresh} new)'],
  'ops.chats': ['Chats: {count}', 'Chats: {count}'],
  'ops.docs': ['Knowledge: {count} doc', 'Knowledge: {count} doc(s)'],
  'ops.allGood': ['Sab theek', 'All good'],
  'ops.copied': ['Copy ho gaya', 'Copied'],
  'ops.never': ['kabhi nahi', 'never'],
  // ── Username aur "hamesha free" (owner ke actions) ────────────────────────
  'ops.username.none': ['username nahi chuna', 'no username yet'],
  'ops.username.reset': ['Username reset karo', 'Reset username'],
  'ops.username.resetHint': [
    'Username ek hi baar set hota hai. Reset karne par wo naam pool me wapas chala jaata hai aur customer agli sign-in par se naya chunega.',
    'A username is set once. Resetting frees the name for reuse and the customer is asked for a new one on their next sign-in.',
  ],
  'ops.username.resetConfirm': ['“{username}” hata dein?', 'Remove “{username}”?'],
  'ops.username.resetDone': ['Username hata diya ({username})', 'Username removed ({username})'],
  'ops.free.label': ['Hamesha free', 'Free forever'],
  'ops.free.reason.owner-connected': ['owner ne connect kiya', 'connected by the owner'],
  'ops.free.reason.manual': ['team ne on kiya', 'switched on by the team'],
  'ops.free.env': ['env COMP_TENANT_IDS se', 'from COMP_TENANT_IDS'],
  'ops.free.turnOn': ['Hamesha free karo', 'Make free forever'],
  'ops.free.turnOff': ['Plan path pe wapas', 'Back on the plan path'],
  'ops.free.hint': [
    'Free forever wale account par trial ya plan ki koi rok nahi lagti — bot bina plan bhi jawab deta rehta hai. Owner ne jo account connect kiya wo khud-ba-khud yahan aa jaata hai.',
    'A free-forever account has no trial or plan gate — the bot keeps answering without a plan. Whatever the owner connects lands here automatically.',
  ],
  // ── "Instagram juda nahi" ka ek-button fix ───────────────────────────────
  // The server sends a `blocker` code, never a sentence, so every word the owner
  // reads here exists in both languages. Steps are newline-separated: the UI
  // renders each line as one numbered step.
  'ops.fix.panelTitle': ['Instagram juda nahi ({count}) — ek button se fix', 'Instagram not connected ({count}) — one-button fix'],
  'ops.fix.panelHint': [
    'Ye in accounts ka asli atakav batata hai aur jo server khud kar sakta hai kar deta hai. Meta kisi API se tester add nahi karne deta aur customer ki taraf se "Allow" dabaya nahi ja sakta — isliye aakhri ek-do kadam aapko ya customer ko hi karne padenge, par wo pehle se copy ho chuke honge.',
    'This names the real blocker for each account and does everything the server is allowed to do. Meta has no API for adding a tester and nobody can press Allow for the customer — so the last step or two is yours or theirs, already copied and ready.',
  ],
  'ops.fix.button': ['Fix karo', 'Fix'],
  'ops.fix.bulk': ['Sab ka plan bana do', 'Plan for all of them'],
  'ops.fix.bulkHint': [
    'Ek list: kis account pe kya karna hai. Ye koi Meta call nahi karta, sirf hisaab lagata hai.',
    'One list of who needs what. Runs no Meta calls — it only sorts the accounts.',
  ],
  'ops.fix.legendTitle': ['Rang ka matlab', 'What the colours mean'],
  'ops.fix.legendOk': [
    'Hara = sab badhiya (Meta token accept karta hai)',
    'Green = all good (Meta accepts this token)',
  ],
  'ops.fix.legendWaiting': [
    'Baingani = invite bhej di gayi — customer ne abhi accept nahi kiya',
    'Purple = invite sent — the customer has not accepted yet',
  ],
  'ops.fix.legendTodo': [
    'Peela = aapka kaam baaki hai (tester invite bhejni hai, ya handle customer ne nahi bataya)',
    'Yellow = your move (tester invite not sent yet, or the handle is not known to us)',
  ],
  'ops.fix.legendBlocked': [
    'Laal = atka hua (token mana hua, re-connect chahiye, ya ek IG do tenants se juda hai — DMs chup ho gaye)',
    'Red = stuck (token refused, reconnect needed, or one IG connected twice — DMs go silent)',
  ],
  'ops.fix.legendGrey': [
    'Dhusky = token purana hoga, dobara verify zaroori',
    'Grey = the token may be stale — needs a re-verify',
  ],
  'ops.fix.modalTitle': ['Connect fix', 'Connect fix'],
  'ops.fix.account': ['Account', 'Account'],
  'ops.fix.handle': ['Handle', 'Handle'],
  'ops.fix.handleUnknown': ['handle nahi pata — customer ne abhi bataya nahi', 'handle unknown — the customer has not told us yet'],
  'ops.fix.blocker': ['Kya atka hai', 'What is wrong'],
  'ops.fix.steps': ['Karna kya hai', 'What to do'],
  'ops.fix.evidence': ['Saboot (asli data)', 'Evidence (real data)'],
  'ops.fix.autoFixed': ['Server ne khud kar diya: {what}', 'Already done by the server: {what}'],
  'ops.fix.autoLiveCheck': ['Meta se token dobara check kiya → {state}', 'Re-checked the token with Meta → {state}'],
  'ops.fix.autoHandleRecorded': ['handle tester queue me likh diya', 'recorded the handle in the tester queue'],
  'ops.fix.copyHandle': ['Handle copy', 'Copy handle'],
  'ops.fix.copyUri': ['Redirect URI copy', 'Copy redirect URI'],
  'ops.fix.openRoles': ['Meta me tester add karo', 'Add as tester in Meta'],
  'ops.fix.openSettings': ['Meta app settings kholo', 'Open Meta app settings'],
  'ops.fix.copyMessage': ['Customer ka message copy', 'Copy the customer message'],
  'ops.fix.pasteHint': [
    'Message copy karke us jagah bhej do jahan aap us customer se baat karte ho (WhatsApp/email) — is server ke paas unka number nahi hota.',
    'Copy the message and send it wherever you already talk to this customer (WhatsApp/email) — this server does not hold their number.',
  ],
  'ops.fix.close': ['Band karo', 'Close'],
  'ops.fix.redirectUri': ['Redirect URI', 'Redirect URI'],
  'ops.fix.inviteApp': ['Invite isi app pe jaani chahiye', 'The invite must be sent on this app'],
  'ops.fix.lastTry': ['Aakhri koshish: {time} — {message}', 'Last attempt: {time} — {message}'],
  'ops.fix.neverTried': ['Is account ne abhi ek baar bhi Connect nahi dabaya.', 'This account has never pressed Connect, not once.'],
  'ops.fix.customerMessage': [
    'Namaste! Aapka Instagram abhi InstaFlow AI se juda nahi hai, isliye bot aapke DM ka jawab nahi de raha.\n\n1. Instagram app kholiye → Settings → Apps and websites → Tester invites\n2. Humein add karne ki request “Accept” kijiye\n3. Phir yahan wapas aakar “Connect Instagram with Meta” dabaiye: {connect}\n\nAtak jayein to isi message ka jawab de dijiye.',
    'Hi! Your Instagram is not linked to InstaFlow AI yet, so the bot cannot answer your DMs.\n\n1. Open the Instagram app → Settings → Apps and websites → Tester invites\n2. Accept the request to add us\n3. Come back here and press “Connect Instagram with Meta”: {connect}\n\nIf you get stuck, just reply to this message.',
  ],
  // "Is the bot actually answering?" — a dry run, no DM sent. Born from a real
  // misreading: the owner tested the bot by DMing it from another InstaFlow-connected
  // account, the loop guard refused (correctly), and the product looked dead.
  'ops.test.title': ['Bot jawab de raha hai ya nahi? — self-test', 'Is the bot answering? — self-test'],
  'ops.test.hint': ['Har account ke andar “Bot ka self-test chalao” dabao. Server asli chain chalta hai — bot switch, plan, Instagram connection, us customer ka prompt + knowledge base, phir AI provider — aur batata hai kahan atka, bilkul wahi jagah jahan asli DM rukti. Koi DM nahi jaata, isliye jitni baar chaho dabao. Jab connection hi toota ho to test wahin ruk jaata hai, kyunki uske aage ka kaam customer ka message kabhi pahunchta hi nahi.', 'Press “Run the bot self-test” inside any account. The server walks the real chain — bot switch, plan, Instagram connection, that customer’s own prompt + knowledge base, then the AI provider — and says where it stops, at the same point a real DM would. No DM is sent, so it is safe to press repeatedly. A broken connection ends the test there, because the stages after it are work the customer’s message never reaches.'],
  'ops.test.button': ['Bot ka self-test chalao', 'Run the bot self-test'],
  'ops.test.noSend': ['Ye sirf check hai — koi DM nahi bhejta.', 'This is a check only — it sends no DM.'],
  'ops.test.stage.botSwitch': ['Bot switch', 'Bot switch'],
  'ops.test.stage.access': ['Plan access', 'Plan access'],
  'ops.test.stage.connection': ['Instagram connection', 'Instagram connection'],
  'ops.test.stage.knowledge': ['Prompt + knowledge base', 'Prompt + knowledge base'],
  'ops.test.stage.ai': ['AI provider', 'AI provider'],
  'ops.test.reply': ['Customer ko yahi jawab jaata', 'This is the reply a customer would get'],
  'ops.test.provider': ['Provider: {provider} · {ms} ms', 'Provider: {provider} · {ms} ms'],
  'ops.test.ok': ['Sab stage pass — bot jawab de raha hai.', 'Every stage passed — the bot is answering.'],
  'ops.test.fail': ['Yahin atka hai — upar laal stage dekho.', 'It stops here — see the red stage above.'],
  'ops.test.loopWarning': ['Dhyan: yahi Instagram account {tenants} pe bhi juda hai. Webhook ek IG account ko sirf ek account pe route karta hai — doosre ki DM chup-chaap drop hoti hai, jabki uska dashboard Connected dikhata hai. Isi wajah se bot chalta hua bhi jawab nahi deta.', 'Note: the same Instagram account is connected to {tenants} too. The webhook routes one Instagram account to one tenant, so the other side\u2019s DMs are dropped silently while its dashboard still says Connected. That alone makes a healthy bot look dead.'],
  'ops.guardRefused.title': ['Bot ne {count} DM ka jawab rok diya (loop guard)', 'The bot refused to answer {count} DM(s) (loop guard)'],
  'ops.guardRefused.why': ['Ye jaan-boojh kar hai, kharabi nahi: jin accounts se ye DM aayi wo khud InstaFlow se jude hue hain, aur do jude hue accounts aapas me reply karte reh jaate hain. Isliye guard rok deta hai. Aise test se jawab kabhi nahi aayega — bot ko asli customer ke DM se test karo, ya “Bot ka self-test” dabao.', 'This is deliberate, not a fault: the accounts behind these DMs are themselves connected to InstaFlow, and two connected accounts reply to each other forever. The guard stops that. A test like this will never produce an answer — test with a real customer DM, or press “Run the bot self-test”.'],
  'ops.guardRefused.others': ['…aur {count} aur.', '…and {count} more.'],
  'ops.fix.label.ALREADY_OK': ['Sab theek hai — token Meta accept kar raha hai.', 'All good — Meta accepts this token.'],
  'ops.fix.label.RECONNECT_NEEDED': ['Account juda hai par Meta token mana kar raha hai. Customer ko dobara connect karna hoga.', 'Connected, but Meta refuses the token. The customer has to reconnect.'],
  'ops.fix.label.REVERIFY_NEEDED': ['Juda hai, par abhi tak live check nahi hua (ya purana hai). “Fix karo” Meta se dobara poochta hai.', 'Connected, but never live-checked (or long ago). “Fix” asks Meta again.'],
  'ops.fix.label.SERVER_NOT_READY': ['Server ki config adhoori hai — tab tak koi bhi customer connect nahi kar sakta.', 'This server cannot complete a connect yet — no customer can, until it is fixed.'],
  'ops.fix.label.TRY_FAILED': ['Customer ne try kiya aur Meta ne error diya. Meta ka asli shabd neeche hain.', 'The customer tried and Meta returned an error. Meta’s own words are below.'],
  'ops.fix.label.INVITE_NOT_SENT': ['Handle pata hai par tester invite abhi bheja nahi gaya.', 'The handle is known, but the tester invite has not been sent.'],
  'ops.fix.label.INVITE_SENT_WAITING': ['Invite bhej diya gaya tha, par account abhi juda nahi — ab customer ko accept karna hai.', 'The invite was sent, the account is still not connected — the customer has to accept now.'],
  'ops.fix.label.HANDLE_UNKNOWN': ['Pata hi nahi kaun sa Instagram handle — customer ne abhi kuch bataya nahi.', 'We do not know which handle this is — the customer has not told us yet.'],
  'ops.fix.label.SHARED_ACCOUNT': ['Ye Instagram account do jagah juda hua hai — DM sirf ek jagah pahunchti hai, isliye ek ka bot chup rehta hai.', 'This Instagram account is connected twice — its DMs reach only one of them, so one bot stays silent.'],
  // “Meta ne token mana kiya” ki AAJ WAAJAH. `RECONNECT_NEEDED` akela galat
  // instruction tha: agar wajah “is app ne authorize nahi kiya” hai to pehle
  // tester invite accept karwana zaroori hai, warna Reconnect bhi usi error pe
  // rukta hai — product do baar toota hua lagta hai.
  'ops.fix.causeLabel': ['Asli wajah', 'Root cause'],
  'ops.fix.causeName.NOT_AUTHORIZED_THIS_APP': [
    'Customer ke Instagram me is app ki permission nahi hai (ya invite pending hai)',
    'Meta: this user has not authorized this app (or the invite is still pending)',
  ],
  'ops.fix.causeName.NOT_AUTHORIZED_OTHER_APP': [
    'Token kisi doosre app ka hai, is server ke app ka nahi',
    'The stored token belongs to a different app, not this one',
  ],
  'ops.fix.causeName.TOKEN_EXPIRED': [
    'Token ki umar poori ho gayi',
    'The token aged out',
  ],
  'ops.fix.causeName.PASSWORD_CHANGED': [
    'Instagram password badla gaya, isliye token cancel hua',
    'An Instagram password change cancelled the token',
  ],
  'ops.fix.causeName.UNKNOWN': [
    'Wajah saaf nahi — Meta ne sirf mana kiya',
    'Not clear — Meta only refused',
  ],
  'ops.fix.causeStep.NOT_AUTHORIZED_THIS_APP': [
    'KYA HUA: Meta keh raha hai “user has not authorized application {appId}” — aur {appId} ISI server ka app hai. Matlab customer ke Instagram me is app ki permission hat gayi hai, ya uska tester invite abhi bhi pending hai.\nPEHLE YEH KARWAO — warna “Reconnect” bhi bilkul isi error pe ruk jaayega: customer se kaho Instagram app → Settings → Apps and websites kholo. “Tester invites” tab me humara invite “Accept” kare (naam milaan karlo — invite ISI app {appId} se aana chahiye), aur “Active” tab me dekh lo ki humara app hataya hua na ho. Uske BAAD dashboard pe Connect dabaye.',
    'WHAT HAPPENED: Meta says “user has not authorized application {appId}” — and {appId} is THIS server’s app. So the customer’s permission for this app has been removed in Instagram, or their tester invite is still pending.\nDO THIS FIRST — otherwise “Reconnect” fails on exactly the same error: tell the customer to open the Instagram app → Settings → Apps and websites. In the “Tester invites” tab they tap Accept on our invite (match the name — it has to come from this app, {appId}), and glance at the “Active” tab so our app is not sitting in Removed. Only after that should they press Connect on the dashboard.',
  ],
  'ops.fix.causeStep.NOT_AUTHORIZED_OTHER_APP': [
    'KYA HUA: Meta ne app id {namedAppId} ka naam liya hai, jo is server ka app ({appId}) nahi hai — matlab jo token store me hai wo kisi DOOSRE Meta app ka hai (aksar same developer account ka purana app).\nCustomer ko bolo: Instagram → Settings → Apps and websites me {namedAppId} wale app ko “Remove” kare, phir SAHI app {appId} ka tester invite accept kare, aur uske baad Connect dabaye. Is app ka naam theek kiye bina sirf Reconnect karne se wahi galti dohrayegi.',
    'WHAT HAPPENED: Meta named app id {namedAppId}, which is not this server’s app ({appId}) — so the token in the store belongs to a DIFFERENT Meta app, usually an older app on the same developer account.\nTell the customer: in Instagram → Settings → Apps and websites, remove the app {namedAppId}, then accept the tester invite from the RIGHT app ({appId}), and press Connect after that. Reconnecting without fixing which app they accepted just repeats the same mistake.',
  ],
  'ops.fix.causeStep.TOKEN_EXPIRED': [
    'KYA HUA: token ki umar poori ho gayi (Meta ne expiry kaha). Isme koi invite ya role ka kaam nahi hai.\nCustomer sirf dashboard pe “Reconnect Account” dabaye → Meta me Allow. Bas.',
    'WHAT HAPPENED: the token aged out (Meta says it expired). No invite and no role work is involved.\nThe customer only has to press “Reconnect Account” on the dashboard → Allow in Meta. That is all.',
  ],
  'ops.fix.causeStep.PASSWORD_CHANGED': [
    'KYA HUA: Instagram ka password badalne se Meta ne khud token cancel kar diya (ye Meta ka security behaviour hai, galti nahi).\nCustomer sirf dobara Reconnect kare — naya token mil jaayega, aur naya token 60 din chalta hai.',
    'WHAT HAPPENED: an Instagram password change made Meta cancel the token itself — that is Meta’s own security behaviour, not a mistake.\nThe customer just reconnects; a fresh token is issued and it lasts about 60 days.',
  ],
  'ops.fix.causeStep.UNKNOWN': [
    'Meta ne token mana kiya par wajah saaf nahi likhi.\nPehle customer se seedha Reconnect karwao — zyadatar yahi kaam kar jaata hai. Error wahi rahe to neeche wala Meta ka poora message bhej dena.',
    'Meta refused the token but did not say why clearly.\nAsk the customer to reconnect once — that usually clears it. If the same error comes back, send on Meta’s full message from below.',
  ],
  'ops.fix.steps.ALREADY_OK': ['Kuch karne ki zaroorat nahi.', 'Nothing to do.'],
  'ops.fix.steps.RECONNECT_NEEDED': ['Customer ko bolo: dashboard kholo → “Reconnect Account” dabao → Meta me Allow karo.\nZaroorat pade to neeche wala message WhatsApp pe bhej do.', 'Tell the customer: open the dashboard → “Reconnect Account” → press Allow in Meta.\nSend the message below on WhatsApp if that is easier.'],
  'ops.fix.steps.REVERIFY_NEEDED': ['“Fix karo” dobara dabaiye — Meta se live check ho jaayega.\nAgar phir bhi OK na aaye to Reconnect ke liye bolo.', 'Press “Fix” once more — that runs a live check with Meta.\nIf it still is not OK, ask them to reconnect.'],
  'ops.fix.steps.SERVER_NOT_READY': ['Meta app id / secret / redirect URI theek karo.\nYe redirect URI exactly (byte-by-byte) Meta app ke “Valid OAuth Redirect URIs” me daalna hai: {uri}', 'Fix the Meta app id / secret / redirect URI.\nThis exact redirect URI (byte for byte) belongs in the Meta app’s “Valid OAuth Redirect URIs”: {uri}'],
  // SERVER_NOT_READY ke code-specific kadam. Jab readiness.code batata hai ki
  // atakav KIS cheez ka hai, generic “app id/secret/redirect theek karo” galat
  // rah deta hai. Har code ek hi asli kaam dikhata hai. Yeh steps pehle aate
  // hain, phir generic line — isliye wahi cheez do baar nahi dikhti.
  'ops.fix.steps.REDIRECT_NOT_REACHABLE': [
    'Yeh connect localhost se shuru hua — Meta kabhi localhost ko redirect nahi karta, isliye one-click connect yahan kabhi poora nahi hota.\nAsli connect hamesha deployed app (https://www.thefgt.in/app) se karo — customer ka message bhi wahin se bhejo; localhost ke link ka koi fayda nahi.',
    'This connect started from localhost — Meta never redirects to localhost, so a one-click connect can never finish here.\nAlways connect from the deployed app (https://www.thefgt.in/app) — send the customer message from there too; a localhost link is useless.',
  ],
  'ops.fix.steps.NO_APP_ID': [
    'Server par META_APP_ID / IG_APP_ID set nahi hai, isliye Meta login shuru hi nahi ho sakta.\nRailway variables me app id set karo (FGT-IDs.html section 3 me saved hai), phir redeploy.\nTab tak token wala form se connect karo.',
    'No META_APP_ID / IG_APP_ID is set on the server, so the Meta login cannot even start.\nSet the app id in the Railway variables (saved in FGT-IDs.html section 3), then redeploy.\nUntil then, connect with the token form.',
  ],
  'ops.fix.steps.IG_APP_SECRET_MISSING': [
    'IG_APP_ID set hai par IG_APP_SECRET nahi — isliye Facebook ka dialog khulta hai jo Instagram-Login app me hamesha “URL blocked” deta hai.\nRailway variables me IG_APP_SECRET set karo (Meta Dashboard → Instagram product page → Instagram app secret).\nYa token wale form se connect karo.',
    'IG_APP_ID is set but IG_APP_SECRET is not — so the Facebook dialog opens, which an Instagram-Login app always answers “URL blocked” with.\nSet IG_APP_SECRET in the Railway variables (Meta Dashboard → Instagram product page → Instagram app secret).\nOr connect with the token form.',
  ],
  // Localhost par customer ko localhost:3000/app link bhejna bekaar hai — Meta
  // use whitelist nahi karta. Us jagah yeh message dikhao jo asli agla kadam batata hai.
  'ops.fix.localhostCustomerMessage': [
    'Yeh connect localhost se hai, isliye customer ko localhost ka link bhejna bekaar hai — Meta use kabhi kholega nahi. Asli connect https://www.thefgt.in/app se karo, phir yeh message wahan se bhejo.',
    'This connect is running on localhost, so sending the customer a localhost link is useless — Meta will never open it. Connect from https://www.thefgt.in/app instead, then send this message from there.',
  ],
  'ops.fix.steps.TRY_FAILED': ['Meta ka message padho (upar). Zyadatar yahi hota hai: URL blocked → redirect URI whitelist me nahi hai.\nTheek karke customer se dobara Connect karwao — message neeche ready hai.', 'Read Meta’s message above. Most often it is “URL blocked” → the redirect URI is not whitelisted.\nFix that, then ask the customer to press Connect again — the message below is ready.'],
  'ops.fix.steps.INVITE_NOT_SENT': ['Meta dashboard → Roles → Add People → “Instagram Tester” → handle daalo → Add.\nHandle copy button neeche hai; invite {appId} app pe hi jaani chahiye.\nPhir customer ko bolo: accept karo aur dashboard pe Connect dabao.', 'Meta dashboard → Roles → Add People → “Instagram Tester” → paste the handle → Add.\nThe copy button is below; the invite must be on app {appId}.\nThen tell the customer: accept it and press Connect on the dashboard.'],
  'ops.fix.steps.INVITE_SENT_WAITING': ['Poora check kar lo: Meta → Roles me ya “Instagram > API Setup with Instagram login” me handle add hua hai?\nCustomer ko bolo (message neeche ready hai): Instagram → Settings → Apps and websites → Tester invites → Accept, phir dashboard pe Connect.\nAccept karne ke baad unhe dobara Connect dabana zaroori hai — accept khud se connect nahi hota.', 'Double-check it: is the handle added in Meta → Roles, or under “Instagram > API Setup with Instagram login”?\nTell the customer (message ready below): Instagram → Settings → Apps and websites → Tester invites → Accept, then Connect on the dashboard.\nAccepting alone does not connect them — they must press Connect afterwards.'],
  'ops.fix.steps.HANDLE_UNKNOWN': ['Customer se handle maango.\nWo khud dashboard pe jaake “Instagram juda nahi?” screen pe apna handle likh sakte hain — wo seedha Ops Console ke tester queue me aa jaata hai.', 'Ask the customer for their handle.\nThey can also type it themselves on the dashboard’s “Instagram not connected” screen — it lands straight in the Ops Console tester queue.'],
  'ops.fix.steps.SHARED_ACCOUNT': ['Dekho kaunse do accounts Isi Instagram account pe hain (neeche).\nJo account owner nahi hai, usse Disconnect karo — ya uske liye alag Instagram account se connect karwao.\nFile me jo bhi pehle index hua hai, DM usi ko jaati hai.', 'See which two accounts share this Instagram account (below).\nDisconnect the one that should not have it — or connect it with a different Instagram account.\nWhichever is indexed first is the one the DMs actually reach.'],
  'ops.fix.sharedWith': ['Ye handle in accounts pe bhi juda hai: {ids} — DM {routed} ko ja rahi hai.', 'This handle is also connected by: {ids} — DMs are routed to {routed}.'],
  'ops.fix.roster': ['Kis account pe kya karna hai', 'Who needs what'],
  'ops.fix.counts': ['{invite} ko invite bhejna hai · {waiting} customer ka intezaar · {unknown} ka handle hi nahi pata', '{invite} need an invite · {waiting} waiting on the customer · {unknown} have no handle yet'],
  'ops.sum.hidden': ['List se hataye', 'Hidden from list'],
  'ops.sum.removed': ['Delete kiye gaye', 'Deleted for good'],
  // Shown on the customer's own Connection screen. Same Instagram account on two
  // accounts here means one bot is silent while reading "Connected".
  'shared.title': ['Ye Instagram account ek doosre account se bhi juda hua hai', 'This Instagram account is also connected by another account'],
  'shared.body': [
    'Isi Instagram account se yahan ek doosri account bhi judi hui hai, aur ek Instagram account ka DM ek hi jagah pahunch sakta hai. Agar aapke DM ka jawab nahi aa raha, to support se baat karein — ye setup se theek hota hai, aapki Instagram settings se nahi.',
    'The same Instagram account is connected by another account here, and an Instagram account can only reach one bot. If your DMs are going unanswered, contact support — this is fixed in the setup, not in your Instagram settings.',
  ],
  // ── List hygiene: hide (reversible) vs delete (permanent) ───────────────
  'ops.remove.title': ['List se hatana / delete karna', 'Hide or delete an account'],
  'ops.remove.subtitle': [
    'Customer package band kar de to “Hide” — list se hat jayega par uska data safe rahega aur ek press me wapas aa jayega. “Delete” sirf tab jab account hamesha ke liye jana chahiye.',
    'When a customer stops paying, “Hide” takes the row off this list while keeping every byte, one press from coming back. Use “Delete” only when the account should be gone for good.',
  ],
  'ops.remove.hiddenPanel': ['List se hataye gaye ({count})', 'Hidden from the list ({count})'],
  'ops.remove.removedPanel': ['Delete kiye gaye accounts ({count})', 'Deleted accounts ({count})'],
  'ops.remove.hiddenAt': ['Hataya {time} — {by} ne', 'Hidden {time} by {by}'],
  'ops.remove.removedAt': ['Delete hua {time} — {by} ne', 'Deleted {time} by {by}'],
  'ops.remove.removedCounts': [
    'mita: {chats} chat, {leads} lead, {gaps} khule sawaal',
    'erased: {chats} chat(s), {leads} lead(s), {gaps} open question(s)',
  ],
  'ops.remove.dataUntouched': ['Data kuch delete nahi hua — sirf row hat gayi.', 'Nothing was deleted — only the row left the list.'],
  'ops.remove.removedNote': [
    'Inka data mit chuka hai. Ye record sirf itna yaad rakhta hai ki delete hua tha — isi wajah se ye account dobara naya free trial nahi le sakta.',
    'Their data is erased. This record only remembers that the delete happened — which is what stops the same account from claiming a fresh free trial.',
  ],
  'ops.remove.dangerTitle': ['Account hatao', 'Remove account'],
  'ops.remove.hint': [
    'Hide: list se gayab, data safe, wapas aa sakta hai. Delete: connection, plan, leads, inbox, AI settings — sab hamesha ke liye.',
    'Hide: off the list, nothing deleted, restorable. Delete: connection, plan, leads, inbox, AI settings — all gone for good.',
  ],
  'ops.remove.hide': ['Hide karo', 'Hide'],
  'ops.remove.restore': ['Wapas laao', 'Restore'],
  'ops.remove.delete': ['Delete', 'Delete'],
  'ops.remove.busy': ['Ho raha hai…', 'Working…'],
  'ops.remove.hiddenDone': [
    'List se hat gaya. Data kuch delete nahi hua — “List se hataye gaye” panel se kabhi bhi wapas laao.',
    'Off the list. Nothing was deleted — bring it back any time from the “Hidden from the list” panel.',
  ],
  'ops.remove.restored': ['Wapas list me aa gaya.', 'Back on the list.'],
  'ops.remove.deletedDone': [
    'Delete ho gaya. Ye account ab naya free trial nahi le sakta.',
    'Deleted. This account can no longer start a new free trial.',
  ],
  'ops.remove.confirmTitle': ['Pakka delete karna hai?', 'Delete this account for good?'],
  'ops.remove.confirmBody': [
    'Isse connection aur token, plan, leads, inbox chats, AI settings aur knowledge base — sab hamesha ke liye mit jayenge. Wapas nahi aayega. Customer ka Instagram account ya uska login nahi hatega, sirf uska bot khatam ho jayega.',
    'This erases the connection and its token, the plan, leads, inbox conversations, AI settings and the knowledge base for good. It cannot be undone. The customer’s Instagram account and login are untouched — only their bot ceases to exist.',
  ],
  'ops.remove.confirmType': ['Confirm karne ke liye {expected} likho', 'Type {expected} to confirm'],
  'ops.remove.confirmCancel': ['Cancel', 'Cancel'],
  'ops.remove.confirmGo': ['Hamesha ke liye delete', 'Delete permanently'],
  // ── Billing row ka reset (trial khatm hone par atka hua account) ─────────
  // Delete se alag: yahan kuch bhi mit-ta nahi aur tombstone nahi banta, isliye
  // text ko ye saaf kehna hai — warna owner ise delete samajh kar darta rahega.
  'ops.billing.title': ['Billing row reset (trial khatm hone par atke accounts)', 'Clear billing rows (accounts stuck on a used-up trial)'],
  'ops.billing.hint': [
    'Jo account trial le chuka hai aur uska trial khatm ho gaya, uski billing row abhi bhi bot rok rahi hai — payments off hone par bhi. Ye button sirf wahi row hataata hai: connection, inbox, leads aur knowledge base jaisa hai waisa rahega, delete jaisa tombstone nahi banega, aur account naya trial phir se le sakta hai.',
    'An account that used its trial and let it expire is still held by its billing row — even with payments off. This button clears that row only: connections, inboxes, leads and knowledge bases stay exactly as they are, no delete-tombstone is written, and the account can start a fresh trial.',
  ],
  'ops.billing.preview': ['Pehle dikhao', 'Preview first'],
  'ops.billing.previewing': ['Dekh raha hoon…', 'Checking…'],
  'ops.billing.count': [
    '{count} account ki billing row hat jayegi',
    'Will clear the billing row of {count} account(s)',
  ],
  'ops.billing.none': [
    'Koi billing row nahi mili — sab pehle se saaf hai.',
    'No billing row to clear — nothing is stuck.',
  ],
  'ops.billing.colNow': ['Abhi', 'Now'],
  'ops.billing.colAfter': ['Reset ke baad', 'After reset'],
  'ops.billing.trialUsed': ['trial le chuka', 'trial already used'],
  'ops.billing.confirmType': ['Confirm karne ke liye {expected} likho', 'Type {expected} to confirm'],
  'ops.billing.confirmGo': ['Billing row hatao', 'Clear billing rows'],
  'ops.billing.busy': ['Ho raha hai…', 'Working…'],
  'ops.billing.done': [
    '{count} account ki billing row hat gayi — bot chalu, aur naya trial khula.',
    'Cleared the billing row of {count} account(s) — bots unblocked and a fresh trial is available.',
  ],
  'ops.billing.skipped': [
    '{count} chhod diye (owner account, ya billing row hi nahi thi).',
    'Skipped {count} (owner account, or no billing row to clear).',
  ],
  'ops.detail.instagram': ['Instagram', 'Instagram'],
  'ops.detail.accountId': ['IG account id', 'IG account id'],
  'ops.detail.connectedAt': ['Juda hua', 'Connected'],
  'ops.detail.lastVerified': ['Token last verified', 'Token last verified'],
  // "Token last verified" only says the account verified once, at connect time.
  // This is the live answer: does Meta still accept the token for THIS app?
  'ops.detail.liveState': ['Abhi ka check', 'Live check'],
  'ops.detail.liveCheckedAt': ['Check kab hua', 'Checked'],
  'ops.detail.checkToken': ['Ab check karo', 'Check now'],
  'ops.detail.checking': ['Check ho raha hai…', 'Checking…'],
  'ops.live.OK': ['theek hai — Meta ne token accept kiya', 'fine — Meta accepted the token'],
  'ops.live.NEEDS_REAUTH': ['Meta token mana kar raha hai — customer ko dobara connect karna hoga', 'Meta refuses this token — the customer has to reconnect'],
  'ops.live.UNREACHABLE': ['pata nahi chala (Meta tak nahi pahuncha)', 'unknown — could not reach Meta'],
  'ops.live.NOT_CONNECTED': ['koi connection nahi', 'no connection'],
  'ops.live.UNKNOWN': ['abhi check nahi hua', 'not checked yet'],
  'ops.detail.knowledge': ['Knowledge base', 'Knowledge base'],
  'ops.detail.openQuestions': ['Unanswered sawaal', 'Unanswered questions'],
  'ops.detail.promptCustom': ['Custom prompt likha hua hai', 'Custom prompt is set'],
  'ops.detail.promptDefault': ['Default prompt chal raha hai', 'Using the default prompt'],
  'ops.detail.inbox': ['Inbox', 'Inbox'],
  'ops.detail.takeovers': ['Human takeover', 'Human takeover'],
  'ops.detail.lastMessage': ['Last message', 'Last message'],
  'ops.detail.actions': ['Account', 'Account'],
  'ops.detail.planStarted': ['Account banaya / plan shuru', 'Plan started'],
  'ops.detail.paid': ['Ab tak diya', 'Paid so far'],
  'ops.detail.openBooking': ['Public booking page kholo', 'Open the public booking page'],
  // ── DMs that arrived with no connected account behind them ───────────────
  // "The bot stopped replying" reaches the console as this, not as a log line.
  'ops.unrouted.title': ['Bina connection wali DM', 'DMs with no connection'],
  'ops.unrouted.subtitle': [
    '{count} account abhi aise hain jinhe DM aa rahi hai par server par connection nahi hai (total {total}) — inka jawab nahi ja sakta, kyunki koi token hi nahi hai.',
    '{count} account(s) are receiving DMs with no connection on this server (total {total}) — nothing can be answered, because there is no token to send with.',
  ],
  'ops.unrouted.from': ['bhejne wala {sender}', 'from {sender}'],
  'ops.unrouted.clear': ['List saaf karo', 'Clear list'],
  'ops.unrouted.hint': [
    'Ye account pehle juda tha phir hatte gaya, ya connect adhura rah gaya. Us handle se dobara Connect karvaiye — ye alert apne aap chala jayega.',
    'These accounts were connected once and then went away, or their connect never finished. Have that handle reconnect — this alert clears itself.',
  ],
  'ops.detail.bot': ['AI bot — is customer ke liye', 'AI bot — for this customer'],
  'ops.detail.botRunning': [
    'Bot chalu hai — ye account abhi DMs ka automatic jawab de raha hai.',
    'The bot is running — this account is answering DMs automatically.',
  ],
  'ops.detail.readOnly': [
    'Neeche ka sab read-only hai. Account badalne ke sirf do control hain — upar wala bot switch, aur sabse neeche "Account hatao".',
    'Everything below is read-only. Only two controls change this account: the bot switch above, and “Remove account” at the very bottom.',
  ],

  // ── Tester-invite queue ─────────────────────────────────────────────────
  // While Meta's access gate is open this queue is the only thing between a
  // paying customer and a working bot, so the copy is written as an instruction,
  // not a status report.
  'ops.tester.title': ['Instagram tester invite queue', 'Instagram tester invite queue'],
  'ops.tester.subtitle': [
    'Meta ka access gate khula hai, isliye har naya customer manually add karna padta hai. Neeche wale handle Meta dashboard → App Roles → Instagram Testers me daalo, phir status aage badhao.',
    'Meta’s access gate is open, so every new customer has to be added by hand. Paste these handles into Meta dashboard → App Roles → Instagram Testers, then move the status on.',
  ],
  'ops.tester.pendingCount': ['{count} baaki', '{count} pending'],
  'ops.tester.openRoles': ['Meta Roles page kholo', 'Open Meta Roles page'],
  'ops.tester.copyHandle': ['Handle copy karo', 'Copy handle'],
  'ops.tester.status.pending': ['Invite bhejni hai', 'Invite to send'],
  'ops.tester.status.invited': ['Bhej di, accept baaki', 'Invited, awaiting accept'],
  'ops.tester.status.done': ['Ho gaya', 'Done'],
  'ops.tester.copyMessage': ['Customer message copy', 'Copy customer message'],
  'ops.tester.counts': ['Bhejni baaki: {pending} · Bheji / accept intezaar: {invited} · Ho gaya: {done}', 'To send: {pending} · Sent / awaiting accept: {invited} · Done: {done}'],
  'ops.tester.requestedAt': ['{time} pe maanga', 'Requested {time}'],
  'ops.tester.markInvited': ['Invite bhej diya', 'Invite sent'],
  'ops.tester.markDone': ['Ho gaya', 'Done'],
  'ops.tester.reopen': ['Dobara kholo', 'Reopen'],
  'ops.tester.prepareInvite': ['Taiyaar karein', 'Prepare Invitation'],
  'ops.tester.needsIdentity': ['Identity confirm', 'Needs Identity Confirmation'],
  'ops.tester.readyToInvite': ['Taiyaar', 'Ready to Invite'],
  'ops.tester.sendInvite': ['Invite bhejo', 'Send Invitation'],
  'ops.tester.verifyAccepted': ['Acceptance confirm karein', 'Confirm Accepted'],
  'ops.tester.verifyAcceptedHint': [
    'Meta acceptance ka koi API/webhook nahi deta, isliye yeh manual (unverified) confirmation hai.',
    'Meta exposes no acceptance API/webhook, so this records a manual (unverified) confirmation.',
  ],
  'ops.tester.accountAdded': ['Meta me add kar diya', 'Mark account added in Meta'],
  'ops.tester.accountAddedHint': [
    'Pehle Meta dashboard me @{handle} ko Instagram Tester add karein, phir yahan confirm karein. Server ise verify nahi kar sakta — sirf record karta hai.',
    'First add @{handle} as an Instagram Tester in the Meta dashboard, then confirm here. The server cannot verify this — it only records it.',
  ],
  'ops.tester.accountAddedBadge': ['Account added · {by}', 'Account added · {by}'],
  'ops.tester.acceptVerified': ['Meta-verified', 'Meta-verified'],
  'ops.tester.acceptUnverified': ['Unverified ({by})', 'Unverified ({by})'],
  'ops.tester.lastAction': ['Last: {action} by {by} · {at}', 'Last: {action} by {by} · {at}'],
  'ops.tester.notifyStatus': ['WhatsApp: {status}', 'WhatsApp: {status}'],
  'ops.tester.dateFilter': ['Date filter', 'Date filter'],
  'ops.tester.dateAll': ['Sab dates', 'All dates'],
  'ops.tester.date7': ['Last 7 days', 'Last 7 days'],
  'ops.tester.date30': ['Last 30 days', 'Last 30 days'],
  'ops.tester.promptInvitationUrl': ['{handle} ke liye invitation URL daalo (Meta app: {appId})', 'Enter invitation URL for {handle} (Meta app: {appId})'],
  'ops.tester.status.REQUESTED': ['Mangwa gaya', 'Requested'],
  'ops.tester.status.NEEDS_IDENTITY_CONFIRMATION': ['Identity confirm karni hai', 'Needs Identity Confirmation'],
  'ops.tester.status.READY_TO_INVITE': ['Taiyaar', 'Ready to Invite'],
  'ops.tester.status.INVITATION_SENT': ['Bhej diya', 'Sent'],
  'ops.tester.status.ACCEPTANCE_PENDING': ['Accept intezaar', 'Acceptance Pending'],
  'ops.tester.status.ACCEPTED': ['Accept ho gaya', 'Accepted'],
  'ops.tester.status.EXPIRED': ['Expire ho gaya', 'Expired'],
  'ops.tester.status.FAILED': ['Fail ho gaya', 'Failed'],
  'ops.tester.status.CANCELLED': ['Cancel ho gaya', 'Cancelled'],
  'ops.tester.customerName': ['{name}', '{name}'],
  'ops.tester.waMasked': ['WhatsApp: {num}', 'WhatsApp: {num}'],
  'ops.tester.waButton': ['Customer ko WhatsApp', 'WhatsApp customer'],
  'ops.tester.waMsgEn': ['Hello! Your Instagram tester invite for @thefgt app is being processed. Kindly accept the tester invite from Instagram (you may have received a notification or check your spam/junk folder). Once accepted, everything will be set up automatically.', 'Hello! Your Instagram tester invite for @thefgt app is being processed. Kindly accept the tester invite from Instagram (check your notifications or spam folder). Once accepted, everything will be set up automatically.'],
  'ops.tester.waMsgHi': ['Hello! Aapka Instagram tester invite @thefgt app ke liye process ho raha hai. Kripya Instagram se aaya tester invite accept kar lein (notification ya spam folder check karein). Accept hone ke baad sab automatic set ho jayega.', 'Hello! Aapka Instagram tester invite @thefgt app ke liye process ho raha hai. Kripya Instagram se aaya tester invite accept kar lein (notification ya spam folder check karein). Accept hone ke baad sab automatic set ho jayega.'],
  'ops.tester.noConsent': ['Consent nahi mila — pehle contact form', 'No consent yet — contact form first'],
  'ops.tester.optedOut': ['Opted out', 'Opted out'],

  // ── Customer complaints ─────────────────────────────────────────────────
  // These come from the public complaint form that replaced the printed mobile
  // number. The panel is the safety net behind the WhatsApp push, so the copy
  // makes a failed delivery read as an action, not just a status.
  'ops.complaint.title': ['Customer complaints', 'Customer complaints'],
  'ops.complaint.subtitle': [
    'Public form se aayi complaints. Har complaint pehle save hoti hai, phir WhatsApp par bheji jaati hai — jo pahunch nahi paayi wo yahin dikhti hai.',
    'Complaints from the public form. Each one is saved first and pushed to WhatsApp after — any push that failed shows up here.',
  ],
  'ops.complaint.openCount': ['{count} khuli', '{count} open'],
  'ops.complaint.relay': ['Relay: {target}', 'Relay: {target}'],
  'ops.complaint.notConfigured': [
    'WhatsApp relay set nahi hai — complaints save ho rahi hain, par notification nahi jaa rahi.',
    'The WhatsApp relay is not configured — complaints are stored, but no notification goes out.',
  ],
  'ops.complaint.delivered': ['WhatsApp par bhej di', 'Sent on WhatsApp'],
  'ops.complaint.undelivered': ['WhatsApp nahi pahunchi', 'Not delivered'],
  'ops.complaint.markDone': ['Niptr ho gaya', 'Mark resolved'],
  'ops.complaint.empty': ['Abhi koi complaint nahi hai.', 'No complaints yet.'],

  // ── Bot control + the bot-to-bot loop guard ─────────────────────────────
  // This block exists because of a real incident: three connected accounts began
  // answering each other and nothing could stop them. The copy is written to be
  // usable while that is happening — action first, explanation after.
  // ── Tester invite: which app the invite MUST come from ────────────────────
  // Written as a warning rather than a note because the failure is invisible:
  // an invite accepted on another app of the same developer account looks
  // identical on the customer's phone, and only the bot goes quiet.
  'ops.tester.appLabel': ['Invite isi app par bhejo:', 'Send the invite on this app:'],
  'ops.tester.copyAppId': ['App id copy', 'Copy app id'],
  'ops.tester.appUnset': ['set nahi hai', 'not configured'],
  'ops.tester.appFlavourIg': ['(Instagram Login — client id)', '(Instagram Login — client id)'],
  'ops.tester.appFlavourFb': ['(Facebook Login — client id)', '(Facebook Login — client id)'],
  'ops.tester.fbAppId': ['Dashboard app id: {id}', 'Dashboard app id: {id}'],
  'ops.tester.appWarning': [
    'Agar Instagram me invite kisi doosre naam/app se aata hai, to wo GALAT app hai — us invite se connect chalega hi nahi aur bot chup rahega. Roles page upar wale link se hi kholo.',
    'If the invite in Instagram comes from a different name/app, it is the WRONG app — connects from it fail and the bot stays silent. Add testers from the Roles link above only.',
  ],
  'ops.control.title': ['Bot control', 'Bot control'],
  'ops.control.brakeOn': [
    'Brake ON — saare bots band ({by}, {time}). Resume dabao ki phir chalu ho jayein.',
    'Brake ON — every bot is stopped ({by}, {time}). Press resume to start them again.',
  ],
  'ops.control.brakeOff': [
    'Sab bots chalu hain ({count} account manually band). Emergency me "Saare bots band karo" dabao.',
    'All bots are running ({count} switched off by hand). In an emergency press "Pause every bot".',
  ],
  'ops.control.pauseAll': ['Saare bots band karo', 'Pause every bot'],
  'ops.control.resumeAll': ['Sab chalu karo', 'Resume every bot'],
  'ops.control.guard': ['Loop guard: {state}', 'Loop guard: {state}'],
  'ops.control.guardOn': ['ON', 'ON'],
  'ops.control.guardOff': ['BAND (env flag)', 'OFF (env flag)'],
  'ops.control.blocked': ['{count} DM refuse kiye', '{count} DM refused'],
  'ops.guard.code.SENDER_IS_CONNECTED_ACCOUNT': ['Sender account id juda hua hai', 'Sender is a connected id'],
  'ops.guard.code.SENDER_USERNAME_IS_CONNECTED': ['Sender handle juda hua hai', 'Sender handle is connected'],
  'ops.guard.code.REPLY_BURST': ['Reply burst rukaya', 'Reply burst stopped'],
  'ops.guard.replies': ['{count} replies ho chuke the', '{count} replies had gone out'],

  // Flags in the Attention column. Keys are the machine flags the server sends.
  'ops.flag.instagramMissing': ['Instagram juda nahi', 'Instagram not connected'],
  'ops.flag.tokenRejected': [
    'Token Meta ne mana kiya — reconnect chahiye',
    'Token rejected by Meta — reconnect needed',
  ],
  'ops.flag.instagramError': ['Instagram error', 'Instagram error'],
  'ops.flag.tokenStale': ['Token purana (7+ din)', 'Token idle 7+ days'],
  'ops.flag.botBlocked': ['Bot band (billing)', 'Bot blocked (billing)'],
  'ops.flag.botPaused': ['Bot team ne band kiya', 'Bot paused by team'],
  'ops.flag.knowledgeEmpty': ['Knowledge khaali', 'Knowledge base empty'],
  'ops.flag.manyOpenQuestions': ['Bahut sawaal unanswered', 'Many unanswered questions'],
  'ops.flag.trialEnding': ['Trial kal khatam', 'Trial ending'],
  'ops.flag.pastDue': ['Payment pending', 'Payment past due'],
  'ops.flag.neverPaid': ['Plan nahi kharida', 'Never paid'],
  'ops.flag.testerRequestPending': ['Tester invite bhejni hai', 'Tester invite to send'],
  'ops.flag.testerInviteWaiting': ['Invite accept hone ka intezaar', 'Waiting on invite accept'],

  // ── Owner Ops Console app (/ops) ────────────────────────────────────────
  // Its own sign-in, because the console is a separate app: the strings here
  // belong to that page, not to the dashboard's auth gate.
  'opsApp.title': ['Team Fgt Ops Console', 'Team Fgt Ops Console'],
  'opsApp.subtitle': [
    'Sirf Team Fgt ke liye. Har account, plan aur bot ek hi screen pe.',
    'Team Fgt only. Every account, plan and bot in one screen.',
  ],
  'opsApp.email': ['Email', 'Email'],
  'opsApp.password': ['Password', 'Password'],
  'opsApp.signIn': ['Sign in', 'Sign in'],
  'opsApp.signingIn': ['Sign in ho raha hai…', 'Signing in…'],
  'opsApp.or': ['Ya phir', 'Or continue with'],
  'opsApp.google': ['Google', 'Google'],
  'opsApp.operatorOnly': [
    'Ye page sirf operator ke liye hai. Grahak apna dashboard /app pe kholein.',
    'This page is for the operator. Customers use their dashboard at /app.',
  ],
  'opsApp.checking': ['Access check ho raha hai…', 'Checking access…'],
  'opsApp.denied': ['Ye account Team Fgt nahi hai', 'This account is not Team Fgt'],
  'opsApp.deniedBody': [
    '{email} ko Ops Console ka access nahi hai. Team Fgt wale account se login karein ya apna dashboard /app pe kholein.',
    '{email} is not allowed into the Ops Console. Sign in with the Team Fgt account, or use your dashboard at /app.',
  ],
  // Shown only on the denied card, and only to an owner who got locked out of
  // their own console: names the exact fix instead of leaving them to guess.
  'opsApp.deniedOwnerHint': [
    'Team Fgt hain? Host ke environment me is address ko OWNER_EMAILS me daalein (ya apna uid OWNER_TENANT_IDS me) aur dobara login karein.',
    'Team Fgt? Put this address in OWNER_EMAILS on the host — or this uid in OWNER_TENANT_IDS — and sign in again.',
  ],
  'opsApp.copyUid': ['Mera uid copy karo', 'Copy my uid'],
  'opsApp.uidCopied': ['Copy ho gaya', 'Copied'],
  'opsApp.error': ['Access check fail hua', 'Could not verify access'],
  'opsApp.retry': ['Dobara koshish karo', 'Try again'],
  'opsApp.switchAccount': ['Dusre account se login karo', 'Sign in with another account'],
  'opsApp.signOut': ['Sign out', 'Sign out'],
  'opsApp.backToApp': ['Dashboard kholo', 'Open the dashboard'],

  // ── Getting-started guide (numbered stepper) ─────────────────────────────
  // Copy rules kept from the wizard this replaces: say what to PRESS and where,
  // not what the feature is. A step that is not green has to explain itself, so
  // every step carries a `todo` line written as the reason it still matters.
  'guide.title': ['Shuru kaise karein', 'Getting started'],
  'guide.subtitle': [
    'Ye 5 steps poore karo — uske baad bot khud se DM ka jawab dega.',
    'Finish these 5 steps and your bot answers DMs on its own.',
  ],
  'guide.welcomeTitle': ['Aapka setup — 5 step me live', 'Your setup — live in 5 steps'],
  'guide.welcomeSubtitle': [
    'Har step server par check hota hai; tick sirf tab lagta hai jab kaam sach me ho gaya ho.',
    'Every step is checked on the server; a tick appears only when the real thing happened.',
  ],
  'guide.continueSetup': ['Setup continue karo', 'Continue setup'],
  'guide.nextStep': ['Next step', 'Next step'],
  'guide.progress': ['{done} / {total} steps poore', '{done} / {total} steps done'],
  'guide.startHere': ['Yahan se shuru karo', 'Start here'],
  'guide.hide': ['Chhupa do', 'Hide'],
  'guide.show': ['Guide dikhao', 'Show guide'],
  'guide.done': ['Ho gaya', 'Done'],
  'guide.whatToDo': ['Kya karna hai', 'What to do'],
  'guide.problem': ['Yahan atka hai', 'Blocked here'],
  'guide.allDone': [
    'Sab ho gaya — @{username} par bot live hai. Ab asli DM aane do.',
    'All done — the bot is live on @{username}. Real DMs can come in now.',
  ],
  'guide.askHelp': ['Samajh nahi aaya? Assistant se poocho', 'Stuck? Ask the assistant'],
  'guide.refresh': ['Status dobara check karo', 'Refresh status'],
  'guide.rechecking': ['Check ho raha hai…', 'Checking…'],
  'guide.openTab': ['Tab kholo', 'Open the tab'],
  'guide.kbGaps': [
    '{count} sawal aise hain jin ka jawab bot ke paas nahi tha — Knowledge Base me add kar do.',
    '{count} question(s) the bot could not answer — add them to the knowledge base.',
  ],

  // ── Onboarding feature highlights + explainer reel/video ────────────────
  // Shown on /app below the getting-started welcome while onboarding is not
  // finished: what the product does (highlights) and how it looks in motion
  // (reel now, narrated video once one is uploaded in src/onboardingFeatures.tsx).
  'highlight.title': ['Ye sab aapke account par ho jata hai', 'All of this happens on your account'],
  'highlight.subtitle': [
    'Poora setup sirf 5 steps ka hai — neeche wo cheezein hain jo uske baad aapki taraf se kaam karti hain.',
    'Setup itself is just 5 steps — below are the things that then keep working for you.',
  ],
  'highlight.ai.title': ['24×7 AI replies', '24×7 AI replies'],
  'highlight.ai.body': [
    'Har DM ka turant jawab — customer raat ko 2 baje pooche to bhi.',
    'Every DM gets an instant reply — even when a customer asks at 2 am.',
  ],
  'highlight.kb.title': ['Aapki copy se training', 'Trained on your own copy'],
  'highlight.kb.body': [
    'Knowledge Base me jo aapne likha — products, FAQs, pricing — wahi jawab jaata hai.',
    'Whatever you write in the knowledge base — products, FAQs, pricing — is what gets answered.',
  ],
  'highlight.booking.title': ['Lead + booking note', 'Lead + booking note'],
  'highlight.booking.body': [
    'Jab customer order ya appointment maange, baat note ho jaati hai — aap sirf confirm karte ho.',
    'When a customer asks for an order or appointment, the detail is noted — you only confirm.',
  ],
  'highlight.analytics.title': ['Aankhon ke saamne report', 'A report you can see'],
  'highlight.analytics.body': [
    'Kitne DM aaye, kitno ne jawab liya, kitne skip hue — sab ek jagah pe.',
    'How many DMs came in, how many were answered, how many were skipped — all on one screen.',
  ],
  'highlight.safe.title': ['Loop guard + fail-safe', 'Loop guard + fail-safe'],
  'highlight.safe.body': [
    'Do bot ek dusre se baat nahi lagate, aur na bheja gaya reply auto-retry hota hai.',
    'Two bots never talk to each other, and a failed reply is retried on its own.',
  ],
  'highlight.lang.title': ['Hindi + English dono', 'Hindi + English both'],
  'highlight.lang.body': [
    'Customer jo bhasha me likhta hai, bot usi me jawab deta hai.',
    'The bot replies in whatever language the customer writes in.',
  ],

  'video.title': ['Dekho — aisa chalta hai', 'Watch how it works'],
  'video.subtitle': [
    'Ek chhota reel: DM aaya, AI jawab bheja, real aapke product ka hi.',
    'A short reel: a DM comes in, the AI answers — using your own product copy.',
  ],
  'video.reelNote': [
    'Ye asli thefgt.in ki screen recording hai — dekho kaise sign in se lekar live bot tak sab chalta hai.',
    'This is a real screen recording of thefgt.in — see how it all works, from sign-in to the live bot.',
  ],
  'video.reelTitle': ['InstaFlow ek DM ka life', 'A DM journey through InstaFlow'],
  'video.pause': ['Reel rok do', 'Pause the reel'],
  'video.play': ['Reel dobara chalao', 'Play the reel again'],
  'video.s1.title': ['1. Customer sawal poochta hai', '1. The customer asks'],
  'video.s1.bubble': ['Customer 💬 “Ye available hai?”', 'Customer 💬 “Is this available?”'],
  'video.s1.body': ['DM turant bot tak pahunchta hai Instagram webhook se.', 'The DM reaches the bot instantly through the Instagram webhook.'],
  'video.s2.title': ['2. AI jawab banata hai', '2. The AI writes the answer'],
  'video.s2.bubble': ['Bot 🤖 “Ji, 2 sizes ₹999 me available hain”', 'Bot 🤖 “Yes, 2 sizes are ₹999”'],
  'video.s2.body': ['Jawab aapke Knowledge Base ke words se banta hai.', 'The answer is built from your knowledge base wording.'],
  'video.s3.title': ['3. Jawab customer tak jaata hai', '3. The answer reaches the customer'],
  'video.s3.bubble': ['31 second me bheja — see chat', 'Sent in 31 seconds — see chat'],
  'video.s3.body': ['Bhejna fail ho to auto-retry — customer ko miss nahi hota.', 'If the send fails it retries on its own — the customer is not missed.'],
  'video.s4.title': ['4. Lead note ho jaata hai', '4. The lead is noted'],
  'video.s4.bubble': ['Lead — order maangna · follow-up', 'Lead — wants to order · follow-up'],
  'video.s4.body': ['Kaun puchh raha, kya maang raha — aapke liye note.', 'Who is asking and what for — noted for you.'],
  'video.s5.title': ['5. Aap dekho kya hua', '5. See what happened'],
  'video.s5.bubble': ['DMs 12 · Replies 12 · Leads 3', 'DMs 12 · Replies 12 · Leads 3'],
  'video.s5.body': ['Analytics me aaj ka poora din ek nazar me.', 'Analytics shows the whole day in one glance.'],

  'guide.step1.title': ['1. Plan chalu karo', '1. Start a plan'],
  'guide.step1.body': [
    'Neeche wala button dabao — Razorpay checkout khulega (UPI/card).\nNaye account ke liye ₹99 Launch Offer (first 100 customers, limited time) sabse sasta hai.\nAuto-charge nahi hota — agla month aap khud renew karte ho.',
    'Press the button below — the Razorpay checkout opens (UPI/card).\nFor new accounts the ₹99 Launch Offer (first 100 customers, limited time) is the cheapest way in.\nNothing is auto-charged — you renew the next month yourself.',
  ],
  'guide.step1.todo': [
    'Plan ke bina bot DM ka jawab nahi de sakta.',
    'Without a plan the bot is not allowed to answer any DM.',
  ],
  'guide.step1.done': ['Plan chalu hai: {plan}', 'Plan is active: {plan}'],
  'guide.step1.action': ['"₹99 Launch Offer" plan kharido', 'Buy the "₹99 Launch Offer" plan'],
  'guide.step1.actionBuy': ['Plan kharido', 'Buy a plan'],
  'guide.step1.starting': ['Checkout khul raha hai…', 'Opening checkout…'],

  'guide.step2.title': ['2. Instagram account connect karo', '2. Connect your Instagram account'],
  'guide.step2.body': [
    'Connections tab kholo.\n"Connect Instagram with Meta" dabao.\nMeta ke apne page par Instagram Business/Creator account se login karke Allow karo.\nWapas yahan aa jao — @username khud dikh jayega.',
    'Open the Connections tab.\nPress "Connect Instagram with Meta".\nSign in to Meta with your Instagram Business/Creator account and allow access.\nCome back here — your @username appears on its own.',
  ],
  'guide.step2.todo': [
    'Abhi koi DM bot tak nahi pahunch raha — connect karna zaroori hai.',
    'No DM reaches the bot yet — this connection is what feeds it.',
  ],
  'guide.step2.done': ['Connect hai: @{username}', 'Connected as @{username}'],
  'guide.step2.action': ['Instagram connect karo', 'Connect Instagram'],
  'guide.step2.bodyBlocked': [
    'Connections tab kholo.\n"Or Connect via Direct Meta Access Token" wala form kholo.\nApna IGAA… token paste karke Connect dabao.',
    'Open the Connections tab.\nOpen the "Or Connect via Direct Meta Access Token" form.\nPaste your IGAA… token and press Connect.',
  ],
  'guide.step2.actionToken': ['Token se connect karo', 'Connect with a token'],
  'manual.invalidToken': [
    'Do aam wajah: (1) token expire ho gaya — Meta ka "Generate token" button lagbhag 1 ghante ka token deta hai, naya banao. (2) Token kisi dusre Meta app ka hai, ya ye Instagram account is app ka tester nahi hai — "Add a tester" se account add karo, phir naya token generate karo.',
    'Two usual causes: (1) the token expired — Meta\'s "Generate token" button issues one that lasts about an hour, so generate a fresh one. (2) It belongs to a different Meta app, or this Instagram account is not a tester of this app — add the account under "Add a tester", then generate a new token.',
  ],
  'manual.formOpened': [
    'Token wala form khol diya — neeche apna IGAA… token paste karke "Connect & Verify Account" dabao.',
    'Opened the token form — paste your IGAA… token below and press "Connect & Verify Account".',
  ],
  'manual.titlePrimary': ['Meta Access Token se connect karo', 'Connect with a Meta Access Token'],
  'manual.subtitlePrimary': [
    'Ek baar token paste karo aur account jud jayega — is server par yahi rasta kaam karta hai.',
    'One paste and the account is connected — this is the route that works on this server.',
  ],
  'guide.step2.tryMetaAnyWay': ['Meta se phir bhi try karo', 'Try Meta anyway'],
  'guide.step2.waiting': ['Instagram ka approval window khula hai…', 'Waiting for Instagram approval…'],
  'guide.step2.reconnect': [
    'Meta ne purana access reject kar diya hai. Dobara connect karo — warna bot chup rahega.',
    'Meta rejected the stored access. Reconnect, or the bot stays silent.',
  ],

  'guide.step3.title': ['3. Knowledge Base bharo', '3. Fill the Knowledge Base'],
  'guide.step3.body': [
    'Knowledge Base & AI Persona tab kholo (sidebar me 4. number pe hai).\nApne business ki asli baatein likho — price, delivery, timing, policy, address.\nKam se kam 3 sawal-jawab add karo. Bot inhi se jawab banata hai.\nJab tak yeh khaali hai bot kuch nahi kehta — isliye yeh sabse zaroori step hai.',
    'Open the "Knowledge Base & AI Persona" tab (number 4 in the sidebar).\nWrite your real business facts — prices, delivery, timings, policies, address.\nAdd at least 3 entries. The bot builds every answer from these.\nWhile this is empty the bot says nothing — that is why this is the most important step.',
  ],
  'guide.step3.todo': [
    'Knowledge Base khaali hai — bot ke paas jawab dene ke liye kuch nahi hai. Sidebar me "Knowledge Base & AI Persona" dabao aur shuru karo.',
    'The knowledge base is empty — the bot has nothing to answer from. Tap "Knowledge Base & AI Persona" in the sidebar and start filling it.',
  ],
  'guide.step3.done': ['{count} document add ho gaye', '{count} document(s) added'],
  'guide.step3.action': ['Knowledge Base kholo', 'Open the knowledge base'],

  'guide.step4.title': ['4. Bot ko khud test karo', '4. Test the bot yourself'],
  'guide.step4.body': [
    'Simulator tab kholo.\nEk sawal bhejo jo customer sach me poochta hai — jaise "price kya hai?".\nJawab padho. Galat lage to Knowledge Base sudhaaro aur dobara bhejo.',
    'Open the Simulator tab.\nSend a question a real customer would ask — e.g. "what is the price?".\nRead the reply. If it is wrong, fix the knowledge base and send it again.',
  ],
  'guide.step4.todo': [
    'Abhi tak bot ko test nahi kiya. Asli customer aane se pehle khud check kar lo.',
    'You have not tested the bot yet. Check it yourself before real customers do.',
  ],
  'guide.step4.done': ['Bot test ho gaya: {at}', 'Bot tested: {at}'],
  'guide.step4.action': ['Simulator kholo', 'Open the simulator'],

  'guide.step5.title': ['5. Live verify karo', '5. Verify it is live'],
  'guide.step5.body': [
    'Connections tab kholo.\n"Verify now" dabao — Meta se token check hota hai.\nGreen "Verified" dikhe to sab set hai.',
    'Open the Connections tab.\nPress "Verify now" — Meta re-checks the token.\nA green "Verified" means everything is wired up.',
  ],
  'guide.step5.todo': [
    'Verify karke confirm karo ki bot sach me chal raha hai.',
    'Run the check to confirm the bot really works.',
  ],
  'guide.step5.done': ['Meta ne verify kar diya: {at}', 'Meta verified it: {at}'],
  'guide.step5.action': ['Verify karo', 'Verify now'],
  'guide.step5.verifying': ['Meta se check ho raha hai…', 'Checking with Meta…'],

  // ── In-portal assistant ──────────────────────────────────────────────────
  'help.open': ['Samajh nahi aa raha? Madad lo', 'Not sure what to do? Get help'],
  'help.title': ['Portal Assistant', 'Portal Assistant'],
  'help.subtitle': [
    'Poocho ki kaha jaana hai — main bata dunga.',
    'Ask where to go and I will point you there.',
  ],
  'help.greeting': [
    'Namaste! Main is portal ko samajhne me madad karta hoon. Batao kahan atke ho — jaise "Instagram kaise connect karu?"',
    'Hi! I help you find your way around this portal. Tell me where you are stuck — e.g. "how do I connect Instagram?"',
  ],
  'help.placeholder': ['Apna sawaal likho…', 'Type your question…'],
  'help.send': ['Bhejo', 'Send'],
  'help.thinking': ['Soch raha hoon…', 'Thinking…'],
  'help.stepHint': ['Aap abhi step {step} / {total} par ho', 'You are on step {step} / {total}'],
  'help.error': [
    'Jawab nahi aa paya. Thodi der baad dobara bhejein.',
    'Could not get an answer. Please try again in a moment.',
  ],
  'help.close': ['Band karo', 'Close'],
  'help.clear': ['Nayi baat shuru karo', 'Start over'],
  'help.disclaimer': [
    'Assistant sirf portal samajhne me madad karta hai. Password ya card details kabhi na dein.',
    'The assistant only explains the portal. Never share a password or card details with it.',
  ],
  'help.chip.connect': ['Instagram kaise connect karu?', 'How do I connect Instagram?'],
  'help.chip.kb': ['Knowledge Base me kya likhu?', 'What should I put in the knowledge base?'],
  'help.chip.test': ['Bot test kaise karu?', 'How do I test the bot?'],
  'help.chip.plan': ['Trial khatam ho gaya to?', 'What happens when the trial ends?'],
};

const LANG_LABEL: Record<Lang, string> = { en: 'English', hi: 'हिंदी' };

function readCookieLang(): Lang | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(en|hi)`));
    return match ? (match[1] as Lang) : null;
  } catch {
    return null;
  }
}

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'hi') return stored;
  } catch {
    /* private mode / storage disabled — fall through to the cookie */
  }
  // Someone who picked हिंदी on the landing or pricing page, then signed in,
  // must land in a Hindi dashboard: those pages have no localStorage, so the
  // cookie is the only thread carrying the choice across.
  return readCookieLang() || DEFAULT_LANG;
}

function persistLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* nothing to do — the cookie below still carries the choice to the server */
  }
  try {
    // A year is long enough that the choice feels permanent; the server reads
    // this for public pages and API error messages, which have no localStorage.
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* cookie blocked — the client UI still switches */
  }
}

type Interpolate = (text: string, vars?: Record<string, string | number>) => string;

const interpolate: Interpolate = (text, vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text;

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  /**
   * Look up a string in the active language. An unknown key returns the key
   * itself, so a missing entry shows up in the UI as an obvious `area.key`
   * instead of silently rendering an empty label.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    persistLang(lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(() => setLangState(prev => (prev === 'hi' ? 'en' : 'hi')), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const entry = STRINGS[key];
      if (!entry) return key;
      return interpolate(lang === 'hi' ? entry[0] : entry[1], vars);
    },
    [lang],
  );

  return (
    <LangContext.Provider value={{ lang, setLang, toggleLang, t }}>{children}</LangContext.Provider>
  );
}

export function useI18n(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
}

/**
 * The English / हिंदी switch. Rendered in the top bar of every screen (and in
 * the marketing header) so the choice is always one tap away.
 */
export function LanguageToggle({
  variant = 'light',
  className = '',
}: {
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const { lang, setLang } = useI18n();
  const base =
    'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap';
  const shell =
    variant === 'dark'
      ? 'bg-black/30 border border-white/15'
      : 'bg-slate-100 border border-slate-200';
  const active = variant === 'dark' ? 'bg-white text-slate-900' : 'bg-white text-purple-700 shadow-xs';
  const idle = variant === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-800';

  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg ${shell} ${className}`}
      role="group"
      aria-label="Language"
      title="Language / भाषा"
    >
      {(Object.keys(LANG_LABEL) as Lang[]).map(option => (
        <button
          key={option}
          type="button"
          onClick={() => setLang(option)}
          aria-pressed={lang === option}
          className={`${base} ${lang === option ? active : idle}`}
        >
          {LANG_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
