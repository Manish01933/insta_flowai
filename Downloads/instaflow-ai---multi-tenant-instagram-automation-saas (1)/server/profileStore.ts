import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * A tenant's readable name — the customer's own handle for their account.
 *
 * Why this exists: a tenant is a **Firebase uid**, and a uid is a 28-character
 * opaque string nobody can read aloud. Support conversations went like
 * "bhaiya wo jo account ... `vYifwGWUHROQD1jRzpyixITakJ3` wala" — and the Ops
 * Console showed the same wall of characters. The Instagram handle cannot fill
 * this role either: it changes every time somebody reconnects, and it is the
 * customer's *business* account, not the account they sign in with.
 *
 * So the username is chosen by the customer on first sign-in and is the name
 * every screen, every owner list and every support conversation uses from then
 * on. It is **set once** on purpose: an identity that anybody can rename at will
 * is not an identity, and a name that gets recycled (customer A abandons
 * "salon", customer B takes it) makes old screenshots and logs unreadable. Only
 * the owner can reset it, from the Ops Console, and the next sign-in asks again.
 *
 * The uid remains the storage key everywhere — nothing here replaces it. This is
 * a display/lookup layer on top, so a bug in this file can never move data
 * between tenants.
 */

export interface ProfileRecord {
  tenantId: string;
  /** Exactly what the customer typed. */
  username: string;
  /** Lower-cased copy: the uniqueness key. */
  usernameLower: string;
  createdAt: string;
  updatedAt: string;
  setBy: 'customer' | 'owner';
}

interface ProfileStoreFile {
  version: 1;
  profiles: Record<string, ProfileRecord>;
  /** usernameLower -> tenantId. Kept in the file so uniqueness survives restarts. */
  taken: Record<string, string>;
}

const PROFILE_FILE = path.join(DATA_DIR, 'profiles.json');

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/**
 * Names that must never belong to a tenant, because every one of them is
 * something the product itself says. A customer called "@owner" or "@fgt" in a
 * support list is a phishing story waiting to happen.
 */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'billing',
  'default_tenant',
  'fgt',
  'help',
  'instaflow',
  'instaflowai',
  'instagram',
  'meta',
  'null',
  'official',
  'ops',
  'owner',
  'payment',
  'payments',
  'root',
  'support',
  'system',
  'team',
  'teamfgt',
  'undefined',
  'www',
]);

let state: ProfileStoreFile | null = null;

function emptyStore(): ProfileStoreFile {
  return { version: 1, profiles: {}, taken: {} };
}

function load(): ProfileStoreFile {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    state = {
      version: 1,
      profiles: parsed?.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
      taken: parsed?.taken && typeof parsed.taken === 'object' ? parsed.taken : {},
    };
    // The index is derived data: rebuild it when it is missing or has drifted,
    // so a hand-edited file cannot hand one name to two tenants.
    for (const record of Object.values(state.profiles)) {
      if (record?.usernameLower) state.taken[record.usernameLower] = record.tenantId;
    }
  } catch {
    /* first run, or the file was never written */
  }
  if (!state) state = emptyStore();
  return state;
}

function persist(): void {
  const current = load();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${PROFILE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current), 'utf8');
    fs.renameSync(tmp, PROFILE_FILE);
  } catch (err) {
    console.error('[profiles] Could not persist usernames:', err);
  }
}

export type UsernameProblem = 'USERNAME_INVALID' | 'USERNAME_TAKEN' | 'USERNAME_RESERVED';

export interface UsernameCheck {
  ok: boolean;
  /** Present only when `ok` is false. */
  code?: UsernameProblem;
  /** Operator-readable, safe to show the customer verbatim. */
  reason?: string;
}

/**
 * Is this a usable username? Pure function of the string — uniqueness is checked
 * separately, because that needs the store.
 */
export function validateUsernameFormat(raw: unknown): UsernameCheck {
  const username = String(raw ?? '').trim();
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return {
      ok: false,
      code: 'USERNAME_INVALID',
      reason: `Username ${USERNAME_MIN}-${USERNAME_MAX} characters ka hona chahiye.`,
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._]*[A-Za-z0-9]$/.test(username)) {
    return {
      ok: false,
      code: 'USERNAME_INVALID',
      reason: 'Sirf letters, digits, dot aur underscore chalte hain — aur naam letter ya digit se hi shuru hoga.',
    };
  }
  if (/[._]{2}/.test(username)) {
    return {
      ok: false,
      code: 'USERNAME_INVALID',
      reason: 'Do dot ya underscore lagatar nahi aa sakte.',
    };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return {
      ok: false,
      code: 'USERNAME_RESERVED',
      reason: 'Ye naam platform ke liye reserved hai — koi doosra chuno.',
    };
  }
  return { ok: true };
}

export function getProfile(tenantId: string): ProfileRecord | null {
  if (!tenantId) return null;
  return load().profiles[tenantId] || null;
}

export function getUsername(tenantId: string): string | null {
  return getProfile(tenantId)?.username || null;
}

/** Resolve a typed name (with or without a leading @) back to its tenant id. */
export function getTenantByUsername(raw: unknown): string | null {
  const username = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!username) return null;
  return load().taken[username] || null;
}

/** Who holds this name already? `null` when it is free. */
export function usernameHolder(usernameLower: string): string | null {
  return load().taken[usernameLower] || null;
}

/**
 * Set a tenant's username, once.
 *
 * Throws an `Error` carrying `code` = one of the `UsernameProblem` values (plus
 * `USERNAME_LOCKED` when the tenant already has one) so the route can turn it
 * into a status without re-deriving the reason.
 */
export function setUsername(
  tenantId: string,
  raw: unknown,
  setBy: 'customer' | 'owner' = 'customer'
): ProfileRecord {
  if (!tenantId) throw new Error('Tenant id is required.');
  const store = load();

  // Set-once. The owner's reset is the only way to change it, and that is a
  // different function on purpose: an update path here would be one nullable
  // flag away from letting a customer rename themselves.
  if (store.profiles[tenantId]) {
    const err = new Error('Username pehle se set hai.');
    (err as Error & { code?: string }).code = 'USERNAME_LOCKED';
    throw err;
  }

  const check = validateUsernameFormat(raw);
  if (!check.ok) {
    const err = new Error(check.reason || 'Username theek nahi hai.');
    (err as Error & { code?: string }).code = check.code;
    throw err;
  }

  const username = String(raw).trim();
  const usernameLower = username.toLowerCase();
  const holder = store.taken[usernameLower];
  if (holder && holder !== tenantId) {
    const err = new Error('Ye username kisi aur ne le liya hai — doosra try karo.');
    (err as Error & { code?: string }).code = 'USERNAME_TAKEN';
    throw err;
  }

  const now = new Date().toISOString();
  const record: ProfileRecord = {
    tenantId,
    username,
    usernameLower,
    createdAt: now,
    updatedAt: now,
    setBy,
  };
  store.profiles[tenantId] = record;
  store.taken[usernameLower] = tenantId;
  persist();
  return record;
}

/**
 * Forget a tenant's username — the owner's reset, so the customer picks one
 * again on the next sign-in. The name goes back into the pool: a reset is the
 * only moment a username can be reused, which is exactly why it is owner-only.
 */
export function resetUsername(tenantId: string): ProfileRecord | null {
  const store = load();
  const existing = store.profiles[tenantId];
  if (!existing) return null;
  delete store.profiles[tenantId];
  if (store.taken[existing.usernameLower] === tenantId) delete store.taken[existing.usernameLower];
  persist();
  return existing;
}

/** Every profile, for the owner console and for tests. */
export function listProfiles(): ProfileRecord[] {
  return Object.values(load().profiles);
}

/** Test/debug helper: drop the in-memory cache so a fresh file is re-read. */
export function reloadProfilesForTest(): void {
  state = null;
}
