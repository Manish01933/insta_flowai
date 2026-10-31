/**
 * Server-side language handling.
 *
 * The dashboard is bilingual, and so is every page a customer can reach
 * without it: the landing page, the pricing page, the public booking page, and
 * the error strings an API hands back. Three sources decide the language, in
 * order of authority:
 *
 *   1. `?lang=en|hi` — the toggle links in the header, and the link the
 *      dashboard's language switch writes. Also pins a cookie so the choice
 *      survives navigation.
 *   2. the `if_lang` cookie — set by the client toggle (see src/i18n.tsx) and
 *      by (1) above.
 *   3. `Accept-Language` — a browser that asks for Hindi gets Hindi.
 *
 * Keep DEFAULT_LANG and LANG_COOKIE in sync with src/i18n.tsx.
 */
export type Lang = 'en' | 'hi';

export const DEFAULT_LANG: Lang = 'en';
export const LANG_COOKIE = 'if_lang';

export function normalizeLang(value?: string | null): Lang | null {
  if (!value) return null;
  const short = value.trim().toLowerCase().slice(0, 2);
  return short === 'en' || short === 'hi' ? short : null;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

type Requestish = {
  headers?: Record<string, any>;
  query?: Record<string, any>;
};

export function langFromRequest(req: Requestish): Lang {
  return (
    normalizeLang(typeof req.query?.lang === 'string' ? req.query.lang : null) ||
    normalizeLang(readCookie(req.headers?.cookie, LANG_COOKIE)) ||
    normalizeLang(typeof req.headers?.['accept-language'] === 'string' ? req.headers['accept-language'] : null) ||
    DEFAULT_LANG
  );
}

/** Remembers a `?lang=` choice so the next page in the journey keeps it. */
export const langCookieHeader = (lang: Lang) =>
  `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** `{ en, hi }` pair → the value for the active language. */
export function pick<T>(lang: Lang, pair: Record<Lang, T>): T {
  return pair[lang] ?? pair[DEFAULT_LANG];
}

/**
 * Messages the API returns to a human. These end up in the dashboard's
 * notification banner verbatim, so a customer reading English never has to
 * decode Hinglish to find out why their trial did not start.
 */
const MESSAGES: Record<string, Record<Lang, string>> = {
  'trial.retired': {
    hi: 'Free trial naya start nahi ho sakta — ₹99 Launch Offer (first 100 customers, limited time) live hai.',
    en: 'The free trial has been retired. The ₹99 Launch Offer (first 100 customers, limited time) is live instead.',
  },
  'trial.alreadyActive': {
    hi: 'Aapka trial/plan pehle se active hai.',
    en: 'Your trial/plan is already active.',
  },
  'trial.alreadyUsed': {
    hi: 'Trial pehle liya ja chuka hai — plan kharidna padega.',
    en: 'The free trial has already been used on this account — a plan has to be bought now.',
  },
  'trial.accountRemoved': {
    hi: 'Ye account team ne hata diya tha, isliye yahan naya free trial nahi mil sakta. Madad ke liye support se baat karo.',
    en: 'This account was removed by the team, so it cannot start a new free trial here. Contact support if you need help.',
  },
  'access.paused': {
    hi: 'Bot abhi band hai — InstaFlow team ne is account ko pause kiya hai',
    en: 'This bot is switched off right now — the InstaFlow team paused this account',
  },
  'access.expired': {
    hi: '{plan} plan khatam ho gaya — renew karo',
    en: '{plan} plan has expired — renew it',
  },
  'access.trial': {
    hi: 'Free Trial chal raha hai — {days} din baaki',
    en: 'Free Trial running — {days} days left',
  },
  'access.pending': {
    hi: '{plan} plan pending — payment complete karo',
    en: '{plan} plan pending — complete the payment',
  },
  'access.active': {
    hi: '{plan} plan active',
    en: '{plan} plan active',
  },
  'pay.notComplete': {
    hi: 'Payment abhi complete nahi hua (status: {status}). Thodi der baad "Payment check karo" dabao.',
    en: 'The payment is not complete yet (status: {status}). Press "Check the payment" again in a moment.',
  },
  'pay.noPendingOrder': {
    hi: 'Koi pending payment nahi mila is account pe.',
    en: 'No pending payment was found for this account.',
  },
  'pay.planGone': {
    hi: 'Ye order ka plan ab available nahi hai.',
    en: 'The plan in this order is no longer available.',
  },
  'pay.noAttempt': {
    hi: 'Is order pe koi payment attempt nahi mila — checkout poora nahi hua.',
    en: 'No payment attempt was found for this order — checkout was not completed.',
  },
  'pay.notConfigured': {
    hi: 'Payments abhi server pe configure nahi hain — turant baat kar ke chalu kar denge.',
    en: 'Payments are not configured on the server yet — we\'ll get you live right away.',
  },
  'connect.igSecretMissing': {
    hi: 'Is server par Instagram app ID set hai par IG_APP_SECRET nahi, isliye Facebook ka dialog khulta hai — aur Instagram-Login wale Meta app me wo hamesha "URL blocked" deta hai. Do raste: (1) neeche token wale form se connect karo, ya (2) server par IG_APP_SECRET set karo (Meta Dashboard > Instagram product page > Instagram app secret).',
    en: 'This server has the Instagram app ID but no IG_APP_SECRET, which is why the Facebook dialog opens — and an Instagram-Login app always answers "URL blocked" there. Two ways forward: (1) connect with the token form below, or (2) set IG_APP_SECRET on the server (Meta Dashboard > Instagram product page > Instagram app secret).',
  },
  'connect.redirectNotReachable': {
    hi: 'Meta is URL par wapas bhejta hai: {uri} — ye public HTTPS hona chahiye aur Meta app me whitelisted hona chahiye. Localhost se one-click connect kabhi poora nahi hota — token wala form use karo, ya deployed app se connect karo.',
    en: 'Meta is told to return the visitor to {uri}. That has to be a public HTTPS URL that is whitelisted in the Meta app. One-click connect can never complete from localhost — use the token form, or connect from the deployed app.',
  },
  'connect.notConfigured': {
    hi: 'Is server par META_APP_ID / IG_APP_ID set nahi hai, isliye Meta login shuru nahi ho sakta. Token wala form use karo, ya server par app id set karo.',
    en: 'No META_APP_ID / IG_APP_ID is configured on this server, so the Meta login cannot start. Use the token form, or set an app id on the server.',
  },
};

export function message(lang: Lang, key: keyof typeof MESSAGES | string, vars?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  if (!entry) return key;
  const text = entry[lang] ?? entry[DEFAULT_LANG];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}
