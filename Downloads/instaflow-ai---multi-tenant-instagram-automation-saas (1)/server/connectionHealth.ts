import { GRAPH_API_BASE, IG_GRAPH_API_BASE, isInstagramLoginToken } from './metaApi';
import {
  getDecryptedTokenForTenant,
  getSafeStatus,
  listConnectedTenantIds,
  markConnectionLiveCheck,
  type ConnectionLiveState,
} from './connectionStore';

/**
 * Is the token in our store still usable BY THIS APP?
 *
 * Why this exists: `lastVerifiedAt` only says the account verified once, at
 * connect time. A connection can stop working afterwards without anything
 * changing on our side:
 *
 *   - the account removes the app in Instagram → Settings → Apps and websites,
 *     which kills the token (`The user has not authorized application <id>`);
 *   - the tester accepted an invite on a *different* app of the same developer
 *     account, so the token that arrives belongs to an app this server cannot
 *     use — Meta answers with the very same error;
 *   - a long-lived upgrade failed, so the token expires within about an hour.
 *
 * In all three cases the Ops row kept saying "CONNECTED" while DMs got no reply.
 * One cheap `/me` call separates them from a healthy account, so the console can
 * say "this account has to reconnect" instead of leaving the operator to guess.
 */

export interface ConnectionHealth {
  tenantId: string;
  state: ConnectionLiveState;
  /** Meta's own words when it refused, so the console is not paraphrasing. */
  detail?: string;
  username?: string;
  checkedAt: string;
}

/** Meta error codes that mean "this token will never work again on its own". */
function isAuthFailure(code: number | undefined, message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (code === 190) return true;
  if (code === 102) return true; // session key invalid
  if (code === 463 || code === 467) return true; // expired
  if (code === 460) return true; // password changed
  return (
    text.includes('has not authorized application') ||
    text.includes('session has expired') ||
    text.includes('access token has expired') ||
    text.includes('invalid oauth access token') ||
    text.includes('cannot parse access token')
  );
}

/** Rate limiting and transport problems say nothing about the token. */
function isTransient(code: number | undefined, message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (code === 4 || code === 17 || code === 32 || code === 613) return true;
  return text.includes('rate limit') || text.includes('temporarily unavailable');
}

/**
 * Which host this tenant's token belongs to. Instagram Login tokens only work on
 * graph.instagram.com and Facebook tokens only on graph.facebook.com, so the
 * host is derived from the token itself (not from the current server config, so
 * an account connected before a flavour change is still checked correctly).
 */
function hostForToken(token: string): string {
  return isInstagramLoginToken(token) ? IG_GRAPH_API_BASE : GRAPH_API_BASE;
}

/**
 * Live check of one tenant. Never throws: a state of `UNREACHABLE` means "could
 * not tell", which must not be reported to the customer as a broken connection.
 */
export async function checkConnectionHealth(
  tenantId: string,
  opts: { persist?: boolean } = {}
): Promise<ConnectionHealth> {
  const checkedAt = new Date().toISOString();
  const token = getDecryptedTokenForTenant(tenantId);
  const status = getSafeStatus(tenantId);

  const finish = (result: Omit<ConnectionHealth, 'tenantId' | 'checkedAt'>): ConnectionHealth => {
    const health: ConnectionHealth = { tenantId, checkedAt, ...result };
    if (opts.persist !== false) {
      markConnectionLiveCheck(tenantId, {
        state: health.state,
        detail: health.detail,
        checkedAt: health.checkedAt,
        username: health.username,
      });
    }
    return health;
  };

  if (!status.isConnected) {
    return { tenantId, state: 'NOT_CONNECTED', detail: undefined, checkedAt };
  }
  if (!token) {
    return finish({
      state: 'NEEDS_REAUTH',
      detail: 'The stored token could not be decrypted, so it cannot be used. Reconnect this account.',
    });
  }

  const host = hostForToken(token);
  try {
    const res = await fetch(`${host}/me?fields=id,username`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await res.json().catch(() => null);

    if (data?.error) {
      const code = Number(data.error.code);
      const message = String(data.error.message || 'Meta refused the token.');
      if (isAuthFailure(code, message)) {
        return finish({ state: 'NEEDS_REAUTH', detail: message });
      }
      return finish({
        state: 'UNREACHABLE',
        detail: isTransient(code, message) ? `Meta is rate limiting this check: ${message}` : message,
      });
    }

    if (!data?.id) {
      return finish({ state: 'UNREACHABLE', detail: 'Meta answered without an account id.' });
    }

    return finish({ state: 'OK', username: String(data.username || '') || undefined });
  } catch (err: any) {
    return finish({ state: 'UNREACHABLE', detail: `Could not reach Meta: ${err?.message || err}` });
  }
}

export interface ConnectionHealthSweep {
  checkedAt: string;
  checked: number;
  needingReauth: ConnectionHealth[];
  unreachable: ConnectionHealth[];
}

/**
 * Check every connected account. Used by the owner's "check all accounts"
 * action: the whole point is to find the dead ones before a customer notices,
 * so it reports the failures rather than a bare success count.
 */
export async function checkAllConnectionHealth(): Promise<ConnectionHealthSweep> {
  const tenantIds = listConnectedTenantIds();
  const results: ConnectionHealth[] = [];
  // Sequential on purpose: a burst of parallel `/me` calls invites Meta's rate
  // limiter onto an account that is otherwise fine.
  for (const tenantId of tenantIds) {
    results.push(await checkConnectionHealth(tenantId));
  }

  return {
    checkedAt: new Date().toISOString(),
    checked: results.length,
    needingReauth: results.filter((r) => r.state === 'NEEDS_REAUTH'),
    unreachable: results.filter((r) => r.state === 'UNREACHABLE'),
  };
}

/**
 * Mark a connection as needing a reconnect because a *send* was refused.
 *
 * Called from the webhook's send path: that is the earliest possible moment a
 * broken token shows up in normal traffic, and it arrives with the customer's
 * phone already open.
 */
export function noteSendAuthFailure(tenantId: string, errorText: string): void {
  if (!isAuthFailure(190, errorText) && !isAuthFailure(undefined, errorText)) return;
  markConnectionLiveCheck(tenantId, {
    state: 'NEEDS_REAUTH',
    detail: `Instagram refused a reply: ${errorText}`,
    checkedAt: new Date().toISOString(),
  });
}
