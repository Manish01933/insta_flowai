import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Customer onboarding lifecycle store — the honest backbone for the OPS portal.
 *
 * Why a dedicated store: the dashboard never had an explicit onboarding state
 * machine, so "where is this customer?" was reconstructed from scattered facts
 * (plan row, connection row, KB size). Feature 4 needs the opposite: one
 * server-validated status per tenant plus an append-only timeline that records
 * WHAT happened, WHEN, and WHO did it. Every transition lives here because an
 * arbitrary status change that only the frontend knows about cannot be trusted.
 *
 * Honesty rules (mirrored from the rest of the codebase):
 *  - No event is ever fabricated. Callers pass the actor ('customer', 'ops',
 *    'system') and the store records what they claim, without inventing
 *    outcomes.
 *  - Transitions are validated server-side against `VALID_TRANSITIONS`;
 *    an invalid jump is rejected with the reason, never silently applied.
 *  - One file, DATA_DIR-backed, atomic persist, bounded timeline per tenant so
 *    no tenant can grow the file without bound.
 */

export type OnboardingStatus =
  | 'REGISTERED'
  | 'FREE_PLAN_ACTIVE'
  | 'INSTAGRAM_CONNECTION_PENDING'
  | 'INSTAGRAM_CONNECTED'
  | 'BUSINESS_REVIEW_PENDING'
  | 'KNOWLEDGE_BASE_DRAFT'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'NEEDS_CUSTOMER_ACTION'
  | 'CONNECTION_FAILED'
  | 'REVIEW_REJECTED'
  | 'SUSPENDED';

export type OnboardingActor = 'customer' | 'ops' | 'system';

export interface TimelineEvent {
  at: string;
  event: string;
  /** Status AFTER this event (null for non-status events). */
  status: OnboardingStatus | null;
  actor: OnboardingActor;
  /** Human-safe detail; must be pre-redacted by the caller. */
  detail?: string;
}

export interface OnboardingState {
  tenantId: string;
  status: OnboardingStatus;
  statusChangedAt: string;
  /** Was APPROVED ever reached (approval date survives later suspensions). */
  approvedAt: string | null;
  events: TimelineEvent[];
  updatedAt: string;
}

/**
 * Server-validated transitions. Anything not listed → rejected.
 *
 * Deliberate shape: forward path mirrors the spec (REGISTERED → … → APPROVED)
 * plus the corrective states. `APPROVED` can only be reached from
 * AWAITING_APPROVAL so OPS cannot approve a customer whose Instagram is missing
 * or whose Knowledge Base was never reviewed.
 */
const VALID_TRANSITIONS: Record<OnboardingStatus, OnboardingStatus[]> = {
  REGISTERED: ['FREE_PLAN_ACTIVE', 'INSTAGRAM_CONNECTION_PENDING', 'NEEDS_CUSTOMER_ACTION'],
  FREE_PLAN_ACTIVE: ['INSTAGRAM_CONNECTION_PENDING', 'NEEDS_CUSTOMER_ACTION'],
  INSTAGRAM_CONNECTION_PENDING: ['INSTAGRAM_CONNECTED', 'CONNECTION_FAILED', 'NEEDS_CUSTOMER_ACTION'],
  INSTAGRAM_CONNECTED: ['BUSINESS_REVIEW_PENDING', 'NEEDS_CUSTOMER_ACTION'],
  CONNECTION_FAILED: ['INSTAGRAM_CONNECTION_PENDING', 'REGISTERED'],
  BUSINESS_REVIEW_PENDING: ['KNOWLEDGE_BASE_DRAFT', 'NEEDS_CUSTOMER_ACTION'],
  KNOWLEDGE_BASE_DRAFT: ['AWAITING_APPROVAL', 'BUSINESS_REVIEW_PENDING', 'NEEDS_CUSTOMER_ACTION'],
  AWAITING_APPROVAL: ['APPROVED', 'REVIEW_REJECTED', 'KNOWLEDGE_BASE_DRAFT'],
  REVIEW_REJECTED: ['KNOWLEDGE_BASE_DRAFT', 'BUSINESS_REVIEW_PENDING'],
  NEEDS_CUSTOMER_ACTION: ['FREE_PLAN_ACTIVE', 'INSTAGRAM_CONNECTION_PENDING', 'KNOWLEDGE_BASE_DRAFT'],
  APPROVED: ['SUSPENDED'],
  SUSPENDED: ['APPROVED'],
};

const MAX_EVENTS_PER_TENANT = 200;
const MAX_DETAIL_CHARS = 300;

export const STATUSES: OnboardingStatus[] = [
  'REGISTERED', 'FREE_PLAN_ACTIVE', 'INSTAGRAM_CONNECTION_PENDING', 'INSTAGRAM_CONNECTED',
  'BUSINESS_REVIEW_PENDING', 'KNOWLEDGE_BASE_DRAFT', 'AWAITING_APPROVAL', 'APPROVED',
  'NEEDS_CUSTOMER_ACTION', 'CONNECTION_FAILED', 'REVIEW_REJECTED', 'SUSPENDED',
];

/** Only a recognisable, safe enum value passes. */
function isStatus(value: unknown): value is OnboardingStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

const states = new Map<string, OnboardingState>();
let loaded = false;

// File path is a `let` (not const) so tests can repoint it at a temp dir —
// the same pattern retryQueue.ts and connectionStore use for isolation.
let STATE_FILE: string | null = null;

function file(): string {
  if (!STATE_FILE) STATE_FILE = path.join(DATA_DIR, 'onboarding-status.json');
  return STATE_FILE;
}

function persist(): void {
  try {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data: Record<string, OnboardingState> = {};
    states.forEach((state, tenantId) => { data[tenantId] = state; });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, states: data }, null, 0), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[onboardingStatus] persist failed (state stays in memory):', err);
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const target = file();
    if (!fs.existsSync(target)) return;
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    for (const [tenantId, value] of Object.entries(parsed?.states ?? {})) {
      const state = value as OnboardingState;
      if (!state || typeof tenantId !== 'string' || !isStatus(state.status)) continue;
      states.set(tenantId, {
        tenantId,
        status: state.status,
        statusChangedAt: String(state.statusChangedAt || ''),
        approvedAt: state.approvedAt || null,
        events: Array.isArray(state.events) ? state.events.slice(-MAX_EVENTS_PER_TENANT) : [],
        updatedAt: String(state.updatedAt || ''),
      });
    }
    console.log(`[onboardingStatus] Loaded ${states.size} onboarding state(s) from ${target}`);
  } catch (err) {
    console.error('[onboardingStatus] failed to load (starting fresh):', err);
  }
}

function redactDetail(detail: unknown): string | undefined {
  const text = String(detail ?? '').trim();
  if (!text) return undefined;
  // Belt-and-braces: the caller redacts, but a secret-shaped token must never
  // reach disk even from a careless caller.
  const safe = text
    .replace(/(access_token|Authorization|Bearer|api_?key|sk-or-v1-|sk-)[^\s"',}]+/gi, '$1<redacted>')
    .slice(0, MAX_DETAIL_CHARS);
  return safe || undefined;
}

function findState(tenantId: string): OnboardingState {
  let existing = states.get(tenantId);
  if (!existing) {
    existing = {
      tenantId,
      status: 'REGISTERED',
      statusChangedAt: new Date().toISOString(),
      approvedAt: null,
      events: [],
      updatedAt: new Date().toISOString(),
    };
    states.set(tenantId, existing);
  }
  return existing;
}

/**
 * Core write path. `event` names what happened; `targetStatus` performs the
 * transition (validated). `ensureRegistered` is the idempotent upsert that the
 * first observation of a tenant gets.
 */
function commit(
  tenantId: string,
  event: string,
  opts: { targetStatus?: OnboardingStatus; actor: OnboardingActor; detail?: string }
): { state: OnboardingState; applied: boolean; error?: string } {
  load();
  const state = findState(tenantId);
  const now = new Date().toISOString();
  let applied = true;

  let rejectedReason: string | undefined;
  if (opts.targetStatus && opts.targetStatus !== state.status) {
    const allowed = VALID_TRANSITIONS[state.status];
    if (!allowed.includes(opts.targetStatus)) {
      rejectedReason = `cannot go from ${state.status} to ${opts.targetStatus}`;
      applied = false;
    } else {
      state.status = opts.targetStatus;
      state.statusChangedAt = now;
      if (opts.targetStatus === 'APPROVED') state.approvedAt = state.approvedAt ?? now;
    }
  }

  state.events.push({
    at: now,
    event: applied ? event : `${event} rejected (${rejectedReason})`,
    status: applied ? (opts.targetStatus ?? state.status) : null,
    actor: opts.actor,
    detail: redactDetail(opts.detail),
  });
  if (state.events.length > MAX_EVENTS_PER_TENANT) {
    state.events = state.events.slice(-MAX_EVENTS_PER_TENANT);
  }
  state.updatedAt = now;
  persist();

  return { state, applied, error: rejectedReason };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Idempotent: the FIRST observation of a tenant records the real timestamp. */
export function ensureRegistered(tenantId: string, actor: OnboardingActor, detail?: string): OnboardingState {
  load();
  const state = states.get(tenantId);
  if (state) return state; // already on record — never a second "registrered"
  const result = commit(tenantId, 'onboarding started', { targetStatus: undefined, actor, detail });
  return result.state;
}

/** Transition with validation. Returns { ok:false, reason } on an illegal jump. */
export function transition(
  tenantId: string,
  targetStatus: OnboardingStatus,
  actor: OnboardingActor,
  detail?: string
): { ok: boolean; state: OnboardingState; reason?: string } {
  if (!isStatus(targetStatus)) return { ok: false, state: ensureRegistered(tenantId, 'system'), reason: 'unknown status' };
  const result = commit(tenantId, `status → ${targetStatus}`, { targetStatus, actor, detail });
  return { ok: result.applied, state: result.state, reason: result.error };
}

/** Append-only note (no status change). */
export function recordEvent(
  tenantId: string,
  event: string,
  actor: OnboardingActor,
  detail?: string
): OnboardingState {
  return commit(tenantId, event, { actor, detail }).state;
}

export function getOnboardingState(tenantId: string): OnboardingState {
  load();
  return findState(tenantId);
}

export function listOnboardingStates(): OnboardingState[] {
  load();
  return Array.from(states.values());
}

/**
 * Real, computed metrics — every number from recorded timestamps, nothing
 * simulated. `registeredToday/Yesterday` are UTC daybuckets (the store has no
 * timezone; the OPS client renders with its configured timezone).
 */
export function getOnboardingMetrics(now: Date = new Date()): {
  total: number;
  registeredToday: number;
  registeredYesterday: number;
  freePlansActive: number;
  instagramConnected: number;
  awaitingReview: number;
  approved: number;
  needsCustomerAction: number;
  stalled: number;
} {
  const states = listOnboardingStates();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayStart = new Date(dayStart.getTime() - 86_400_000);

  const registeredAt = (s: OnboardingState): number => {
    const first = s.events[0]?.at;
    const ts = first ? Date.parse(first) : NaN;
    return Number.isFinite(ts) ? ts : Date.parse(s.updatedAt);
  };

  return {
    total: states.length,
    registeredToday: states.filter((s) => registeredAt(s) >= dayStart.getTime()).length,
    registeredYesterday: states.filter(
      (s) => registeredAt(s) >= yesterdayStart.getTime() && registeredAt(s) < dayStart.getTime()
    ).length,
    // Counted by lifecycle event (the recorded resulting status), so a tenant
    // that moved on to CONNECTED etc. is still counted as having activated.
    freePlansActive: states.filter((s) => s.events.some((e) => e.status === 'FREE_PLAN_ACTIVE')).length,
    instagramConnected: states.filter((s) => s.events.some((e) => e.status === 'INSTAGRAM_CONNECTED')).length,
    awaitingReview: states.filter(
      (s) => s.status === 'AWAITING_APPROVAL' || s.status === 'BUSINESS_REVIEW_PENDING' || s.status === 'KNOWLEDGE_BASE_DRAFT'
    ).length,
    approved: states.filter((s) => s.approvedAt).length,
    needsCustomerAction: states.filter((s) => s.status === 'NEEDS_CUSTOMER_ACTION').length,
    stalled: states.filter((s) => {
      const paused = ['NEEDS_CUSTOMER_ACTION', 'CONNECTION_FAILED', 'REVIEW_REJECTED'];
      return paused.includes(s.status);
    }).length,
  };
}

/** Test hook — point the store at a temp dir and clear memory (per-run namespacing). */
export function _resetForTests(dir?: string): void {
  loaded = false;
  states.clear();
  if (dir) {
    STATE_FILE = path.join(dir, 'onboarding-status.json');
  } else {
    STATE_FILE = null;
  }
}

/** Stable, non-secret key for duplicate-notification prevention. */
export function dedupeKeyFor(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}
