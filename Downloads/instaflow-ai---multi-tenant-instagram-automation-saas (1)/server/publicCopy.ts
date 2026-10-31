import type { Lang } from './i18n';

/**
 * Copy for the pages a visitor can reach without an account: the home page, the
 * pricing page and the public booking page.
 *
 * Every language is a full object of the same shape, so `Record<Lang, X>` makes
 * TypeScript fail the build if a string is added to one language and forgotten
 * in the other — the usual way a bilingual site silently rots.
 *
 * Product names, prices, "Pricing", "Features" and the industry chips stay in
 * English on purpose: that is how an Indian business owner reads them, and
 * translating "Razorpay" or "WhatsApp" would only make the pages harder to
 * scan.
 */

type Pair = [string, string];

export interface LandingCopy {
  navHow: string;
  navFeatures: string;
  navPricing: string;
  navFullPricing: string;
  navSignIn: string;
  /** Short offer CTA kept in the sticky header, on mobile too. */
  navOffer: string;
  heroH1: string;
  heroLede1: string;
  heroLede2: string;
  /** One-line, concrete promise that sits under the headline. */
  heroSub: string;
  heroCtaPrimary: string;
  heroCtaPricing: string;
  heroFine: string;
  /** Founders-offer block under the hero (price anchor + terms + seats). */
  offerKicker: string;
  offerTitle: string;
  offerOldPrice: string;
  offerPrice: string;
  offerPer: string;
  offerBody: string;
  offerTerms: string;
  /** {sold} and {cap} are filled from the real subscription rows. */
  offerSeats: string;
  offerCta: string;
  howTitle: string;
  howSub: string;
  howSteps: Pair[];
  featuresTitle: string;
  featuresSub: string;
  features: Pair[];
  whoTitle: string;
  whoSub: string;
  pricingTitle: string;
  pricingSub: string;
  pricingNoteBefore: string;
  pricingNoteLink: string;
  pricingNoteAfter: string;
  faqTitle: string;
  faqSub: string;
  faqs: Pair[];
  planCta: string;
  footerTag: string;
}

export interface PlansCopy {
  pageTitle: string;
  metaDescription: string;
  h1: string;
  sub: string;
  steps: string[];
  paymentsNote: string;
  howTitle: string;
  howItems: string[];
  planCta: string;
  footerLogin: string;
}

export interface BookingCopy {
  pageTitle: string;
  metaDescription: string;
  h1: string;
  sub: string;
  packagesTitle: string;
  extrasTitle: string;
  emptyTitle: string;
  emptyBody: string;
  detailsTitle: string;
  labelName: string;
  placeholderName: string;
  labelWhatsapp: string;
  labelEmail: string;
  labelTravelDates: string;
  placeholderTravelDates: string;
  labelTravellers: string;
  placeholderTravellers: string;
  labelMessage: string;
  placeholderMessage: string;
  submit: string;
  sending: string;
  errorGeneric: string;
  thankYouBefore: string;
  thankYouAfter: string;
  notFoundTitle: string;
  notFoundBody: string;
}

export const LANDING: Record<Lang, LandingCopy> = {
  hi: {
    navHow: 'Kaam kaise karta hai',
    navFeatures: 'Features',
    navPricing: 'Pricing',
    navFullPricing: 'Full pricing',
    navSignIn: 'Sign in',
    navOffer: '₹99 offer',
    heroH1: 'Instagram ke DM khud handle ho jaayein',
    heroLede1:
      'InstaFlow AI aapke business ki apni jaankari se customer ke DM ka jawab deta hai, baat aage badhata hai, aur interested customer ko aapke booking page tak le jata hai.',
    heroLede2:
      'Har enquiry ka poora detail — naam, WhatsApp number, sawaal — seedha aapke dashboard me pahuchta hai.',
    heroSub:
      'Aapke prices, packages aur policies se jawab — Hindi, Hinglish ya English me, raat ko bhi. Bot sirf wahi batata hai jo aapne likha hai; jo nahi pata wo sawaal aapki list me aa jata hai.',
    heroCtaPrimary: '₹99 me shuru karo — first 100 only',
    heroCtaPricing: 'Pricing dekho',
    heroFine:
      'Free plan bhi hai (200 replies/month) · Card sirf paid plan par · 10–15 minute me live',
    offerKicker: 'FOUNDERS LAUNCH OFFER',
    offerTitle: 'Starter plan ki poori suvidha — pehli 100 businesses ke liye ₹99/month',
    offerOldPrice: '₹999',
    offerPrice: '₹99',
    offerPer: '/month',
    offerBody:
      '1 Instagram account · 500 AI replies/month · 50 knowledge-base documents · Booking page + leads inbox · Unanswered-sawaal alerts',
    offerTerms:
      'Auto-charge nahi hota — har month aap khud renew karte ho. Offer khula hone tak (first 100) renewal ₹99/month; offer band hone ke baad renewal normal Starter price ₹999/month. Renew na karo to bot pause ho jaata hai, data safe rehta hai.',
    offerSeats: '{sold} / {cap} seats claimed',
    offerCta: '₹99 me shuru karo',
    howTitle: 'Kaam kaise karta hai',
    howSub: 'Aap sirf apna business batayein. Bot 24 ghante messages sambhalta hai, aur har lead aap tak pahunchti hai.',
    howSteps: [
      ['Plan chuno', 'Launch offer (₹99, pehli 100) ya Starter / Growth / Agency — signup ke baad turant chalu.'],
      ['Instagram connect karo', 'Apna Instagram professional account 2 click me connect hota hai; token encrypted rehta hai.'],
      [
        'Knowledge base bharo',
        'Prices, packages, kya included hai, policies aur FAQs — bot sirf inhi se jawab deta hai, kuch bana kar nahi bolta.',
      ],
      ['Bot live', 'Customer DM karta hai → jawab turant jata hai → lead aur booking aapke dashboard me aate hain.'],
    ],
    featuresTitle: 'Aapko kya milta hai',
    featuresSub: 'Ek hi dashboard me bot, booking page aur leads — alag-alag tools jodne ki zaroorat nahi.',
    features: [
      [
        'Aapki jaankari se jawab',
        'Knowledge base me jo likha hai (prices, packages, policies), bot usi ke hisaab se jawab deta hai — kuch bana kar nahi bolta.',
      ],
      ['Booking page + leads inbox', 'Har account ka apna public page banta hai. Customer form bharta hai aur lead seedha aapke dashboard me aati hai.'],
      ['WhatsApp par ek click', 'Lead ke saath WhatsApp button — customer se seedha baat karo, number copy karne ki zaroorat nahi.'],
      [
        'Unanswered sawaalon ki list',
        'Jo sawaal knowledge base me nahi the, bot unhe alag list me dikhata hai, taaki aap ek line likh kar agla jawab ready kar do.',
      ],
      ['Human takeover', 'Jab aap khud baat karna chaho, ek toggle se bot ruk jata hai aur inbox me aap reply karte ho.'],
      ['Multiple pages (Agency)', 'Agency plan me ek dashboard se kai clients ke Instagram accounts chalao.'],
    ],
    whoTitle: 'Kis ke liye hai',
    whoSub: 'Jahan bhi Instagram par enquiry aati hai aur usme price ya dates batani padti hai.',
    pricingTitle: 'Pricing',
    pricingSub: 'Month-to-month. Launch offer: pehli 100 customers ₹99 ke plan pe — limited time.',
    pricingNoteBefore: 'Saare plan me: knowledge-base jawab, booking page, leads inbox aur unanswered-sawaal alerts. Details',
    pricingNoteLink: 'pricing page',
    pricingNoteAfter: 'par.',
    faqTitle: 'Aksar pooche jaane wale sawaal',
    faqSub: 'Sabse zyada jo puchha jata hai.',
    faqs: [
      [
        'Bot galat price to nahi bata dega?',
        'Nahi. Bot sirf usi jaankari se jawab deta hai jo aapne knowledge base me di hai. Jo cheez wahan nahi hai, uske liye wo guess nahi karta — wo sawaal aapki list me aa jata hai.',
      ],
      [
        'Kitne din me chalu ho jayega?',
        'Signup, Instagram connect aur thodi knowledge base — 10-15 minute. Iske baad bot turant DMs ka jawab dena shuru kar deta hai.',
      ],
      ['Mera Instagram token safe hai?', 'Haan. Access token AES-256-GCM se encrypt hokar store hota hai, aur kabhi browser pe nahi bheja jata.'],
      [
        'Leads kahan aati hain?',
        'Aapke InstaFlow dashboard ke Inbox me — naam, WhatsApp number, customer ka poora sawaal aur booking ki date ya quantity (jo usne form me bhara ho), plus WhatsApp par ek click.',
      ],
      [
        'Kaise cancel karun?',
        'Dashboard ke Plan & billing se kabhi bhi cancel kar sakte ho. Cancel karne ke baad bhi jo period aapne pay kiya hai wo poora chalta rehta hai.',
      ],
      ['Paisa kaise bharna hai?', 'Razorpay se — UPI, card, netbanking, wallet. Kuch bhi charge hone se pehle aap plan aur amount dekh lete ho.'],
    ],
    planCta: '{plan} se shuru karo',
    footerTag: 'InstaFlow AI · Instagram DM automation for Indian businesses. Bot aapke apne Instagram account se reply karta hai.',
  },
  en: {
    navHow: 'How it works',
    navFeatures: 'Features',
    navPricing: 'Pricing',
    navFullPricing: 'Full pricing',
    navSignIn: 'Sign in',
    navOffer: '₹99 offer',
    heroH1: 'Let Instagram DMs answer themselves',
    heroLede1:
      'InstaFlow AI replies to your customers from your own business information, moves the conversation forward, and walks an interested customer to your booking page.',
    heroLede2:
      'Every enquiry arrives in your dashboard in full — name, WhatsApp number and the question asked.',
    heroSub:
      'Answers from your own prices, packages and policies — in Hindi, Hinglish or English, even at 2am. The bot only says what you wrote; anything it does not know becomes a question on your list instead.',
    heroCtaPrimary: 'Start for ₹99 — first 100 only',
    heroCtaPricing: 'See pricing',
    heroFine: 'Free plan available (200 replies/month) · Card only for a paid plan · Live in 10–15 minutes',
    offerKicker: 'FOUNDERS LAUNCH OFFER',
    offerTitle: 'The full Starter plan — ₹99/month for the first 100 businesses',
    offerOldPrice: '₹999',
    offerPrice: '₹99',
    offerPer: '/month',
    offerBody:
      '1 Instagram account · 500 AI replies/month · 50 knowledge-base documents · Booking page + leads inbox · Unanswered-question alerts',
    offerTerms:
      'No auto-charge — you renew each month yourself. While the offer is open (first 100), renewal is ₹99/month; once it closes, renewal is at the normal Starter price of ₹999/month. If you do not renew, the bot pauses and your data stays safe.',
    offerSeats: '{sold} / {cap} seats claimed',
    offerCta: 'Start for ₹99',
    howTitle: 'How it works',
    howSub: 'You describe your business once. The bot handles messages 24/7 and every lead reaches you.',
    howSteps: [
      ['Pick a plan', 'The Launch offer (₹99, first 100), or Starter / Growth / Agency — active right after signup.'],
      ['Connect Instagram', 'Your Instagram professional account links in two clicks; the token stays encrypted.'],
      [
        'Fill in the knowledge base',
        'Prices, packages, what is included, policies and FAQs — the bot answers only from these and never invents anything.',
      ],
      ['Bot goes live', 'A customer DMs → the reply goes out instantly → the lead and booking land in your dashboard.'],
    ],
    featuresTitle: 'What you get',
    featuresSub: 'The bot, the booking page and the leads live in one dashboard — nothing else to wire up.',
    features: [
      [
        'Answers from your own information',
        'The bot replies from exactly what you wrote in the knowledge base (prices, packages, policies) and never makes anything up.',
      ],
      ['Booking page + leads inbox', 'Every account gets its own public page. The customer fills in the form and the lead lands straight in your dashboard.'],
      ['One click to WhatsApp', 'Every lead carries a WhatsApp button — talk to the customer directly, no need to copy a number.'],
      [
        'A list of unanswered questions',
        'Questions the knowledge base could not answer are collected in their own list, so you can write one line and be ready next time.',
      ],
      ['Human takeover', 'When you want to handle a chat yourself, one toggle pauses the bot and you reply from the inbox.'],
      ['Multiple pages (Agency)', 'On the Agency plan, run several clients’ Instagram accounts from one dashboard.'],
    ],
    whoTitle: 'Who it is for',
    whoSub: 'Anywhere Instagram enquiries need a price or a date quoted.',
    pricingTitle: 'Pricing',
    pricingSub: 'Month-to-month. Launch offer: the first 100 customers get the ₹99 plan — limited time.',
    pricingNoteBefore: 'Every plan includes knowledge-base answers, the booking page, the leads inbox and unanswered-question alerts. Full details on the',
    pricingNoteLink: 'pricing page',
    pricingNoteAfter: '.',
    faqTitle: 'Frequently asked questions',
    faqSub: 'What people ask us most.',
    faqs: [
      [
        'Will the bot quote a wrong price?',
        'No. The bot answers only from the information you put in the knowledge base. When something is not there it does not guess — that question is filed into your list instead.',
      ],
      [
        'How long does it take to go live?',
        'Signup, connecting Instagram and a little knowledge-base content — 10-15 minutes. After that the bot starts answering DMs immediately.',
      ],
      ['Is my Instagram token safe?', 'Yes. The access token is stored AES-256-GCM encrypted and is never sent to the browser.'],
      [
        'Where do leads go?',
        'Into your InstaFlow dashboard inbox — with the name, WhatsApp number, the full question and the booking date or quantity the customer entered, plus a one-click WhatsApp button.',
      ],
      [
        'How do I cancel?',
        'Any time from Plan & billing in the dashboard. After cancelling, the period you already paid for keeps running in full.',
      ],
      ['How do I pay?', 'Through Razorpay — UPI, card, netbanking or wallet. You see the plan and the exact amount before anything is charged.'],
    ],
    planCta: 'Start with {plan}',
    footerTag: 'InstaFlow AI · Instagram DM automation for Indian businesses. The bot replies from your own Instagram account.',
  },
};

export const PLANS: Record<Lang, PlansCopy> = {
  hi: {
    pageTitle: 'InstaFlow AI — plans',
    metaDescription: 'Instagram DM automation with an AI that answers from your own knowledge base.',
    h1: 'Instagram ke DM khud handle ho jaayein',
    sub: 'AI tumhare business ki apni jankari se jawab deta hai, customer ko booking page tak le jata hai, aur har enquiry/lead tumhe turant deliver karta hai.',
    steps: ['1. Plan chuno', '2. Instagram connect karo', '3. Knowledge base bharo', '4. Bot live'],
    paymentsNote: 'Payments abhi configure nahi hue hain — turant chalu karne ke liye humse baat karo. Pricings me ₹99 Launch Offer (pehli 100 customers) bhi hai.',
    howTitle: 'Kaam kaise karta hai',
    howItems: [
      'Signup karke apna Instagram (professional) account connect karo.',
      'Knowledge base me prices, packages, policies aur FAQs daalo — bot sirf inhi se jawab dega, kuch bana kar nahi bolega.',
      'Customer DM karta hai → bot turant reply karta hai, sawaal samajhta hai aur interested hone par tumhara booking page bhejta hai.',
      'Jo sawaal knowledge base me nahi the, wo tumhe dikhte hain — aur booking form se aaya har lead tumhare dashboard me pahuchta hai.',
    ],
    planCta: '{plan} se shuru karo',
    footerLogin: 'Customer login',
  },
  en: {
    pageTitle: 'InstaFlow AI — plans',
    metaDescription: 'Instagram DM automation with an AI that answers from your own knowledge base.',
    h1: 'Let Instagram DMs answer themselves',
    sub: 'The AI replies from your own business information, walks the customer to your booking page, and delivers every enquiry and lead to you instantly.',
    steps: ['1. Pick a plan', '2. Connect Instagram', '3. Fill the knowledge base', '4. Bot live'],
    paymentsNote: 'Payments are not configured yet — reach out and we will get you live right away. The ₹99 Launch Offer (first 100 customers) is also listed on the pricing page.',
    howTitle: 'How it works',
    howItems: [
      'Sign up and connect your Instagram (professional) account.',
      'Add prices, packages, policies and FAQs to the knowledge base — the bot answers only from these and never makes anything up.',
      'A customer DMs → the bot replies instantly, understands the question, and sends your booking page once the customer is interested.',
      'Questions the knowledge base could not answer are shown to you — and every lead from the booking form lands in your dashboard.',
    ],
    planCta: 'Start with {plan}',
    footerLogin: 'Customer login',
  },
};

export const BOOKING: Record<Lang, BookingCopy> = {
  hi: {
    pageTitle: 'Book with @{handle}',
    metaDescription: 'Enquire and book with @{handle}',
    h1: 'Enquire & book',
    sub: 'Details bhar do — team aapko WhatsApp par exact options bhej degi.',
    packagesTitle: 'Packages & prices',
    extrasTitle: 'Good to know',
    emptyTitle: 'Enquiry',
    emptyBody: 'Send us your details and the team will share packages and prices.',
    detailsTitle: 'Your details',
    labelName: 'Naam *',
    placeholderName: 'Aapka pura naam',
    labelWhatsapp: 'WhatsApp number *',
    labelEmail: 'Email (optional)',
    labelTravelDates: 'Travel dates',
    placeholderTravelDates: 'e.g. 12-16 Oct',
    labelTravellers: 'Kitne log',
    placeholderTravellers: 'e.g. 2 adults',
    labelMessage: 'Kuch aur batana hai? (optional)',
    placeholderMessage: 'Budget, city, koi special request...',
    submit: 'Send enquiry',
    sending: 'Sending...',
    errorGeneric: 'Kuch galat ho gaya, dobara try karein.',
    thankYouBefore: 'Thank you, {name}!',
    thankYouAfter: 'Aapki enquiry mil gayi hai. Team aapko WhatsApp par jaldi contact karegi.',
    notFoundTitle: 'Booking page nahi mila',
    notFoundBody: 'Ye link active nahi hai. Instagram DM me team se naya link maang lo.',
  },
  en: {
    pageTitle: 'Book with @{handle}',
    metaDescription: 'Enquire and book with @{handle}',
    h1: 'Enquire & book',
    sub: 'Fill in your details — the team will send you exact options on WhatsApp.',
    packagesTitle: 'Packages & prices',
    extrasTitle: 'Good to know',
    emptyTitle: 'Enquiry',
    emptyBody: 'Send us your details and the team will share packages and prices.',
    detailsTitle: 'Your details',
    labelName: 'Name *',
    placeholderName: 'Your full name',
    labelWhatsapp: 'WhatsApp number *',
    labelEmail: 'Email (optional)',
    labelTravelDates: 'Travel dates',
    placeholderTravelDates: 'e.g. 12-16 Oct',
    labelTravellers: 'How many travellers',
    placeholderTravellers: 'e.g. 2 adults',
    labelMessage: 'Anything else we should know? (optional)',
    placeholderMessage: 'Budget, city, any special request...',
    submit: 'Send enquiry',
    sending: 'Sending...',
    errorGeneric: 'Something went wrong, please try again.',
    thankYouBefore: 'Thank you, {name}!',
    thankYouAfter: 'We have your enquiry. The team will contact you on WhatsApp shortly.',
    notFoundTitle: 'Booking page not found',
    notFoundBody: 'This link is not active. Please ask for a fresh link in Instagram DM.',
  },
};

/**
 * The public complaint form.
 *
 * This page replaced a printed mobile number on the contact and policy pages.
 * The customer never sees where the message lands — they only need to know that
 * a human will read it — which is why none of this copy mentions WhatsApp
 * delivery or a destination number.
 */
export interface ComplaintCopy {
  pageTitle: string;
  metaDescription: string;
  h1: string;
  sub: string;
  labelAccountId: string;
  placeholderAccountId: string;
  labelContact: string;
  labelProblem: string;
  placeholderProblem: string;
  submit: string;
  sending: string;
  errorGeneric: string;
  reassurance: string;
  thankYouTitle: string;
  thankYouBody: string;
  backToSite: string;
}

export const COMPLAINT: Record<Lang, ComplaintCopy> = {
  hi: {
    pageTitle: 'Complaint / Shikayat',
    metaDescription: 'Apni shikayat bhejein — InstaFlow AI support team har message khud padhti hai.',
    h1: 'Shikayat bhejein',
    sub: 'Neeche apni detail aur problem likhein. Hamari team har complaint khud padhti hai aur aapko usi number par reply karti hai.',
    labelAccountId: 'Aapki id / email *',
    placeholderAccountId: 'Jis email ya id se aapne signup kiya',
    labelContact: 'Aapka mobile / WhatsApp number *',
    labelProblem: 'Aapki problem *',
    placeholderProblem: 'Kya dikkat aa rahi hai? Jab shuru hui, kya message aaya — jitna detail de sakein utna better.',
    submit: 'Complaint bhejein',
    sending: 'Bhej rahe hain...',
    errorGeneric: 'Kuch galat ho gaya, dobara try karein.',
    reassurance: 'Aapka number sirf aapko reply karne ke liye use hota hai — kahin publish nahi hota.',
    thankYouTitle: 'Complaint mil gayi',
    thankYouBody: 'Shukriya. Team aapki complaint dekhkar aapko aapke diye number par contact karegi.',
    backToSite: 'Wapas home page',
  },
  en: {
    pageTitle: 'Complaint',
    metaDescription: 'Send a complaint — the InstaFlow AI support team reads every message itself.',
    h1: 'Send a complaint',
    sub: 'Tell us who you are and what went wrong. A human on our team reads every complaint and replies to the number you give us.',
    labelAccountId: 'Your id / email *',
    placeholderAccountId: 'The email or id you signed up with',
    labelContact: 'Your mobile / WhatsApp number *',
    labelProblem: 'What is the problem? *',
    placeholderProblem: 'What is going wrong? When did it start, and what did you see? The more detail, the faster we can fix it.',
    submit: 'Send complaint',
    sending: 'Sending...',
    errorGeneric: 'Something went wrong, please try again.',
    reassurance: 'Your number is used only to reply to you — it is never published anywhere.',
    thankYouTitle: 'Complaint received',
    thankYouBody: 'Thank you. The team has your complaint and will contact you on the number you gave.',
    backToSite: 'Back to home',
  },
};

/**
 * Plan taglines come from the plan store (the single source of truth for what
 * is on sale), which stores them in the original Hinglish. The public pages are
 * read by people who picked English, so their English wording lives here and
 * falls back to the plan store whenever a plan has no entry.
 */
export const PLAN_TAGLINES: Record<string, Record<Lang, string>> = {
  launch99: { hi: '₹99 — pehli 100 customers (limited)', en: 'First 100 customers — limited time' },
  starter: { hi: 'Ek business, ek page', en: 'One business, one page' },
  growth: { hi: 'Growing page, zyada enquiries', en: 'Growing page, more enquiries' },
  agency: { hi: 'Multiple clients, ek dashboard', en: 'Multiple clients, one dashboard' },
  owner: { hi: 'Internal — full access', en: 'Internal — full access' },
};

export function planTagline(planId: string, fallback: string, lang: Lang): string {
  return PLAN_TAGLINES[planId]?.[lang] ?? fallback;
}

export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}
