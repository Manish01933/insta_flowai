import fs from 'fs';
import path from 'path';
import { DATA_DIR, isPersistentDataDirConfigured } from './connectionStore';
import { isValidInstagramUsername, normaliseInstagramUsername } from './testerRequestStore';

/**
 * Why a customer's Connect attempt ended the way it did.
 *
 * Why this exists: "Instagram not connected" is the single most common row in the
 * Ops Console, and it was also the least actionable — the console could see the
 * account had no connection but had no idea *why*. The reasons are wildly
 * different and only one of them is fixable from the dashboard:
 *
 *   - Instagram's access gate refused the OAuth (the account is not a tester);
 *   - Meta returned a real error (redirect URI mismatch, revoked app, bad code);
 *   - the customer authorised a personal account, so no professional account was
 *     found;
 *   - the customer never pressed Connect at all.
 *
 * All four look identical from outside. So every attempt now leaves a record here,
 * written both by the OAuth callback (what the server saw) and by the dashboard
 * (what the browser was told — a failure that never reached the callback would
 * otherwise leave no trace anywhere).
 *
 * It also fixes a smaller, older problem: a *failed* OAuth never reaches the
 * account-discovery step, so the server never learned the handle the customer was
 * trying with. When the blocked-connect screen sends the handle along, it is kept
 * here — which is what lets the Ops Console name the account instead of showing
 * `no handle`.
 */

const FILE = path.join(DATA_DIR, 'connect-attempts.json');

/** Per-tenant ring of recent attempts: the interesting one is always the latest. */
const MAX_PER_TENANT = 5;
/** Cap on tenants, oldest-touched dropped first. */
const MAX_TENANTS = 500;
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_CHARS = 300;

export type ConnectAttemptStage = 'blocked' | 'error' | 'success';

/**
 * `blocked` — Instagram refused before/at the consent screen (access gate);
 * `error` — anything else that stopped the connect;
 * `success` — a connect that completed (kept so "it worked yesterday" is readable).
 */
export interface ConnectAttempt {
  tenantId: string;
  at: string;
  stage: ConnectAttemptStage;
  /** Meta's own `error` / `error_reason`, when it sent one. */
  code?: string;
  /** What the customer was told, verbatim — Meta's description or ours. */
  message?: string;
  /** The Instagram handle this attempt was for, when we got to see it. */
  username?: string;
  /** Where the record came from, so a stale browser report can be told apart. */
  source: 'callback' | 'dashboard' | 'owner';
}

const attempts = new Map<string, ConnectAttempt[]>();
let loaded = false;

/** Same shape as the other volume stores: a plain id, bounded length. */
function isValidTenantId(tenantId: string): boolean {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(String(tenantId || ''));
}

function clean(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('[connectAttempts] Failed to create data directory:', err);
  }
}

function persist() {
  try {
    ensureDataDir();

    // Trim before writing: the cap is on tenants, and the ones that matter are the
    // ones touched most recently.
    const entries = Array.from(attempts.entries())
      .sort((a, b) => lastAtMs(b[1]) - lastAtMs(a[1]))
      .slice(0, MAX_TENANTS);

    const next = new Map(entries);
    attempts.clear();
    entries.forEach(([tenantId, list]) => attempts.set(tenantId, list));

    const data: Record<string, ConnectAttempt[]> = {};
    next.forEach((list, tenantId) => {
      data[tenantId] = list;
    });

    const tmpFile = `${FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, attempts: data }, null, 2), 'utf8');
    fs.renameSync(tmpFile, FILE);
  } catch (err) {
    console.error('[connectAttempts] Failed to persist connect attempts:', err);
  }
}

function lastAtMs(list: ConnectAttempt[]): number {
  const at = list.length ? Date.parse(list[list.length - 1].at) : NaN;
  return Number.isFinite(at) ? at : 0;
}

export function loadConnectAttempts(): void {
  if (loaded) return;
  loaded = true;

  if (!isPersistentDataDirConfigured && process.env.NODE_ENV === 'production') {
    console.warn(
      '[connectAttempts] DATA_DIR is not set; the record of WHY a connect failed would be lost on redeploy.'
    );
  }

  try {
    if (!fs.existsSync(FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const cutoff = Date.now() - RETENTION_MS;

    let dropped = 0;
    for (const [tenantId, value] of Object.entries(parsed?.attempts ?? {})) {
      if (!isValidTenantId(tenantId) || !Array.isArray(value)) {
        dropped += 1;
        continue;
      }
      const list = (value as ConnectAttempt[])
        .filter((entry) => entry?.at && Date.parse(entry.at) >= cutoff)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .slice(-MAX_PER_TENANT);
      if (list.length) attempts.set(tenantId, list);
      else dropped += 1;
    }

    console.log(
      `[connectAttempts] Loaded attempts for ${attempts.size} tenant(s) from ${FILE}` +
        (dropped ? ` (dropped ${dropped} empty/expired)` : '')
    );
  } catch (err) {
    console.error('[connectAttempts] Failed to load connect attempts:', err);
  }
}

/**
 * Record one attempt.
 *
 * An identical repeat inside a minute is collapsed: Meta retries its callback and
 * browsers re-mount the dashboard, and five copies of the same sentence would push
 * the earlier, different failure out of the ring.
 */
export function recordConnectAttempt(input: {
  tenantId: string;
  stage: ConnectAttemptStage;
  code?: string;
  message?: string;
  username?: string;
  source: ConnectAttempt['source'];
}): ConnectAttempt | null {
  if (!isValidTenantId(input.tenantId)) return null;
  loadConnectAttempts();

  // Normalised on the way in, exactly like the tester queue does it: this handle
  // is re-submitted to Meta and compared against what is already on file, and
  // `@Shop_One` vs `shop_one` would read as two different accounts and quietly
  // defeat both.
  const rawUsername = clean(input.username, 40);
  const normalised = rawUsername ? normaliseInstagramUsername(rawUsername) : '';

  const record: ConnectAttempt = {
    tenantId: input.tenantId,
    at: new Date().toISOString(),
    stage: input.stage,
    code: clean(input.code, 80),
    message: clean(input.message, MAX_MESSAGE_CHARS),
    username:
      normalised && isValidInstagramUsername(normalised) ? normalised : undefined,
    source: input.source,
  };

  const list = attempts.get(input.tenantId) || [];
  const previous = list[list.length - 1];
  if (
    previous &&
    previous.stage === record.stage &&
    previous.message === record.message &&
    Date.now() - Date.parse(previous.at) < 60_000
  ) {
    // Same failure, same minute, same words: keep the first timestamp.
    return previous;
  }

  list.push(record);
  attempts.set(input.tenantId, list.slice(-MAX_PER_TENANT));
  persist();
  return record;
}

/** The most recent attempt for a tenant, or null when there has never been one. */
export function getLastConnectAttempt(tenantId: string): ConnectAttempt | null {
  loadConnectAttempts();
  const list = attempts.get(tenantId);
  return list && list.length ? list[list.length - 1] : null;
}

/** Every tenant that has ever tried, newest attempt first — for the ops overview. */
export function getLastConnectAttemptByTenant(): Record<string, ConnectAttempt> {
  loadConnectAttempts();
  const result: Record<string, ConnectAttempt> = {};
  attempts.forEach((list, tenantId) => {
    if (list.length) result[tenantId] = list[list.length - 1];
  });
  return result;
}

export function listConnectAttempts(tenantId: string): ConnectAttempt[] {
  loadConnectAttempts();
  return [...(attempts.get(tenantId) || [])];
}

/**
 * The handle the customer was last seen trying with.
 *
 * This is the only way the server can learn the handle of an account whose OAuth
 * was refused by Instagram's access gate — discovery never runs, so nothing else
 * knows it.
 */
export function getLastAttemptUsername(tenantId: string): string | null {
  const attempt = getLastConnectAttempt(tenantId);
  return attempt?.username || null;
}

export function getConnectAttemptStats() {
  loadConnectAttempts();
  let failures = 0;
  attempts.forEach((list) => {
    const last = list[list.length - 1];
    if (last && last.stage !== 'success') failures += 1;
  });
  return {
    tenantsTracked: attempts.size,
    tenantsWithLastFailure: failures,
    file: FILE,
    persistentDirConfigured: isPersistentDataDirConfigured,
  };
}
