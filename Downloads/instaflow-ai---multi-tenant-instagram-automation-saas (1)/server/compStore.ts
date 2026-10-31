import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Accounts that never need a plan — kept at runtime, not in the environment.
 *
 * Why: `COMP_TENANT_IDS` is an env var, so marking one account "free forever"
 * meant an env edit **and a redeploy**, and the account the operator was testing
 * with was usually mid-test. The owner's own test connections therefore kept
 * their 3-day trial and went silent — a self-inflicted support ticket
 * ("Free Trial plan has expired — renew it" on an account the team owns).
 *
 * Two things mark an account here:
 *   - `owner-connected`: the **owner was the signed-in caller** when that
 *     tenant's Instagram connect began (see the OAuth start route). That is a
 *     real signal — it is the owner's verified identity, not a guess — and it is
 *     exactly the case the operator asked for: whatever account the owner
 *     connects stays free, with no trial clock and no redeploy.
 *   - `manual`: the owner flipped it by hand in the Ops Console, for the accounts
 *     that predate this rule.
 *
 * Deliberately reversible: every record can be removed from the same console, so
 * a customer who gets marked by mistake (or a test account that grows up into a
 * real one) can be put back on the normal plan path.
 *
 * The env list still wins and still exists: it is the bootstrap (the very first
 * deploy has no store file), and it keeps working for hosts that prefer config
 * over console. `isCompedTenant` merges both.
 */

export type CompReason = 'owner-connected' | 'manual';

export interface CompRecord {
  tenantId: string;
  reason: CompReason;
  /** Who caused it — the owner's email/uid when the server knew it. */
  markedBy: string | null;
  markedAt: string;
  note?: string;
}

interface CompStoreFile {
  version: 1;
  tenants: Record<string, CompRecord>;
}

const COMP_FILE = path.join(DATA_DIR, 'comped-tenants.json');

let state: CompStoreFile | null = null;

function load(): CompStoreFile {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(COMP_FILE, 'utf8'));
    state = {
      version: 1,
      tenants: parsed?.tenants && typeof parsed.tenants === 'object' ? parsed.tenants : {},
    };
  } catch {
    /* first run */
  }
  if (!state) state = { version: 1, tenants: {} };
  return state;
}

function persist(): void {
  const current = load();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${COMP_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current), 'utf8');
    fs.renameSync(tmp, COMP_FILE);
  } catch (err) {
    console.error('[comp] Could not persist the free-forever list:', err);
  }
}

export function isRuntimeComped(tenantId: string): boolean {
  if (!tenantId) return false;
  return Boolean(load().tenants[tenantId]);
}

export function getCompRecord(tenantId: string): CompRecord | null {
  if (!tenantId) return null;
  return load().tenants[tenantId] || null;
}

/** Idempotent: re-marking an account keeps the first reason and timestamp. */
export function markComped(
  tenantId: string,
  reason: CompReason,
  markedBy?: string | null,
  note?: string
): CompRecord {
  if (!tenantId) throw new Error('Tenant id is required.');
  const store = load();
  const existing = store.tenants[tenantId];
  if (existing) return existing;

  const record: CompRecord = {
    tenantId,
    reason,
    markedBy: markedBy ? String(markedBy).slice(0, 200) : null,
    markedAt: new Date().toISOString(),
    note: note ? String(note).slice(0, 300) : undefined,
  };
  store.tenants[tenantId] = record;
  persist();
  console.log(`[comp] ${tenantId} is now free forever (${reason}${record.markedBy ? `, by ${record.markedBy}` : ''})`);
  return record;
}

export function unmarkComped(tenantId: string): CompRecord | null {
  const store = load();
  const existing = store.tenants[tenantId];
  if (!existing) return null;
  delete store.tenants[tenantId];
  persist();
  console.log(`[comp] ${tenantId} is back on the normal plan path (was ${existing.reason})`);
  return existing;
}

export function listComped(): CompRecord[] {
  return Object.values(load().tenants);
}

/** Test/debug helper: drop the in-memory cache so a fresh file is re-read. */
export function reloadCompedForTest(): void {
  state = null;
}
