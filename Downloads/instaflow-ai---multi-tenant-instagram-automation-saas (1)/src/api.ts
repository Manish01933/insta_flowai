import { auth } from './firebase';

/**
 * Every `/api` call from the dashboard goes through here.
 *
 * The server no longer believes an `x-tenant-id` header — it reads the tenant
 * from a verified Firebase ID token, so that a uid cannot simply be claimed.
 * Attaching the token in one place (rather than in twenty call sites) is what
 * makes that guarantee hold as new screens are added.
 *
 * In Demo Mode there is no signed-in user, so no header is attached and the
 * server lets the request through as the demo tenant — which only ever sees its
 * own empty data.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = async (forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(init.headers || {});
    const user = auth.currentUser;

    // Which tenant this request is about. Signed in, it is the account's own uid;
    // otherwise the dashboard is in Demo Mode, and `default_tenant` is the only
    // tenant the server serves without a token. Defaulting here means a new
    // screen cannot forget the header and quietly look empty.
    if (!headers.has('x-tenant-id')) headers.set('x-tenant-id', user?.uid || 'default_tenant');

    if (user && !headers.has('Authorization')) {
      try {
        // Cached by the Firebase SDK and refreshed automatically when it is close
        // to expiring, so this is not a network round trip on every request.
        headers.set('Authorization', `Bearer ${await user.getIdToken(forceRefresh)}`);
      } catch {
        // Refresh failed (offline, revoked session). Send the request anyway: the
        // server answers 401 and the UI shows its normal error state.
      }
    }

    return fetch(input, { ...init, headers });
  };

  const response = await send(false);

  // A tab left open overnight can hold a token that expired while it was idle.
  // One forced refresh-and-retry turns that into a silent recovery instead of a
  // spurious "sign in again" over a working session.
  if (response.status === 401 && auth.currentUser && !new Headers(init.headers || {}).has('Authorization')) {
    return send(true);
  }

  return response;
}
