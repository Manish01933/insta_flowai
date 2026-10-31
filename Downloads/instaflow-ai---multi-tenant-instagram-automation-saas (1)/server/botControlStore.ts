import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * The owner's on/off switch for a customer's bot.
 *
 * Why this exists: the only ways to stop a bot were billing (turn payments on and
 * the account slides out of its plan) or asking the customer to hit Disconnect —
 * neither of which is usable during an incident. When three Instagram accounts
 * started replying to each other, there was no single button to stop the traffic.
 * This is that button: one record per tenant, plus a global brake that stops every
 * bot at once.
 *
 * Two design rules:
 *   - absence means ENABLED. The store only ever records an explicit decision, so
 *     a fresh deploy, a new customer, or a corrupt file can never silently mute a
 *     paying account;
 *   - the global brake *wins* unless a tenant has its own switch set, and
 *     `setAllBots(false)` clears per-tenant records — "stop everything" must mean
 *     everything, not "everything I had not already un-paused".
 *
 * Lives in `DATA_DIR` (a mounted volume in production) so a pause survives the
 * redeploy that follows it.
 */

export interface BotControlRecord {
  enabled: boolean;
  updatedAt: string;
  /** Owner uid/email that flipped it — the console is owner-only, but say who. */
  updatedBy: string;
  note?: string;
}

export interface BotState {
  enabled: boolean;
  /** Where the decision came from — for the console, never a secret. */
  source: 'default' | 'tenant' | 'global';
  updatedAt: string | null;
  updatedBy: string | null;
}

interface ControlFile {
  version: number;
  pausedAll: boolean;
  pausedAllUpdatedAt?: string;
  pausedAllBy?: string;
  pausedAllNote?: string;
  tenants: Record<string, BotControlRecord>;
}

const CONTROL_FILE = path.join(DATA_DIR, 'bot-control.json');

let state: ControlFile = {
  version: 1,
  pausedAll: false,
  tenants: {},
};
let loaded = false;

function isValidTenantId(tenantId: string): boolean {
  return /^[A-Za-z0-9_.@-]{1,128}$/.test(tenantId);
}

export function loadBotControls() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(CONTROL_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf8'));
    const tenants: Record<string, BotControlRecord> = {};
    let dropped = 0;

    for (const [tenantId, value] of Object.entries(parsed?.tenants || {})) {
      if (!value || typeof value !== 'object' || !isValidTenantId(tenantId)) {
        dropped += 1;
        continue;
      }
      tenants[tenantId] = {
        enabled: Boolean((value as BotControlRecord).enabled),
        updatedAt: String((value as BotControlRecord).updatedAt || ''),
        updatedBy: String((value as BotControlRecord).updatedBy || ''),
        note: (value as BotControlRecord).note ? String((value as BotControlRecord).note).slice(0, 300) : undefined,
      };
    }

    state = {
      version: 1,
      pausedAll: Boolean(parsed?.pausedAll),
      pausedAllUpdatedAt: parsed?.pausedAllUpdatedAt,
      pausedAllBy: parsed?.pausedAllBy,
      pausedAllNote: parsed?.pausedAllNote,
      tenants,
    };

    const paused = Object.values(tenants).filter((record) => !record.enabled).length;
    if (state.pausedAll || paused) {
      console.log(
        `[botControl] Loaded from ${CONTROL_FILE}: ` +
          `${state.pausedAll ? 'ALL BOTS PAUSED' : 'running'} ` +
          `(${Object.keys(tenants).length} per-tenant switch(es), ${paused} paused)`
      );
    }
  } catch (err) {
    console.error('[botControl] Failed to load bot controls (every bot stays enabled):', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${CONTROL_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpFile, CONTROL_FILE);
  } catch (err) {
    console.error('[botControl] Failed to persist bot controls:', err);
  }
}

/**
 * May this tenant's bot send anything at all?
 *
 * The global brake is checked first, then the tenant's own switch. A tenant with
 * no record follows the global brake — which is `false` (running) by default.
 */
export function isBotEnabled(tenantId: string): BotState {
  loadBotControls();
  const record = tenantId ? state.tenants[tenantId] : undefined;

  if (record) {
    return {
      enabled: record.enabled,
      source: 'tenant',
      updatedAt: record.updatedAt || null,
      updatedBy: record.updatedBy || null,
    };
  }

  if (state.pausedAll) {
    return {
      enabled: false,
      source: 'global',
      updatedAt: state.pausedAllUpdatedAt || null,
      updatedBy: state.pausedAllBy || null,
    };
  }

  return { enabled: true, source: 'default', updatedAt: null, updatedBy: null };
}

/** Flip one tenant's bot. Returns the saved record. */
export function setBotEnabled(
  tenantId: string,
  enabled: boolean,
  updatedBy: string,
  note?: string
): BotControlRecord {
  loadBotControls();
  if (!isValidTenantId(tenantId)) {
    throw new Error('Invalid tenant id.');
  }

  const record: BotControlRecord = {
    enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: String(updatedBy || 'owner').slice(0, 200),
    note: note ? String(note).slice(0, 300) : undefined,
  };
  state.tenants[tenantId] = record;
  persist();
  return record;
}

/**
 * Forget a tenant's bot switch — the owner's permanent delete.
 *
 * Dropping the record puts the account back on the default (running, unless the
 * global brake is on). That is irrelevant for a tenant that no longer exists, and
 * exactly why the row should not stay: the console's "paused by team" list is a
 * list of decisions about live customers.
 */
export function clearBotControl(tenantId: string): boolean {
  loadBotControls();
  if (!tenantId || !state.tenants[tenantId]) return false;
  delete state.tenants[tenantId];
  persist();
  return true;
}

/**
 * The emergency brake: stop (or restart) every bot with one write.
 *
 * Per-tenant switches are dropped in both directions on purpose. After "resume
 * all" the owner expects everything running, and after "pause all" they expect
 * everything stopped — a leftover record would quietly contradict the button they
 * just pressed.
 */
export function setAllBots(enabled: boolean, updatedBy: string, note?: string) {
  loadBotControls();
  state.pausedAll = !enabled;
  state.pausedAllUpdatedAt = new Date().toISOString();
  state.pausedAllBy = String(updatedBy || 'owner').slice(0, 200);
  state.pausedAllNote = note ? String(note).slice(0, 300) : undefined;
  state.tenants = {};
  persist();
  return {
    pausedAll: state.pausedAll,
    updatedAt: state.pausedAllUpdatedAt,
    updatedBy: state.pausedAllBy,
  };
}

/**
 * A tenant that has never been switched is deliberately absent here: this is the
 * owner console's view of what has been decided, not a list of every customer.
 */
export function getBotControlSnapshot() {
  loadBotControls();
  const overrides = Object.entries(state.tenants)
    .map(([tenantId, record]) => ({ tenantId, ...record }))
    .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

  return {
    pausedAll: state.pausedAll,
    pausedAllAt: state.pausedAllUpdatedAt || null,
    pausedAllBy: state.pausedAllBy || null,
    pausedAllNote: state.pausedAllNote || null,
    /** Tenants explicitly switched OFF right now. */
    pausedTenants: overrides.filter((record) => !record.enabled).map((record) => record.tenantId),
    overrides,
  };
}

export function getBotControlStats() {
  loadBotControls();
  const records = Object.values(state.tenants);
  return {
    pausedAll: state.pausedAll,
    switchRecords: records.length,
    pausedTenants: records.filter((record) => !record.enabled).length,
    file: CONTROL_FILE,
    persistentDirConfigured: Boolean(process.env.DATA_DIR),
  };
}
