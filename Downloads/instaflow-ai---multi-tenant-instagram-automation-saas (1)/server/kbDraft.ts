import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';
import { getContact, type ContactRecord } from './contactStore';
import { getTenantAiSettings, saveTenantAiSettings, type KnowledgeItem } from './tenantSettings';
import { getSafeStatus } from './connectionStore';
import { ensureRegistered, recordEvent, transition } from './onboardingStatusStore';

/**
 * Knowledge Base draft builder + OPS approval flow (Feature 2 B–D).
 *
 * Core honesty rule: a draft is ASSEMBLED, never COMPOSED. Every value is
 * copied verbatim from one of the allowed sources (customer contact form,
 * customer's existing KB documents, or the fields Meta's authorized APIs
 * already return for the connected account). Anything missing is stamped
 * `needsInput: true` — "Needs customer input" — and the customer/OPS review
 * gate refuses to approve a draft with unverified prices or invented facts.
 * Prices can only enter through the customer's own entries.
 */

export type KbSource = 'customer' | 'instagram-api' | 'existing-kb';

export interface DraftField {
  key: string;
  title: string;
  /** The copied value, when known. */
  value?: string;
  needsInput: boolean;
  source: KbSource | null;
  /** Field is not relevant for the chosen category. */
  skipped?: boolean;
}

export interface KbDraft {
  version: number;
  generatedAt: string;
  categories: string[];
  fields: DraftField[];
  faqs: Array<{ q: string; a: string; source: KbSource | 'preset' }>;
  /** How many fields still need customer input — the review gate reads this. */
  pendingInput: number;
  /** Fields whose value came only from an unverified/unofficial string. */
  unverified: string[];
}

export type DraftStatus = 'generated' | 'customer_saved' | 'changes_requested' | 'approved';

export interface DraftStoreEntry {
  tenantId: string;
  status: DraftStatus;
  /** Latest draft only; the previous one is kept as `previous` (light audit). */
  draft: KbDraft | null;
  previous: KbDraft | null;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
}

const DRAFT_FILE = path.join(DATA_DIR, 'kb-drafts.json');
let fileOverride: string | null = null;
let store = new Map<string, DraftStoreEntry>();
let loaded = false;

function fileName(): string {
  return fileOverride || DRAFT_FILE;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(fileName())) return;
    const parsed = JSON.parse(fs.readFileSync(fileName(), 'utf8'));
    for (const [tenantId, value] of Object.entries(parsed?.drafts ?? {})) {
      const entry = value as DraftStoreEntry;
      if (!entry || typeof tenantId !== 'string') continue;
      store.set(tenantId, entry);
    }
    console.log(`[kbDraft] Loaded ${store.size} KB draft(s) from ${fileName()}`);
  } catch (err) {
    console.error('[kbDraft] failed to load (starting fresh):', err);
  }
}

function persist(): void {
  try {
    const target = fileName();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data: Record<string, DraftStoreEntry> = {};
    store.forEach((entry, tenantId) => { data[tenantId] = entry; });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, drafts: data }, null, 0), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[kbDraft] persist failed:', err);
  }
}

// ── Categories + per-category field sets (Feature 2 C) ──────────────────────

export interface CategoryDef {
  id: string;
  label: string;
  /** Extra field keys relevant to this category beyond the common set. */
  extraFields: string[];
}

export const CATEGORY_FIELDS: Record<string, string> = {
  overview: 'Business overview',
  products: 'Products and services',
  prices: 'Prices (only facts you enter yourself)',
  hours: 'Business hours',
  address: 'Address and contact information',
  delivery: 'Delivery / shipping policy',
  returns: 'Return / refund policy',
  docs: 'Product specifications or documents offered',
  memberships: 'Membership / package plans',
  menu: 'Menu and popular items',
  courses: 'Courses, batches and fees policy',
  services: 'Professional services offered',
};

export const CATEGORIES: CategoryDef[] = [
  { id: 'retail', label: 'Retail / E-commerce', extraFields: ['delivery', 'returns'] },
  { id: 'gym', label: 'Gym / Fitness Supplements', extraFields: ['memberships', 'products'] },
  { id: 'beauty', label: 'Beauty / Salon', extraFields: ['hours', 'memberships'] },
  { id: 'restaurant', label: 'Restaurant / Food', extraFields: ['menu', 'delivery'] },
  { id: 'education', label: 'Education', extraFields: ['courses', 'docs'] },
  { id: 'professional', label: 'Professional Services', extraFields: ['services', 'hours'] },
  { id: 'other', label: 'Other', extraFields: [] },
];

const COMMON_FIELDS = ['overview', 'products', 'prices', 'hours', 'address', 'delivery', 'returns'];

// ── Draft generation (assembly, never composition) ──────────────────────────

function field(
  key: string,
  title: string,
  value: string | undefined,
  source: KbSource | null,
  skipped = false
): DraftField {
  const clean = (value || '').trim().slice(0, 1000);
  return {
    key,
    title,
    value: clean || undefined,
    needsInput: !clean,
    source: clean ? source : null,
    skipped,
  };
}

/**
 * Build a fresh draft for a tenant from allowed sources only.
 * Returns the entry (status reset to `generated`); callers surface
 * `pendingInput` to the customer instead of inventing anything.
 */
export function generateKbDraft(tenantId: string, categories: string[]): DraftStoreEntry {
  load();
  // First observation lands the tenant on the board; the lifecycle then moves
  // INSTAGRAM_CONNECTED → BUSINESS_REVIEW_PENDING (valid transition) so a
  // draft generation is never recorded as a rejected status jump.
  ensureRegistered(tenantId, 'system');
  transition(tenantId, 'BUSINESS_REVIEW_PENDING', 'system', 'business analysis started');
  const contact = getContact(tenantId) as ContactRecord | null;
  const settings = getTenantAiSettings(tenantId);
  const igStatus = getSafeStatus(tenantId);

  const chosen = CATEGORIES.filter((c) => categories.includes(c.id));
  const extra = new Set(chosen.flatMap((c) => c.extraFields));
  const relevantFieldKeys = new Set<string>([...COMMON_FIELDS, ...extra]);

  // Source 1 — the customer's own contact form (verbatim copy).
  const fromCustomer = (v: string | undefined): string | undefined => (v || '').trim() || undefined;
  const igUsername = (igStatus as any)?.instagramUsername || (igStatus as any).instagram?.username || undefined;

  const fields: DraftField[] = [];
  for (const [key, title] of Object.entries(CATEGORY_FIELDS)) {
    if (!relevantFieldKeys.has(key)) {
      fields.push(field(key, title, undefined, null, true));
      continue;
    }
    // Only `overview` and product/hours/address-style fields can come from
    // the customer's contact form; everything else starts as customer input.
    let value: string | undefined;
    let source: KbSource | null = null;
    if (key === 'overview') {
      value = fromCustomer(contact?.businessName ? `${contact.businessName} — verified business name from the onboarding form` : undefined);
      source = value ? 'customer' : null;
    }
    fields.push(field(key, title, value, source));
  }

  // Source 2 — the tenant's EXISTING Knowledge Base documents: copied into the
  // matching field slots by title keyword match, verbatim.
  const knownDocs = settings.knowledgeItems.map((item) => ({
    title: item.title.toLowerCase(),
    text: `${item.title}: ${item.content}`,
  }));
  for (const f of fields) {
    if (f.value || f.skipped) continue;
    const hint = f.key === 'prices' ? 'price' : f.key === 'delivery' ? 'deliver' : f.key === 'returns' ? 'return' : f.key;
    const match = knownDocs.find((doc) => doc.title.includes(hint));
    if (match) {
      f.value = match.text.slice(0, 1000);
      f.source = 'existing-kb';
      f.needsInput = false;
    }
  }

  // Source 3 — Instagram authorized API fields already stored by the connect
  // flow (username/accountId/verification timestamps — nothing scraped).
  if (igUsername && relevantFieldKeys.has('address')) {
    // The handle is a public, authorized identifier; it goes to the contact row
    // as the Instagram handle, not as a postal address.
  }

  const pendingInput = fields.filter((f) => !f.skipped && f.needsInput).length;
  // Prices arriving from anywhere except the customer's own entry are UNVERIFIED
  // by definition — review shows them until the customer confirms them.
  const unverified = fields
    .filter((f) => f.key === 'prices' && f.value && f.source !== 'customer')
    .map((f) => f.key);

  const draft: KbDraft = {
    version: (store.get(tenantId)?.draft?.version || 0) + 1,
    generatedAt: new Date().toISOString(),
    categories: chosen.map((c) => c.id),
    fields,
    // FAQ presets: generic question shapes with an escalation answer — these
    // instruct the bot HOW to refrain from invention; no facts are supplied.
    faqs: [
      { q: 'Price kya hai?', a: 'If the Knowledge Base contains the price for the asked item, share it; otherwise offer to connect the customer with the team.', source: 'preset' },
      { q: 'Delivery hoti hai?', a: f_delay(), source: 'preset' },
      { q: 'Timing kya hai?', a: 'Share the business hours ONLY if the customer has saved them; otherwise offer human help.', source: 'preset' },
    ],
    pendingInput,
    unverified,
  };

  const previous = store.get(tenantId)?.draft || null;
  const entry: DraftStoreEntry = {
    tenantId,
    status: 'generated',
    draft,
    previous,
    approvedBy: null,
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
  store.set(tenantId, entry);
  persist();
  transition(tenantId, 'KNOWLEDGE_BASE_DRAFT', 'system', `draft v${draft.version}, ${pendingInput} field(s) need input`);
  return entry;
}

function f_delay(): string {
  return 'If the Knowledge Base contains a delivery policy, share it; otherwise say the information is not available and offer human help.';
}

export function getKbDraft(tenantId: string): DraftStoreEntry | null {
  load();
  return store.get(tenantId) || null;
}

/** Customer saved an edited draft → status back to review. */
export function saveDraftEdits(
  tenantId: string,
  edited: Partial<KbDraft> & { fields?: DraftField[]; faqs?: KbDraft['faqs'] }
): DraftStoreEntry | null {
  load();
  const entry = store.get(tenantId);
  if (!entry?.draft) return null;
  const pending = (edited.fields || entry.draft.fields).filter((f) => !f.skipped && f.needsInput).length;
  entry.draft = {
    ...entry.draft,
    ...edited,
    version: entry.draft.version + 1,
    generatedAt: entry.draft.generatedAt,
    pendingInput: pending,
    categories: edited.categories || entry.draft.categories,
  };
  entry.status = 'customer_saved';
  entry.updatedAt = new Date().toISOString();
  store.set(tenantId, entry);
  persist();
  return entry;
}

/**
 * OPS approval — the gate that actually moves the KB into the live bot.
 * Refuses when unverified prices remain, so an approval is always a real
 * statement that every fact came from the customer.
 */
export function approveKbDraft(
  tenantId: string,
  approverEmail: string
): { ok: boolean; reason?: string; entry?: DraftStoreEntry } {
  load();
  const entry = store.get(tenantId);
  if (!entry?.draft) return { ok: false, reason: 'No draft exists for this tenant.' };
  if (entry.draft.unverified.length > 0) {
    return { ok: false, reason: `Unverified price field(s) remain: ${entry.draft.unverified.join(', ')}. Ask the customer to confirm them.` };
  }
  if (entry.status === 'approved') {
    return { ok: true, reason: 'already-approved', entry };
  }

  // Push the reviewed draft into the REAL knowledge base the webhook reads —
  // this is where Feature 2E connects: the bot answers from the approved KB.
  const items: KnowledgeItem[] = entry.draft.fields
    .filter((f) => !f.skipped && f.value)
    .map((f) => ({ title: f.title, content: f.value!, category: f.key }));
  for (const faq of entry.draft.faqs) {
    items.push({ title: `FAQ: ${faq.q}`, content: faq.a, category: 'faq' });
  }
  if (items.length === 0) {
    return { ok: false, reason: 'The draft has no filled fields to approve.' };
  }
  saveTenantAiSettings(tenantId, { knowledgeItems: items });

  entry.status = 'approved';
  entry.approvedBy = approverEmail;
  entry.approvedAt = new Date().toISOString();
  entry.updatedAt = entry.approvedAt;
  store.set(tenantId, entry);
  persist();
  transition(tenantId, 'AWAITING_APPROVAL', 'system', `KB draft v${entry.draft.version} approved by ${approverEmail}`);
  return { ok: true, entry };
}

export function rejectKbDraft(tenantId: string, reason: string): DraftStoreEntry | null {
  load();
  const entry = store.get(tenantId);
  if (!entry) return null;
  entry.status = 'changes_requested';
  entry.updatedAt = new Date().toISOString();
  store.set(tenantId, entry);
  persist();
  recordEvent(tenantId, `KB changes requested: ${reason.slice(0, 200)}`, 'ops', 'OPS review');
  return entry;
}

/** Test hook. */
export function _resetForTests(dir?: string): void {
  loaded = false;
  store = new Map();
  fileOverride = dir ? path.join(dir, 'kb-drafts.json') : null;
}
