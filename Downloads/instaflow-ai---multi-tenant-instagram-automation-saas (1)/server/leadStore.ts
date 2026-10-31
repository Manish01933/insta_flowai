import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Customer leads captured from the public booking page (`/book/<username>`).
 *
 * Why this exists: an Instagram DM bot can only reply inside Meta's 24-hour
 * messaging window, and it must never take payment details in chat. So the sale
 * has to leave the DM at some point — the booking page is that handover, and
 * this is where what the customer typed lands.
 *
 * Lives in DATA_DIR (a mounted volume in production), so a deploy never loses a
 * lead that a customer typed in.
 */

export interface Lead {
  id: string;
  tenantId: string;
  instagramUsername?: string;
  name: string;
  whatsapp: string;
  email?: string;
  travelDates?: string;
  travellers?: string;
  message?: string;
  /** Where it came from, so future sources can share the store. */
  source: 'booking_page';
  status: 'new' | 'contacted';
  createdAt: string;
  /** Set when an operator marks it handled. */
  handledAt?: string;
}

const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

const MAX_LEADS = 2000;
const RETENTION_DAYS = 180;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_FIELD_CHARS = 500;

const leads = new Map<string, Lead>();
let loaded = false;

/** Public-form input arrives from the open internet: keep only sane, short text. */
function cleanField(value: unknown, max = MAX_FIELD_CHARS): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function loadLeads() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(LEADS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    const data: Record<string, Lead> = parsed?.leads ?? parsed ?? {};

    const now = Date.now();
    let dropped = 0;
    for (const [id, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || !value.name || !value.whatsapp) {
        dropped += 1;
        continue;
      }
      const created = Date.parse((value as Lead).createdAt);
      if (Number.isFinite(created) && now - created > RETENTION_MS) {
        dropped += 1;
        continue;
      }
      leads.set(id, { ...(value as Lead), id, status: (value as Lead).status || 'new' });
    }

    console.log(
      `[leads] Loaded ${leads.size} lead(s) from ${LEADS_FILE}` + (dropped ? ` (dropped ${dropped} stale/invalid)` : '')
    );
  } catch (err) {
    console.error('[leads] Failed to load leads:', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, Lead> = {};
    leads.forEach((lead, id) => {
      data[id] = lead;
    });
    const tmpFile = `${LEADS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, leads: data }), 'utf8');
    fs.renameSync(tmpFile, LEADS_FILE);
  } catch (err) {
    console.error('[leads] Failed to persist leads:', err);
  }
}

function prune(now: number = Date.now()) {
  leads.forEach((lead, id) => {
    const created = Date.parse(lead.createdAt);
    if (Number.isFinite(created) && now - created > RETENTION_MS) leads.delete(id);
  });

  if (leads.size > MAX_LEADS) {
    const oldestFirst = Array.from(leads.values()).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    for (const lead of oldestFirst.slice(0, leads.size - MAX_LEADS)) {
      leads.delete(lead.id);
    }
  }
}

export interface NewLeadInput {
  tenantId: string;
  instagramUsername?: string;
  name: unknown;
  whatsapp: unknown;
  email?: unknown;
  travelDates?: unknown;
  travellers?: unknown;
  message?: unknown;
}

/**
 * Validate and store a lead. Returns either the saved lead or the reason it was
 * rejected, so the route can answer the form with something the customer can act
 * on.
 */
export function addLead(input: NewLeadInput): { ok: true; lead: Lead } | { ok: false; error: string } {
  const name = cleanField(input.name, 120);
  const whatsapp = cleanField(input.whatsapp, 40);

  if (name.length < 2) return { ok: false, error: 'Please enter your name.' };

  // Digits only, so "+91 98765 43210", "09876543210" and "9876543210" all pass.
  const digits = whatsapp.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: 'Please enter a valid WhatsApp number with country code.' };
  }

  loadLeads();
  const lead: Lead = {
    id: crypto.randomBytes(8).toString('hex'),
    tenantId: input.tenantId,
    instagramUsername: input.instagramUsername,
    name,
    whatsapp,
    email: cleanField(input.email, 160) || undefined,
    travelDates: cleanField(input.travelDates, 120) || undefined,
    travellers: cleanField(input.travellers, 40) || undefined,
    message: cleanField(input.message, 800) || undefined,
    source: 'booking_page',
    status: 'new',
    createdAt: new Date().toISOString(),
  };

  leads.set(lead.id, lead);
  prune();
  persist();
  return { ok: true, lead };
}

/**
 * Leads for a tenant, newest first.
 *
 * Strictly per tenant: the demo tenant used to be handed every tenant's leads
 * (so the demo inbox looked alive), which is the same as publishing customers'
 * customers' phone numbers to anyone who typed `default_tenant`.
 */
export function getLeads(tenantId: string): Lead[] {
  loadLeads();
  const result: Lead[] = [];
  leads.forEach((lead) => {
    if (lead.tenantId === tenantId) result.push(lead);
  });
  return result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Mark a lead handled. When `tenantId` is given (every real caller), a lead that
 * belongs to somebody else is left untouched instead of being found — an id
 * alone is not permission.
 */
export function markLeadHandled(id: string, tenantId?: string): Lead | null {
  loadLeads();
  const lead = leads.get(id);
  if (!lead) return null;
  if (tenantId && lead.tenantId !== tenantId) return null;
  lead.status = 'contacted';
  lead.handledAt = new Date().toISOString();
  persist();
  return lead;
}

/** Leads grouped by tenant, for the owner-only overview. */
export function getLeadCountsByTenant(): Record<string, { total: number; fresh: number; latestAt: string | null }> {
  loadLeads();
  const counts: Record<string, { total: number; fresh: number; latestAt: string | null }> = {};
  leads.forEach((lead) => {
    const entry = (counts[lead.tenantId] ||= { total: 0, fresh: 0, latestAt: null });
    entry.total += 1;
    if (lead.status === 'new') entry.fresh += 1;
    if (!entry.latestAt || Date.parse(lead.createdAt) > Date.parse(entry.latestAt)) entry.latestAt = lead.createdAt;
  });
  return counts;
}

/**
 * Meta / GDPR data deletion. Leads are the most obviously personal records we
 * hold (name + WhatsApp number), so they are deleted by tenant on request.
 */
export function deleteLeadsForTenant(tenantId: string): number {
  loadLeads();
  let removed = 0;
  leads.forEach((lead, id) => {
    if (lead.tenantId === tenantId) {
      leads.delete(id);
      removed += 1;
    }
  });
  if (removed > 0) persist();
  return removed;
}

export function getLeadStats() {
  loadLeads();
  let fresh = 0;
  leads.forEach((lead) => {
    if (lead.status === 'new') fresh += 1;
  });
  return {
    totalLeads: leads.size,
    newLeads: fresh,
    file: LEADS_FILE,
  };
}
