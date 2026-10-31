import type { Lang } from './i18n';

/**
 * Fill-in-the-blank knowledge-base starter documents.
 *
 * The complaint this answers: a brand-new customer opens the Knowledge Base and
 * stares at an empty form. They do not know what a "document" should look like,
 * how long it should be, or which facts the bot actually needs — so they either
 * write nothing (and the bot has nothing to answer from) or write one long blob
 * that buries the price three lines in.
 *
 * One click now writes the five documents an enquiry always needs — price,
 * timing, location, what is included, and the booking/cancellation rule — with
 * every number left as a `[bracket]`. The customer's job becomes replacing
 * brackets instead of inventing structure, which turns a blank page into a
 * two-minute edit. They are written in the reader's own language on purpose:
 * these lines become the bot's source of truth, and a customer should write
 * them in the words they already use with their own customers.
 *
 * Order matters. The first two documents are the ones customers ask about
 * most, so they are the first thing the seller fixes.
 */

export interface StarterDoc {
  title: string;
  content: string;
  category: string;
}

const STARTER_DOCS: Record<Lang, StarterDoc[]> = {
  en: [
    {
      title: 'My business overview',
      content:
        'Business name: [BUSINESS NAME]. Business type: [BUSINESS TYPE — e.g. restaurant, salon, clothing store, real estate, coaching]. ' +
        'What we sell: [PRODUCT/SERVICE list]. Our city / service area: [LOCATION]. Best contact: [CONTACT INFORMATION].',
      category: 'Business Profile',
    },
    {
      title: 'Prices and packages',
      content:
        'Option 1: [PRODUCT/SERVICE] — [PRICE]. Option 2: [PRODUCT/SERVICE] — [PRICE]. ' +
        'Option 3: [PRODUCT/SERVICE] — [PRICE]. To confirm an order/booking we take [amount or %] in advance.',
      category: 'Pricing',
    },
    {
      title: 'Current offers',
      content:
        'Running offers: [OFFER — e.g. combo deals, seasonal discounts]. Bulk/group discount: [OFFER]. ' +
        'Offer valid till: [DATE].',
      category: 'Offers',
    },
    {
      title: 'Timings and availability',
      content:
        'We are open [days] from [start time] to [end time]. We can take [number] bookings/orders per day. ' +
        'Our busiest weeks are [months] — plan early for those.',
      category: 'Timings',
    },
    {
      title: 'Location and delivery information',
      content:
        'We are based in [city]. We serve [areas / delivery radius]. ' +
        'Pickup or visit: [address]. Delivery information: [DELIVERY INFORMATION — courier, days, fee, free-above].',
      category: 'Location',
    },
    {
      title: 'What is included',
      content:
        'Included: [list]. Not included: [list]. Costs extra: [list].',
      category: 'Inclusions',
    },
    {
      title: 'Payment, cancellation and FAQ',
      content:
        'Payment methods: [UPI / card / cash]. Cancel at least [number] hours before and [refund rule]. ' +
        'FAQ: [FAQ — the questions customers ask most, with your answers].',
      category: 'Policy',
    },
  ],
  hi: [
    {
      title: 'Meri business jankari',
      content:
        'Business naam: [BUSINESS NAME]. Business type: [BUSINESS TYPE — jaise restaurant, salon, clothing store, real estate, coaching]. ' +
        'Hum kya bechte hain: [PRODUCT/SERVICE list]. Hamara sheher / service area: [LOCATION]. Contact: [CONTACT INFORMATION].',
      category: 'Business Profile',
    },
    {
      title: 'Price aur packages',
      content:
        'Option 1: [PRODUCT/SERVICE] — [PRICE]. Option 2: [PRODUCT/SERVICE] — [PRICE]. ' +
        'Option 3: [PRODUCT/SERVICE] — [PRICE]. Order/booking confirm karne ke liye [amount ya %] advance lena padta hai.',
      category: 'Pricing',
    },
    {
      title: 'Current offers',
      content:
        'Chal rahe offers: [OFFER — jaise combo deals, seasonal discount]. Bulk/group discount: [OFFER]. ' +
        'Offer valid till: [DATE].',
      category: 'Offers',
    },
    {
      title: 'Timing aur availability',
      content:
        'Hum [din] khule rehte hain, [start time] se [end time] tak. Ek din me [number] booking/order le sakte hain. ' +
        'Sabse busy season [mahine] hai — pehle plan karna padta hai.',
      category: 'Timings',
    },
    {
      title: 'Location aur delivery information',
      content:
        'Hum [city] me hain. Service area: [areas / delivery radius]. ' +
        'Pickup ya visit: [address]. Delivery information: [DELIVERY INFORMATION — courier, din, fee, free-above].',
      category: 'Location',
    },
    {
      title: 'Kya included hai',
      content:
        'Included: [list]. Included nahi hai: [list]. Iska extra charge lagega: [list].',
      category: 'Inclusions',
    },
    {
      title: 'Payment, cancellation aur FAQ',
      content:
        'Payment: [UPI / card / cash]. [number] ghante pehle cancel karne par [refund rule]. ' +
        'FAQ: [FAQ — jo sawaal customers sabse zyada poochte hain, unke jawab].',
      category: 'Policy',
    },
  ],
};

/** The starter documents for the language the customer is reading. */
export function starterDocs(lang: Lang): StarterDoc[] {
  return STARTER_DOCS[lang] ?? STARTER_DOCS.en;
}

/**
 * Which starter documents are still missing.
 *
 * Matching is by *slot*, not by title, and that detail is the whole point:
 * the titles differ per language ("Prices and packages" vs "Price aur
 * packages"), so a title match would offer all five documents again the moment
 * a customer switched the interface language — dropping five duplicate facts
 * into a knowledge base the bot answers from. A slot is identified by the
 * category, which is the same string in both languages, and a title that
 * matches any language's version of a slot counts as that slot too, so a
 * customer who renamed a document before switching language is still covered.
 */
export function missingStarterDocs(
  lang: Lang,
  existing: readonly { title?: string | null; category?: string | null }[]
): StarterDoc[] {
  const allDocs = [...STARTER_DOCS.en, ...STARTER_DOCS.hi];
  const byCategory = new Map(allDocs.map((doc) => [doc.category.toLowerCase(), doc.category]));
  const byTitle = new Map(allDocs.map((doc) => [doc.title.trim().toLowerCase(), doc.category]));

  const present = new Set<string>();
  for (const item of existing) {
    const category = String(item?.category ?? '').trim().toLowerCase();
    const title = String(item?.title ?? '').trim().toLowerCase();
    const slot = byCategory.get(category) ?? byTitle.get(title);
    if (slot) present.add(slot);
  }

  return starterDocs(lang).filter((doc) => !present.has(doc.category));
}
