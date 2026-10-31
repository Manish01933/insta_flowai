import { apiFetch } from './api';

/**
 * The getting-started path, as the server sees it.
 *
 * The statuses are computed server-side (see `server/onboardingStore.ts`)
 * because the facts behind them — a live subscription, a connected Instagram
 * account, saved knowledge documents, a verified token — live there. The client
 * only renders them, so the guide can never drift from reality and a step turns
 * red again the moment the thing behind it breaks.
 */

export type OnboardingStepId = 'account' | 'instagram' | 'knowledge' | 'simulator' | 'verify';

/** Order the steps are shown in. Mirrors `ONBOARDING_STEPS` on the server. */
export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  'account',
  'instagram',
  'knowledge',
  'simulator',
  'verify',
];

export interface OnboardingSignals {
  plan: {
    allowed: boolean;
    reason: string | null;
    needsPlan: boolean;
    planId: string | null;
    planName: string | null;
    status: string | null;
    currentPeriodEnd: string | null;
    trialDays: number;
    isNew: boolean;
  };
  instagram: {
    connected: boolean;
    status: string;
    username: string | null;
    accountId: string | null;
    lastVerifiedAt: string | null;
    lastError: string | null;
    needsReconnect: boolean;
  };
  knowledge: { documents: number; customised: boolean };
  simulator: { testedAt: string | null };
  guide: { hiddenAt: string | null };
}

export interface OnboardingSnapshot {
  steps: { id: OnboardingStepId; done: boolean }[];
  progress: { done: number; total: number; current: OnboardingStepId | null; allDone: boolean };
  signals: OnboardingSignals;
}

export async function fetchOnboarding(tenantId: string): Promise<OnboardingSnapshot | null> {
  const res = await apiFetch('/api/onboarding', { headers: { 'x-tenant-id': tenantId } });
  const data = await res.json();
  return data?.success ? (data as OnboardingSnapshot) : null;
}

// ── Self-service onboarding wizard (Feature 1) ──────────────────────────
// Every call is tenant-scoped by apiFetch's verified token header; the server
// recomputes the truth (activation, connection, statuses) so the UI can only
// show what really happened.

export interface ContactView {
  /** Instagram Business Account username (real value from Meta, set after successful connect). */
  instagramUsername?: string | null;
  /** Instagram Business Account ID (real value from Meta Graph API). */
  instagramAccountId?: string | null;
  /** Instagram connection status. */
  instagramStatus?: string | null;
  /** Timestamp of the last successful Instagram connection. */
  instagramConnectedAt?: string | null;
  /** Business name (legacy/manual entry — kept for existing saved data). */
  businessName?: string;
  contactPerson?: string;
  /** MASKED (country code + last 4) — the raw number never leaves the server. */
  whatsappNumber?: string;
  language?: 'en' | 'hi';
  email?: string;
  consent: { given: boolean; at: string | null; source: string };
  optOut: { at: string | null } | null;
}

export async function fetchOnboardingContact(): Promise<ContactView | null> {
  const res = await apiFetch('/api/onboarding/contact');
  const data = await res.json().catch(() => null);
  return res.ok && data?.success ? (data.contact as ContactView | null) : null;
}

export class ContactValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

export async function saveOnboardingContact(input: {
  /** Optional — replaced by Instagram section, kept for legacy saved data. */
  businessName?: string;
  contactPerson: string;
  whatsappNumber: string;
  /** Instagram account details from Meta (set after successful connect). */
  instagramUsername?: string | null;
  instagramAccountId?: string | null;
  instagramStatus?: string | null;
  instagramConnectedAt?: string | null;
  language: 'en' | 'hi';
  email?: string;
  consent: boolean;
}): Promise<ContactView> {
  const res = await apiFetch('/api/onboarding/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    if (Array.isArray(data?.errors)) throw new ContactValidationError(data.errors as string[]);
    throw new Error(data?.error || 'Could not save the details.');
  }
  return data.contact as ContactView;
}

export async function optOutOnboardingWhatsApp(): Promise<void> {
  const res = await apiFetch('/api/onboarding/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optOut: true }),
  });
  if (!res.ok) throw new Error('Could not record the opt-out. Try again.');
}

/** Free-plan activation: server-verified entitlement, no payment involved. */
export async function activateOnboardingFreePlan(): Promise<{ ok: boolean; alreadyActive: boolean; message: string }> {
  const res = await apiFetch('/api/plan/activate', { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Free plan activation failed.');
  return data;
}

// ── Lifecycle view (server-computed statuses, Feature 4) ─────────────────

export interface LifecycleView {
  status: string;
  statusChangedAt: string;
  approved: boolean;
  connected: boolean;
  instagram: { username: string | null; accountIdMasked: string | null } | null;
  connectionMessageKey: string | null;
  timeline: Array<{ at: string; event: string; status: string | null; actor: string }>; 
  kb: { status: string; version: number; pendingInput: number } | null;
}

export async function fetchLifecycleStatus(): Promise<LifecycleView | null> {
  const res = await apiFetch('/api/onboarding/status');
  const data = await res.json().catch(() => null);
  return res.ok && data?.success ? (data as LifecycleView) : null;
}

// ── KB draft builder (Feature 2) ─────────────────────────────────────────

export interface DraftFieldView {
  key: string;
  title: string;
  value?: string;
  needsInput: boolean;
  source: string | null;
  skipped?: boolean;
}

export interface KbDraftView {
  version: number;
  generatedAt: string;
  categories: string[];
  fields: DraftFieldView[];
  faqs: Array<{ q: string; a: string; source: string }>;
  pendingInput: number;
  unverified: string[];
}

export async function generateKbDraft(categories: string[]): Promise<KbDraftView & { status: string; note: string }> {
  const res = await apiFetch('/api/onboarding/kb-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Draft generation failed.');
  return data;
}

export async function saveKbDraftEdits(
  fields: DraftFieldView[],
  faqs: KbDraftView['faqs']
): Promise<KbDraftView & { status: string }> {
  const res = await apiFetch('/api/onboarding/kb-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', fields, faqs }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Draft could not be saved.');
  return data;
}

/** Remember the customer's hide/show choice on the server, not in one browser. */
export async function persistGuideHidden(tenantId: string, hidden: boolean): Promise<void> {
  try {
    await apiFetch('/api/onboarding/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ hidden }),
    });
  } catch {
    // Cosmetic preference: a failed save must never surface as an error.
  }
}

export interface GuideTurn {
  sender: 'you' | 'guide';
  text: string;
}

export interface GuideAnswer {
  reply: string;
  currentStep: OnboardingStepId | null;
}

/**
 * Ask the in-portal assistant. It is a separate endpoint from the customer's own
 * bot (`/api/simulate-dm`): this one is the platform explaining itself, funded
 * by us, so a confused customer never spends the AI quota they paid for.
 */
export async function askGuide(
  tenantId: string,
  message: string,
  history: GuideTurn[]
): Promise<GuideAnswer> {
  const res = await apiFetch('/api/support/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({ message, history: history.slice(-6) }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'The assistant could not answer right now.');
  }

  return { reply: String(data.reply || ''), currentStep: data.currentStep ?? null };
}
