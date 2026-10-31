import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './connectionStore';

/**
 * Per-DM lifecycle tracing (Task 2 instrumentation).
 *
 * One record per incoming DM, updated at every checkpoint the reply flow
 * passes: webhook receipt/verification, duplicate + tenant resolution, AI
 * provider selection and outcome (OpenRouter/Gemini tracked separately),
 * the Instagram send, and the final status. Written to the same persistent
 * JSON-on-volume architecture every other store here uses (chatStore,
 * messageDedupe, botControlStore) — no new database, no paid service.
 *
 * Two hard rules, both deliberate:
 *
 * 1. TRACING CAN NEVER BREAK THE REPLY FLOW. Every public function swallows
 *    its own errors into a console.warn. A failed trace write must not stop,
 *    crash, or even slow a customer's reply — the reply path runs unaffected.
 *    (Coverage of the owner's requirement #8.)
 *
 * 2. CONCURRENT WRITES CANNOT CORRUPT THE FILE. Node executes the webhook
 *    handler's synchronous sections on one thread, but two DMs can interleave
 *    at await points, so writes are serialized through an in-process queue and
 *    persisted with the atomic temp-file + rename pattern the rest of this
 *    codebase already uses. (Requirement #9.)
 *
 * PRIVACY (requirement #7): the record stores a SHA-256 hash of the sender id
 * — never the raw id — and never the message text. No token, key or secret is
 * ever recorded. Console logs elsewhere were trimmed of raw message text in
 * the same spirit.
 *
 * NO RETRIES HERE (requirement #11): a retryable failure is *labelled*
 * (`retryable: true`, `retries` counter placeholder at 0) but nothing is
 * re-sent or replayed by this module. Recovery is Task 3, on its own approval.
 */

const TRACE_FILE = path.join(DATA_DIR, 'message-traces.json');

const parsedMax = parseInt(process.env.MAX_MESSAGE_TRACES || '', 10);
/** Ring buffer cap: bounded disk, old traces fall off the end. */
const MAX_TRACES = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 500;

const TRACE_TTL_MS = 48 * 60 * 60 * 1000;

export type TraceStage =
  | 'received'
  | 'verified'
  | 'signature-rejected'
  | 'duplicate'
  | 'no-message'
  | 'self-echo'
  | 'unrouted'
  | 'routed'
  | 'billing-blocked'
  | 'guard-blocked'
  | 'takeover'
  | 'ai-started'
  | 'ai-completed'
  | 'ai-failed'
  | 'send-started'
  | 'send-completed'
  | 'send-failed';

/**
 * Safe error categories. Transient ones are labelled retryable for Task 3 —
 * Task 2 only records the label, never acts on it.
 */
export type ErrorCategory =
  | 'timeout'
  | 'rate-limit'
  | 'server-error'
  | 'network'
  | 'auth'
  | 'permission'
  | 'config'
  | 'unknown';

const TRANSIENT: ReadonlySet<ErrorCategory> = new Set([
  'timeout',
  'rate-limit',
  'server-error',
  'network',
]);

export function isRetryableCategory(category: ErrorCategory): boolean {
  return TRANSIENT.has(category);
}

/**
 * Classify any thrown error or Meta/HTTP error object into a safe category.
 * Accepts anything; returns 'unknown' rather than throwing.
 */
export function classifyError(err: unknown): { category: ErrorCategory; detail: string } {
  const raw = String((err as any)?.message || (typeof err === 'string' ? err : '') || '');
  // Never echo a credential-shaped string into logs or traces.
  const detail = redactSecrets(raw).slice(0, 200) || 'unknown error';

  if (/timed?\s?out|AbortError|ETIMEDOUT/i.test(raw)) return { category: 'timeout', detail };
  if (/\b429\b|rate.?limit/i.test(raw)) return { category: 'rate-limit', detail };
  if (/\b5\d{2}\b|internal (server )?error/i.test(raw)) return { category: 'server-error', detail };
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw)) {
    return { category: 'network', detail };
  }
  // Meta's documented permanent codes: 190 invalid OAuth token, 10/200
  // permission denied, 102 session expired.
  if (/\b190\b|access_token|invalid.*oauth|token.*(expired|invalid)/i.test(raw)) {
    return { category: 'auth', detail };
  }
  if (/\b(10|200|20705)\b.*(permission|authorized)|(messaging|permission).*denied/i.test(raw)) {
    return { category: 'permission', detail };
  }
  if (/not configured|invalid.*key|key format|unknown model/i.test(raw)) {
    return { category: 'config', detail };
  }
  return { category: 'unknown', detail };
}

/** Strips anything that looks like a token or key before it reaches storage. */
function redactSecrets(text: string): string {
  return text
    .replace(/(access_token|Authorization|Bearer|api[_-]?key|sk-or-v1-|sk-)[^\s"',}]+/gi, '$1<redacted>')
    .replace(/EAAG[\w-]{10,}/g, '<redacted-token>');
}

export interface MessageTrace {
  id: string;
  tenantId: string | null;
  igAccountId: string;
  /** SHA-256 of the raw sender id, first 16 hex chars — raw id is never stored. */
  senderHash: string;
  receivedAt: string;
  lastStage: TraceStage | 'final';
  /** Terminal result: 'blocked' rows are normal (guard/billing/takeover), not failures. */
  finalStatus: 'pending' | 'delivered' | 'failed' | 'blocked';
  /** Final human-readable non-secret failure note, when failed. */
  failureNote?: string;
  ai?: {
    provider: 'openrouter' | 'gemini' | 'omniroute' | 'fallback';
    model: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    status: 'ok' | 'canned-fallback' | 'error';
    /** Per-provider attempts in order: proves OpenRouter vs Gemini vs OmniRoute health separately. */
    attempts: Array<{
      provider: 'openrouter' | 'gemini' | 'omniroute';
      ok: boolean;
      durationMs: number | null;
      errorCategory: ErrorCategory | null;
      errorDetail: string | null;
    }>;
  };
  send?: {
    startedAt?: string;
    endedAt?: string;
    status: 'sent' | 'failed' | 'skipped';
    errorCategory?: ErrorCategory | null;
    errorDetail?: string | null;
    retryable?: boolean;
  };
  retries: number;
}

// ── Storage: serialized writes, atomic persist, bounded file ────────────────

const traces: MessageTrace[] = [];
let loaded = false;
let dirty = false;

let persistChain: Promise<void> = Promise.resolve();

/** Atomic write (temp + rename) — the same pattern as chatStore/messageDedupe. */
function persist(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = JSON.stringify({ version: 1, traces }, null, 0);
    const tmp = `${TRACE_FILE}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, TRACE_FILE);
    dirty = false;
  } catch (err) {
    // Storage failure is recorded but NEVER thrown — the reply flow must run.
    console.warn('[messageTrace] persist failed (reply flow untouched):', (err as Error).message);
  }
}

/** All writes funnel through here so concurrent updates cannot interleave mid-record. */
function queuePersist(): void {
  persistChain = persistChain
    .catch(() => {
      /* previous failure already logged; keep the chain alive */
    })
    .then(() => {
      if (dirty) persist();
    });
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(TRACE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(TRACE_FILE, 'utf8'));
    if (Array.isArray(parsed?.traces)) {
      const cutoff = Date.now() - TRACE_TTL_MS;
      for (const t of parsed.traces) {
        if (t && typeof t === 'object' && typeof t.receivedAt === 'string' && Date.parse(t.receivedAt) > cutoff) {
          traces.push(t as MessageTrace);
        }
      }
    }
  } catch (err) {
    console.warn('[messageTrace] could not load previous traces (starting fresh):', (err as Error).message);
  }
}

function prune() {
  const cutoff = Date.now() - TRACE_TTL_MS;
  while (traces.length && Date.parse(traces[0].receivedAt) < cutoff) traces.shift();
  while (traces.length > MAX_TRACES) traces.shift();
}

// ── Public API (never throws) ───────────────────────────────────────────────

export function hashSenderId(senderId: string): string {
  return crypto.createHash('sha256').update(String(senderId)).digest('hex').slice(0, 16);
}

/** Create the record at the moment the DM first gets our attention. */
export function startTrace(init: {
  igAccountId: string;
  senderId: string;
  tenantId?: string | null;
  stage: TraceStage;
}): MessageTrace | null {
  try {
    load();
    const trace: MessageTrace = {
      id: crypto.randomUUID(),
      tenantId: init.tenantId ?? null,
      igAccountId: init.igAccountId,
      senderHash: hashSenderId(init.senderId),
      receivedAt: new Date().toISOString(),
      lastStage: init.stage,
      finalStatus: 'pending',
      retries: 0,
    };
    traces.unshift(trace);
    prune();
    dirty = true;
    queuePersist();
    return trace;
  } catch (err) {
    console.warn('[messageTrace] startTrace failed (reply flow untouched):', (err as Error).message);
    return null;
  }
}

/** Find the most recent still-pending trace for this sender/account pair. */
function findTrace(igAccountId: string, senderId: string): MessageTrace | undefined {
  const senderHash = hashSenderId(senderId);
  return traces.find((t) => t.igAccountId === igAccountId && t.senderHash === senderHash && t.finalStatus === 'pending');
}

/**
 * Advance a trace to the next stage. Pass `trace` (the object returned by
 * startTrace) when the handler holds it; otherwise the lookup runs by
 * account+sender, which is still hash-based and allocation-free.
 */
export function updateTrace(
  igAccountId: string,
  senderId: string,
  patch: {
    stage: TraceStage;
    tenantId?: string | null;
    ai?: Partial<NonNullable<MessageTrace['ai']>>;
    send?: Partial<NonNullable<MessageTrace['send']>>;
    note?: string;
  },
  heldTrace?: MessageTrace | null
): void {
  try {
    load();
    const trace =
      heldTrace && traces.includes(heldTrace)
        ? heldTrace
        : findTrace(igAccountId, senderId);
    if (!trace) return;

    trace.lastStage = patch.stage;
    if (patch.tenantId !== undefined) trace.tenantId = patch.tenantId;

    if (patch.ai) {
      trace.ai = {
        provider: patch.ai.provider ?? trace.ai?.provider ?? 'openrouter',
        model: patch.ai.model ?? trace.ai?.model ?? '',
        status: patch.ai.status ?? trace.ai?.status ?? 'ok',
        startedAt: patch.ai.startedAt ?? trace.ai?.startedAt,
        endedAt: patch.ai.endedAt ?? trace.ai?.endedAt,
        durationMs: patch.ai.durationMs ?? trace.ai?.durationMs,
        attempts: patch.ai.attempts ?? trace.ai?.attempts ?? [],
      };
    }

    if (patch.send) {
      trace.send = {
        status: patch.send.status ?? trace.send?.status ?? 'sent',
        startedAt: patch.send.startedAt ?? trace.send?.startedAt,
        endedAt: patch.send.endedAt ?? trace.send?.endedAt,
        errorCategory: patch.send.errorCategory ?? trace.send?.errorCategory ?? null,
        errorDetail: patch.send.errorDetail ?? trace.send?.errorDetail ?? null,
        retryable: patch.send.retryable ?? trace.send?.retryable,
      };
    }

    // Terminal stages flip finalStatus; everything else stays pending.
    if (patch.stage === 'send-completed') trace.finalStatus = 'delivered';
    else if (patch.stage === 'send-failed' || patch.stage === 'ai-failed') trace.finalStatus = 'failed';
    else if (['billing-blocked', 'guard-blocked', 'takeover', 'unrouted', 'signature-rejected', 'no-message', 'self-echo', 'duplicate'].includes(patch.stage)) {
      trace.finalStatus = 'blocked';
    }

    if (patch.note) trace.failureNote = redactSecrets(patch.note.slice(0, 200));

    dirty = true;
    queuePersist();
  } catch (err) {
    console.warn('[messageTrace] updateTrace failed (reply flow untouched):', (err as Error).message);
  }
}

/** Build the ai sub-object for a finished generateAiReply call. */
export function describeAiOutcome(args: {
  provider: 'openrouter' | 'gemini' | 'omniroute' | 'fallback';
  model: string;
  startedAt: string;
  attempts: Array<{ provider: 'openrouter' | 'gemini' | 'omniroute'; ok: boolean; error?: string }>;
}): Partial<NonNullable<MessageTrace['ai']>> {
  const endedAt = new Date().toISOString();
  const attempts = args.attempts.map((a) => {
    const classified = a.ok ? null : classifyError(a.error);
    return {
      provider: a.provider,
      ok: a.ok,
      durationMs: null as number | null,
      errorCategory: classified?.category ?? null,
      errorDetail: classified?.detail ?? null,
    };
  });
  const anyFailed = attempts.some((a) => !a.ok);
  return {
    provider: args.provider,
    model: args.model,
    startedAt: args.startedAt,
    endedAt,
    status: args.provider === 'fallback' || anyFailed ? 'canned-fallback' : 'ok',
    attempts,
  };
}

// ── Health counters (requirement #6) ────────────────────────────────────────

export interface TraceHealth {
  last24h: {
    total: number;
    delivered: number;
    failed: number;
    blocked: number;
    pending: number;
    cannedFallback: number;
    aiFailures: { openrouter: number; gemini: number; omniroute: number };
    sendFailures: number;
    sendRetryableFailures: number;
  };
  recentFailures: Array<{
    id: string;
    at: string;
    tenantId: string | null;
    igAccountId: string;
    senderHash: string;
    stage: string;
    aiProvider?: string;
    aiStatus?: string;
    sendStatus?: string;
    sendErrorCategory?: string | null;
    sendRetryable?: boolean;
    failureNote?: string;
  }>;
}

export function getTraceHealth(): TraceHealth {
  load();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const health: TraceHealth['last24h'] = {
    total: 0,
    delivered: 0,
    failed: 0,
    blocked: 0,
    pending: 0,
    cannedFallback: 0,
    aiFailures: { openrouter: 0, gemini: 0, omniroute: 0 },
    sendFailures: 0,
    sendRetryableFailures: 0,
  };

  for (const t of traces) {
    if (Date.parse(t.receivedAt) < cutoff) continue;
    health.total += 1;
    if (t.finalStatus === 'delivered') health.delivered += 1;
    else if (t.finalStatus === 'failed') health.failed += 1;
    else if (t.finalStatus === 'blocked') health.blocked += 1;
    else health.pending += 1;

    if (t.ai?.status === 'canned-fallback') health.cannedFallback += 1;
    for (const a of t.ai?.attempts ?? []) {
      if (!a.ok) health.aiFailures[a.provider] += 1;
    }
    if (t.send?.status === 'failed') {
      health.sendFailures += 1;
      if (t.send.retryable) health.sendRetryableFailures += 1;
    }
  }

  const recentFailures = traces
    .filter((t) => t.finalStatus === 'failed')
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      at: t.receivedAt,
      tenantId: t.tenantId,
      igAccountId: t.igAccountId,
      senderHash: t.senderHash,
      stage: t.lastStage,
      aiProvider: t.ai?.provider,
      aiStatus: t.ai?.status,
      sendStatus: t.send?.status,
      sendErrorCategory: t.send?.errorCategory ?? null,
      sendRetryable: t.send?.retryable,
      failureNote: t.failureNote,
    }));

  return { last24h: health, recentFailures };
}

/** Test hook: drop everything (only used by the test harness with a temp DATA_DIR). */
export function _resetForTests() {
  traces.length = 0;
  loaded = false;
  dirty = false;
}
