import { encryptData, decryptData } from './encryption';

/**
 * Pinned Graph API version for the Facebook Login surface (EAA… tokens).
 * v21.0 EXPIRES 2027-01-21. An expired pin does not fail cleanly: Meta falls
 * the call forward to the next usable version and behavior drifts silently.
 * Keep this on a live version (see
 * developers.facebook.com/docs/graph-api/changelog/versions) or override with
 * the META_GRAPH_API_VERSION env var without a code change.
 */
export const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
export const GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

/**
 * Instagram Login ("Instagram API with Instagram Login") is a SEPARATE API surface
 * from the Facebook Graph API: different host, different tokens, different scopes.
 *
 * Tokens minted by Instagram Login start with `IG` (IGAA…, IGQV…), while Facebook
 * Graph tokens start with `EAA`. Many Meta apps (including this one's) are only
 * provisioned for Instagram Login, so sending those tokens to graph.facebook.com
 * fails with code 190 "Cannot parse access token".
 */
export const IG_GRAPH_API_VERSION = process.env.IG_GRAPH_API_VERSION || 'v23.0';
export const IG_GRAPH_API_BASE = `https://graph.instagram.com/${IG_GRAPH_API_VERSION}`;
export const IG_OAUTH_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const IG_OAUTH_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const IG_LOGIN_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];

export type AuthMode = 'facebook' | 'instagram_login';

/** True when the token belongs to the Instagram Login API (not the FB Graph API). */
export function isInstagramLoginToken(token: string): boolean {
  return /^IG[A-Za-z0-9]/.test(String(token || '').trim());
}

export interface InstagramAccountDetails {
  instagramAccountId: string;
  instagramUsername: string;
  instagramName?: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  facebookPageName?: string;
  accessToken: string;
  scopes?: string[];
  /** Which API surface the stored token belongs to. */
  authMode?: AuthMode;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  account?: {
    instagramAccountId: string;
    instagramUsername: string;
    instagramName?: string;
    profilePictureUrl?: string;
    facebookPageId?: string;
    facebookPageName?: string;
    lastVerifiedAt: string;
  };
}

/**
 * Translates Meta Graph API error codes into helpful, human-readable explanations.
 */
export function formatMetaError(errorObj: any): string {
  if (!errorObj) return 'Unknown Meta API error occurred.';
  
  const code = errorObj.code;
  const subcode = errorObj.error_subcode;
  const message = errorObj.message || 'Meta API returned an error.';

  if (code === 1) {
    if (message.includes('client secret') || message.includes('Error validating client secret')) {
      return 'Error validating client secret: The Meta App Secret configured does not match the Meta App ID. Please verify in developers.facebook.com under Settings > Basic for your app and update META_APP_SECRET in your environment.';
    }
  }

  if (message.includes('Error validating client secret')) {
    return 'Error validating client secret: The Meta App Secret does not match the Meta App ID. In Meta Developer Console, navigate to App Settings > Basic, click Show on App Secret, and ensure your server environment has the exact matching META_APP_SECRET.';
  }
  if (code === 190) {
    if (subcode === 463 || subcode === 467) {
      return 'The Meta Access Token has expired. Please regenerate your token or reconnect via OAuth.';
    }
    if (subcode === 460) {
      return 'The password of the connected account was changed. Please re-authenticate with Meta.';
    }
    return 'Invalid or expired Meta Access Token. Please verify and provide a fresh token.';
  }

  if (code === 10 || code === 200 || code === 298) {
    return 'Permission denied by Meta: The provided token lacks required permissions (such as instagram_basic, instagram_manage_messages, or pages_show_list).';
  }

  if (code === 100) {
    if (message.includes('Unsupported get request')) {
      return `Meta API ID not found or inaccessible (${message}). Note: Do not use the Meta App ID as the Instagram Page ID; use the Instagram Business Account ID.`;
    }
    if (/unsupported request/i.test(message)) {
      return (
        `Meta rejected this call (${message}). On Instagram Login this is almost always the app's access level, ` +
        'not the request itself: accounts that hold a role on the app (Admin/Developer/Tester) succeed, while ' +
        "accounts without a role fail until the app completes Meta's Tech Provider / Access Verification. " +
        'Fix: add the account as an Instagram Tester with an Active invite, or finish Tech Provider verification for the Instagram app.'
      );
    }
    return `Invalid parameter in Meta API request: ${message}`;
  }

  if (code === 4 || code === 17 || code === 32) {
    return 'Meta Graph API rate limit reached. Please wait a few minutes before trying again.';
  }

  return message;
}

/**
 * Discovers and validates the real Instagram Business Account ID and details from a Meta token.
 * Traverses Facebook Pages -> Linked Instagram Business Account, or validates direct IG account ID.
 */
export async function discoverInstagramAccount(
  rawToken: string,
  hintId?: string
): Promise<{ success: boolean; data?: InstagramAccountDetails; error?: string }> {
  const token = rawToken.trim();
  if (!token || token.length < 15) {
    return { success: false, error: 'Meta access token is too short or invalid format.' };
  }

  // Instagram Login tokens must go to graph.instagram.com — graph.facebook.com
  // answers them with an opaque 190 "Cannot parse access token".
  if (isInstagramLoginToken(token)) {
    return discoverInstagramLoginAccount(token);
  }

  // 1. Try querying /me/accounts to find connected Facebook Pages with linked Instagram Business Accounts
  try {
    const pagesUrl = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(token)}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json();

    if (pagesData.data && Array.isArray(pagesData.data) && pagesData.data.length > 0) {
      // Look for a page that has an instagram_business_account
      for (const page of pagesData.data) {
        if (page.instagram_business_account && page.instagram_business_account.id) {
          const ig = page.instagram_business_account;
          return {
            success: true,
            data: {
              instagramAccountId: ig.id,
              instagramUsername: ig.username || 'instagram_user',
              instagramName: ig.name || page.name,
              profilePictureUrl: ig.profile_picture_url,
              facebookPageId: page.id,
              facebookPageName: page.name,
              // Prefer the page's specific access token if available, else the user token
              accessToken: page.access_token || token,
            },
          };
        }
      }

      // If user provided a specific hintId (e.g. they know their Page ID)
      if (hintId) {
        const matchedPage = pagesData.data.find((p: any) => p.id === hintId.trim());
        if (matchedPage && matchedPage.instagram_business_account) {
          const ig = matchedPage.instagram_business_account;
          return {
            success: true,
            data: {
              instagramAccountId: ig.id,
              instagramUsername: ig.username || 'instagram_user',
              instagramName: ig.name || matchedPage.name,
              profilePictureUrl: ig.profile_picture_url,
              facebookPageId: matchedPage.id,
              facebookPageName: matchedPage.name,
              accessToken: matchedPage.access_token || token,
            },
          };
        }
      }
    } else if (pagesData.error) {
      console.warn('Meta /me/accounts query note:', pagesData.error.message);
    }
  } catch (err: any) {
    console.warn('Error querying /me/accounts:', err.message);
  }

  // 2. If the user provided a hintId or if the token is directly for an Instagram Business Account
  const targetId = hintId ? hintId.trim() : 'me';
  try {
    const directUrl = `${GRAPH_API_BASE}/${targetId}?fields=id,name,username,profile_picture_url,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(token)}`;
    const directRes = await fetch(directUrl);
    const directData = await directRes.json();

    if (directData && !directData.error) {
      // Check if it returned an instagram_business_account
      if (directData.instagram_business_account && directData.instagram_business_account.id) {
        const ig = directData.instagram_business_account;
        return {
          success: true,
          data: {
            instagramAccountId: ig.id,
            instagramUsername: ig.username || 'instagram_user',
            instagramName: ig.name || directData.name,
            profilePictureUrl: ig.profile_picture_url,
            facebookPageId: directData.id,
            facebookPageName: directData.name,
            accessToken: token,
          },
        };
      }

      // If directData itself is the Instagram Business Account (has username or numeric IG ID)
      if (directData.id && (directData.username || targetId !== 'me')) {
        return {
          success: true,
          data: {
            instagramAccountId: directData.id,
            instagramUsername: directData.username || directData.name || `account_${directData.id}`,
            instagramName: directData.name,
            profilePictureUrl: directData.profile_picture_url,
            accessToken: token,
          },
        };
      }
    } else if (directData && directData.error) {
      const errorMsg = formatMetaError(directData.error);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    return { success: false, error: `Connection failed: ${err.message}` };
  }

  return {
    success: false,
    error: 'No Instagram Professional/Business account found linked to this Meta token. Please ensure your Instagram account is set to "Professional" or "Business" in Instagram Settings, and that it is linked to a Facebook Page in Meta Accounts Center.',
  };
}

/**
 * Performs a live verification check against Meta Graph API for an existing connected account.
 */
export async function verifyLiveInstagramConnection(
  instagramAccountId: string,
  rawToken: string
): Promise<VerificationResult> {
  if (isInstagramLoginToken(rawToken)) {
    const igDiscovery = await discoverInstagramLoginAccount(rawToken);
    if (!igDiscovery.success || !igDiscovery.data) {
      return { valid: false, error: igDiscovery.error };
    }
    return {
      valid: true,
      account: {
        instagramAccountId: igDiscovery.data.instagramAccountId,
        instagramUsername: igDiscovery.data.instagramUsername,
        instagramName: igDiscovery.data.instagramName,
        profilePictureUrl: igDiscovery.data.profilePictureUrl,
        lastVerifiedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const url = `${GRAPH_API_BASE}/${instagramAccountId}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return {
        valid: false,
        error: formatMetaError(data.error),
      };
    }

    if (!data.id) {
      return {
        valid: false,
        error: 'Instagram account ID verification returned empty response from Meta.',
      };
    }

    return {
      valid: true,
      account: {
        instagramAccountId: data.id,
        instagramUsername: data.username || 'instagram_user',
        instagramName: data.name,
        profilePictureUrl: data.profile_picture_url,
        lastVerifiedAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Network error verifying with Meta Graph API: ${err.message}`,
    };
  }
}

/**
 * Discovers the Instagram account behind an Instagram-Login (IGAA…) token.
 * The Instagram Login presence API exposes the account through `user_id`.
 */
export async function discoverInstagramLoginAccount(
  rawToken: string
): Promise<{ success: boolean; data?: InstagramAccountDetails; error?: string }> {
  const token = rawToken.trim();

  try {
    const url = `${IG_GRAPH_API_BASE}/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: formatMetaError(data.error) };
    }

    const accountId = data.user_id || data.id;
    if (!accountId) {
      return {
        success: false,
        error:
          'Instagram did not return an account id for this token. Make sure the token was generated for an Instagram Professional account.',
      };
    }

    return {
      success: true,
      data: {
        instagramAccountId: String(accountId),
        instagramUsername: data.username || `ig_${accountId}`,
        instagramName: data.name,
        profilePictureUrl: data.profile_picture_url,
        accessToken: token,
        scopes: IG_LOGIN_SCOPES,
        authMode: 'instagram_login',
      },
    };
  } catch (err: any) {
    return { success: false, error: `Instagram Login discovery failed: ${err.message}` };
  }
}

/**
 * Subscribes the connected Instagram Business account to the app's webhook
 * (messages + messaging_postbacks) via the Instagram Login Graph surface.
 *
 * Meta does NOT reliably auto-subscribe accounts after Business Login OAuth:
 * without this call, inbound DMs never reach the webhook and the bot stays
 * silent even though the connection itself is valid.
 */
export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  rawToken: string
): Promise<{ success: boolean; subscribedFields?: string[]; error?: string }> {
  try {
    const res = await fetch(
      `${IG_GRAPH_API_BASE}/${encodeURIComponent(instagramAccountId)}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rawToken}`,
        },
        body: JSON.stringify({ subscribed_fields: 'messages,messaging_postbacks' }),
      }
    );

    const data = await res.json();
    if (data.error) {
      console.warn(
        `Webhook subscription failed for IG account ${instagramAccountId}:`,
        data.error
      );
      return { success: false, error: formatMetaError(data.error) };
    }
    const fields = Array.isArray(data?.data?.[0]?.subscribed_fields)
      ? data.data[0].subscribed_fields
      : undefined;
    console.log(
      `Webhook subscription OK for IG account ${instagramAccountId}` +
        (fields ? ` (fields: ${fields.join(', ')})` : '')
    );
    return { success: true, subscribedFields: fields };
  } catch (err: any) {
    console.error(
      `Webhook subscription network error for IG account ${instagramAccountId}:`,
      err?.message || err
    );
    return { success: false, error: err?.message || String(err) };
  }
}

/** Sends a DM through the Instagram Login messaging endpoint. */
async function sendInstagramLoginMessage(
  recipientId: string,
  messageText: string,
  rawToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${IG_GRAPH_API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
      }),
    });

    const data = await res.json();
    if (data.error) {
      console.warn('Instagram Login send error on /me/messages:', data.error);
      return { success: false, error: formatMetaError(data.error) };
    }
    return { success: true, data };
  } catch (err: any) {
    console.error('sendInstagramLoginMessage network error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Builds the Instagram Login authorization URL (the equivalent of the Facebook
 * OAuth dialog, but for apps provisioned for Instagram API with Instagram Login).
 */
export function buildInstagramLoginAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const scopes = args.scopes?.length ? args.scopes : IG_LOGIN_SCOPES;
  return (
    `${IG_OAUTH_AUTHORIZE_URL}?client_id=${encodeURIComponent(args.clientId)}` +
    `&redirect_uri=${encodeURIComponent(args.redirectUri)}` +
    `&response_type=code&scope=${encodeURIComponent(scopes.join(','))}` +
    `&state=${encodeURIComponent(args.state)}`
  );
}

/** Exchanges an Instagram Login authorization code for a short-lived token. */
export async function exchangeInstagramLoginCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ success: boolean; accessToken?: string; userId?: string; error?: string }> {
  try {
    const body = new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: args.redirectUri,
      code: args.code,
    });

    const res = await fetch(IG_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();

    if (data.error || data.error_message) {
      return { success: false, error: formatMetaError(data.error) || data.error_message };
    }
    if (!data.access_token) {
      return { success: false, error: 'Instagram did not return an access token.' };
    }

    return { success: true, accessToken: data.access_token, userId: data.user_id ? String(data.user_id) : undefined };
  } catch (err: any) {
    return { success: false, error: `Instagram code exchange failed: ${err.message}` };
  }
}

/**
 * Why the last `exchangeForLongLivedInstagramToken` call returned null.
 *
 * The exchange fails soft on purpose (the short-lived token is still usable), so
 * without this the caller can only say "it did not upgrade" — which hid the real
 * cause (e.g. Meta's access-level gate answering code 100) behind a generic
 * "Invalid parameter" banner in the dashboard.
 */
let lastLongLivedExchangeError: string | null = null;

/** Human-readable reason for the most recent failed long-lived token exchange. */
export function getLastLongLivedExchangeError(): string | null {
  return lastLongLivedExchangeError;
}

/** Swaps a short-lived Instagram Login token for a 60-day long-lived one. */
export async function exchangeForLongLivedInstagramToken(
  shortLivedToken: string,
  clientSecret: string
): Promise<string | null> {
  lastLongLivedExchangeError = null;
  try {
    const url = `${IG_GRAPH_API_BASE.replace(/\/v[0-9.]+$/, '')}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(shortLivedToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.access_token) return data.access_token;
    const reason = formatMetaError(data.error) || 'Meta did not return a long-lived token.';
    lastLongLivedExchangeError = reason;
    console.warn('Instagram long-lived token exchange returned no token:', data, '→', reason);
    return null;
  } catch (err: any) {
    lastLongLivedExchangeError = `Instagram long-lived token exchange failed: ${err?.message || err}`;
    console.warn('Instagram long-lived token exchange failed:', err);
    return null;
  }
}

/**
 * Sends a direct message reply to an Instagram user via the Meta Graph API.
 *
 * Routes to graph.instagram.com automatically when the connection was made with
 * Instagram Login (or when the token itself is an `IG…` token).
 */
export async function sendInstagramMessage(
  instagramAccountId: string,
  recipientId: string,
  messageText: string,
  rawToken: string,
  authMode?: AuthMode
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (authMode === 'instagram_login' || (!authMode && isInstagramLoginToken(rawToken))) {
    return sendInstagramLoginMessage(recipientId, messageText, rawToken);
  }

  try {
    // 1. Try sending to https://graph.facebook.com/<META_GRAPH_API_VERSION>/{instagramAccountId}/messages
    const url = `${GRAPH_API_BASE}/${instagramAccountId}/messages?access_token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
      }),
    });

    const data = await res.json();

    if (data.error) {
      console.warn(`Meta send error on /${instagramAccountId}/messages:`, data.error);
      // Fallback: try /me/messages if page-scoped token
      const fallbackUrl = `${GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(rawToken)}`;
      const fbRes = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: messageText },
        }),
      });
      const fbData = await fbRes.json();
      if (fbData.error) {
        return { success: false, error: formatMetaError(fbData.error) };
      }
      return { success: true, data: fbData };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error('sendInstagramMessage network error:', err);
    return { success: false, error: err.message };
  }
}
