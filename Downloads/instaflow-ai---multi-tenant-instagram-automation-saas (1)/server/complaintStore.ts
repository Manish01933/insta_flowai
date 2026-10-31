import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Customer complaints captured from the public complaint form (`/complaint`).
 *
 * Why this exists: the public contact pages used to print the owner's personal
 * mobile number, which both exposed it and left no record of who complained
 * about what. The form now takes the customer's id, a mobile/WhatsApp number and
 * the problem, and the complaint is stored here *before* any WhatsApp delivery is
 * attempted — so a relay outage, a wrong key or a rate limit can never lose a
 * customer's message.
 *
 * Lives in DATA_DIR (a mounted volume in production), so a deploy never loses a
 * complaint a customer typed in.
 */

export interface Complaint {
  id: string;
  /** Whatever the customer identified themselves by — account id, email or handle. */
  accountId: string;
  /** Their mobile / WhatsApp number, as typed. */
  contact: string;
  problem: string;
  /** Where it came from page-wise, so future sources can share this store. */
  source: 'contact_form';
  status: 'new' | 'resolved';
  /** Whether the WhatsApp push reached the owner. */
  notified: boolean;
  /** Why it did not, when it did not. */
  notifyError?: string;
  createdAt: string;
  resolvedAt?: string;
}

const COMPLAINTS_FILE = path.join(DATA_DIR, 'complaints.json');

const MAX_COMPLAINTS = 1000;
const RETENTION_DAYS = 365;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_FIELD_CHARS = 1500;

const complaints = new Map<string, Complaint>();
let loaded = false;

/** Public-form input arrives from the open internet: keep only sane, short text. */
function cleanField(value: unknown, max = MAX_FIELD_CHARS): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export function loadComplaints() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(COMPLAINTS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(COMPLAINTS_FILE, 'utf8'));
    const data: Record<string, Complaint> = parsed?.complaints ?? parsed ?? {};

    const now = Date.now();
    let dropped = 0;
    for (const [id, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || !value.accountId || !value.problem) {
        dropped += 1;
        continue;
      }
      const created = Date.parse((value as Complaint).createdAt);
      if (Number.isFinite(created) && now - created > RETENTION_MS) {
        dropped += 1;
        continue;
      }
      complaints.set(id, { ...(value as Complaint), id, status: (value as Complaint).status || 'new' });
    }

    console.log(
      `[complaints] Loaded ${complaints.size} complaint(s) from ${COMPLAINTS_FILE}` +
        (dropped ? ` (dropped ${dropped} stale/invalid)` : '')
    );
  } catch (err) {
    console.error('[complaints] Failed to load complaints:', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, Complaint> = {};
    complaints.forEach((complaint, id) => {
      data[id] = complaint;
    });
    const tmpFile = `${COMPLAINTS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, complaints: data }), 'utf8');
    fs.renameSync(tmpFile, COMPLAINTS_FILE);
  } catch (err) {
    console.error('[complaints] Failed to persist complaints:', err);
  }
}

function prune(now: number = Date.now()) {
  complaints.forEach((complaint, id) => {
    const created = Date.parse(complaint.createdAt);
    if (Number.isFinite(created) && now - created > RETENTION_MS) complaints.delete(id);
  });

  if (complaints.size > MAX_COMPLAINTS) {
    const oldestFirst = Array.from(complaints.values()).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    for (const complaint of oldestFirst.slice(0, complaints.size - MAX_COMPLAINTS)) {
      complaints.delete(complaint.id);
    }
  }
}

export interface NewComplaintInput {
  accountId: unknown;
  contact: unknown;
  problem: unknown;
}

/**
 * Validate and store a complaint. Returns either the saved record or the reason
 * it was rejected, so the route can answer the form with something the customer
 * can act on.
 */
export function addComplaint(input: NewComplaintInput): { ok: true; complaint: Complaint } | { ok: false; error: string } {
  const accountId = cleanField(input.accountId, 160);
  const contact = cleanField(input.contact, 40);
  const problem = cleanField(input.problem, MAX_FIELD_CHARS);

  if (accountId.length < 3) {
    return { ok: false, error: 'Please enter the id or email address you signed up with.' };
  }

  // Digits only, so "+91 98765 43210", "09876543210" and "9876543210" all pass.
  const digits = contact.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: 'Please enter a valid mobile or WhatsApp number with country code.' };
  }

  if (problem.length < 10) {
    return { ok: false, error: 'Please describe the problem in a little more detail.' };
  }

  loadComplaints();
  const complaint: Complaint = {
    id: crypto.randomBytes(8).toString('hex'),
    accountId,
    contact,
    problem,
    source: 'contact_form',
    status: 'new',
    notified: false,
    createdAt: new Date().toISOString(),
  };

  complaints.set(complaint.id, complaint);
  prune();
  persist();
  return { ok: true, complaint };
}

/** Record the outcome of the WhatsApp push, so an outage is visible later. */
export function markComplaintNotified(id: string, result: { ok: true } | { ok: false; error: string }): Complaint | null {
  loadComplaints();
  const complaint = complaints.get(id);
  if (!complaint) return null;
  complaint.notified = result.ok;
  if (result.ok) {
    delete complaint.notifyError;
  } else {
    complaint.notifyError = result.error.slice(0, 300);
  }
  persist();
  return complaint;
}

/** Complaints for the owner view, newest first. */
export function getComplaints(): Complaint[] {
  loadComplaints();
  return Array.from(complaints.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

/** Mark a complaint handled. An unknown id is reported, not created. */
export function resolveComplaint(id: string): Complaint | null {
  loadComplaints();
  const complaint = complaints.get(id);
  if (!complaint) return null;
  complaint.status = 'resolved';
  complaint.resolvedAt = new Date().toISOString();
  persist();
  return complaint;
}

export function getComplaintStats() {
  loadComplaints();
  let fresh = 0;
  let undelivered = 0;
  complaints.forEach((complaint) => {
    if (complaint.status === 'new') fresh += 1;
    if (!complaint.notified) undelivered += 1;
  });
  return {
    total: complaints.size,
    open: fresh,
    undelivered,
    file: COMPLAINTS_FILE,
  };
}

/**
 * NOTE: complaints are deliberately NOT wired into the Meta data-deletion
 * callback. That flow is keyed by `tenantId`; a complaint is keyed by whatever
 * an anonymous visitor typed, so there is no reliable join and pretending there
 * is one would be worse than the gap. Removing a complaint has to be a manual
 * step (resolve it, then drop the record from `complaints.json`), and that
 * limitation is recorded in `docs/KNOWN_ISSUES.md`.
 *
 * Retention (365 days) is therefore the only automatic control applied here.
 */
