import {
  getSafeStatus,
  getTenantByInstagramAccountId,
  listTenantsForInstagramAccountId,
  type ConnectionLiveState,
} from './connectionStore';
import {
  getTesterRequest,
  submitTesterRequest,
  type TesterRequestStatus,
} from './testerRequestStore';
import {
  getLastConnectAttempt,
  getLastAttemptUsername,
  type ConnectAttempt,
} from './connectAttemptStore';
import { getOAuthAppIdentity } from './appIdentity';

/**
 * Why one account is not connected, and what is left to do about it.
 *
 * This exists because "Instagram not connected" was a dead end: the row said what
 * was *not* true and nothing else, while the four possible causes need four
 * completely different actions — and one of them (Instagram's access gate) cannot
 * be solved from this server at all.
 *
 * The rule this module follows: decide a single `blocker`, and gather the evidence
 * for it. No prose lives here, because the console is bilingual and every sentence
 * belongs in `src/i18n.tsx` with the rest of the owner-facing copy. The client
 * turns `blocker` + these facts into the headline, the steps and the message to
 * send the customer, which means the same reasoning can be shown in either
 * language without the server holding two copies of it.
 *
 * What this deliberately does NOT claim: that the account can be connected from
 * here. Only the customer can press Allow, and Meta exposes no API to add an
 * Instagram tester. Every plan therefore ends in one of two human steps, and names
 * which one.
 */

export type ConnectBlocker =
  /** Connected, and Meta accepts the token. Nothing to do. */
  | 'ALREADY_OK'
  /** Connected, but Meta refuses the token — the customer must reconnect. */
  | 'RECONNECT_NEEDED'
  /** Connected, never live-checked (or checked long ago) — re-check first. */
  | 'REVERIFY_NEEDED'
  /** This server cannot complete an OAuth at all (app id / secret / redirect). */
  | 'SERVER_NOT_READY'
  /** The customer tried and something other than the access gate stopped it. */
  | 'TRY_FAILED'
  /** Their handle is known but the tester invite has not been sent yet. */
  | 'INVITE_NOT_SENT'
  /** Invite marked sent (or done) and the account is still not connected. */
  | 'INVITE_SENT_WAITING'
  /** We have never learned which handle they are trying with. */
  | 'HANDLE_UNKNOWN'
  /** Two tenants hold the same Instagram account — one of them gets no DMs. */
  | 'SHARED_ACCOUNT';

export type ConnectBlockerSeverity = 'ok' | 'action' | 'blocked';

/**
 * *Why* Meta refuses a token, as far as Meta's own sentence can be read.
 *
 * `RECONNECT_NEEDED` alone is the wrong instruction in the most common case. When
 * the customer's authorization for THIS app is gone — Meta's words:
 * `The user has not authorized application <id>` — telling them to press Reconnect
 * first fails in exactly the same way, and the product looks broken twice in a row.
 * The cause decides the **order** of the steps, so it is parsed from Meta's verbatim
 * message instead of being flattened into a single label.
 *
 * The application id Meta names is the interesting part: if it is *our* app, the
 * customer's grant was revoked or its tester invite is still pending. If it is a
 * different id, the stored token belongs to another app of the same developer
 * account entirely — and no amount of reconnecting on the wrong app will fix it.
 */
export type TokenRefusalCause =
  /** Meta names this deployment's app: the grant was revoked, or the invite is pending. */
  | 'NOT_AUTHORIZED_THIS_APP'
  /** Meta names some *other* app: the token in our store is not this app's token. */
  | 'NOT_AUTHORIZED_OTHER_APP'
  /** The token simply aged out. No invite, no role — just reconnect. */
  | 'TOKEN_EXPIRED'
  /** Instagram password change invalidated the token. Just reconnect. */
  | 'PASSWORD_CHANGED'
  /**
   * The stored token never decrypted, so Meta was never asked at all.
   *
   * This is a server-side key problem (`ENCRYPTION_MASTER_KEY` changed, removed or
   * wrong), not a Meta verdict, and it used to fall through to `UNKNOWN` — which the
   * console renders as "Meta only refused". Reconnect still repairs the account (the
   * new token is encrypted with the current key), but the owner was being sent to
   * blame Meta for a failure Meta never saw.
   */
  | 'DECRYPT_FAILED'
  /** Meta refused but said nothing the parser recognises. */
  | 'UNKNOWN';

export interface TokenRefusal {
  cause: TokenRefusalCause;
  /** The application id Meta named, when its message named one. */
  appId: string | null;
  /** True when that id is an app this server actually connects through. */
  appIdIsOurs: boolean;
}

/**
 * Read Meta's refusal. Pure string work on purpose: this runs on every console load
 * and must never cost a network call, and it has to be unit-testable without Meta.
 */
export function classifyTokenRefusal(
  detail: string | undefined,
  appIds: { instagramAppId: string | null; facebookAppId: string | null }
): TokenRefusal | null {
  const text = String(detail || '').trim();
  if (!text) return null;

  const named = text.match(/application\s+(\d{6,})/i)?.[1] || null;
  const ours = [appIds.instagramAppId, appIds.facebookAppId].filter(Boolean) as string[];
  const appIdIsOurs = named ? ours.includes(named) : false;
  const lower = text.toLowerCase();
  const base = { appId: named, appIdIsOurs };

  // Checked before every Meta wording: `connectionHealth` writes this detail when
  // decryption fails, and in that case no request reached Meta, so none of Meta's
  // sentences can apply.
  if (lower.includes('could not be decrypted')) {
    return { cause: 'DECRYPT_FAILED', appId: null, appIdIsOurs: false };
  }

  if (lower.includes('has not authorized application') || lower.includes('has not authorized')) {
    // No id named ⇒ nothing suggests a foreign app, so treat it as our own grant.
    return { cause: named && !appIdIsOurs ? 'NOT_AUTHORIZED_OTHER_APP' : 'NOT_AUTHORIZED_THIS_APP', ...base };
  }
  if (lower.includes('password')) return { cause: 'PASSWORD_CHANGED', ...base };
  if (
    lower.includes('session has expired') ||
    lower.includes('has expired') ||
    lower.includes('expired')
  ) {
    return { cause: 'TOKEN_EXPIRED', ...base };
  }
  return { cause: 'UNKNOWN', ...base };
}

export interface ConnectFixFacts {
  tenantId: string;
  blocker: ConnectBlocker;
  severity: ConnectBlockerSeverity;
  /** Handle the plan is about, however we learned it. */
  handle: string | null;
  handleSource: 'connection' | 'testerRequest' | 'attempt' | null;
  connected: boolean;
  /** False when the webhook routes this Instagram account to a different tenant. */
  receivesDms: boolean;
  liveState: ConnectionLiveState | 'UNKNOWN';
  liveDetail?: string;
  connectedAt?: string;
  lastVerifiedAt?: string;
  testerRequest: {
    username: string;
    status: TesterRequestStatus;
    requestedAt: string;
    updatedAt: string;
  } | null;
  /** The last thing we know about an attempt, and when. Usually the answer. */
  lastAttempt: ConnectAttempt | null;
  /** Whether this server could complete an OAuth right now. */
  readiness: { ok: boolean; code: string | null; reason: string | null };
  /**
   * The exact redirect URI this server sends to Meta.
   *
   * Read from the server, not from the browser's origin: Meta compares it byte for
   * byte against the app's whitelist, and `META_REDIRECT_URI` may point at a
   * different host than the page the owner is looking at. A guessed URI here would
   * paste the wrong thing into the one form where "almost right" fails.
   */
  redirectUri: string;
  sharedWith: string[];
  /** When shared: the tenant whose bot actually receives this account's DMs. */
  routedTo: string | null;
  /**
   * Why Meta refuses the token, parsed from `liveDetail`. Null when Meta accepts it or
   * has not been asked. Drives the *order* of the reconnect steps on the client, which
   * is the difference between a fix and a second identical failure.
   */
  tokenRefusal: TokenRefusal | null;
  /** Public ids of the app an invite has to be accepted on. Not secrets. */
  oauthApp: { flavour: string; clientId: string | null; facebookAppId: string | null };
}

/** Severity drives the badge colour in the console: red = customer can't be helped yet. */
function severityFor(blocker: ConnectBlocker): ConnectBlockerSeverity {
  switch (blocker) {
    case 'ALREADY_OK':
      return 'ok';
    case 'RECONNECT_NEEDED':
    case 'SERVER_NOT_READY':
    case 'SHARED_ACCOUNT':
      return 'blocked';
    default:
      return 'action';
  }
}

/**
 * Classify one tenant.
 *
 * Order matters: a broken server config outranks everything (no customer action
 * can succeed while it is wrong), a live connection is judged by whether Meta
 * still accepts it, and everything else is decided by what the customer has
 * already done — because the next step differs completely between "never tried",
 * "tried and was refused", and "was invited and did not come back".
 */
export function buildConnectFixFacts(input: {
  tenantId: string;
  readiness: { ok: boolean; code: string | null; reason: string | null };
  redirectUri: string;
}): ConnectFixFacts {
  const { tenantId, readiness, redirectUri } = input;
  const connection = getSafeStatus(tenantId);
  const connected = Boolean(connection.isConnected);
  const sharedWith = connection.sharedWith || [];
  const request = getTesterRequest(tenantId);
  const lastAttempt = getLastConnectAttempt(tenantId);
  const attemptUsername = getLastAttemptUsername(tenantId);
  const identity = getOAuthAppIdentity();

  // `liveUsername` is what a successful live check learned from Meta's `/me`. It is
  // written on every check but was never read, so an account whose connect-time
  // username was missing showed as "handle nahi mila" — while the server did know it.
  const handle =
    connection.instagramUsername ||
    connection.liveUsername ||
    request?.username ||
    attemptUsername ||
    null;
  const handleSource: ConnectFixFacts['handleSource'] =
    connection.instagramUsername || connection.liveUsername
      ? 'connection'
      : request?.username
      ? 'testerRequest'
      : attemptUsername
      ? 'attempt'
      : null;

  const routedTo = connection.instagramAccountId
    ? getTenantByInstagramAccountId(connection.instagramAccountId)?.tenantId || null
    : null;

  // A shared handle is only a *problem* for the tenant whose DMs go elsewhere. The
  // other one works today and is merely fragile — flagging it as broken would send
  // the owner chasing an account that is fine, so it keeps its real verdict and the
  // sharing is reported as evidence instead.
  const shadowed =
    connected && sharedWith.length > 0 && Boolean(routedTo) && routedTo !== tenantId;

  let blocker: ConnectBlocker;
  if (!readiness.ok) {
    blocker = 'SERVER_NOT_READY';
  } else if (connected) {
    if (connection.liveState === 'NEEDS_REAUTH') blocker = 'RECONNECT_NEEDED';
    else if (shadowed) blocker = 'SHARED_ACCOUNT';
    else if (connection.liveState === 'OK') blocker = 'ALREADY_OK';
    else blocker = 'REVERIFY_NEEDED';
  } else if (lastAttempt?.stage === 'error') {
    // A real error beats the invite question: Meta's own words are the answer, and
    // asking the customer to accept an invite they already accepted wastes a day.
    blocker = 'TRY_FAILED';
  } else if (!handle) {
    blocker = 'HANDLE_UNKNOWN';
  } else if (!request || request.status === 'REQUESTED') {
    // No queue row at all means nothing was ever sent for this handle — which is
    // the common case for an account refused at Instagram's consent screen, since
    // that path never reaches account discovery.
    blocker = 'INVITE_NOT_SENT';
  } else {
    // Covers both "invited" and "done": in each case the ball is with the customer
    // (accept the invite, then press Connect), and the owner has already done their
    // half — which is exactly what makes this state the frustrating one.
    blocker = 'INVITE_SENT_WAITING';
  }

  return {
    tenantId,
    blocker,
    severity: severityFor(blocker),
    handle,
    handleSource,
    connected,
    // Not connected ⇒ nothing routes here yet, so "receives DMs" is moot; report
    // true so the console never explains a silence that cannot happen.
    receivesDms:
      connected && connection.instagramAccountId
        ? routedTo === tenantId
        : true,
    liveState: connection.liveState || 'UNKNOWN',
    liveDetail: connection.liveDetail,
    connectedAt: connection.connectedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    testerRequest: request
      ? {
          username: request.username,
          status: request.status,
          requestedAt: request.requestedAt,
          updatedAt: request.updatedAt,
        }
      : null,
    lastAttempt,
    readiness,
    redirectUri,
    sharedWith,
    routedTo,
    // Only meaningful for a token Meta has actually refused; `liveDetail` on a healthy
    // or unchecked account is either absent or an unrelated transport complaint.
    tokenRefusal:
      connection.liveState === 'NEEDS_REAUTH'
        ? classifyTokenRefusal(connection.liveDetail, {
            instagramAppId: identity.instagramAppId,
            facebookAppId: identity.facebookAppId,
          })
        : null,
    oauthApp: {
      flavour: identity.flavour,
      clientId: identity.oauthClientId,
      facebookAppId: identity.facebookAppId,
    },
  };
}

/**
 * Every account that is not connected (plus shared ones), for the one-press
 * version. Sorted so the accounts the owner can actually finish come first:
 * a handle we know and an invite to send is a five-second job, while an account
 * with no handle needs the customer to act first.
 */
export function sortFixPlans(plans: ConnectFixFacts[]): ConnectFixFacts[] {
  const weight: Record<ConnectBlocker, number> = {
    SERVER_NOT_READY: 0,
    INVITE_NOT_SENT: 1,
    SHARED_ACCOUNT: 2,
    RECONNECT_NEEDED: 3,
    TRY_FAILED: 4,
    REVERIFY_NEEDED: 5,
    INVITE_SENT_WAITING: 6,
    HANDLE_UNKNOWN: 7,
    ALREADY_OK: 8,
  };
  return [...plans].sort((a, b) => {
    if (weight[a.blocker] !== weight[b.blocker]) return weight[a.blocker] - weight[b.blocker];
    return a.tenantId.localeCompare(b.tenantId);
  });
}

/**
 * Make sure the handle we know about is in the tester queue.
 *
 * The one thing the server can genuinely complete by itself. A connect refused at
 * Instagram's consent screen never reaches account discovery, so the queue — the
 * only place an invite can be sent from — would otherwise stay empty for exactly
 * the accounts that need an invite most.
 *
 * Returns true only when it actually wrote something, so the console can say what
 * changed instead of claiming a fix it did not make.
 */
export function ensureHandleRecorded(tenantId: string): boolean {
  const request = getTesterRequest(tenantId);
  const handle = getLastAttemptUsername(tenantId) || request?.username || null;
  if (!handle) return false;
  if (request?.username === handle) return false;

  const submitted = submitTesterRequest(tenantId, handle);
  return submitted.ok;
}

/** Tenant ids that share an Instagram account with somebody else (any direction). */
export function tenantsSharingAnAccount(tenantIds: string[]): string[] {
  const shared: string[] = [];
  tenantIds.forEach((tenantId) => {
    const connection = getSafeStatus(tenantId);
    if (connection.instagramAccountId && listTenantsForInstagramAccountId(connection.instagramAccountId).length > 1) {
      shared.push(tenantId);
    }
  });
  return shared;
}
