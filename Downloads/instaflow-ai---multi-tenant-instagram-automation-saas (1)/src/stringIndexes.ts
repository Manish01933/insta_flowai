/**
 * Compile-time intersection helpers for strings the dashboard renders by key.
 *
 * These are used so the inline app shell (HTML rendering before the React
 * bundle is ready) can look up things like dashboard label lists and
 * onboarding step metadata without duplicating literal strings.
 */

// Nav label set used by the shell `<script>` to render the sidebar tabs
// in English before the React bundle activates.
export const NAV_LABELS_EN = [
  'Connection Center',
  'Add Information for Your Business',
  'AI Sales Agent Setup',
  'Knowledge Base & AI Persona',
  'Customer Booking Page',
  'Account Analytics',
] as const;

// Onboarding step v5 metadata: order, short label, one-line plain-English
// description, and the currently-configured onboarding path anchor tab.
export const ONBOARDING_STEPS_V5 = [
  {
    key: 'connections',
    title: 'Connection Center',
    short: 'Connect your Instagram account',
    desc: 'Link the business Instagram account the AI bot will reply from. Only an account you own can be connected.',
    pathAlt: '',
  },
  {
    key: 'business',
    title: 'Add Information for Your Business',
    short: 'Save your details + WhatsApp consent',
    desc: 'Add your business details, FAQs, products and policies. The bot answers from this information.',
    pathAlt: '',
  },
  {
    key: 'business',
    title: 'Add Information for Your Business',
    short: 'Save your details + WhatsApp consent',
    desc: 'Enter the business name, contact person, WhatsApp number and communication language. The bot uses these to introduce the business in replies.',
    pathAlt: '',
  },
  {
    key: 'simulator',
    title: 'AI Sales Agent Setup',
    short: 'Test the agent before customers see it',
    desc: 'Open the sandbox and type a few real customer questions. What the agent says here is what it will say in live DMs.',
    pathAlt: '',
  },
  {
    key: 'knowledge',
    title: 'Knowledge Base & AI Persona',
    short: 'Fill the Knowledge Base so the bot can answer',
    desc: 'Open the Knowledge Base tab and add your business information, FAQs, products, pricing and policies. The bot answers real DMs from exactly what you write here — an empty knowledge base means it has nothing to say.',
    pathAlt: '',
  },
  {
    key: 'booking',
    title: 'Customer Booking Page',
    short: 'Share a booking link with interested customers',
    desc: 'The link routes interested contacts into your dashboard as leads. It is the page the bot hands to customers when they are ready to book.',
    pathAlt: '',
  },
  {
    key: 'analytics',
    title: 'Account Analytics',
    short: 'See performance, credits and plan status',
    shortAlt: 'View results and plan',
    desc: 'Live counters for DMs handled, resolution rate, AI credits used, and the active plan or trial. This is where you watch the results show up.',
    pathAlt: '',
  },
] as const;

export type OnboardingStepV5Key = typeof ONBOARDING_STEPS_V5[number]['key'];
