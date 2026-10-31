import fs from 'fs';
import path from 'path';
import { DATA_DIR, isPersistentDataDirConfigured } from './connectionStore';

/**
 * Accounts the owner has taken off the console's customer list.
 *
 * Two very different actions share this one file, because both answer the same
 * question — "is this account still on my list, and why not?" — and splitting
 * them would let one drift out of sync with the other:
 *
 *   - **hidden** — the customer stopped paying, or asked to be taken off. Their
 *     data is untouched; the row simply stops appearing in the Ops Console, and
 *     `restore` puts it back. Nothing about their dashboard, bot or inbox changes,
 *     so a "hide" can never surprise a live customer.
 *   - **removed** — a permanent delete. Every server-side record for the tenant is
 *     erased by `tenantRemoval.ts`, and the tombstone kept here is what stops the
 *     same account from simply signing in again and claiming a fresh free trial.
 *
 * The tombstone deliberately holds almost nothing: a tenant id, when it happened,
 * who did it, the handle it last had, and *what* was deleted (counts, not
 * content). That is enough to answer "did you delete my account?" in a support
 * conversation and useless as a copy of the customer's data — which is the point,
 * since the customer asked for it to be gone.
 *
 * A pure cache of the file. Delete it and hidden accounts reappear in the list
 * and removed accounts can trial again; nothing else is lost.
 */

const FILE = path.join(DATA_DIR, 'account-removal.json');

/** Caps, mirroring the other volume stores. Oldest dropped first. */
const MAX_HIDDEN = 500;
const MAX_REMOVED = 2000;
const MAX_NOTE_CHARS = 200;

/** One archive entry, shown in the console's "Hidden accounts" panel. */
export interface HiddenAccountRecord {
  tenantId: string;
  hiddenAt: string;
  /** Verified owner identity (uid or email) — the audit trail for this action. */
  hiddenBy: string;
  note?: string;
  /** Last known handle, so the row is recognisable rather than an opaque uid. */
  instagramUsername?: string;
  planName?: string;
  planStatus?: string;
  leads?: number;
  chats?: number;
}

/** What a permanent delete actually took out. Counts only, never content. */
export interface RemovedAccountCounts {
  connection: boolean;
  chats: number;
  leads: number;
  aiSettings: boolean;
  subscription: boolean;
  testerRequest: boolean;
  botControl: boolean;
  kbGaps: number;
}

/** A deleted account. Kept forever (up to the cap) so the trial stays blocked. */
export interface RemovedAccountRecord {
  tenantId: string;
  removedAt: string;
  removedBy: string;
  note?: string;
  instagramUsername?: string;
  planName?: string;
  deleted: RemovedAccountCounts;
}

interface RemovalState {
  hidden: Record<string, HiddenAccountRecord>;
  removed: Record<string, RemovedAccountRecord>;
}

const state: RemovalState = { hidden: {}, removed: {} };
let loaded = false;

/** Same shape as the other volume stores: a plain id, bounded length. */
function isValidTenantId(tenantId: string): boolean {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(String(tenantId || ''));
}

function clean(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('[accountRemoval] Failed to create data directory:', err);
  }
}

function persist() {
  try {
    ensureDataDir();

    // Oldest first in the trim list, so the caps drop the least interesting
    // entries rather than whichever key happens to be last in the object.
    const hidden = Object.values(state.hidden)
      .sort((a, b) => Date.parse(b.hiddenAt) - Date.parse(a.hiddenAt))
      .slice(0, MAX_HIDDEN);
    const removed = Object.values(state.removed)
      .sort((a, b) => Date.parse(b.removedAt) - Date.parse(a.removedAt))
      .slice(0, MAX_REMOVED);

    const next: RemovalState = { hidden: {}, removed: {} };
    hidden.forEach((record) => {
      next.hidden[record.tenantId] = record;
    });
    removed.forEach((record) => {
      next.removed[record.tenantId] = record;
    });
    state.hidden = next.hidden;
    state.removed = next.removed;

    const tmpFile = `${FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, ...next }, null, 2), 'utf8');
    fs.renameSync(tmpFile, FILE);
  } catch (err) {
    console.error('[accountRemoval] Failed to persist account removals:', err);
  }
}

export function loadAccountRemovals(): void {
  if (loaded) return;
  loaded = true;

  if (!isPersistentDataDirConfigured && process.env.NODE_ENV === 'production') {
    console.warn(
      '[accountRemoval] DATA_DIR is not set; hidden accounts would come back and deleted accounts could trial again after a redeploy.'
    );
  }

  try {
    if (!fs.existsSync(FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));

    let dropped = 0;
    for (const [tenantId, value] of Object.entries(parsed?.hidden ?? {})) {
      const record = value as HiddenAccountRecord;
      if (!isValidTenantId(tenantId) || !record?.hiddenAt) {
        dropped += 1;
        continue;
      }
      state.hidden[tenantId] = { ...record, tenantId };
    }
    for (const [tenantId, value] of Object.entries(parsed?.removed ?? {})) {
      const record = value as RemovedAccountRecord;
      if (!isValidTenantId(tenantId) || !record?.removedAt) {
        dropped += 1;
        continue;
      }
      state.removed[tenantId] = {
        ...record,
        tenantId,
        deleted: {
          connection: Boolean(record.deleted?.connection),
          chats: Number(record.deleted?.chats) || 0,
          leads: Number(record.deleted?.leads) || 0,
          aiSettings: Boolean(record.deleted?.aiSettings),
          subscription: Boolean(record.deleted?.subscription),
          testerRequest: Boolean(record.deleted?.testerRequest),
          botControl: Boolean(record.deleted?.botControl),
          kbGaps: Number(record.deleted?.kbGaps) || 0,
        },
      };
    }

    console.log(
      `[accountRemoval] Loaded ${Object.keys(state.hidden).length} hidden and ` +
        `${Object.keys(state.removed).length} removed account(s) from ${FILE}` +
        (dropped ? ` (dropped ${dropped} invalid)` : '')
    );
  } catch (err) {
    console.error('[accountRemoval] Failed to load account removals:', err);
  }
}

/** Is this account archived (off the console list)? */
export function isAccountHidden(tenantId: string): boolean {
  loadAccountRemovals();
  return Boolean(tenantId && state.hidden[tenantId]);
}

/** Is this account permanently gone? Gate for the "no second free trial" rule. */
export function isAccountRemoved(tenantId: string): boolean {
  loadAccountRemovals();
  return Boolean(tenantId && state.removed[tenantId]);
}

export function getRemovedAccount(tenantId: string): RemovedAccountRecord | null {
  loadAccountRemovals();
  return (tenantId && state.removed[tenantId]) || null;
}

export function getHiddenAccount(tenantId: string): HiddenAccountRecord | null {
  loadAccountRemovals();
  return (tenantId && state.hidden[tenantId]) || null;
}

/**
 * Take an account off the list without touching a byte of its data.
 *
 * Idempotent on purpose: pressing the button twice must not move the "hidden at"
 * timestamp, because that is what a support conversation is reconstructed from.
 */
export function hideAccount(input: {
  tenantId: string;
  hiddenBy: string;
  note?: string;
  instagramUsername?: string;
  planName?: string;
  planStatus?: string;
  leads?: number;
  chats?: number;
}): HiddenAccountRecord {
  loadAccountRemovals();
  if (!isValidTenantId(input.tenantId)) throw new Error('Invalid tenant id.');

  const existing = state.hidden[input.tenantId];
  if (existing) return existing;

  // An account that was permanently deleted cannot be "hidden" afterwards: the
  // tombstone outranks the archive, or restore would resurrect a deleted account.
  if (state.removed[input.tenantId]) {
    throw new Error('This account was deleted, not hidden.');
  }

  const record: HiddenAccountRecord = {
    tenantId: input.tenantId,
    hiddenAt: new Date().toISOString(),
    hiddenBy: String(input.hiddenBy || 'owner').slice(0, 200),
    note: clean(input.note, MAX_NOTE_CHARS),
    instagramUsername: clean(input.instagramUsername),
    planName: clean(input.planName),
    planStatus: clean(input.planStatus),
    leads: typeof input.leads === 'number' ? input.leads : undefined,
    chats: typeof input.chats === 'number' ? input.chats : undefined,
  };

  state.hidden[input.tenantId] = record;
  persist();
  return record;
}

/** Put a hidden account back on the list. False when it was not hidden. */
export function restoreAccount(tenantId: string): boolean {
  loadAccountRemovals();
  if (!tenantId || !state.hidden[tenantId]) return false;
  delete state.hidden[tenantId];
  persist();
  return true;
}

/**
 * Write the tombstone for a permanent delete.
 *
 * Called *after* the purge succeeded, so a failure part-way through never leaves
 * an account that still has data but is blocked from trialling. It also drops any
 * archive entry for the same tenant — an account cannot be both.
 */
export function recordAccountRemoval(input: {
  tenantId: string;
  removedBy: string;
  note?: string;
  instagramUsername?: string;
  planName?: string;
  deleted: RemovedAccountCounts;
}): RemovedAccountRecord {
  loadAccountRemovals();
  if (!isValidTenantId(input.tenantId)) throw new Error('Invalid tenant id.');

  const record: RemovedAccountRecord = {
    tenantId: input.tenantId,
    removedAt: new Date().toISOString(),
    removedBy: String(input.removedBy || 'owner').slice(0, 200),
    note: clean(input.note, MAX_NOTE_CHARS),
    instagramUsername: clean(input.instagramUsername),
    planName: clean(input.planName),
    deleted: input.deleted,
  };

  state.removed[input.tenantId] = record;
  delete state.hidden[input.tenantId];
  persist();
  return record;
}

/** Hidden accounts, newest first. */
export function listHiddenAccounts(): HiddenAccountRecord[] {
  loadAccountRemovals();
  return Object.values(state.hidden).sort(
    (a, b) => Date.parse(b.hiddenAt) - Date.parse(a.hiddenAt)
  );
}

/** Deleted accounts, newest first — the "was this account deleted?" lookup. */
export function listRemovedAccounts(): RemovedAccountRecord[] {
  loadAccountRemovals();
  return Object.values(state.removed).sort(
    (a, b) => Date.parse(b.removedAt) - Date.parse(a.removedAt)
  );
}

export function getAccountRemovalStats() {
  loadAccountRemovals();
  const removed = Object.values(state.removed);
  return {
    hidden: Object.keys(state.hidden).length,
    removed: removed.length,
    latestRemovalAt: removed.length
      ? removed.map((r) => r.removedAt).sort().slice(-1)[0]
      : null,
    file: FILE,
    persistentDirConfigured: isPersistentDataDirConfigured,
  };
}
