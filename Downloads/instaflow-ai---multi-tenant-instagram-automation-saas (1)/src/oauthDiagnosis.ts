/**
 * Why the Meta consent window ended without connecting anything.
 *
 * Meta does not redirect back when it refuses a login: it renders its own error
 * page inside the popup ("URL blocked", "Invalid redirect_uri") and the popup
 * just sits there. The dashboard therefore only learns that *nothing* happened,
 * and the operator is left staring at an unchanged Connect button — the exact
 * "mujhe pata hi nahi chala main galat kaha tha" state.
 *
 * The two causes are both knowable in advance from the status the server
 * already sends, so the failure can be named instead of guessed at:
 *
 *  - `oauthFlavour: 'facebook'` means IG_APP_ID / IG_APP_SECRET are not set on
 *    the server. A Meta app provisioned for Instagram Login has no Facebook
 *    "Valid OAuth Redirect URIs" page at all, so the Facebook dialog always
 *    answers `URL blocked` (see DEPLOY.md).
 *  - A redirect URI on localhost, or one the visitor has never seen on their
 *    own screen, is the other half: Meta compares the redirect URI against the
 *    app's whitelist byte for byte, so it has to be both registered and live.
 */

export interface ConsentStatusFacts {
  oauthFlavour?: 'instagram_login' | 'facebook' | null;
  oauthRedirectUri?: string | null;
  oauthClientId?: string | null;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Hosts Meta can never redirect to, whatever the app's whitelist says. */
export function isUnreachableRedirectHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  );
}

/**
 * One actionable paragraph for the operator who just closed the Meta window.
 * Ordered so the most likely cause is read first.
 */
export function describeConsentFailure(
  status: ConsentStatusFacts | null,
  pageOrigin: string,
  t: Translate
): string {
  const lines: string[] = [t('oauth.closedNoConnect')];
  const redirectUri = String(status?.oauthRedirectUri || '');

  if (status?.oauthFlavour === 'facebook') {
    lines.push(t('oauth.fbFlavour'));
  }

  if (redirectUri && isUnreachableRedirectHost(redirectUri)) {
    lines.push(t('oauth.localhostRedirect'));
  } else if (redirectUri) {
    // The visitor may be looking at a different host than the one Meta will
    // send them back to (a tunnel, or the deployed domain) — say which.
    const pageHost = hostOf(pageOrigin);
    const redirectHost = hostOf(redirectUri);
    lines.push(
      pageHost && redirectHost && pageHost !== redirectHost
        ? t('oauth.otherHostRedirect', { uri: redirectUri })
        : t('oauth.whitelistReminder', { uri: redirectUri })
    );
  }

  return lines.join(' ');
}
