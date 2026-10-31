import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';
import type { Lang } from './i18n';

/**
 * Customer contact store — business name, contact person, WhatsApp number,
 * preferred language and the CONSENT record for onboarding/status messages.
 *
 * Why a separate store (not profileStore): the profile is the customer's
 * *public* identity (a username shown in lists and find-me prompts). The fields
 * here are *private ops* data — especially the WhatsApp number — so they live in
 * their own file and are only exposed masked to customers, raw to OPS only.
 *
 * Consent: stored with timestamp and source, per Feature 1 Step 4 / Feature 8.
 * An opt-out is recorded, never deleted — the customer's choice must survive.
 */

export interface ContactRecord {
  tenantId: string;
  /** Instagram Business Account username (real value, not guessed — set only after a successful Meta connection). */
  instagramUsername?: string;
  /** Instagram Business Account ID (real value from Meta Graph API, not guessed). */
  instagramAccountId?: string;
  /** Instagram connection status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | undefined. */
  instagramStatus?: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  /** Timestamp of the last successful Instagram connection. */
  instagramConnectedAt?: string;
  /** Business name (legacy/manual entry — replaced by Instagram section; kept for existing saved data). */
  businessName?: string;
  /** Mandatory — the person who owns this account. */
  contactPerson?: string;
  /** E.164 (+countrycode…). Never returned raw to a non-owner. Mandatory. */
  whatsappNumber?: string;
  /** Preferred communication language from the customer's own choice. */
  language?: Lang;
  email?: string;
  consent: {
    given: boolean;
    at: string | null;
    source: 'customer-self-service' | 'ops-manual';
  };
  optOut: { at: string | null; source: 'customer-self-service' | 'ops-manual' | 'provider-webhook' } | null;
  createdAt: string;
  updatedAt: string;
}

const CONTACT_FILE = path.join(DATA_DIR, 'contacts.json');

const records = new Map<string, ContactRecord>();
let loaded = false;
let fileOverride: string | null = null;

function fileName(): string {
  return fileOverride || CONTACT_FILE;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(fileName())) return;
    const parsed = JSON.parse(fs.readFileSync(fileName(), 'utf8'));
    for (const [tenantId, value] of Object.entries(parsed?.contacts ?? {})) {
      const rec = value as ContactRecord;
      if (!rec || typeof tenantId !== 'string') continue;
      records.set(tenantId, rec);
    }
    console.log(`[contacts] Loaded ${records.size} customer contact record(s) from ${fileName()}`);
  } catch (err) {
    console.error('[contacts] failed to load (starting fresh):', err);
  }
}

function persist(): void {
  try {
    const target = fileName();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data: Record<string, ContactRecord> = {};
    records.forEach((rec, tenantId) => { data[tenantId] = rec; });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, contacts: data }, null, 0), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[contacts] persist failed (state stays in memory):', err);
  }
}

// ── Phone normalisation ─────────────────────────────────────────────────────

export const DEFAULT_COUNTRY_CODE = '+91'; // Product's primary market (Razorpay billing).

export interface PhoneResult {
  /** E.164 string, or null when the input is not a plausible number. */
  e164: string | null;
  reason?: string;
}

/**
 * Normalise a customer-entered WhatsApp number.
 *
 * Accepted shapes: `+<8-15 digits>` (full international) and bare
 * `<8-13 digits>` — a 10-digit Indian mobile gets +91, a leading 91 with
 * 8-13 digits is treated as the country code. Anything else is rejected
 * with a reason; the caller decides what to tell the customer.
 */
export function normalizePhone(raw: unknown): PhoneResult {
  const text = String(raw ?? '').trim().replace(/[\s()-]/g, '');
  if (!text || text.length > 17) return { e164: null, reason: 'missing or too many characters' };

  if (text.startsWith('+')) {
    const digits = text.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return { e164: null, reason: 'after the + sign a phone number needs 8-15 digits' };
    return { e164: `+${digits}` };
  }

  if (!/^\d+$/.test(text)) return { e164: null, reason: 'use digits and an optional leading + only' };

  if (text.length === 10) return { e164: `${DEFAULT_COUNTRY_CODE}${text}` };
  if (text.length >= 11 && text.length <= 13 && text.startsWith('91')) {
    return { e164: `+${text}` };
  }
  if (text.length >= 8 && text.length <= 13) return { e164: `+${text}` };

  return { e164: null, reason: 'need the full number with country code (e.g. +91 98765 43210)' };
}

/** Masked, log-safe form: country code + last 4 digits only. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return `+${digits.slice(0, 2)}•••••${digits.slice(-4)}`;
}

// ── Validation ──────────────────────────────────────────────────────────────

const NAME_MAX = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanField(value: unknown, max = NAME_MAX): string | undefined {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.slice(0, max);
}

export function validateContactInput(input: {
  businessName?: unknown;
  contactPerson?: unknown;
  whatsappNumber?: unknown;
  language?: unknown;
  email?: unknown;
  consent?: unknown;
}): { ok: true; patch: Partial<ContactRecord> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const patch: Partial<ContactRecord> = {};

  // Business name is optional (replaced by Instagram section; kept for legacy saved data).
  const businessName = cleanField(input.businessName);
  if (businessName) patch.businessName = businessName;

  // contactPerson is MANDATORY.
  const contactPerson = cleanField(input.contactPerson, 100);
  if (!contactPerson) errors.push('Contact person name cannot be empty.');
  else patch.contactPerson = contactPerson;

  // whatsappNumber is MANDATORY.
  if (!input.whatsappNumber || !String(input.whatsappNumber ?? '').trim()) {
    errors.push('WhatsApp number cannot be empty.');
  } else {
    const phone = normalizePhone(input.whatsappNumber);
    if (!phone.e164) errors.push(phone.reason || 'WhatsApp number is invalid.');
    else patch.whatsappNumber = phone.e164;
  }

  if (input.language !== undefined) {
    const lang = String(input.language).trim().toLowerCase();
    if (lang && lang !== 'en' && lang !== 'hi') errors.push('Language must be en or hi.');
    else if (lang) patch.language = lang as Lang;
  }

  if (input.email !== undefined && String(input.email ?? '').trim()) {
    const email = cleanField(input.email, 120);
    if (!email || !EMAIL_RE.test(email)) errors.push('Email address is invalid.');
    else patch.email = email;
  }

  return errors.length ? { ok: false, errors } : { ok: true, patch };
}

// ── Read / write ────────────────────────────────────────────────────────────

export function getContact(tenantId: string): ContactRecord | null {
  load();
  return records.get(tenantId) || null;
}

/** A caller-provided change to a contact record. Consent carries its own type
 * instead of intersecting with Partial<ContactRecord> — callers pass the CHOICE
 * plus source; the timestamps are this store's responsibility. */
export interface ContactPatch
  extends Partial<Omit<ContactRecord, 'consent'>> {
  consent?: { given: boolean; source?: ContactRecord['consent']['source'] };
}

/**
 * Save-or-merge. Consent is only ever CHANGED, never silently lost: a missing
 * `consent` field leaves the existing record untouched.
 */
export function saveContact(tenantId: string, patch: ContactPatch): ContactRecord {
  load();
  const existing = records.get(tenantId);
  const now = new Date().toISOString();
  const previous: ContactRecord = existing || {
    tenantId,
    consent: { given: false, at: null, source: 'customer-self-service' },
    optOut: null,
    createdAt: now,
    updatedAt: now,
  };

  const next: ContactRecord = {
    ...previous,
    ...patch,
    tenantId,
    // Consent: an explicit input wins. The timestamp updates only when the
    // chosen value actually changes (re-saving the same consent is not an event).
    consent: patch.consent
      ? {
          given: Boolean(patch.consent.given),
          at: patch.consent.given ? (previous.consent.given === patch.consent.given ? previous.consent.at || now : now) : now,
          source: patch.consent.source || (existing ? previous.consent.source : 'customer-self-service'),
        }
      : previous.consent,
    optOut: existing?.optOut ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  records.set(tenantId, next);
  persist();
  return next;
}

export function optOut(tenantId: string, source: NonNullable<ContactRecord['optOut']>['source']): ContactRecord | null {
  load();
  const existing = records.get(tenantId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next: ContactRecord = { ...existing, optOut: { at: now, source }, updatedAt: now };
  records.set(tenantId, next);
  persist();
  return next;
}

export function hasWhatsAppConsent(tenantId: string): boolean {
  const rec = getContact(tenantId);
  return Boolean(rec?.consent.given && !rec?.optOut);
}

/** Test hook — repoint at a temp dir and clear memory. */
export function _resetForTests(dir?: string): void {
  loaded = false;
  records.clear();
  fileOverride = dir ? path.join(dir, 'contacts.json') : null;
}
