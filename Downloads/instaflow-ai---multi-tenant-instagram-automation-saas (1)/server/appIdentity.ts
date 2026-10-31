/**
 * Which Meta app this deployment actually connects Instagram through.
 *
 * Why this module exists: a tester invite only works on **one** app — the app
 * whose credentials this server uses for OAuth. Adding the tester on any other
 * Meta app looks identical from inside Instagram (the person still accepts an
 * invite and still sees an "authorized" row) but the connect then fails on the
 * access gate, or the token that arrives cannot be used by this server at all.
 * That happened in production: invites were sent from a different app of the
 * same developer account and every connect from those accounts was silently
 * useless.
 *
 * So the product states the invariant instead of leaving it to memory: the
 * `oauthClientId` below is the client id Meta sees, and every "add as a tester"
 * instruction in the console has to name that same app.
 */
export interface OAuthAppIdentity {
  /** Which API surface this server runs the connect flow on. */
  flavour: 'instagram_login' | 'facebook';
  /** The `client_id` sent to Meta — the app an invite has to be accepted on. */
  oauthClientId: string | null;
  /** Instagram-platform app id (`IG_APP_ID`), when Instagram Login is configured. */
  instagramAppId: string | null;
  /** Facebook app id (`META_APP_ID`), which the app dashboard and roles page are keyed by. */
  facebookAppId: string | null;
  /** True when an Instagram app id AND its own secret are configured. */
  instagramLoginReady: boolean;
  /** The app dashboard that owns the roles / Instagram-testers list. */
  appDashboardUrl: string | null;
  /** Where an Instagram Tester is added. */
  appRolesUrl: string | null;
  /** Deep link to the app's Instagram product page. */
  instagramApiSetupUrl: string | null;
}

function envValue(name: string): string {
  return (process.env[name] || '').trim();
}

export function getOAuthAppIdentity(): OAuthAppIdentity {
  const instagramAppId = envValue('IG_APP_ID') || null;
  const instagramAppSecret = envValue('IG_APP_SECRET');
  const facebookAppId = envValue('META_APP_ID') || envValue('INSTAGRAM_APP_ID') || null;

  const instagramLoginReady = Boolean(instagramAppId && instagramAppSecret);
  const flavour: OAuthAppIdentity['flavour'] = instagramLoginReady ? 'instagram_login' : 'facebook';
  const oauthClientId = instagramLoginReady ? instagramAppId : facebookAppId;

  // The dashboard is keyed by the FACEBOOK app id. An Instagram app id is not a
  // dashboard URL: `developers.facebook.com/apps/<ig-app-id>` has no app to open,
  // which is exactly how an operator ends up on a *different* app's roles page
  // and invites testers for an app this server never talks to. The Facebook app
  // id is preferred whenever it is known; the Instagram id is the fallback only
  // for the (Instagram-Login) deployment that has no Facebook app id at all.
  const dashboardAppId = facebookAppId || instagramAppId;
  const app = dashboardAppId ? `https://developers.facebook.com/apps/${dashboardAppId}` : null;

  return {
    flavour,
    oauthClientId,
    instagramAppId,
    facebookAppId,
    instagramLoginReady,
    appDashboardUrl: app ? `${app}/` : null,
    appRolesUrl: app ? `${app}/roles/roles/` : null,
    instagramApiSetupUrl: app ? `${app}/use_cases/customize/API-Setup/?product_route=instagram-business` : null,
  };
}
