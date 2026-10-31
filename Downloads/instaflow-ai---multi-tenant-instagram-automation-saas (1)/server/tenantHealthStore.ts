import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Per-tenant runtime health facts, derived ONLY from events that actually
 * happened while this process handled Instagram DMs.
 *
 * Why this store exists: the Ops row could always say "CONNECTED", but nothing
 * durable answered "when did this customer's bot last actually get a DM, and
 * did a reply still go out?". The trace ring (`messageTrace.ts`) expires after
 * 48 h and is per-DM, the chat store is a conversation log — neither is a place
 * to count "3 send failures in half an hour" for alerting. This one small JSON
 * file is.
 *
 * Design rules (same pattern as messageDedupe / retryQueue):
 *  - one JSON file under DATA_DIR, written atomically (temp file + rename),
 *    serialized through a promise chain so parallel writes cannot interleave;
 *  - bounded: a fixed-size event ring per tenant, pruned past retention days;
 *  - never stores tokens, messaging text or customer words — only categories,
 *    durations and a short redacted diagnostic (the same safe strings
 *    `classifyError` already produces);
 *  - never the source of truth for billing/access decisions — the existing
 *    stores stay authoritative; this only FEEDS the owner console and alerts;
 *  - failures to persist are logged loudly but never crash message handling.
 *
 * One file = one writer (single Node process). Multi-replica deployments must
 * keep this store disabled-by-default access path safe: like the retry queue,
 * the file is not safe for concurrent writers from two containers.
 */

export type HealthEventKind =
  | 'inbound'
  | 'send-ok'
  | 'send-fail'
  | 'ai-fail'
  | 'webhook-fail'
  | 'storage-fail';

export interface HealthEvent {
  at: string;
  kind: HealthEventKind;
  /** Safe error category from classifyError, when the event came from a failure. */
  category?: string;
  /** Short, already-redacted diagnostic detail (never echoes raw tokens). */
  detail?: string;
  /** True when the send outcome was uncertain (timeout / network throw). */
  ambiguous?: boolean;
  /** Which connected Instagram account the event belongs to (when known). */
  igAccountIdMasked?: string;
}

export interface TenantHealthRecord {
  tenantId: string;
  lastInboundAt: string | null;
  lastSendOkAt: string | null;
  /** Latest failed/uncertain outbound send observed in this process. */
  lastSendFailAt: string | null;
  lastSendFailCategory: string | null;
  lastAiFailAt: string | null;
  lastWebhookFailAt: string | null;
  lastErrorAt: string | null;
  lastErrorCategory: string | null;
  lastErrorDetail: string | null;
  /** Bounded recent-event ring (newest first). */
  events: HealthEvent[];
}

interface HealthStoreFile {
  version: 1;
  tenants: Record<string, { summary: Omit<TenantHealthRecord, 'tenantId' | 'events'>; events: HealthEvent[] }>;
}

const FILE_NAME = 'tenant-health.json';
/** Resolved per call so isolated tests can point the store at a temp dir. */
function filePath(): string {
  const override = (globalThis as any).__HEALTH_STORE_TEST_DIR__;
  return override ? path.join(String(override), FILE_NAME) : path.join(DATA_DIR, FILE_NAME);
}
const RETENTION_DAYS = 14;
const MAX_EVENTS_PER_TENANT = 60;
const MAX_DETAIL_CHARS = 220;

const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

let state: HealthStoreFile | null = null;
let persistChain: Promise<void> = Promise.resolve();
let loaded = false;

function redact(raw: unknown): string {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/(access_token|client_secret|api_?key|token|password)=?[^&\s"',}]+/gi, '$1=<redacted>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted-long-token>')
    .slice(0, MAX_DETAIL_CHARS);
}

function load(): HealthStoreFile {
  if (loaded && state) return state;
  loaded = true;
  state = { version: 1, tenants: {} };
  try {
    if (fs.existsSync(filePath())) {
      const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as HealthStoreFile;
      if (parsed && parsed.version === 1 && parsed.tenants && typeof parsed.tenants === 'object') {
        state = parsed;
      }
    }
  } catch (err) {
    // A corrupt health file must never block message handling: start empty,
    // keep the broken file as evidence.
    try {
      fs.renameSync(filePath(), `${filePath()}.corrupt-${Date.now()}`);
    } catch {
      // rename failed — nothing more we can do; fresh start anyway.
    }
    console.error('[tenantHealth] corrupt tenant-health.json moved aside; starting empty.');
    state = { version: 1, tenants: {} };
  }
  return state;
}

function persistSnapshot() {
  const file = filePath();
  const base = path.dirname(file);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const current = load();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current), 'utf8');
  fs.renameSync(tmp, file);
}

function persist(): Promise<void> {
  const run = persistChain.then(() => {
    try {
      persistSnapshot();
    } catch (err) {
      console.error('[tenantHealth] persist failed:', err);
      // Storage failure is itself a monitored condition (Platform Health).
      noteInternal('storage-fail', undefined, undefined, String((err as any)?.message || err));
    }
  });
  persistChain = run.catch(() => undefined);
  return run;
}

function emptySummary() {
  return {
    lastInboundAt: null,
    lastSendOkAt: null,
    lastSendFailAt: null,
    lastSendFailCategory: null,
    lastAiFailAt: null,
    lastWebhookFailAt: null,
    lastErrorAt: null,
    lastErrorCategory: null,
    lastErrorDetail: null,
  };
}

function record(tenantId: string, event: HealthEvent): NotesResult {
  const current = load();
  const id = String(tenantId || '').trim();
  if (!id) {
    // Tenantless events (platform-level) are recorded on the special bucket.
    current.tenants['__platform__'] ||= { summary: emptySummary(), events: [] };
    pushPlatform(current.tenants['__platform__'].events, event);
    void persist();
    return { changed: true };
  }
  const entry = (current.tenants[id] ||= { summary: emptySummary(), events: [] });
  const now = event.at;
  const s = entry.summary;

  const prevErrorAt = s.lastErrorAt;
  switch (event.kind) {
    case 'inbound':
      s.lastInboundAt = now;
      break;
    case 'send-ok':
      s.lastSendOkAt = now;
      break;
    case 'send-fail':
      s.lastSendFailAt = now;
      s.lastSendFailCategory = event.category || null;
      // Distinguish "known-failed" from "uncertain outcome" in the error fields.
      if (!event.ambiguous) {
        s.lastErrorAt = now;
        s.lastErrorCategory = event.category || null;
        s.lastErrorDetail = event.detail || null;
      }
      break;
    case 'ai-fail':
      s.lastAiFailAt = now;
      s.lastErrorAt = now;
      s.lastErrorCategory = 'ai';
      s.lastErrorDetail = event.detail || null;
      break;
    case 'webhook-fail':
      s.lastWebhookFailAt = now;
      if (s.lastErrorAt === null || Date.parse(now) >= (prevErrorAt ? Date.parse(prevErrorAt) : 0)) {
        s.lastErrorAt = now;
        s.lastErrorCategory = 'webhook';
        s.lastErrorDetail = event.detail || null;
      }
      break;
    case 'storage-fail':
      if (Date.parse(now) >= (s.lastErrorAt ? Date.parse(s.lastErrorAt) : 0)) {
        s.lastErrorAt = now;
        s.lastErrorCategory = 'storage';
        s.lastErrorDetail = event.detail || null;
      }
      break;
  }
  entry.events.unshift(event);
  prune(entry.events);
  void persist();
  return { changed: true };
}

function pushPlatform(events: HealthEvent[], event: HealthEvent) {
  events.unshift(event);
  events.length = Math.min(events.length, MAX_EVENTS_PER_TENANT);
  const cutoff = Date.now() - RETENTION_MS;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (Date.parse(events[i].at) < cutoff) events.splice(i, 1);
  }
}

function prune(events: HealthEvent[]) {
  events.length = Math.min(events.length, MAX_EVENTS_PER_TENANT);
  const cutoff = Date.now() - RETENTION_MS;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (Date.parse(events[i].at) < cutoff) events.splice(i, 1);
  }
}

/** Internal result of a note (kept minimal: the store is not a message path). */
export interface NotesResult {
  changed: boolean;
  event?: HealthEvent;
}

/** Hot path guard so call sites can always skip cheaply when unneeded. */
export interface HealthListener {
  (event: HealthEvent, tenantId: string): void;
}

const listeners: HealthListener[] = [];

/** Alert evaluator registers here; invoked synchronously after each note. */
export function onHealthEvent(listener: HealthListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

function emit(event: HealthEvent, tenantId: string) {
  listeners.forEach((listener) => {
    try {
      listener(event, tenantId);
    } catch (err) {
      console.error('[tenantHealth] listener failed:', err);
    }
  });
}

function noteInternal(
  kind: HealthEventKind,
  tenantId: string | undefined,
  igAccountId: string | undefined,
  detail?: string
): void {
  const at = new Date().toISOString();
  const event: HealthEvent = {
    at,
    kind,
    detail: detail ? redact(detail) : undefined,
  };
  record(tenantId || '__platform__', { ...event, igAccountIdMasked: igAccountId ? maskId(igAccountId) : undefined });
  emit(event, tenantId || '__platform__');
}

/** Mask an Instagram/account id: keep first 5 + last 3 characters. */
export function maskId(id: unknown): string {
  const text = String(id || '').trim();
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 5)}***${text.slice(-3)}`;
}

// ---------------------------------------------------------------------------
// Public note API (called from the real webhook/AI/send paths in server.ts)
// ---------------------------------------------------------------------------

export function noteInbound(tenantId: string): void {
  noteInternal('inbound', tenantId, undefined);
}

export function noteSendSuccess(tenantId: string, igAccountId?: string): void {
  noteInternal('send-ok', tenantId, igAccountId);
}

export function noteSendFailure(tenantId: string, args: { igAccountId?: string; category?: string; detail?: string; ambiguous?: boolean }): void {
  const at = new Date().toISOString();
  const event: HealthEvent = {
    at,
    kind: 'send-fail',
    category: args.category || undefined,
    detail: args.detail ? redact(args.detail) : undefined,
    ambiguous: Boolean(args.ambiguous),
  };
  record(tenantId, { ...event, igAccountIdMasked: args.igAccountId ? maskId(args.igAccountId) : undefined });
  emit(event, tenantId);
}

export function noteAiFailure(tenantId: string, args: { detail?: string }): void {
  noteInternal('ai-fail', tenantId, undefined, args.detail);
}

export function noteWebhookFailure(args: { tenantId?: string; kind: 'unrouted' | 'exception'; detail?: string }): void {
  noteInternal('webhook-fail', args.tenantId, undefined, args.detail || args.kind);
}

export function noteStorageFailure(args: { tenantId?: string; context: string }): void {
  noteInternal('storage-fail', args.tenantId, undefined, args.context);
}

// ---------------------------------------------------------------------------
// Reads (owner console + alert evaluator)
// ---------------------------------------------------------------------------

export function getTenantHealthFacts(tenantId: string): TenantHealthRecord {
  const current = load();
  const entry = current.tenants[String(tenantId || '').trim()];
  if (!entry) {
    return {
      tenantId,
      lastInboundAt: null,
      lastSendOkAt: null,
      lastSendFailAt: null,
      lastSendFailCategory: null,
      lastAiFailAt: null,
      lastWebhookFailAt: null,
      lastErrorAt: null,
      lastErrorCategory: null,
      lastErrorDetail: null,
      events: [],
    };
  }
  return { tenantId, ...entry.summary, events: [...entry.events] };
}

export function getHealthFactsByTenant(): Record<string, TenantHealthRecord> {
  const current = load();
  const out: Record<string, TenantHealthRecord> = {};
  Object.keys(current.tenants).forEach((tenantId) => {
    if (tenantId === '__platform__') return;
    out[tenantId] = getTenantHealthFacts(tenantId);
  });
  return out;
}

export function getPlatformHealthEvents(): HealthEvent[] {
  const current = load();
  const entry = current.tenants['__platform__'];
  return entry ? [...entry.events] : [];
}

/** Number of send failures (excluding ambiguous) for one tenant inside the window. */
export function countSendFailuresWithin(tenantId: string, windowMs: number, now = Date.now()): number {
  const facts = getTenantHealthFacts(tenantId);
  return facts.events.filter(
    (event) =>
      event.kind === 'send-fail' &&
      !event.ambiguous &&
      now - Date.parse(event.at) <= windowMs
  ).length;
}

export function countAiFailuresWithin(tenantId: string, windowMs: number, now = Date.now()): number {
  const facts = getTenantHealthFacts(tenantId);
  return facts.events.filter(
    (event) => event.kind === 'ai-fail' && now - Date.parse(event.at) <= windowMs
  ).length;
}

/** Housekeeping: prune everything past retention; run from a sweeper (unref'd). */
export function startHealthStoreSweeper(): void {
  const sweep = () => {
    const current = load();
    const cutoff = Date.now() - RETENTION_MS;
    let changed = false;
    Object.keys(current.tenants).forEach((tenantId) => {
      const entry = current.tenants[tenantId];
      const before = entry.events.length;
      for (let i = entry.events.length - 1; i >= 0; i -= 1) {
        if (Date.parse(entry.events[i].at) < cutoff) entry.events.splice(i, 1);
      }
      if (entry.events.length !== before) changed = true;
    });
    if (changed) void persist();
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

/** Test hook. */
export function _resetHealthStoreForTests(): void {
  state = { version: 1, tenants: {} };
  loaded = true;
  persistChain = Promise.resolve();
  listeners.length = 0;
}

/** Test hook: point the store file at a temp dir (never the production DATA_DIR). */
export function _setHealthStoreTestDir(dir?: string): void {
  if (dir) (globalThis as any).__HEALTH_STORE_TEST_DIR__ = dir;
  else delete (globalThis as any).__HEALTH_STORE_TEST_DIR__;
  _resetHealthStoreForTests();
}
