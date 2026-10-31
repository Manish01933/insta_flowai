import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';
import {
  isRetryableCategory,
  classifyError,
  type ErrorCategory,
} from './messageTrace';

/**
 * Task 3 — durable retry queue for failed Instagram outbound DM replies.
 *
 * Design contract (pre-implementation audit, owner-approved):
 *
 *  - Storage lives in DATA_DIR (the Railway volume mount in production), as a
 *    single JSON file, written atomically (temp file + rename) exactly like
 *    messageDedupe / botControlStore. Concurrent writes are serialized through
 *    a `persistChain` promise so 25 simultaneous saves cannot interleave.
 *  - A corrupt or torn file is renamed aside (`queue-corrupt-<ts>.json`) and
 *    boot continues with an empty queue — jobs are lost, loudly, never the
 *    whole store.
 *  - Capacity is bounded (RETRY_QUEUE_MAX, default 50). A full queue refuses
 *    the NEW job and counts it (`queueDrops`); nothing is evicted silently.
 *  - Only CONFIRMED transient send failures retry: HTTP 429 (rate-limit) and
 *    5xx (server-error) classify cleanly — the request demonstrably did not
 *    reach a talking stage. A timeout or a network throw is AMBIGUOUS (the
 *    request may already have been accepted), so it is never blindly resent;
 *    it is counted in `ambiguousSends` for the owner to see. Exactly-once is
 *    NOT promised — at-most-N-retries is what exists.
 *  - Permanent failures (auth 190/102, permission 10/200, invalid request)
 *    never enter the queue.
 *  - Records store a stable jobId, never plaintext tokens and never AI keys.
 *    The tenant's access token is decrypted at send-time by the caller.
 *  - RECOVERY: on boot the expired scan runs only for processing-eligible
 *    jobs (leaseUntil expired). Job expiry (RETRY_JOB_TTL_MS) removes stale
 *    jobs. Multiple replicas on one volume file are UNSAFE (two writers) —
 *    the documented rule is RETRY_ENABLED=false before scaling up. The
 *    default is disabled.
 */

// Re-enabled only when the owner explicitly sets RETRY_ENABLED=true.
// GlobalThis indirection exists so tests can flip the switch without env races.
export let RETRY_ENABLED: boolean =
  (process.env.RETRY_ENABLED || 'false').trim().toLowerCase() === 'true';

export function setRetryEnabledForTests(value: boolean): void {
  RETRY_ENABLED = value;
}

const QUEUE_MAX = parsePositiveInt('RETRY_QUEUE_MAX', 50, 1, 500);
const MAX_ATTEMPTS = parsePositiveInt('RETRY_MAX_ATTEMPTS', 3, 1, 10);
const JOB_TTL_MS = parsePositiveInt('RETRY_JOB_TTL_MS', 4 * 60 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
const BASE_DELAY_MS = parsePositiveInt('RETRY_BASE_DELAY_MS', 30_000, 5_000, 10 * 60 * 1000);
const LEASE_MS = parsePositiveInt('RETRY_LEASE_MS', 60_000, 10_000, 5 * 60 * 1000);

function parsePositiveInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Resolved per call so isolated tests can point the queue at a temp dir. */
export function retryQueueBaseDir(): string {
  return (globalThis as any).__RETRY_QUEUE_TEST_DIR__ || DATA_DIR;
}

function queueFilePath(): string {
  return path.join(retryQueueBaseDir(), 'retry-queue.json');
}

export interface RetryJob {
  /** Stable dedupe key: tenant|igAccount|recipient|ingressMid-derived. */
  jobId: string;
  tenantId: string;
  instagramAccountId: string;
  /** Raw recipient id — needed to send, never logged. */
  recipientId: string;
  senderId: string;
  /** The exact reply text that failed. Retried verbatim, never re-generated. */
  replyText: string;
  authMode?: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseUntil?: number;
  createdAt: number;
  lastErrorCategory?: ErrorCategory;
  lastErrorDetail?: string;
}

interface QueueShape {
  version: 1;
  jobs: RetryJob[];
}

export interface RetryQueueStats {
  enabled: boolean;
  configured: boolean;
  depth: number;
  capacity: number;
  delivered: number;
  retryAttempts: number;
  permanentFailures: number;
  expiredJobs: number;
  queueDrops: number;
  ambiguousSends: number;
  recoveryFailures: number;
  firstSendFailuresDeriving: number;
  byCategory: Record<string, number>;
  lastError?: string;
}

// Serializes every write of the queue file — same pattern that made
// messageTrace concurrent-writer tests pass.
let persistChain: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Diagnostics counters (process-lifetime). Never count secrets, only numbers.
// ---------------------------------------------------------------------------
const counters = {
  delivered: 0,
  retryAttempts: 0,
  permanentFailures: 0,
  expiredJobs: 0,
  queueDrops: 0,
  ambiguousSends: 0,
  recoveryFailures: 0,
  firstSendFailuresDeriving: 0,
  byCategory: new Map<string, number>(),
};

let loaded = false;
let queue: RetryJob[] = [];

function bumpCategory(cat: string) {
  counters.byCategory.set(cat, (counters.byCategory.get(cat) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Persistence (atomic + serialized + corruption-recovery)
// ---------------------------------------------------------------------------
function persistSnapshot(): void {
  const file = queueFilePath();
  const base = path.dirname(file);
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  const data: QueueShape = { version: 1, jobs: queue };
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpFile, file);
}

function persist(): Promise<void> {
  const run = persistChain.then(() => {
    try {
      persistSnapshot();
    } catch (err: any) {
      counters.recoveryFailures += 1;
      console.error(`[retryQueue] persist failed: ${redact(err?.message)}`);
      throw err; // keep failed promise so ordering is preserved
    }
  });
  // The chain swallows errors after ordering counts; the caller's own persist
  // above already surfaced the failure in logs + counters.
  persistChain = run.catch(() => undefined);
  return run;
}

function redact(raw: unknown): string {
  return String(raw || '')
    .replace(/(access_token|client_secret|api_?key|token)=?[^&\s"',}]+/gi, '$1=<redacted>')
    .slice(0, 200);
}

/** Load once. Corrupt file → rename aside + start empty (loud). */
export function loadRetryQueue(): void {
  if (loaded) return;
  loaded = true;
  try {
    const QUEUE_FILE = queueFilePath();
    if (!fs.existsSync(QUEUE_FILE)) return;
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as QueueShape;
    if (!parsed || !Array.isArray(parsed.jobs)) {
      throw new Error('retry-queue.json is not {version, jobs[]} shaped');
    }
    const now = Date.now();
    queue = parsed.jobs.filter((j) => {
      if (j.createdAt + JOB_TTL_MS <= now) {
        counters.expiredJobs += 1;
        return false;
      }
      return true;
    });
    // Persist the pruned state so expiry survives a second restart too.
    void persist();
    console.log(`[retryQueue] Loaded ${queue.length} pending job(s) from ${queueFilePath()}`);
  } catch (err: any) {
    // Corruption: keep the broken file as evidence, start clean, never crash.
    counters.recoveryFailures += 1;
    try {
      const aside = path.join(path.dirname(queueFilePath()), `queue-corrupt-${Date.now()}.json`);
      fs.renameSync(queueFilePath(), aside);
      console.error(`[retryQueue] CORRUPT queue file moved to ${aside}; starting with an empty queue (pending jobs lost).`);
    } catch (renameErr) {
      console.error(`[retryQueue] CORRUPT queue file could not be moved aside; starting with an empty queue. ${redact(renameErr)}`);
    }
    queue = [];
  }
}

// ---------------------------------------------------------------------------
// Enqueue (called from the webhook send-failure path)
// ---------------------------------------------------------------------------

/**
 * Stable job key — same trace/dedupe identity for the same failed reply so
 * a duplicate webhook never enqueues the same job twice.
 */
export function buildJobId(tenantId: string, igAccountId: string, recipientId: string, mid: string | null): string {
  return `${tenantId}|${igAccountId}|${recipientId}|${mid || 'no-mid'}`;
}

/**
 * Classify the failed send and either enqueue (confirmed transient) or count
 * as ambiguous / permanent. Returns what happened, tokens never included.
 */
export function offerFailedSend(args: {
  tenantId: string;
  instagramAccountId: string;
  recipientId: string;
  senderId: string;
  replyText: string;
  authMode?: string;
  rawError: string | undefined;
  mid: string | null;
}): { enqueued: boolean; reason: string } {
  loadRetryQueue();
  if (!RETRY_ENABLED) {
    return { enqueued: false, reason: 'disabled' };
  }

  const classified = classifyError(args.rawError);
  const category = classified.category;
  bumpCategory(category);

  const isTransient = isRetryableCategory(category);
  // Timeouts / network throws are ambiguous: the send may already be talking
  // to Meta. Rate-limit and 5xx come back as an HTTP status with no delivery
  // — confirmed-transient, safe to retry.
  const ambiguous = category === 'timeout' || category === 'network';
  if (!isTransient || ambiguous) {
    if (ambiguous) counters.ambiguousSends += 1;
    return { enqueued: false, reason: ambiguous ? 'ambiguous' : `permanent-${category}` };
  }

  return enqueueRetry({
    jobId: buildJobId(args.tenantId, args.instagramAccountId, args.recipientId, args.mid),
    tenantId: args.tenantId,
    instagramAccountId: args.instagramAccountId,
    recipientId: args.recipientId,
    senderId: args.senderId,
    replyText: args.replyText,
    authMode: args.authMode,
  });
}

function enqueueRetry(job: Omit<RetryJob, 'attempts' | 'maxAttempts' | 'nextAttemptAt' | 'createdAt'>): { enqueued: boolean; reason: string } {
  const now = Date.now();
  if (queue.length >= QUEUE_MAX) {
    counters.queueDrops += 1;
    console.warn(`[retryQueue] capacity full (${queue.length}/${QUEUE_MAX}) — newest failure refused, existing jobs kept.`);
    return { enqueued: false, reason: 'capacity-full' };
  }
  // Idempotent retry-job: an identical failed reply is never queued twice.
  if (queue.some((j) => j.jobId === job.jobId)) {
    return { enqueued: false, reason: 'duplicate' };
  }
  queue.push({
    ...job,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now + BASE_DELAY_MS,
    createdAt: now,
  });
  counters.firstSendFailuresDeriving += 1;
  void persist();
  console.log(`[retryQueue] enqueued job (depth=${queue.length}/${QUEUE_MAX}, attempts<=${MAX_ATTEMPTS}, first attempt in ${Math.round(BASE_DELAY_MS / 1000)}s) category=${queue[queue.length - 1].lastErrorCategory || 'n/a'}`);
  return { enqueued: true, reason: 'queued' };
}

// ---------------------------------------------------------------------------
// Retry processing (sweeper driven)
// ---------------------------------------------------------------------------

export interface RetrySenderId {
  /** Resolved at send-time by the caller — never persisted in the queue. */
  send: (args: {
    tenantId: string;
    instagramAccountId: string;
    recipientId: string;
    replyText: string;
    authMode?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Task 3 B1 — pre-send safety contract. Injected by server.ts so this module
 * stays free of store imports (and tests can drive each guard directly).
 * Every check reflects CURRENT state at the moment of send, never enqueue-time
 * state: a bot paused, a human takeover or a burst cap tripped AFTER enqueue
 * must stop the queued reply.
 */
export interface RetryGuards {
  /** Tenant bot switch: global brake + per-tenant switch (current state). */
  botEnabled: (tenantId: string) => boolean;
  /** Human takeover of this exact conversation? */
  humanTakeover: (instagramAccountId: string, recipientId: string) => boolean;
  /** Would this reply break the burst cap for this conversation? */
  burstCap: (instagramAccountId: string, recipientId: string) => boolean;
  /** Verified tenant↔account ownership link (registry, not client input). */
  ownsAccount: (tenantId: string, instagramAccountId: string) => boolean;
}

let afkGuardRegistry: RetryGuards | null = null;
export function setRetryGuards(g: RetryGuards | null): void {
  afkGuardRegistry = g;
}
function getGuards(): RetryGuards | null {
  return afkGuardRegistry;
}

function backoffWithJitter(attempt: number): number {
  const exponential = Math.min(60_000, BASE_DELAY_MS * Math.pow(2, attempt));
  const jitter = Math.random() * Math.min(5_000, BASE_DELAY_MS);
  return exponential + jitter;
}

/**
 * Runs due jobs serially. Each job is leased (leaseUntil = now + LEASE_MS)
 * before sending; the lease makes a concurrent sweeper within one process a
 * no-op and prevents a crashed sweeper from double-processing.
 */
export async function processDueRetryJobs(
  sender: RetrySenderId['send']
): Promise<{ processed: number; delivered: number; failures: number }> {
  if (!RETRY_ENABLED) return { processed: 0, delivered: 0, failures: 0 };
  loadRetryQueue();

  const now = Date.now();
  let processed = 0;
  let delivered = 0;
  let failures = 0;

  for (const job of [...queue]) {
    if (job.leaseUntil && job.leaseUntil > now) continue;
    if (job.nextAttemptAt > now) continue;
    if (job.createdAt + JOB_TTL_MS <= now) {
      counters.expiredJobs += 1;
      queue = queue.filter((j) => j.jobId !== job.jobId);
      void persist();
      continue;
    }

    // ---- Task 3 B1: refresh every blocking guard BEFORE the send ----
    const guards = getGuards();
    if (guards) {
      // Ownership first: a stale/foreign tenant↔account pair never sends and
      // is dropped at once (no loop: the job leaves the queue).
      if (!guards.ownsAccount(job.tenantId, job.instagramAccountId)) {
        counters.permanentFailures += 1;
        queue = queue.filter((j) => j.jobId !== job.jobId);
        void persist();
        console.error(`[retryQueue] job ${job.jobId} ownership check failed — job removed without sending.`);
        failures += 1;
        continue;
      }
      // Bot disabled (global brake or tenant switch): DO NOT send. The job is
      // reversible state, so it is DEFERRED (lease cleared, next attempt in
      // the normal backoff slot) — never an endless loop, never a resend.
      if (!guards.botEnabled(job.tenantId)) {
        job.leaseUntil = undefined;
        job.nextAttemptAt = Date.now() + Math.min(15 * 60_000, backoffWithJitter(job.attempts));
        void persist();
        console.warn(`[retryQueue] job ${job.jobId} bot disabled — deferred, not sent.`);
        continue;
      }
      // Human takeover of the conversation: the job's purpose is gone; the
      // job is REMOVED (existing takeover semantics: a human owns the thread).
      if (guards.humanTakeover(job.instagramAccountId, job.recipientId)) {
        counters.permanentFailures += 1;
        queue = queue.filter((j) => j.jobId !== job.jobId);
        void persist();
        console.warn(`[retryQueue] job ${job.jobId} human takeover active — job removed, human owns the thread.`);
        failures += 1;
        continue;
      }
      // Burst cap: the reply WOULD break the loop guard. Send nothing; DEFER
      // (window will roll off) — removing the job would be wrong because the
      // cap is time-windowed, but it can never loop: no send happens.
      if (guards.burstCap(job.instagramAccountId, job.recipientId)) {
        job.leaseUntil = undefined;
        job.nextAttemptAt = Date.now() + Math.min(15 * 60_000, backoffWithJitter(job.attempts));
        void persist();
        console.warn(`[retryQueue] job ${job.jobId} burst cap active — deferred, not sent.`);
        continue;
      }
    }

    // Lease BEFORE sending so a long send cannot be re-started concurrently.
    job.leaseUntil = now + LEASE_MS;
    void persist();
    processed += 1;
    counters.retryAttempts += 1;

    let result: { success: boolean; error?: string };
    try {
      result = await sender({
        tenantId: job.tenantId,
        instagramAccountId: job.instagramAccountId,
        recipientId: job.recipientId,
        replyText: job.replyText,
        authMode: job.authMode,
      });
    } catch (err: any) {
      result = { success: false, error: err?.message };
    }

    if (result.success) {
      delivered += 1;
      counters.delivered += 1;
      bumpCategory('retry-delivered');
      queue = queue.filter((j) => j.jobId !== job.jobId);
      void persist();
      console.log(`[retryQueue] job delivered on retry ${job.attempts + 1}/${job.maxAttempts}`);
      continue;
    }

    const classified = classifyError(result.error);
    job.lastErrorCategory = classified.category;
    job.lastErrorDetail = classified.detail;
    bumpCategory(classified.category);

    const isTransient = isRetryableCategory(classified.category);
    const ambiguous = classified.category === 'timeout' || classified.category === 'network';

    if (!isTransient && !ambiguous) {
      // Auth/permission/invalid — never retry, surface per-tenant health flags.
      counters.permanentFailures += 1;
      queue = queue.filter((j) => j.jobId !== job.jobId);
      void persist();
      console.error(`[retryQueue] job ${job.jobId} permanent failure (category=${classified.category}); giving up — token/connect health flags remain owned by server.ts noteSendAuthFailure path, the queue itself never touches them.`);
      failures += 1;
      continue;
    }

    if (ambiguous) {
      // Do NOT blindly resend (the previous attempt may have been accepted).
      counters.ambiguousSends += 1;
      failures += 1;
      const attemptsUsed = job.attempts + 1;
      if (attemptsUsed >= job.maxAttempts) {
        queue = queue.filter((j) => j.jobId !== job.jobId);
        void persist();
        console.warn(`[retryQueue] job ${job.jobId} exhausted attempts with ambiguous outcome; dropped (no resend).`);
      } else {
        job.attempts = attemptsUsed;
        job.leaseUntil = undefined;
        job.nextAttemptAt = Date.now() + backoffWithJitter(attemptsUsed);
        void persist();
      }
      continue;
    }

    // Confirmed transient (rate-limit / 5xx): schedule the next attempt.
    job.attempts += 1;
    job.leaseUntil = undefined;
    if (job.attempts >= job.maxAttempts) {
      counters.permanentFailures += 1;
      queue = queue.filter((j) => j.jobId !== job.jobId);
      void persist();
      console.warn(`[retryQueue] job ${job.jobId} exhausted ${job.maxAttempts} attempts (last category=${classified.category}).`);
      failures += 1;
    } else {
      job.nextAttemptAt = Date.now() + backoffWithJitter(job.attempts);
      void persist();
      console.warn(`[retryQueue] job ${job.jobId} transient failure, next attempt in ${Math.round((job.nextAttemptAt - Date.now()) / 1000)}s (attempts=${job.attempts}/${job.maxAttempts}) category=${classified.category}`);
      failures += 1;
    }
  }

  return { processed, delivered, failures };
}



// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
export function getRetryQueueStats(): RetryQueueStats {
  loadRetryQueue();
  const byCategory: Record<string, number> = {};
  counters.byCategory.forEach((v, k) => {
    byCategory[k] = v;
  });
  return {
    enabled: RETRY_ENABLED,
    configured: Boolean(process.env.DATA_DIR),
    depth: queue.length,
    capacity: QUEUE_MAX,
    delivered: counters.delivered,
    retryAttempts: counters.retryAttempts,
    permanentFailures: counters.permanentFailures,
    expiredJobs: counters.expiredJobs,
    queueDrops: counters.queueDrops,
    ambiguousSends: counters.ambiguousSends,
    recoveryFailures: counters.recoveryFailures,
    firstSendFailuresDeriving: counters.firstSendFailuresDeriving,
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Owner console — see and unstick queued sends. This is the fix path for
// "customer bole reply nahi aaya": the reply is sitting in the queue, the owner
// can read why (last error category) and force it due now or drop it.
// ---------------------------------------------------------------------------

/** One queued job as the owner console shows it. The raw recipient id is
 *  masked (ids are not secrets, but the console has no need for the full one);
 *  the reply text is the owner's own bot's words and is shown verbatim. */
export interface RetryJobView {
  jobId: string;
  tenantId: string;
  instagramAccountId: string;
  recipientMasked: string;
  replyText: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastErrorCategory?: string;
  lastErrorDetail?: string;
}

export function listRetryJobs(): RetryJobView[] {
  loadRetryQueue();
  return [...queue]
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    .map((job) => ({
      jobId: job.jobId,
      tenantId: job.tenantId,
      instagramAccountId: job.instagramAccountId,
      recipientMasked: job.recipientId ? `…${String(job.recipientId).slice(-4)}` : '',
      replyText: job.replyText,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt,
      createdAt: job.createdAt,
      lastErrorCategory: job.lastErrorCategory,
      lastErrorDetail: job.lastErrorDetail,
    }));
}

/**
 * Make one job due immediately (owner "Retry now"). Returns false when the job
 * is already gone (delivered or expired between render and click) — the UI
 * refreshes and the row simply disappears.
 */
export function promoteRetryJob(jobId: string): boolean {
  loadRetryQueue();
  const job = queue.find((j) => j.jobId === jobId);
  if (!job) return false;
  job.leaseUntil = undefined;
  job.nextAttemptAt = Date.now();
  void persist();
  return true;
}

/** Drop one job (owner "Discard" — e.g. the customer was answered by hand). */
export function discardRetryJob(jobId: string): boolean {
  loadRetryQueue();
  const before = queue.length;
  queue = queue.filter((j) => j.jobId !== jobId);
  if (queue.length === before) return false;
  void persist();
  return true;
}

/** Test hook — resets in-memory state and points DATA_DIR-relative path at a temp dir. */
export function _resetForTests(dir?: string) {
  loaded = false;
  queue = [];
  persistChain = Promise.resolve();
  counters.delivered = 0;
  counters.retryAttempts = 0;
  counters.permanentFailures = 0;
  counters.expiredJobs = 0;
  counters.queueDrops = 0;
  counters.ambiguousSends = 0;
  counters.recoveryFailures = 0;
  counters.firstSendFailuresDeriving = 0;
  counters.byCategory.clear();
  // QUEUE_FILE is module-const; tests override via DATA_DIR before import.
  if (dir) {
    (globalThis as any).__RETRY_QUEUE_TEST_DIR__ = dir;
  } else {
    delete (globalThis as any).__RETRY_QUEUE_TEST_DIR__;
  }
}
