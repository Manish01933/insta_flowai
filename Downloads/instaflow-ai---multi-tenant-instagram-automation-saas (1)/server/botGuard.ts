import fs from 'fs';
import path from 'path';
import {
  DATA_DIR,
  getTenantByInstagramAccountId,
  listConnections,
} from './connectionStore';
import {
  GRAPH_API_BASE,
  IG_GRAPH_API_BASE,
  isInstagramLoginToken,
  type AuthMode,
} from './metaApi';

/**
 * Stops two InstaFlow-connected accounts from talking to each other.
 *
 * Why this exists: it happened for real. Two Instagram accounts were connected to
 * InstaFlow and the operator accidentally DMed one from the other. Account B's bot
 * answered the DM, that reply arrived at account A's inbox, account A's bot
 * answered *that* — and the two bots kept replying to each other indefinitely. A
 * third connected account joined in. There was no switch to stop it.
 *
 * Two independent defences, because the first one cannot always fire:
 *
 *   1. Identity isolation. A DM whose sender is another InstaFlow-connected
 *      account is never answered. Webhook `sender.id` is an Instagram-scoped ID
 *      (IGSID), not the account id we store, so matching the raw id only works
 *      when Meta happens to send the account id (and always works for echoes). The
 *      conclusive check is the sender's @username, fetched from
 *      `GET graph.instagram.com/<IGSID>?fields=username` — the documented User
 *      Profile API — and compared against every connected handle. One lookup per
 *      sender per account, cached on disk.
 *
 *   2. Reply burst cap. Whatever the sender's identity, no single conversation may
 *      receive more than `IG_REPLY_BURST_MAX` bot replies in
 *      `IG_REPLY_BURST_WINDOW_MS`. A real customer never hits it; any bot-to-bot
 *      loop does, within seconds. This is the failsafe for the cases where the
 *      lookup fails (no permission, revoked token, blocked profile) or where the
 *      counterpart is an *external* auto-responder nobody connected here.
 *
 * Both block *the bot's reply only*: the inbound message is not stored, so a loop
 * can never grow the inbox either. Every block is counted, logged, and kept in a
 * small in-memory ring buffer the Ops Console shows.
 */

const ISOLATION_ENV = (process.env.IG_ISOLATE_CONNECTED_ACCOUNTS || 'true').trim().toLowerCase();
const ISOLATION_ENABLED = ISOLATION_ENV !== 'false' && ISOLATION_ENV !== '0' && ISOLATION_ENV !== 'off';

const RESOLVE_ENV = (process.env.IG_RESOLVE_SENDER_USERNAMES || 'true').trim().toLowerCase();
const RESOLVE_ENABLED = RESOLVE_ENV !== 'false' && RESOLVE_ENV !== '0' && RESOLVE_ENV !== 'off';

/**
 * Handle-level allowlist, comma separated (@optional). A sender whose resolved
 * username is on this list passes the identity-isolation checks as if they were
 * an unconnected customer — the ops owner's own test accounts stay testable
 * without switching the whole guard off. The reply burst cap still applies to
 * every allowlisted conversation, so even this path cannot loop forever.
 */
const GUARD_ALLOW_RAW = (process.env.IG_GUARD_ALLOW_HANDLES || '')
  .split(',')
  .map((raw) => raw.trim().replace(/^@+/, '').toLowerCase())
  .filter(Boolean);
const GUARD_ALLOW = new Set(GUARD_ALLOW_RAW);

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Bot replies allowed to one conversation inside the window before we stop. */
const BURST_MAX = positiveInt(process.env.IG_REPLY_BURST_MAX, 8);
const BURST_WINDOW_MS = positiveInt(process.env.IG_REPLY_BURST_WINDOW_MS, 5 * 60 * 1000);

/** How long a resolved @username (or a failed lookup) is trusted. */
const PROFILE_TTL_OK_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_TTL_FAIL_MS = 6 * 60 * 60 * 1000;
const PROFILE_FILE = path.join(DATA_DIR, 'sender-profiles.json');
const PROFILE_MAX_ENTRIES = 5000;

export type GuardCode =
  | 'SENDER_IS_CONNECTED_ACCOUNT'
  | 'SENDER_USERNAME_IS_CONNECTED'
  | 'REPLY_BURST';

export interface GuardEvent {
  at: string;
  code: GuardCode;
  /** Account that received the DM (the bot we stopped). */
  igAccountId: string;
  tenantId: string;
  senderId: string;
  senderUsername?: string;
  /** Which tenant owns the sender account, when we could tell. */
  senderTenantId?: string;
  handle?: string;
  replyCount?: number;
}

export interface GuardContext {
  igAccountId: string;
  tenantId: string;
  senderId: string;
  rawToken: string;
  authMode?: AuthMode;
}

export type GuardVerdict =
  | { allow: true; senderUsername?: string }
  | { allow: false; code: GuardCode; reason: string; senderTenantId?: string; handle?: string };

// ── Counters + the ring buffer the console reads ────────────────────────────

const counters = {
  messagesChecked: 0,
  blockedIdentity: 0,
  blockedUsername: 0,
  blockedBurst: 0,
  allowlisted: 0,
  usernameLookups: 0,
  usernameLookupFailures: 0,
};

const MAX_EVENTS = 40;
const recentEvents: GuardEvent[] = [];

function note(verdict: GuardEvent) {
  recentEvents.unshift(verdict);
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
}

// ── Sender profile cache (IGSID -> @username) ───────────────────────────────

interface CachedProfile {
  username: string | null;
  resolvedAt: string;
}

const profiles = new Map<string, CachedProfile>();
let profilesLoaded = false;
let profilesDirty = false;

function profileKey(igAccountId: string, senderId: string): string {
  return `${igAccountId}:${senderId}`;
}

function loadProfiles() {
  if (profilesLoaded) return;
  profilesLoaded = true;
  try {
    if (!fs.existsSync(PROFILE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    let dropped = 0;
    for (const [key, value] of Object.entries(parsed?.profiles || {})) {
      const entry = value as CachedProfile;
      if (!entry || typeof entry !== 'object' || typeof entry.resolvedAt !== 'string') {
        dropped += 1;
        continue;
      }
      profiles.set(key, {
        username: entry.username ? String(entry.username) : null,
        resolvedAt: entry.resolvedAt,
      });
    }
    if (dropped) console.warn(`[botGuard] Dropped ${dropped} malformed sender profile(s).`);
  } catch (err) {
    console.error('[botGuard] Failed to load the sender profile cache:', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persistProfiles() {
  if (!profilesDirty) return;
  profilesDirty = false;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Keep the newest entries when the cap is reached: older senders are the ones
    // least likely to message again.
    if (profiles.size > PROFILE_MAX_ENTRIES) {
      const oldestFirst = Array.from(profiles.entries()).sort(
        (a, b) => Date.parse(a[1].resolvedAt) - Date.parse(b[1].resolvedAt)
      );
      for (let i = 0; i < oldestFirst.length - PROFILE_MAX_ENTRIES; i += 1) {
        profiles.delete(oldestFirst[i][0]);
      }
    }
    const data: Record<string, CachedProfile> = {};
    profiles.forEach((value, key) => {
      data[key] = value;
    });
    const tmpFile = `${PROFILE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, profiles: data }), 'utf8');
    fs.renameSync(tmpFile, PROFILE_FILE);
  } catch (err) {
    console.error('[botGuard] Failed to persist the sender profile cache:', err);
  }
}

/** Strip the `@` and casing that make `@Desi_Tour` and `desi_tour` look different. */
function normaliseHandle(value: unknown): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

/**
 * The sender's @username from Meta's User Profile API.
 *
 * `sender.id` in a messaging webhook is an Instagram-scoped ID, so it does not
 * match the Instagram account id we store — but it *is* the key this endpoint
 * takes. Failures are cached (shorter) so a bad token does not turn every DM into
 * an outbound request. Never throws.
 */
async function resolveSenderUsername(ctx: GuardContext): Promise<string | null> {
  if (!RESOLVE_ENABLED) return null;
  loadProfiles();

  const key = profileKey(ctx.igAccountId, ctx.senderId);
  const cached = profiles.get(key);
  if (cached) {
    const ttl = cached.username ? PROFILE_TTL_OK_MS : PROFILE_TTL_FAIL_MS;
    if (Date.now() - Date.parse(cached.resolvedAt) < ttl) {
      return cached.username;
    }
  }

  const instagramLogin = ctx.authMode === 'instagram_login' || isInstagramLoginToken(ctx.rawToken);
  const base = instagramLogin ? IG_GRAPH_API_BASE : GRAPH_API_BASE;
  const url =
    `${base}/${encodeURIComponent(ctx.senderId)}?fields=username` +
    `&access_token=${encodeURIComponent(ctx.rawToken)}`;

  counters.usernameLookups += 1;
  let username: string | null = null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data: any = await res.json();
    if (data?.error) {
      // Expected on Standard Access / missing permission — not fatal, the burst
      // cap still protects the conversation.
      counters.usernameLookupFailures += 1;
      if (counters.usernameLookupFailures <= 3) {
        console.warn(
          `[botGuard] Could not resolve sender ${ctx.senderId} to a username ` +
            `(${data.error.code || ''} ${data.error.message || 'unknown'}). ` +
            'Connected-account isolation falls back to the reply burst cap.'
        );
      }
    } else {
      username = data?.username ? String(data.username) : null;
    }
  } catch (err: any) {
    counters.usernameLookupFailures += 1;
    if (counters.usernameLookupFailures <= 3) {
      console.warn(`[botGuard] Sender profile lookup failed: ${err?.message || err}`);
    }
  }

  profiles.set(key, { username, resolvedAt: new Date().toISOString() });
  profilesDirty = true;
  return username;
}

// ── Reply burst cap ─────────────────────────────────────────────────────────

// conversation key -> timestamps of recent bot replies
const replies = new Map<string, number[]>();
// conversation key -> last time we logged a burst block (log once, not once/message)
const lastBurstLog = new Map<string, number>();

function conversationKey(igAccountId: string, senderId: string): string {
  return `${igAccountId}:${senderId}`;
}

function recentReplies(key: string, now: number): number[] {
  const stamps = (replies.get(key) || []).filter((ts) => now - ts < BURST_WINDOW_MS);
  replies.set(key, stamps);
  if (replies.size > 20000) replies.clear();
  return stamps;
}

/** Would the next reply break the cap? Pure read — `noteOutboundReply` records. */
function burstTripped(igAccountId: string, senderId: string): { tripped: boolean; count: number } {
  const key = conversationKey(igAccountId, senderId);
  const stamps = recentReplies(key, Date.now());
  return { tripped: stamps.length >= BURST_MAX, count: stamps.length };
}

/**
 * Task 3 (retry worker): pure read-only burst-cap check a caller can consult
 * BEFORE sending a queued reply. Same key/window/cap as the webhook's inline
 * check; records nothing and logs nothing.
 */
export function wouldBurstCap(igAccountId: string, senderId: string): boolean {
  return burstTripped(igAccountId, senderId).tripped;
}

/** Record that we just answered this conversation. Call after a successful send. */
export function noteOutboundReply(igAccountId: string, senderId: string) {
  const key = conversationKey(igAccountId, senderId);
  const stamps = recentReplies(key, Date.now());
  stamps.push(Date.now());
  replies.set(key, stamps);
}

/**
 * The webhook's gate: may the bot answer this DM at all?
 *
 * Order is cheap-first: the raw-id check needs no network call, the username
 * lookup is cached, and the burst cap is free. Only the first two concern *who*
 * the sender is; the third is the universal failsafe.
 */
export async function evaluateInbound(ctx: GuardContext): Promise<GuardVerdict> {
  counters.messagesChecked += 1;
  /** Set when the sender resolved to a handle that is NOT a connected account. */
  let senderUsername: string | undefined;

  /** Set once the sender's handle is known and allowlisted (identity checks skipped). */
  let allowlistedByHandle: string | undefined;

  if (ISOLATION_ENABLED) {
    // 1. The sender's id is itself an InstaFlow-connected account (Meta sends the
    //    account id for echoes and for some professional-account senders).
    const sameId = getTenantByInstagramAccountId(ctx.senderId);
    if (sameId) {
      counters.blockedIdentity += 1;
      const handle = sameId.connection.instagramUsername || '';
      const event: GuardEvent = {
        at: new Date().toISOString(),
        code: 'SENDER_IS_CONNECTED_ACCOUNT',
        igAccountId: ctx.igAccountId,
        tenantId: ctx.tenantId,
        senderId: ctx.senderId,
        senderUsername: handle || undefined,
        senderTenantId: sameId.tenantId,
        handle: handle || undefined,
      };
      note(event);
      return {
        allow: false,
        code: 'SENDER_IS_CONNECTED_ACCOUNT',
        reason:
          `sender ${ctx.senderId} is the InstaFlow-connected account ` +
          `${handle ? `@${handle} ` : ''}(tenant ${sameId.tenantId})`,
        senderTenantId: sameId.tenantId,
        handle: handle || undefined,
      };
    }

    // 2. The conclusive check: who is this sender on Instagram?
    const resolvedUsername = await resolveSenderUsername(ctx);
    if (resolvedUsername) {
      const needle = normaliseHandle(resolvedUsername);
      if (GUARD_ALLOW.has(needle)) {
        // The ops owner explicitly named this handle: connected-account isolation
        // does not apply to it. The burst cap below still runs for it.
        allowlistedByHandle = resolvedUsername;
        counters.allowlisted += 1;
      }
    }
    if (!allowlistedByHandle && resolvedUsername) {
      const needle = normaliseHandle(resolvedUsername);
      // Strict handle comparison only. `getTenantByInstagramUsername` also does a
      // punctuation-insensitive fuzzy match, which is right for a booking link and
      // wrong here: it would let one customer's DM be silently swallowed because
      // their handle happens to look like another tenant's.
      const owner = listConnections().find(
        (connection) => normaliseHandle(connection.instagramUsername) === needle
      );
      if (owner) {
        counters.blockedUsername += 1;
        const event: GuardEvent = {
          at: new Date().toISOString(),
          code: 'SENDER_USERNAME_IS_CONNECTED',
          igAccountId: ctx.igAccountId,
          tenantId: ctx.tenantId,
          senderId: ctx.senderId,
          senderUsername: resolvedUsername,
          senderTenantId: owner.tenantId,
          handle: owner.instagramUsername || resolvedUsername,
        };
        note(event);
        return {
          allow: false,
          code: 'SENDER_USERNAME_IS_CONNECTED',
          reason: `sender @${resolvedUsername} is the InstaFlow-connected account (tenant ${owner.tenantId})`,
          senderTenantId: owner.tenantId,
          handle: owner.instagramUsername || resolvedUsername,
        };
      }
      // A known, unconnected sender — carried into the burst event so the console
      // can show who the conversation was with.
      senderUsername = resolvedUsername;
    }
  }

  // 3. Universal failsafe: no conversation may receive an endless stream of
  //    replies. A real customer never reaches this; any loop does.
  const burst = burstTripped(ctx.igAccountId, ctx.senderId);
  if (burst.tripped) {
    const key = conversationKey(ctx.igAccountId, ctx.senderId);
    const lastLog = lastBurstLog.get(key) || 0;
    if (Date.now() - lastLog > 60_000) {
      lastBurstLog.set(key, Date.now());
      console.warn(
        `[botGuard] REPLY_BURST: ${burst.count} replies to ${ctx.senderId} from account ` +
          `${ctx.igAccountId} inside ${Math.round(BURST_WINDOW_MS / 1000)}s — pausing replies to this ` +
          'conversation (probable bot-to-bot loop).'
      );
    }
    counters.blockedBurst += 1;
    note({
      at: new Date().toISOString(),
      code: 'REPLY_BURST',
      igAccountId: ctx.igAccountId,
      tenantId: ctx.tenantId,
      senderId: ctx.senderId,
      senderUsername,
      replyCount: burst.count,
    });
    return {
      allow: false,
      code: 'REPLY_BURST',
      reason:
        `${burst.count} replies already sent to this conversation in ` +
        `${Math.round(BURST_WINDOW_MS / 1000)}s`,
    };
  }

  return { allow: true, senderUsername: allowlistedByHandle || senderUsername };
}

export function isBotIsolationEnabled(): boolean {
  return ISOLATION_ENABLED;
}

export function getBotGuardConfig() {
  return {
    isolationEnabled: ISOLATION_ENABLED,
    usernameResolutionEnabled: RESOLVE_ENABLED,
    burstMax: BURST_MAX,
    burstWindowSeconds: Math.round(BURST_WINDOW_MS / 1000),
    allowlist: [...GUARD_ALLOW],
  };
}

export function getBotGuardStats() {
  loadProfiles();
  return {
    ...getBotGuardConfig(),
    ...counters,
    cachedSenderProfiles: profiles.size,
    trackedConversations: replies.size,
    file: PROFILE_FILE,
  };
}

/** Newest first, for the Ops Console. */
export function getRecentGuardEvents(): GuardEvent[] {
  return recentEvents.slice();
}

/** Housekeeping: drop stale burst windows and flush the profile cache. */
export function startBotGuardSweeper() {
  const timer = setInterval(() => {
    const now = Date.now();
    replies.forEach((stamps, key) => {
      const alive = stamps.filter((ts) => now - ts < BURST_WINDOW_MS);
      if (alive.length) replies.set(key, alive);
      else replies.delete(key);
    });
    lastBurstLog.forEach((at, key) => {
      if (now - at > 10 * 60 * 1000) lastBurstLog.delete(key);
    });
    persistProfiles();
  }, 5 * 60 * 1000);
  // Never keep the process alive just for housekeeping.
  timer.unref?.();
  return timer;
}
