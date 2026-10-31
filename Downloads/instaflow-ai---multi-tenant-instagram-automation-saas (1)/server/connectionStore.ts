import fs from 'fs';
import path from 'path';
import { encryptData, decryptData } from './encryption';
import { AuthMode, InstagramAccountDetails } from './metaApi';

export interface StoredInstagramConnection {
  tenantId: string;
  instagramAccountId: string;
  instagramUsername: string;
  instagramName?: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  facebookPageName?: string;
  encryptedAccessToken: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  scopes: string[];
  connectedAt: string;
  lastVerifiedAt: string;
  lastError?: string;
  /** 'instagram_login' when the token comes from Instagram Login (IGAA…), else 'facebook'. */
  authMode?: AuthMode;
  /**
   * Result of the last LIVE check against Meta (see connectionHealth.ts).
   *
   * `lastVerifiedAt` only says the account verified once, at connect time — a
   * token killed later (app removed in Instagram, or an invite accepted on a
   * different Meta app) left the row saying CONNECTED while DMs got no reply.
   */
  liveState?: ConnectionLiveState;
  liveDetail?: string;
  liveCheckedAt?: string;
  /** Handle Meta still reports for this token, the strongest “it really works” signal. */
  liveUsername?: string;
}

/** Whether the stored token can still be used by THIS app. */
export type ConnectionLiveState =
  | 'OK'
  | 'NEEDS_REAUTH'
  | 'UNREACHABLE'
  | 'NOT_CONNECTED'
  | 'UNKNOWN';

export interface SafeConnectionStatus {
  isConnected: boolean;
  tenantId: string;
  instagramAccountId?: string;
  instagramUsername?: string;
  instagramName?: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  facebookPageName?: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectedAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
  scopes?: string[];
  authMode?: AuthMode;
  liveState?: ConnectionLiveState;
  liveDetail?: string;
  liveCheckedAt?: string;
  liveUsername?: string;
  /**
   * Other tenants holding the SAME Instagram account id.
   *
   * Non-empty means this connection exists but may not receive DMs — the webhook
   * routes an account id to exactly one tenant. Surfaced so neither the customer
   * nor the owner has to guess why the bot is quiet on a "connected" account.
   */
  sharedWith?: string[];
}

/**
 * Directory where connected Instagram accounts are persisted.
 *
 * Defaults to `<cwd>/.data`, which is fine for local development but is
 * EPHEMERAL on most hosting platforms (Railway, Render, Cloud Run, Vercel):
 * the container filesystem is replaced on every deploy or restart, so every
 * connected account would silently disappear. Set DATA_DIR to a path on a
 * mounted persistent volume in production.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'connections.json');

/** True when DATA_DIR points at an explicitly configured (usually mounted) path. */
export const isPersistentDataDirConfigured = Boolean(process.env.DATA_DIR);

// In-memory cache for fast lookups
// tenantId -> StoredInstagramConnection
const tenantStore = new Map<string, StoredInstagramConnection>();
// instagramAccountId -> tenantId
const igAccountIndex = new Map<string, string>();
// facebookPageId -> tenantId
const pageIdIndex = new Map<string, string>();
// Owner-decided routing for shared accounts (see resolveSharedAccountRouting):
// instagramAccountId -> tenantId. Declared here (not with its helpers below)
// because loadConnectionsFromDisk() runs at module load and applies these.
const ROUTING_FILE = path.join(DATA_DIR, 'connection-routing.json');
const routingOverrides = new Map<string, string>();

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create data directory:', err);
  }
}

function persistToDisk() {
  try {
    ensureDataDir();
    const data: Record<string, StoredInstagramConnection> = {};
    tenantStore.forEach((val, key) => {
      data[key] = val;
    });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist connections to disk:', err);
  }
}

export function loadConnectionsFromDisk() {
  if (process.env.NODE_ENV === 'production' && !isPersistentDataDirConfigured) {
    console.warn(
      `[connectionStore] DATA_DIR is not set; storing connections in ${DATA_DIR}. ` +
        'On hosts with an ephemeral filesystem (Railway/Render/Cloud Run) connected ' +
        'Instagram accounts will be LOST on every redeploy. Mount a persistent ' +
        'volume and set DATA_DIR to that mount path.'
    );
  }

  try {
    ensureDataDir();
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data: Record<string, StoredInstagramConnection> = JSON.parse(raw);
      tenantStore.clear();
      igAccountIndex.clear();
      pageIdIndex.clear();

      for (const [tenantId, conn] of Object.entries(data)) {
        tenantStore.set(tenantId, conn);
        if (conn.instagramAccountId) {
          igAccountIndex.set(conn.instagramAccountId, tenantId);
        }
        if (conn.facebookPageId) {
          pageIdIndex.set(conn.facebookPageId, tenantId);
        }
      }
      // Owner routing decisions ride on top of the derived index — without
      // re-applying them here, every restart would revert to last-save-wins.
      loadRoutingOverrides();
      applyRoutingOverrides();
      console.log(`Loaded ${tenantStore.size} Instagram connection(s) from ${DATA_FILE}`);
    }
  } catch (err) {
    console.error('Error loading connections from disk:', err);
  }
}

// Initialize on module load
loadConnectionsFromDisk();

export function saveConnection(
  tenantId: string,
  account: InstagramAccountDetails,
  rawToken: string
): SafeConnectionStatus {
  // Server-side encryption: Never store raw tokens in plaintext
  const encryptedAccessToken = encryptData(rawToken, tenantId);
  const now = new Date().toISOString();

  const stored: StoredInstagramConnection = {
    tenantId,
    instagramAccountId: account.instagramAccountId,
    instagramUsername: account.instagramUsername,
    instagramName: account.instagramName,
    profilePictureUrl: account.profilePictureUrl,
    facebookPageId: account.facebookPageId,
    facebookPageName: account.facebookPageName,
    encryptedAccessToken,
    status: 'CONNECTED',
    scopes: account.scopes || [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_show_list',
      'pages_read_engagement'
    ],
    connectedAt: now,
    lastVerifiedAt: now,
    lastError: undefined,
    authMode: account.authMode,
    // A fresh connect has not been checked yet; the OAuth callback runs the live
    // check immediately afterwards, so this is filled in within the same request.
    liveState: 'UNKNOWN',
    liveDetail: undefined,
    liveCheckedAt: undefined,
    liveUsername: undefined,
  };

  // A second tenant connecting an Instagram account that is already connected
  // here is not a copy — it is a routing collision. The webhook resolves a DM by
  // its Instagram account id, and that index holds exactly ONE tenant, so one of
  // the two silently stops receiving its customers' messages. Nothing in the app
  // used to notice; this is the earliest place that can say it out loud.
  const previousOwner = tenantStore.get(tenantId)?.instagramAccountId;
  if (previousOwner && previousOwner !== account.instagramAccountId && igAccountIndex.get(previousOwner) === tenantId) {
    igAccountIndex.delete(previousOwner);
  }
  const sharedWith = listTenantsForInstagramAccountId(account.instagramAccountId).filter(
    (id) => id !== tenantId
  );
  if (sharedWith.length) {
    console.warn(
      `SHARED_INSTAGRAM_ACCOUNT: @${account.instagramUsername} (${account.instagramAccountId}) is now connected by ` +
        `tenant ${tenantId} AND ${sharedWith.join(', ')} — DMs from this account can only be routed to one of them ` +
        `(the webhook picks the account id's index, which now points at ${tenantId}). ` +
        `One of these tenants will get silence until the duplicate is disconnected.`
    );
  }

  tenantStore.set(tenantId, stored);
  igAccountIndex.set(account.instagramAccountId, tenantId);
  // An owner routing decision outranks last-save-wins: when two tenants share
  // one Instagram account, the shadowed tenant's reconnect must not steal the
  // DMs back from the tenant the owner chose.
  const routed = routingOverrides.get(account.instagramAccountId);
  if (routed && routed !== tenantId && tenantStore.get(routed)?.instagramAccountId === account.instagramAccountId) {
    igAccountIndex.set(account.instagramAccountId, routed);
  }
  if (account.facebookPageId) {
    pageIdIndex.set(account.facebookPageId, tenantId);
  }

  persistToDisk();

  return getSafeStatus(tenantId);
}

/**
 * Every tenant holding this Instagram account id.
 *
 * Normally one. Two or more means the routing collision described in
 * `saveConnection`: the webhook can only answer from one of them, so the others
 * receive their customers' DMs and stay silent about it.
 */
export function listTenantsForInstagramAccountId(instagramAccountId: string): string[] {
  const id = String(instagramAccountId || '').trim();
  if (!id) return [];
  const holders: string[] = [];
  tenantStore.forEach((conn, tenantId) => {
    if (conn.instagramAccountId === id) holders.push(tenantId);
  });
  return holders;
}

/**
 * Instagram account ids connected by more than one tenant, with the tenant the
 * webhook actually routes their DMs to. Read straight off the index, so it can
 * never disagree with what the webhook does.
 */
export function getSharedInstagramAccounts(): Array<{
  instagramAccountId: string;
  instagramUsername?: string;
  /** The tenant a DM from this account reaches today. */
  routedTo: string | null;
  tenantIds: string[];
}> {
  const byAccount = new Map<string, string[]>();
  tenantStore.forEach((conn, tenantId) => {
    if (!conn.instagramAccountId) return;
    const list = byAccount.get(conn.instagramAccountId) || [];
    list.push(tenantId);
    byAccount.set(conn.instagramAccountId, list);
  });

  const shared: Array<{
    instagramAccountId: string;
    instagramUsername?: string;
    routedTo: string | null;
    tenantIds: string[];
  }> = [];

  byAccount.forEach((tenantIds, instagramAccountId) => {
    if (tenantIds.length < 2) return;
    shared.push({
      instagramAccountId,
      instagramUsername: tenantStore.get(tenantIds[0])?.instagramUsername,
      routedTo: igAccountIndex.get(instagramAccountId) || null,
      tenantIds,
    });
  });

  return shared;
}

// ---------------------------------------------------------------------------
// Owner-decided routing for shared accounts (KNOWN_ISSUES A4).
//
// The derived index is last-save-wins, which silently picked one tenant when
// two connected the same Instagram account. `resolveSharedAccountRouting` is
// the human decision, persisted in its own file so a restart — or the losing
// tenant reconnecting — cannot flip it back.
// ---------------------------------------------------------------------------

function persistRoutingOverrides() {
  try {
    ensureDataDir();
    const data: Record<string, string> = {};
    routingOverrides.forEach((tenantId, igId) => {
      data[igId] = tenantId;
    });
    fs.writeFileSync(ROUTING_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist connection routing overrides:', err);
  }
}

function loadRoutingOverrides() {
  routingOverrides.clear();
  try {
    if (!fs.existsSync(ROUTING_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'));
    for (const [igId, tenantId] of Object.entries(parsed || {})) {
      if (igId && typeof tenantId === 'string' && tenantId) routingOverrides.set(igId, tenantId);
    }
  } catch (err) {
    console.error('Error loading connection routing overrides:', err);
  }
}

/** Re-apply owner decisions on top of the derived index. An override whose
 *  tenant no longer holds the account is dropped — a stale decision must not
 *  route DMs to a tenant that cannot answer them. */
function applyRoutingOverrides() {
  routingOverrides.forEach((tenantId, igId) => {
    if (tenantStore.get(tenantId)?.instagramAccountId === igId) {
      igAccountIndex.set(igId, tenantId);
    } else {
      routingOverrides.delete(igId);
    }
  });
}

/**
 * Owner console: decide which tenant a shared Instagram account's DMs reach.
 * This is the human decision the routing collision was waiting for — the
 * webhook can only route an account id to one tenant, and last-save-wins had
 * been picking silently. Throws when the tenant does not actually hold the
 * account, so a wrong click cannot misroute live DMs.
 */
export function resolveSharedAccountRouting(
  instagramAccountId: string,
  tenantId: string
): { before: string | null; after: string; tenantIds: string[] } {
  const igId = String(instagramAccountId || '').trim();
  const target = String(tenantId || '').trim();
  const holders = listTenantsForInstagramAccountId(igId);
  if (!igId || !holders.length) throw new Error('No tenant holds this Instagram account.');
  if (!holders.includes(target)) throw new Error('That tenant does not hold this Instagram account.');

  const before = igAccountIndex.get(igId) || null;
  routingOverrides.set(igId, target);
  igAccountIndex.set(igId, target);
  persistRoutingOverrides();
  console.log(
    `SHARED_ACCOUNT_RESOLVED: ${igId} routed ${before || '(none)'} -> ${target} (owner). ` +
      `Holders: ${holders.join(', ')}. Shadowed tenant(s) keep their data; this account's DMs reach ${target} only.`
  );
  return { before, after: target, tenantIds: holders };
}

export function getSafeStatus(tenantId: string): SafeConnectionStatus {
  const conn = tenantStore.get(tenantId);
  if (!conn || conn.status === 'DISCONNECTED') {
    return {
      isConnected: false,
      tenantId,
      status: 'DISCONNECTED',
    };
  }

  return {
    isConnected: conn.status === 'CONNECTED',
    tenantId: conn.tenantId,
    instagramAccountId: conn.instagramAccountId,
    instagramUsername: conn.instagramUsername,
    instagramName: conn.instagramName,
    profilePictureUrl: conn.profilePictureUrl,
    facebookPageId: conn.facebookPageId,
    facebookPageName: conn.facebookPageName,
    status: conn.status,
    connectedAt: conn.connectedAt,
    lastVerifiedAt: conn.lastVerifiedAt,
    lastError: conn.lastError,
    scopes: conn.scopes,
    authMode: conn.authMode,
    liveState: conn.liveState || 'UNKNOWN',
    liveDetail: conn.liveDetail,
    liveCheckedAt: conn.liveCheckedAt,
    liveUsername: conn.liveUsername,
    // Computed on read, not stored: a flag written at connect time would go stale
    // the moment the other tenant disconnects, and this is exactly the kind of
    // "looks fine, is not" state the console exists to expose.
    sharedWith: listTenantsForInstagramAccountId(conn.instagramAccountId).filter(
      (id) => id !== tenantId
    ),
  };
}

/**
 * Every connected account, for the owner-only overview. Never includes a token:
 * it goes through `getSafeStatus`, which is the same redacted shape the customer
 * sees on their own Connection screen.
 */
export function listConnections(): SafeConnectionStatus[] {
  const statuses: SafeConnectionStatus[] = [];
  tenantStore.forEach((_conn, tenantId) => statuses.push(getSafeStatus(tenantId)));
  return statuses;
}

export function getDecryptedTokenForTenant(tenantId: string): string | null {
  const conn = tenantStore.get(tenantId);
  if (!conn || !conn.encryptedAccessToken) return null;
  try {
    return decryptData(conn.encryptedAccessToken, tenantId);
  } catch (err) {
    console.error(`Failed to decrypt token for tenant ${tenantId}:`, err);
    return null;
  }
}

export function getTenantByInstagramAccountId(...candidateIds: (string | undefined | null)[]): { tenantId: string; connection: StoredInstagramConnection } | null {
  for (const rawId of candidateIds) {
    if (!rawId) continue;
    const id = String(rawId).trim();
    const tenantId = igAccountIndex.get(id) || pageIdIndex.get(id);
    if (tenantId) {
      const connection = tenantStore.get(tenantId);
      if (connection) return { tenantId, connection };
    }
  }

  // Strict account matching only: a webhook event for an Instagram account
  // that is NOT an indexed, actively-connected tenant account must never be
  // answered by another tenant's bot. (A previous single-tenant fallback here
  // would route a stranger account's DMs to the only connected tenant — a
  // cross-tenant leak the platform explicitly must not have.)
  return null;
}

/**
 * Resolve the tenant that owns an Instagram handle.
 *
 * The public booking page uses the handle as its slug (`/book/<username>`) so
 * the operator can hand out a link customers can read and remember, and so it
 * still works after the page has been shared.
 */
export function getTenantByInstagramUsername(
  username: string
): { tenantId: string; connection: StoredInstagramConnection } | null {
  const normalise = (value: unknown) => String(value || '').trim().replace(/^@/, '').toLowerCase();
  const loose = (value: unknown) => normalise(value).replace(/[^a-z0-9]/g, '');

  const needle = normalise(username);
  if (!needle) return null;

  const entries = Array.from(tenantStore.entries());
  const match = entries.find(([, conn]) => normalise(conn.instagramUsername) === needle);
  if (match) return { tenantId: match[0], connection: match[1] };

  // A link that was already shared must keep working if the handle picks up or
  // drops punctuation (desi_tour001 vs desitour001). This is deliberately NOT a
  // "any slug resolves" fallback: `/book/<random>` would then serve a customer
  // somebody else's page. Ambiguous fuzzy matches are rejected too, because
  // `desi_tour001` and `desitour001` are two genuinely different handles.
  const looseNeedle = loose(needle);
  if (looseNeedle.length < 3) return null;

  const fuzzy = entries.filter(([, conn]) => loose(conn.instagramUsername) === looseNeedle);
  if (fuzzy.length === 1) return { tenantId: fuzzy[0][0], connection: fuzzy[0][1] };
  return null;
}

/**
 * Record the outcome of a live token check.
 *
 * Deliberately does NOT touch `status`/`lastError`: "Meta cannot use this token"
 * and "the account is connected" are different facts, and rewriting the first
 * into the second would make a working account disappear from the inbox and the
 * booking page. The live fields are additive, and only the customer-facing copy
 * changes ("reconnect needed").
 */
export function markConnectionLiveCheck(
  tenantId: string,
  update: {
    state: ConnectionLiveState;
    detail?: string;
    checkedAt: string;
    username?: string;
  }
): SafeConnectionStatus {
  const conn = tenantStore.get(tenantId);
  if (!conn) {
    return { isConnected: false, tenantId, status: 'DISCONNECTED' };
  }

  conn.liveState = update.state;
  conn.liveDetail = update.state === 'OK' ? undefined : update.detail;
  conn.liveCheckedAt = update.checkedAt;
  if (update.username) conn.liveUsername = update.username;

  tenantStore.set(tenantId, conn);
  persistToDisk();
  return getSafeStatus(tenantId);
}

/** Every tenant id that currently holds a connection — the sweep's work list. */
export function listConnectedTenantIds(): string[] {
  return Array.from(tenantStore.keys());
}

export function updateVerificationStatus(
  tenantId: string,
  isValid: boolean,
  errorMessage?: string,
  updatedDetails?: Partial<StoredInstagramConnection>
): SafeConnectionStatus {
  const conn = tenantStore.get(tenantId);
  if (!conn) {
    return { isConnected: false, tenantId, status: 'DISCONNECTED' };
  }

  if (isValid) {
    conn.status = 'CONNECTED';
    conn.lastVerifiedAt = new Date().toISOString();
    conn.lastError = undefined;
    if (updatedDetails?.instagramUsername) conn.instagramUsername = updatedDetails.instagramUsername;
    if (updatedDetails?.profilePictureUrl) conn.profilePictureUrl = updatedDetails.profilePictureUrl;
  } else {
    conn.status = 'ERROR';
    conn.lastError = errorMessage || 'Verification failed with Meta API.';
  }

  tenantStore.set(tenantId, conn);
  persistToDisk();
  return getSafeStatus(tenantId);
}

export function disconnectAccount(tenantId: string): boolean {
  const conn = tenantStore.get(tenantId);
  if (conn) {
    // Only drop an index entry that still points at THIS tenant. When two tenants
    // share one Instagram account the index belongs to the other one, and deleting
    // it here would silence the account that was working — and the console tells the
    // owner to disconnect exactly this duplicate, so that path has to be safe.
    if (conn.instagramAccountId && igAccountIndex.get(conn.instagramAccountId) === tenantId) {
      igAccountIndex.delete(conn.instagramAccountId);
    }
    // An owner routing decision pointed at this tenant — clear it and fall
    // back to another holder instead of leaving the account's DMs unrouted.
    if (conn.instagramAccountId && routingOverrides.get(conn.instagramAccountId) === tenantId) {
      routingOverrides.delete(conn.instagramAccountId);
      persistRoutingOverrides();
      const remaining = listTenantsForInstagramAccountId(conn.instagramAccountId).filter(
        (id) => id !== tenantId
      );
      if (remaining.length) igAccountIndex.set(conn.instagramAccountId, remaining[0]);
    }
    if (conn.facebookPageId && pageIdIndex.get(conn.facebookPageId) === tenantId) {
      pageIdIndex.delete(conn.facebookPageId);
    }
    tenantStore.delete(tenantId);
    persistToDisk();
    return true;
  }
  return false;
}

export function getDiagnosticsInfo() {
  const accounts: any[] = [];
  tenantStore.forEach((c) => {
    accounts.push({
      tenantId: c.tenantId,
      instagramAccountId: c.instagramAccountId,
      instagramUsername: c.instagramUsername,
      facebookPageId: c.facebookPageId,
      status: c.status,
      lastVerifiedAt: c.lastVerifiedAt,
      lastError: c.lastError,
    });
  });

  return {
    totalTenants: tenantStore.size,
    indexedIgAccounts: Array.from(igAccountIndex.keys()),
    indexedPageIds: Array.from(pageIdIndex.keys()),
    accounts,
  };
}
