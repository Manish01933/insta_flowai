import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * "Please add my Instagram as a Tester" requests.
 *
 * Why this exists: Meta's access gate makes a tester invite the only way a new
 * customer can connect while Tech Provider / Access Verification is pending — so
 * every new account needs the owner to type their Instagram handle into the Meta
 * dashboard. Until now the only source of that handle was the owner asking over
 * WhatsApp, because a *failed* OAuth never reaches the account-discovery step, so
 * nothing on the server ever learns which handle was refused. The Ops row for
 * such a tenant literally read "no handle".
 *
 * So the customer types it themselves, once, on the blocked-connect screen, and
 * the owner gets a queue instead of a conversation. One row per tenant: a repeat
 * submission is the customer correcting a typo, not a second request.
 */

export type TesterRequestStatus =
  | 'REQUESTED'
  | 'NEEDS_IDENTITY_CONFIRMATION'
  | 'READY_TO_INVITE'
  | 'INVITATION_SENT'
  | 'ACCEPTANCE_PENDING'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED';

export interface TesterRequestAuditEntry {
  action: string;
  by: string;
  at: string;
  detail?: string;
}

export interface TesterRequest {
  tenantId: string;
  /** Normalised Instagram handle, no leading @. */
  username: string;
  status: TesterRequestStatus;
  requestedAt: string;
  updatedAt: string;
  /** Optional line the owner leaves themselves ("added, waiting for accept"). */
  note?: string;
  /** The verified invitation destination URL, set when INVITATION_SENT. */
  invitationUrl?: string;
  /** The Meta app id this invitation must be accepted on. */
  metaAppId?: string;
  /** Timestamp the invitation was marked sent. */
  invitedAt?: string;
  /** Timestamp acceptance was recorded. */
  acceptedAt?: string;
  /**
   * Who recorded the acceptance. Meta exposes no tester-acceptance API or
   * webhook today, so this is evidence of a human confirmation — not of Meta's
   * own verdict — and the UI labels it as such.
   */
  acceptedBy?: 'owner' | 'customer';
  /** True only if a reliable Meta signal confirmed it. Nothing sets this today. */
  acceptanceVerified?: boolean;
  /** The owner's recorded Meta-dashboard step: "I added this handle as a tester". */
  accountAddedAt?: string;
  accountAddedBy?: string;
  /** Result of the customer notification attempt for the current invitation. */
  notify?: TesterInvitationNotification;
  /** Immutable audit trail of admin actions on this request. */
  auditLog?: TesterRequestAuditEntry[];
}

export interface TesterInvitationNotification {
  /** Outbox status (queued / provider-unconfigured / blocked-consent / …). */
  status: string;
  at: string;
  /** Why automated delivery did not happen, when it did not. */
  reason?: string;
  /** Masked destination — the raw number is never stored on the request row. */
  toMasked?: string | null;
}

/**
 * Allowed status transitions. A transition not listed here is rejected so the
 * queue can never skip steps (e.g. REQUESTED straight to ACCEPTED).
 */
const ALLOWED_TRANSITIONS: Record<TesterRequestStatus, TesterRequestStatus[]> = {
  REQUESTED: ['NEEDS_IDENTITY_CONFIRMATION', 'READY_TO_INVITE', 'CANCELLED', 'FAILED', 'EXPIRED'],
  NEEDS_IDENTITY_CONFIRMATION: ['READY_TO_INVITE', 'CANCELLED', 'FAILED', 'EXPIRED'],
  READY_TO_INVITE: ['CANCELLED', 'FAILED', 'EXPIRED'],
  // REQUESTED is the owner's "reopen": the invite was sent on the wrong app, to
  // the wrong handle, or never accepted at all. Without it the queue's Reopen
  // button asked for a transition the table refused, so the owner got a 404 and
  // the row stayed stuck with no way back.
  // ACCEPTED is absent on purpose: acceptance goes through recordTesterAcceptance
  // so the row always stores who confirmed it and whether Meta verified it. A bare
  // status flip would be an "accepted" label with no evidence behind it.
  INVITATION_SENT: ['ACCEPTANCE_PENDING', 'REQUESTED', 'EXPIRED', 'FAILED', 'CANCELLED'],
  ACCEPTANCE_PENDING: ['REQUESTED', 'EXPIRED', 'FAILED', 'CANCELLED'],
  ACCEPTED: ['REQUESTED'], // reopen: accepted on the wrong account/app, or access lost
  EXPIRED: ['REQUESTED'], // customer may re-request after expiry
  FAILED: ['REQUESTED'], // customer may re-request after failure
  CANCELLED: ['REQUESTED'], // customer may re-request after cancellation
};

const REQUESTS_FILE = path.join(DATA_DIR, 'tester-requests.json');

/** Caps + retention, mirroring the other volume stores. */
const MAX_REQUESTS = 500;
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_USERNAME_CHARS = 30;
const MAX_NOTE_CHARS = 200;

const requests = new Map<string, TesterRequest>();
let loaded = false;

/**
 * Turn whatever the customer pasted into a bare handle.
 *
 * People paste all of these: `@thenutritionhut`, `instagram.com/thenutritionhut/`,
 * `https://www.instagram.com/thenutritionhut?igsh=…`, or the handle with a
 * trailing full stop from a sentence. All of them mean the same account, and the
 * Meta dashboard only accepts the bare form — so the normalising happens once on
 * the way in, not in the owner's head at 11pm.
 */
export function normaliseInstagramUsername(raw: string): string {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^(www\.)?instagram\.com\//, '');
  value = value.replace(/^@+/, '');
  value = value.replace(/[/?#].*$/, '');
  value = value.replace(/[^a-z0-9._]/g, '');
  return value.slice(0, MAX_USERNAME_CHARS);
}

/**
 * Instagram allows letters, digits, periods and underscores. A handle made only
 * of periods is not a real account, and an empty one is a mistaken submit — both
 * are worth refusing here rather than putting an unusable row in the queue.
 */
export function isValidInstagramUsername(username: string): boolean {
  if (!username || username.length > MAX_USERNAME_CHARS) return false;
  if (!/^[a-z0-9._]+$/.test(username)) return false;
  return /[a-z0-9]/.test(username);
}

/**
 * Hosts an invitation destination may live on.
 *
 * This list is a security control, not a convenience: the customer portal turns
 * the stored string into a clickable button, so whatever is saved here is
 * rendered in a customer's browser. `javascript:` / `data:` / any third-party
 * host would make an operator-typed value into a script hand-off, and an
 * http:// link would downgrade the session — so only https on Meta's own
 * domains is accepted.
 */
const ALLOWED_INVITATION_HOSTS = ['facebook.com', 'fb.com', 'instagram.com', 'meta.com'];

export function validateInvitationUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'An invitation link is required.' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'The invitation link must start with https://' };
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_INVITATION_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) {
    return {
      ok: false,
      error: `Only official Meta links are accepted (facebook.com, instagram.com, meta.com). “${host}” is not one.`,
    };
  }

  return { ok: true, url: parsed.toString() };
}

export function loadTesterRequests() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(REQUESTS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    const data: Record<string, TesterRequest> = parsed?.requests ?? {};

    const now = Date.now();
    let dropped = 0;
    for (const [tenantId, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || !value.username) {
        dropped += 1;
        continue;
      }
      const updatedAt = Date.parse(value.updatedAt || value.requestedAt || '');
      if (Number.isFinite(updatedAt) && now - updatedAt > RETENTION_MS) {
        dropped += 1;
        continue;
      }
      const rawStatus = String(value.status || '');
      const known: TesterRequestStatus[] = [
        'REQUESTED',
        'NEEDS_IDENTITY_CONFIRMATION',
        'READY_TO_INVITE',
        'INVITATION_SENT',
        'ACCEPTANCE_PENDING',
        'ACCEPTED',
        'EXPIRED',
        'FAILED',
        'CANCELLED',
      ];
      const status: TesterRequestStatus =
        rawStatus === 'invited' ? 'INVITATION_SENT' :
        rawStatus === 'done' ? 'ACCEPTED' :
        rawStatus === 'pending' ? 'REQUESTED' :
        known.includes(rawStatus as TesterRequestStatus) ? (rawStatus as TesterRequestStatus) :
        'REQUESTED';
      requests.set(tenantId, { ...value, tenantId, status });
    }

    console.log(
      `[testerRequests] Loaded ${requests.size} tester request(s) from ${REQUESTS_FILE}` +
        (dropped ? ` (dropped ${dropped} stale/invalid)` : '')
    );
  } catch (err) {
    console.error('[testerRequests] Failed to load tester requests:', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, TesterRequest> = {};
    requests.forEach((request, tenantId) => {
      data[tenantId] = request;
    });
    const tmpFile = `${REQUESTS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, requests: data }), 'utf8');
    fs.renameSync(tmpFile, REQUESTS_FILE);
  } catch (err) {
    console.error('[testerRequests] Failed to persist tester requests:', err);
  }
}

function updatedAtMs(request: TesterRequest): number {
  const ts = Date.parse(request.updatedAt || request.requestedAt);
  return Number.isFinite(ts) ? ts : 0;
}

function prune(now: number = Date.now()) {
  requests.forEach((request, tenantId) => {
    // A request still waiting on us is never aged out: dropping it would silently
    // lose the one thing the customer cannot fix themselves.
    if (request.status !== 'REQUESTED' && now - updatedAtMs(request) > RETENTION_MS) {
      requests.delete(tenantId);
    }
  });

  if (requests.size <= MAX_REQUESTS) return;

  // Over the cap, drop the oldest *finished* rows first; pending ones go last so
  // the queue the owner actually works from stays intact.
  const ordered = Array.from(requests.values()).sort((a, b) => {
    const aPending = a.status === 'REQUESTED' ? 1 : 0;
    const bPending = b.status === 'REQUESTED' ? 1 : 0;
    if (aPending !== bPending) return aPending - bPending;
    return updatedAtMs(a) - updatedAtMs(b);
  });
  for (const request of ordered.slice(0, requests.size - MAX_REQUESTS)) {
    requests.delete(request.tenantId);
  }
}

/**
 * Record (or correct) one tenant's tester request.
 *
 * Re-submitting with a different handle resets the row to `pending`: the owner
 * may already have added the previous, wrong handle, and a row that keeps saying
 * "invited" while the queue no longer matches the customer would be worse than no
 * row at all.
 */
export function submitTesterRequest(
  tenantId: string,
  rawUsername: string
): { ok: true; request: TesterRequest } | { ok: false; error: string } {
  loadTesterRequests();

  const username = normaliseInstagramUsername(rawUsername);
  if (!isValidInstagramUsername(username)) {
    return {
      ok: false,
      error:
        'That does not look like an Instagram username. Use letters, numbers, periods or underscores (example: @yourbrand).',
    };
  }

  const now = new Date().toISOString();
  const existing = requests.get(tenantId);

  if (existing && existing.username === username) {
    existing.updatedAt = now;
    persist();
    return { ok: true, request: existing };
  }

  const request: TesterRequest = {
    tenantId,
    username,
    status: 'REQUESTED',
    requestedAt: now,
    updatedAt: now,
  };
  requests.set(tenantId, request);
  prune();
  persist();
  return { ok: true, request };
}

/** The tenant's own request, so the blocked-connect card survives a reload. */
export function getTesterRequest(tenantId: string): TesterRequest | null {
  loadTesterRequests();
  return requests.get(tenantId) || null;
}

/** Every request, pending first and newest first inside each group. */
export function listTesterRequests(): TesterRequest[] {
  loadTesterRequests();
  return Array.from(requests.values()).sort((a, b) => {
    const aPending = a.status === 'REQUESTED' ? 0 : 1;
    const bPending = b.status === 'REQUESTED' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return updatedAtMs(b) - updatedAtMs(a);
  });
}

/** Owner action: move a request along the status chain. */
export function setTesterRequestStatus(
  tenantId: string,
  status: TesterRequestStatus,
  note?: string,
  actor?: string
): TesterRequest | null {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return null;

  const allowed = ALLOWED_TRANSITIONS[request.status];
  if (!allowed || !allowed.includes(status)) {
    return null;
  }

  request.status = status;
  request.updatedAt = new Date().toISOString();

  const now = new Date().toISOString();
  if (status === 'INVITATION_SENT') request.invitedAt = now;
  if (status === 'ACCEPTED') request.acceptedAt = now;

  // Reopen: the row starts over, so the previous invitation's proof goes with
  // it. A stale URL/app id would otherwise make the customer portal show a link
  // that is no longer the invitation being sent, and keep the old app id next to
  // a fresh REQUESTED row.
  if (status === 'REQUESTED') {
    delete request.invitationUrl;
    delete request.metaAppId;
    delete request.invitedAt;
    delete request.acceptedAt;
    delete request.acceptedBy;
    delete request.acceptanceVerified;
    // The delivery result belonged to the invitation that just got reopened.
    delete request.notify;
  }

  if (typeof note === 'string') {
    const trimmed = note.trim().slice(0, MAX_NOTE_CHARS);
    if (trimmed) request.note = trimmed;
    else delete request.note;
  }

  appendAuditEntry(request, `status:${status}`, actor || 'owner', note || '', status);

  persist();
  return request;
}

function appendAuditEntry(
  request: TesterRequest,
  action: string,
  by: string,
  detail?: string,
  status?: TesterRequestStatus
): void {
  if (!request.auditLog) request.auditLog = [];
  request.auditLog.push({ action, by, at: new Date().toISOString(), detail });
  // Keep the audit log bounded.
  if (request.auditLog.length > 50) request.auditLog = request.auditLog.slice(-50);
}

/**
 * Owner action: record the verified invitation URL and Meta app id before
 * marking the invitation as sent. The URL is never invented here — the caller
 * supplies it after confirming it in Meta's dashboard.
 */
export function setTesterRequestInvitation(
  tenantId: string,
  invitationUrl: string,
  metaAppId: string,
  note?: string,
  actor?: string
): TesterRequest | null {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return null;
  if (request.status !== 'READY_TO_INVITE') return null;

  // The Meta-dashboard step has to be recorded first. Sending a link before the
  // handle really is a tester produces an invitation the customer cannot use,
  // which is the exact silent failure this workflow exists to prevent.
  if (!request.accountAddedAt) return null;

  // Defence in depth: the route validates too, but the store must never hold a
  // URL the portal would render as a clickable button unless it is https on a
  // Meta domain.
  const checked = validateInvitationUrl(invitationUrl);
  if (!checked.ok) return null;

  request.invitationUrl = checked.url;
  request.metaAppId = metaAppId;
  request.invitedAt = new Date().toISOString();

  const now = new Date().toISOString();
  request.status = 'INVITATION_SENT';
  request.updatedAt = now;

  if (typeof note === 'string') {
    const trimmed = note.trim().slice(0, MAX_NOTE_CHARS);
    if (trimmed) request.note = trimmed;
    else delete request.note;
  }

  appendAuditEntry(request, 'invitation_sent', actor || 'owner', `${checked.url} (app ${metaAppId})`, 'INVITATION_SENT');
  persist();
  return request;
}

/**
 * Owner action: record that the handle was actually added as an Instagram
 * Tester in the Meta app dashboard.
 *
 * Meta has no API for this, so the server cannot check it — but it can refuse to
 * pretend it happened. Recording it here is what unlocks "Prepare" and "Send",
 * and the row keeps who recorded it and when.
 */
export function recordTesterAccountAdded(
  tenantId: string,
  actor: string,
  handle?: string
): { ok: true; request: TesterRequest } | { ok: false; error: string } {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return { ok: false, error: 'No tester request for that account.' };

  if (request.status === 'ACCEPTED' || request.status === 'CANCELLED') {
    return { ok: false, error: `The Meta dashboard step cannot be recorded on a ${request.status} request. Reopen it first.` };
  }

  if (handle) {
    const confirmed = normaliseInstagramUsername(handle);
    if (confirmed !== request.username) {
      return {
        ok: false,
        error: `The confirmed handle (@${confirmed || '—'}) does not match this request (@${request.username}).`,
      };
    }
  }

  const now = new Date().toISOString();
  request.accountAddedAt = now;
  request.accountAddedBy = actor || 'owner';
  request.updatedAt = now;
  appendAuditEntry(request, 'account_added', request.accountAddedBy, `Meta dashboard: @${request.username}`);
  persist();
  return { ok: true, request };
}

/**
 * Record an acceptance.
 *
 * `verified` is false for every path that exists today: Meta exposes no tester
 * acceptance API or webhook, so all the server can honestly record is that a
 * human said it happened. The flag exists so a future Meta-verified signal can
 * be distinguished instead of quietly relabelling old manual rows.
 */
export function recordTesterAcceptance(
  tenantId: string,
  by: 'owner' | 'customer',
  actor: string,
  options: { verified?: boolean; note?: string } = {}
): { ok: true; request: TesterRequest } | { ok: false; error: string } {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return { ok: false, error: 'No tester request for that account.' };

  if (request.status !== 'INVITATION_SENT' && request.status !== 'ACCEPTANCE_PENDING') {
    return {
      ok: false,
      error: `Acceptance can only be recorded once an invitation was sent (current status: ${request.status}).`,
    };
  }

  const now = new Date().toISOString();
  request.status = 'ACCEPTED';
  request.acceptedAt = now;
  request.acceptedBy = by;
  request.acceptanceVerified = options.verified === true;
  request.updatedAt = now;

  if (typeof options.note === 'string') {
    const trimmed = options.note.trim().slice(0, MAX_NOTE_CHARS);
    if (trimmed) request.note = trimmed;
  }

  appendAuditEntry(
    request,
    options.verified === true ? 'accepted_verified' : 'accepted_unverified',
    actor || by,
    options.note || '',
    'ACCEPTED'
  );
  persist();
  return { ok: true, request };
}

/**
 * Customer action: "maine invite accept kar liya".
 *
 * This moves the row to ACCEPTANCE_PENDING — never to ACCEPTED — because the
 * customer's own word is not Meta's verdict. The owner still has to look at the
 * account before the queue says done.
 */
export function recordCustomerConfirmation(
  tenantId: string
): { ok: true; request: TesterRequest } | { ok: false; error: string } {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return { ok: false, error: 'No tester request for that account.' };
  if (request.status !== 'INVITATION_SENT') {
    return { ok: false, error: `Nothing is waiting for your confirmation (status: ${request.status}).` };
  }

  const now = new Date().toISOString();
  request.status = 'ACCEPTANCE_PENDING';
  request.updatedAt = now;
  appendAuditEntry(request, 'customer_confirmed_accept', 'customer', 'Customer says the invitation was accepted — unverified.', 'ACCEPTANCE_PENDING');
  persist();
  return { ok: true, request };
}

/** Store the outcome of the customer notification attempt for this request. */
export function recordTesterNotification(
  tenantId: string,
  notify: TesterInvitationNotification
): TesterRequest | null {
  loadTesterRequests();
  const request = requests.get(tenantId);
  if (!request) return null;
  request.notify = notify;
  request.updatedAt = new Date().toISOString();
  appendAuditEntry(request, 'notification', 'system', `${notify.status}${notify.reason ? ` — ${notify.reason}` : ''}`);
  persist();
  return request;
}

/**
 * Drop a tenant's tester request — the owner's permanent delete.
 *
 * A request is often the *first* thing a new account leaves behind (Meta refused
 * the connect, so nothing else exists), which is exactly why it has to go: leaving
 * it in place would keep a deleted customer in the invite queue forever.
 */
export function deleteTesterRequest(tenantId: string): boolean {
  loadTesterRequests();
  if (!requests.delete(tenantId)) return false;
  persist();
  return true;
}

/** How many invites are still waiting on the owner. */
export function getTesterRequestStats() {
  loadTesterRequests();
  let pending = 0;
  requests.forEach((request) => {
    if (request.status === 'REQUESTED') pending += 1;
  });
  return { total: requests.size, pending, file: REQUESTS_FILE, retentionDays: RETENTION_DAYS };
}

/** Test-only: clear all in-memory requests and reset the loaded flag so each
 * test starts from an empty queue. Never call outside tests. */
export function _resetForTests(): void {
  requests.clear();
  loaded = false;
  try {
    if (fs.existsSync(REQUESTS_FILE)) fs.rmSync(REQUESTS_FILE);
  } catch {
    // ignore
  }
}
