import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Customer activation state — the owner-facing lifecycle for a newly connected
 * Instagram account, sitting *alongside* the tester invitation queue
 * (server/testerRequestStore.ts) rather than replacing it.
 *
 * Every connected account starts at CONNECTED_PENDING_ACTIVATION when its
 * token is saved. The owner then:
 *   1. adds the handle as an Instagram Tester in the Meta dashboard
 *   2. records "invitation sent" (Mark Invitation Sent)
 *   3. sends activation instructions through a supported channel
 *   4. waits for the customer to send a test DM from a second account
 *   5. marks FULLY_ACTIVE once a real reply is confirmed
 *
 * Meta exposes no tester-acceptance API/webhook, so acceptance is never
 * inferred from opening the invitation link — it is either "not verified"
 * (owner/customer say so) or verified by an actual successful test reply.
 *
 * All data is per-tenant, persisted to disk, and never shared across tenants.
 */

export type ActivationStatus =
  | 'CONNECTED_PENDING_ACTIVATION'
  | 'INVITATION_SENT'
  | 'AWAITING_CUSTOMER_ACCEPTANCE'
  | 'AWAITING_TEST_DM'
  | 'FULLY_ACTIVE'
  | 'ACTION_REQUIRED'
  | 'MESSAGE_SEND_FAILED';

export interface ActivationAuditEntry {
  action: string;
  by: string;
  at: string;
  detail?: string;
}

export interface ActivationState {
  tenantId: string;
  instagramUsername: string | null;
  instagramAccountId: string | null;
  status: ActivationStatus;
  /** ISO timestamp the account first connected (state created). */
  connectedAt: string;
  updatedAt: string;
  /** When the owner marked the invitation as sent. */
  invitationSentAt?: string;
  /** The admin who last acted on this account. */
  lastActionBy?: string;
  /** Short description of the last admin action. */
  lastAction?: string;
  /** Outcome of the last "send activation instructions" attempt. */
  instructionSend?: {
    status: string;
    at: string;
    reason?: string;
    toMasked?: string | null;
  };
  /** Customer consented to WhatsApp notifications (read from contact store). */
  whatsappConsent?: boolean;
  /** The customer sent a test DM that we actually answered. */
  testDmConfirmedAt?: string;
  /** Immutable audit trail of owner actions on this account. */
  auditLog?: ActivationAuditEntry[];
}

const STATES_FILE = path.join(DATA_DIR, 'activation-states.json');
const MAX_STATES = 500;
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const states = new Map<string, ActivationState>();
let loaded = false;

/** Allowed transitions so the owner cannot skip a required step. */
const ALLOWED_TRANSITIONS: Record<ActivationStatus, ActivationStatus[]> = {
  CONNECTED_PENDING_ACTIVATION: ['INVITATION_SENT', 'ACTION_REQUIRED', 'MESSAGE_SEND_FAILED'],
  INVITATION_SENT: ['AWAITING_CUSTOMER_ACCEPTANCE', 'ACTION_REQUIRED', 'MESSAGE_SEND_FAILED'],
  AWAITING_CUSTOMER_ACCEPTANCE: ['AWAITING_TEST_DM', 'ACTION_REQUIRED', 'CONNECTED_PENDING_ACTIVATION'],
  AWAITING_TEST_DM: ['FULLY_ACTIVE', 'ACTION_REQUIRED', 'CONNECTED_PENDING_ACTIVATION'],
  FULLY_ACTIVE: ['CONNECTED_PENDING_ACTIVATION'], // re-verify after token expiry etc.
  ACTION_REQUIRED: ['CONNECTED_PENDING_ACTIVATION', 'INVITATION_SENT'],
  MESSAGE_SEND_FAILED: ['CONNECTED_PENDING_ACTIVATION', 'INVITATION_SENT'],
};

function loadStates(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(STATES_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(STATES_FILE, 'utf8'));
    const data: Record<string, ActivationState> = parsed?.states ?? {};
    const now = Date.now();
    let dropped = 0;
    for (const [tenantId, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object') {
        dropped += 1;
        continue;
      }
      const updatedAt = Date.parse(value.updatedAt || value.connectedAt || '');
      if (Number.isFinite(updatedAt) && now - updatedAt > RETENTION_MS) {
        dropped += 1;
        continue;
      }
      states.set(tenantId, { ...value, tenantId } as ActivationState);
    }
    console.log(
      `[activation] Loaded ${states.size} activation state(s) from ${STATES_FILE}` +
        (dropped ? ` (dropped ${dropped} stale/invalid)` : '')
    );
  } catch (err) {
    console.error('[activation] Failed to load activation states:', err);
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, ActivationState> = {};
    states.forEach((state, tenantId) => {
      data[tenantId] = state;
    });
    const tmpFile = `${STATES_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, states: data }), 'utf8');
    fs.renameSync(tmpFile, STATES_FILE);
  } catch (err) {
    console.error('[activation] Failed to persist activation states:', err);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Create (or touch) an activation record when a real Instagram connection is saved. */
export function touchActivationOnConnect(
  tenantId: string,
  instagramUsername: string | null,
  instagramAccountId: string | null
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const now = nowIso();
  const existing = states.get(tenantId);

  if (existing) {
    existing.instagramUsername = instagramUsername ?? existing.instagramUsername;
    existing.instagramAccountId = instagramAccountId ?? existing.instagramAccountId;
    existing.updatedAt = now;
    persist();
    return { ok: true, state: existing };
  }

  const state: ActivationState = {
    tenantId,
    instagramUsername: instagramUsername ?? null,
    instagramAccountId: instagramAccountId ?? null,
    status: 'CONNECTED_PENDING_ACTIVATION',
    connectedAt: now,
    updatedAt: now,
  };
  states.set(tenantId, state);
  persist();
  return { ok: true, state };
}

export function getActivationState(tenantId: string): ActivationState | null {
  loadStates();
  return states.get(tenantId) || null;
}

/** Every state, newest first by connectedAt. */
export function listActivationStates(): ActivationState[] {
  loadStates();
  return Array.from(states.values()).sort(
    (a, b) => Date.parse(b.connectedAt) - Date.parse(a.connectedAt)
  );
}

/**
 * Owner action: mark the invitation as sent (after the Meta dashboard step and
 * a genuine invitation URL have been recorded through the tester routes).
 * Moves CONNECTED_PENDING_ACTIVATION → INVITATION_SENT.
 */
export function markInvitationSent(
  tenantId: string,
  actor: string,
  note?: string
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const state = states.get(tenantId);
  if (!state) return { ok: false, error: 'No activation state for that account.' };

  const allowed = ALLOWED_TRANSITIONS[state.status];
  if (!allowed || !allowed.includes('INVITATION_SENT')) {
    return {
      ok: false,
      error: `Cannot mark invitation sent from ${state.status}.`,
    };
  }

  state.status = 'INVITATION_SENT';
  state.invitationSentAt = nowIso();
  state.lastActionBy = actor;
  state.lastAction = 'invitation-sent';
  state.updatedAt = nowIso();
  if (typeof note === 'string' && note.trim()) state.lastAction = note.trim();
  appendAudit(state, 'invitation_sent', actor, note || '');
  persist();
  return { ok: true, state };
}

/**
 * Owner action: send activation instructions through a supported channel
 * (WhatsApp via the existing outbox). Moves INVITATION_SENT →
 * AWAITING_CUSTOMER_ACCEPTANCE.
 */
export function sendActivationInstructions(
  tenantId: string,
  actor: string,
  sendResult: { status: string; at: string; reason?: string; toMasked?: string | null },
  note?: string
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const state = states.get(tenantId);
  if (!state) return { ok: false, error: 'No activation state for that account.' };

  const allowed = ALLOWED_TRANSITIONS[state.status];
  if (!allowed || !allowed.includes('AWAITING_CUSTOMER_ACCEPTANCE')) {
    return {
      ok: false,
      error: `Cannot send activation instructions from ${state.status}.`,
    };
  }

  state.status = 'AWAITING_CUSTOMER_ACCEPTANCE';
  state.instructionSend = sendResult;
  state.lastActionBy = actor;
  state.lastAction = note?.trim() || 'activation-instructions-sent';
  state.updatedAt = nowIso();
  appendAudit(state, 'activation_instructions_sent', actor, note || '');
  persist();
  return { ok: true, state };
}

/**
 * Owner action: record that the customer's test DM was answered successfully.
 * Moves AWAITING_TEST_DM → FULLY_ACTIVE.
 */
export function confirmTestDm(
  tenantId: string,
  actor: string,
  note?: string
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const state = states.get(tenantId);
  if (!state) return { ok: false, error: 'No activation state for that account.' };

  const allowed = ALLOWED_TRANSITIONS[state.status];
  if (!allowed || !allowed.includes('FULLY_ACTIVE')) {
    return {
      ok: false,
      error: `Cannot mark fully active from ${state.status}.`,
    };
  }

  state.status = 'FULLY_ACTIVE';
  state.testDmConfirmedAt = nowIso();
  state.lastActionBy = actor;
  state.lastAction = note?.trim() || 'test-dm-confirmed';
  state.updatedAt = nowIso();
  appendAudit(state, 'test_dm_confirmed', actor, note || '');
  persist();
  return { ok: true, state };
}

/** Owner action: require the customer to do something (reconnect, add tester, etc.). */
export function requireAction(
  tenantId: string,
  actor: string,
  note: string
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const state = states.get(tenantId);
  if (!state) return { ok: false, error: 'No activation state for that account.' };

  const allowed = ALLOWED_TRANSITIONS[state.status];
  if (!allowed || !allowed.includes('ACTION_REQUIRED')) {
    return {
      ok: false,
      error: `Cannot require action from ${state.status}.`,
    };
  }

  state.status = 'ACTION_REQUIRED';
  state.lastActionBy = actor;
  state.lastAction = note.trim().slice(0, 200);
  state.updatedAt = nowIso();
  appendAudit(state, 'action_required', actor, note);
  persist();
  return { ok: true, state };
}

/** Owner action: record that a message send failed. */
export function messageSendFailed(
  tenantId: string,
  actor: string,
  reason: string
): { ok: true; state: ActivationState } | { ok: false; error: string } {
  loadStates();
  const state = states.get(tenantId);
  if (!state) return { ok: false, error: 'No activation state for that account.' };

  const allowed = ALLOWED_TRANSITIONS[state.status];
  if (!allowed || !allowed.includes('MESSAGE_SEND_FAILED')) {
    return {
      ok: false,
      error: `Cannot mark send failed from ${state.status}.`,
    };
  }

  state.status = 'MESSAGE_SEND_FAILED';
  state.lastActionBy = actor;
  state.lastAction = `message-send-failed: ${reason}`.slice(0, 200);
  state.updatedAt = nowIso();
  appendAudit(state, 'message_send_failed', actor, reason);
  persist();
  return { ok: true, state };
}

/** Test helper: reset all states. Never used outside tests. */
export function _resetForTests(): void {
  states.clear();
  loaded = false;
  try {
    if (fs.existsSync(STATES_FILE)) fs.rmSync(STATES_FILE);
  } catch {
    // ignore
  }
}

function appendAudit(
  state: ActivationState,
  action: string,
  by: string,
  detail?: string
): void {
  if (!state.auditLog) state.auditLog = [];
  state.auditLog.push({ action, by, at: nowIso(), detail });
  if (state.auditLog.length > 50) state.auditLog = state.auditLog.slice(-50);
}
