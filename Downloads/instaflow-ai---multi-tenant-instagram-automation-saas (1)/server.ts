// Must be the first import: loads .env before any other server module reads it.
import './server/env';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { generateAiReply, getAiConfigStatus, verifyOpenRouterModelAtBoot, verifyOmniRouteModelAtBoot, AI_FALLBACK_REPLY, isDuplicateFallbackReply } from './server/aiService';
import { parseInboundMessage, productContextInstruction } from './server/inboundMessage';
import { 
  discoverInstagramAccount, 
  discoverInstagramLoginAccount,
  verifyLiveInstagramConnection, 
  sendInstagramMessage,
  formatMetaError,
  buildInstagramLoginAuthUrl,
  exchangeInstagramLoginCode,
  exchangeForLongLivedInstagramToken,
  getLastLongLivedExchangeError,
  subscribeInstagramAccountToWebhooks,
  META_GRAPH_API_VERSION,
  GRAPH_API_BASE
} from './server/metaApi';
import { 
  saveConnection, 
  getSafeStatus, 
  getDecryptedTokenForTenant, 
  getTenantByInstagramAccountId,
  updateVerificationStatus,
  disconnectAccount,
  getDiagnosticsInfo,
  getSharedInstagramAccounts,
  resolveSharedAccountRouting,
  loadConnectionsFromDisk,
  listConnections
} from './server/connectionStore';
import {
  hasProcessedMessage,
  markMessageProcessed,
  startMessageDedupeSweeper,
  getMessageDedupeStats
} from './server/messageDedupe';
import {
  getTenantAiContext,
  getTenantAiSettings,
  saveTenantAiSettings,
  deleteTenantAiSettings,
  getTenantSettingsStats,
  DEFAULT_SYSTEM_PROMPT,
  ANSWERING_RULES,
  MAX_SYSTEM_PROMPT_CHARS,
} from './server/tenantSettings';
import {
  KB_MISS_INSTRUCTION,
  recordKbGap,
  getKbGaps,
  resolveKbGap,
  clearKbGaps,
  extractKbMiss,
  getKbGapStats,
} from './server/kbGapStore';
import { addLead, getLeads, markLeadHandled, getLeadStats, deleteLeadsForTenant } from './server/leadStore';
import {
  parseSignedRequest,
  newConfirmationCode,
  recordDataDeletion,
  getDataDeletionRequest,
  getDataDeletionStats,
} from './server/dataDeletionStore';
import { getTenantByInstagramUsername } from './server/connectionStore';
import {
  getBotControlSnapshot,
  getBotControlStats,
  isBotEnabled,
  setAllBots,
  setBotEnabled,
} from './server/botControlStore';
import {
  evaluateInbound,
  getBotGuardStats,
  getRecentGuardEvents,
  isBotIsolationEnabled,
  noteOutboundReply,
  startBotGuardSweeper,
  wouldBurstCap,
} from './server/botGuard';
import {
  getTesterRequest,
  submitTesterRequest,
  setTesterRequestStatus,
  setTesterRequestInvitation,
  getTesterRequestStats,
  validateInvitationUrl,
  recordTesterAccountAdded,
  recordTesterAcceptance,
  recordCustomerConfirmation,
  recordTesterNotification,
  type TesterRequestStatus,
} from './server/testerRequestStore';
import {
  touchActivationOnConnect,
  getActivationState,
  listActivationStates,
  markInvitationSent,
  sendActivationInstructions,
  confirmTestDm,
  requireAction,
  messageSendFailed,
  type ActivationStatus,
} from './server/activationStore';
import { buildTenantOverview } from './server/opsOverview';
import { explainRootCause, type RootCauseAccount } from './server/rootCause';
import { billingResetConfirmMatches, planBillingReset } from './server/billingReset';
import {
  getAccountRemovalStats,
  hideAccount,
  isAccountHidden,
  restoreAccount,
} from './server/accountRemovalStore';
import { deleteConfirmMatches, removeTenantCompletely } from './server/tenantRemoval';
import { runBotSelfTest } from './server/botSelfTest';
import {
  getConnectAttemptStats,
  getLastConnectAttempt,
  recordConnectAttempt,
} from './server/connectAttemptStore';
import {
  buildConnectFixFacts,
  ensureHandleRecorded,
  sortFixPlans,
  type ConnectFixFacts,
} from './server/connectFix';
import { getOAuthAppIdentity } from './server/appIdentity';
import {
  checkConnectionHealth,
  checkAllConnectionHealth,
  noteSendAuthFailure,
} from './server/connectionHealth';
import {
  recordUnroutedDelivery,
  getUnroutedDeliveryStats,
  clearUnroutedDeliveries,
} from './server/deliveryAlertStore';
import {
  buildOnboardingSnapshot,
  buildSupportSystemPrompt,
  offlineGuideAnswer,
  markSimulatorTested,
  setGuideHidden,
  loadOnboarding,
} from './server/onboardingStore';
import {
  getPurchasablePlans,
  getPlan,
  findSubscription,
  isLaunchOfferAvailable,
  LAUNCH_OFFER_CAP,
  launchOfferSold,
  startTrial,
  activateSubscription,
  cancelSubscription,
  decideAccess,
  listSubscriptions,
  resetSubscriptions,
  getOwnerTenantIds,
  isOwnerIdentity,
  getCompedTenantIds,
  getSubscriptionStats,
  rememberPendingOrder,
  getPendingOrder,
  clearPendingOrder,
  isCompedTenant,
  isOwnerTenant,
  activateFreePlan,
  extendSubscriptionDays,
  TRIAL_DAYS,
} from './server/planStore';
import { getProfile, setUsername, resetUsername } from './server/profileStore';
import {
  getPublicBanner,
  getOwnerBanner,
  saveBanner,
  deleteBanner,
  BannerInputError,
} from './server/bannerStore';
import {
  listVideos,
  addVideo,
  deleteVideo,
  VideoInputError,
} from './server/videoLibraryStore';
import {
  getContact,
  maskPhone,
  saveContact,
  optOut as optOutContact,
  validateContactInput,
  hasWhatsAppConsent,
  type ContactPatch,
  type ContactRecord,
} from './server/contactStore';
import {
  ensureRegistered,
  transition as transitionOnboarding,
  recordEvent as recordEventOnboarding,
  getOnboardingState,
  listOnboardingStates,
  getOnboardingMetrics,
  type OnboardingActor,
} from './server/onboardingStatusStore';
import {
  generateKbDraft,
  getKbDraft,
  approveKbDraft,
  rejectKbDraft,
  saveDraftEdits,
  CATEGORIES,
} from './server/kbDraft';
import {
  queueWhatsAppMessage,
  listOutbox,
  providerStatusDetail,
  isCustomerWhatsAppProviderConfigured,
  renderTemplate,
  type TemplateId,
} from './server/whatsappOutbox';
import { markComped, unmarkComped } from './server/compStore';
import { DEFAULT_LANG, langCookieHeader, langFromRequest, message as M, type Lang } from './server/i18n';
import { verifyFirebaseIdToken } from './server/auth';
import { BOOKING, COMPLAINT, LANDING, PLANS, fillTemplate, planTagline } from './server/publicCopy';
import {
  addComplaint,
  getComplaints,
  getComplaintStats,
  loadComplaints,
  markComplaintNotified,
  resolveComplaint,
  type Complaint,
} from './server/complaintStore';
import { getOwnerWhatsAppLabel, isOwnerWhatsAppConfigured, sendOwnerWhatsApp } from './server/ownerNotify';
import {
  startTrace,
  updateTrace,
  isRetryableCategory,
  classifyError,
  getTraceHealth,
  type MessageTrace,
} from './server/messageTrace';
// Customer health monitoring: durable per-tenant message-lifecycle facts,
// incidents + owner alert delivery (channels/thresholds are env-tunable).
import {
  startHealthStoreSweeper,
  noteInbound,
  noteSendSuccess,
  noteSendFailure,
  noteAiFailure,
  noteWebhookFailure,
  getTenantHealthFacts,
} from './server/tenantHealthStore';
import {
  startAlertEngine,
  startNoReplyWatcher,
  getAlertChannelStatus,
  evaluateSilentBot,
  openIncident,
  deliver as deliverIncidentAlert,
  getOpenIncidentCount,
  isEmailAlertConfigured,
  ALERT_DEFAULTS,
} from './server/adminAlertNotifier';
import {
  listIncidents,
  setIncidentStatus,
  type IncidentStatus,
} from './server/healthIncidentStore';
// Task 3: durable retry queue for confirmed-transient send failures.
import {
  offerFailedSend,
  processDueRetryJobs,
  getRetryQueueStats,
  loadRetryQueue,
  setRetryGuards,
  listRetryJobs,
  promoteRetryJob,
  discardRetryJob,
  RETRY_ENABLED,
} from './server/retryQueue';
import {
  isPaymentsConfigured,
  getPublicPaymentConfig,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  fetchPayment,
  fetchOrderPayments,
  capturePayment,
  describePaymentFailure,
} from './server/payments';
import {
  buildChatId,
  getChatsForTenant,
  getChatById,
  isHumanTakeover,
  recordIncomingMessage,
  appendOutboundMessage,
  setHumanTakeover,
  startChatStoreSweeper,
  getChatStoreStats,
  getChatCountsByTenant,
  deleteChatsForTenant
} from './server/chatStore';

// Resolve the listening port. Some hosts/injected environments set PORT=0
// ("pick any free port"); fall back to 3000 so local dev has a stable URL.
const parsedPort = parseInt(process.env.PORT || '', 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Meta App Configuration
const META_APP_ID = process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'instaflow_secure_verify_token';

// Instagram Login ("Instagram API with Instagram Login") credentials. These live
// on the Instagram product page of the same Meta app and are what an app
// provisioned for that flavour must use for OAuth + Graph calls.
const IG_APP_ID = process.env.IG_APP_ID || '';
const IG_APP_SECRET = process.env.IG_APP_SECRET || '';

// How incoming webhook deliveries are authenticated.
//
// - 'enforce' (default): a delivery whose signature matches no configured
//   secret is dropped with 401 before any work happens.
// - 'warn': still log the failure, but process the delivery anyway. This is a
//   deliberate escape hatch for the case where deliveries arrive signed with a
//   secret we do not have yet — it lets the bot come alive while the correct
//   secret is being fetched. In this mode anyone who learns the webhook URL can
//   inject a fake delivery, so it is meant to be temporary.
const WEBHOOK_SIGNATURE_MODE = (process.env.WEBHOOK_SIGNATURE_MODE || 'enforce').toLowerCase();
const WEBHOOK_SIGNATURE_WARN = WEBHOOK_SIGNATURE_MODE === 'warn';

// Deduplication of incoming message IDs (prevents double-replies from webhook
// retries). Backed by server/messageDedupe.ts so the cache survives restarts
// and redeploys — see that module for the rationale.
startMessageDedupeSweeper();

// Task 3: boot-time retry-queue recovery (load + expire stale jobs) and the
// retry sweeper. Processing only advances RETRY_ENABLED=true; otherwise no-op.
loadRetryQueue();
// Task 3 B1: CURRENT-state safety checks before every retry send — bot switch,
// human takeover and burst cap re-read at send time (enqueue-time state is
// stale by then), plus hardened tenant↔account ownership re-verification.
setRetryGuards({
  botEnabled: (tenantId) => isBotEnabled(tenantId).enabled,
  humanTakeover: (instagramAccountId, recipientId) =>
    isHumanTakeover(buildChatId(instagramAccountId, recipientId)),
  burstCap: (igAccountId, recipientId) => wouldBurstCap(igAccountId, recipientId),
  // Ownership: resolve the tenant for THIS instagram account from the registry
  // and require it to be exactly the job's tenant — never the job's own claim
  // alone. A stale tenant on a reconnected account cannot re-fire.
  ownsAccount: (tenantId, instagramAccountId) =>
    getTenantByInstagramAccountId(instagramAccountId)?.tenantId === tenantId,
});
/** The one send path for queued retries — shared by the sweeper below and the
 *  owner console's "Retry now", so both run the identical token-decryption
 *  path and the queue itself never stores a token. */
const retrySender = async ({
  tenantId,
  instagramAccountId,
  recipientId,
  replyText,
  authMode,
}: {
  tenantId: string;
  instagramAccountId: string;
  recipientId: string;
  replyText: string;
  authMode?: string;
}) => {
  // Same runtime token-decryption path as the normal send: the queue itself
  // never stores the token, so a restart re-resolves it per tenant.
  const decryptedToken = getDecryptedTokenForTenant(tenantId);
  if (!decryptedToken) {
    return { success: false, error: 'retry: no decrypted token for tenant (auth)' };
  }
  return sendInstagramMessage(instagramAccountId, recipientId, replyText, decryptedToken, authMode as any);
};

setInterval(() => {
  void processDueRetryJobs(retrySender).catch((err) => console.error('[retryQueue] sweeper error:', err?.message || err));
}, 30_000).unref();

// Customer health monitor: housekeeping only — retention pruning + the
// evidence-gated "replies stopped" check. All intervals are unref'd.
startHealthStoreSweeper();
startAlertEngine();
startNoReplyWatcher();

// Bot-to-bot guard (server/botGuard.ts): how many replies a single conversation
// may receive, plus the sender-username cache that keeps two InstaFlow-connected
// accounts from answering each other forever. Housekeeping only — the guard itself
// runs inline in the webhook.
startBotGuardSweeper();

// Inbox chat history and human-takeover state live in server/chatStore.ts on
// the persistent volume (DATA_DIR): an in-memory Map here was wiped by every
// redeploy, which erased the whole customer inbox.
startChatStoreSweeper();

// OAuth states are signed, not stored. An in-memory map loses every pending
// authorization the moment the container restarts — which happens on every
// deploy — and the customer then lands on "OAuth session expired" right after
// pressing Allow on Instagram. A signed state carries the tenant and the expiry
// with it, so the callback can trust it with no server-side memory at all.
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function oauthStateSecret(): string {
  return (
    process.env.ENCRYPTION_MASTER_KEY ||
    process.env.META_APP_SECRET ||
    process.env.IG_APP_SECRET ||
    'instaflow-oauth-state-fallback'
  );
}

function signOAuthState(tenantId: string, mode: 'facebook' | 'instagram_login'): string {
  const payload = `${Date.now() + OAUTH_STATE_TTL_MS}.${mode}.${crypto.randomBytes(8).toString('hex')}.${tenantId}`;
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', oauthStateSecret()).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

/** Returns the tenant/mode a state was issued for, or null if it is not ours. */
function verifyOAuthState(rawState: string): { tenantId: string; mode: 'facebook' | 'instagram_login' } | null {
  const [encoded, signature] = String(rawState || '').split('.');
  if (!encoded || !signature) return null;

  const expected = crypto.createHmac('sha256', oauthStateSecret()).update(encoded).digest('hex');
  const given = Buffer.from(signature, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  // Constant-time compare: a wrong signature must not leak the right one.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  const parts = Buffer.from(encoded, 'base64url').toString('utf8').split('.');
  if (parts.length < 4) return null;
  const [expiresAtRaw, mode, , ...tenantParts] = parts;
  const tenantId = tenantParts.join('.');
  const expiresAt = Number(expiresAtRaw);
  if (!tenantId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return { tenantId, mode: mode === 'instagram_login' ? 'instagram_login' : 'facebook' };
}

function getPublicAppUrl(req: express.Request): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}`;
}

const DIST_INDEX_HTML = path.join(process.cwd(), 'dist', 'index.html');
// The owner Ops Console is a second, independent app with its own shell, served
// at `/ops` and never linked from the customer dashboard — so a customer's
// browser downloads none of the owner-only code.
const DIST_OPS_HTML = path.join(process.cwd(), 'dist', 'ops.html');

// Vite writes `/assets/index-<hash>.js` into the built shell, and that hash
// changes on every build. Reading it back at boot gives one string that answers
// "which version of the dashboard is this server serving?".
function readBuildId(): string {
  try {
    const html = fs.readFileSync(DIST_INDEX_HTML, 'utf8');
    const match = html.match(/\/assets\/([^"']+)\.js/);
    if (match) return match[1];
  } catch {
    // Dev server, or a first boot before `npm run build`.
  }
  return (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 12) || 'dev';
}

const BUILD_ID = readBuildId();

// The shell is served with the build id it was built from, so an already-open
// tab can tell that a newer deploy exists (see /api/version and the stale-build
// banner). Both apps get the same stamp from this one place.
function stampBuildId(html: string): string {
  return html.replace(
    '</head>',
    `<script>window.__BUILD_ID__=${JSON.stringify(BUILD_ID)}</script></head>`
  );
}

// Meta requires the redirect URI to match one of the app's whitelisted
// "Valid OAuth Redirect URIs" byte-for-byte, and the token exchange must repeat
// the exact same value. META_REDIRECT_URI wins when set (useful for tunnels and
// deployments where the public URL differs from APP_URL).
function getOAuthRedirectUri(req: express.Request, callbackPath = '/api/instagram/oauth/callback'): string {
  const configured = (process.env.META_REDIRECT_URI || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `${getPublicAppUrl(req)}${callbackPath}`;
}

/** Hosts Meta will never send a visitor back to, whatever the app whitelists. */
function isUnreachableRedirectUri(uri: string): boolean {
  let host = '';
  try {
    host = new URL(uri).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (!host) return true;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  );
}

/**
 * Whether the one-click consent screen can actually finish on this deployment.
 *
 * The failure this removes: the customer presses "Connect Instagram with Meta"
 * and Meta answers with a dead end it renders *inside the popup* — "URL
 * blocked", "Invalid redirect_uri" — and never redirects back, so the dashboard
 * has nothing to report and the button looks broken. Both causes are knowable
 * here before the popup opens, so the dashboard can name the fix instead.
 *
 * Deliberately not a guess about Meta's opinion: it only fires on the two
 * configurations that cannot work under any whitelist — a redirect Meta is not
 * allowed to follow, and a half-configured Instagram Login app (an app id with
 * no app secret), which silently falls back to the Facebook dialog that such an
 * app has no page for.
 */
function buildOAuthReadiness(req: express.Request): { ok: boolean; code: string | null; reason: string | null } {
  const lang = langFromRequest(req);
  const redirectUri = getOAuthRedirectUri(req);

  if (!IG_APP_ID && !META_APP_ID) {
    return { ok: false, code: 'NO_APP_ID', reason: M(lang, 'connect.notConfigured') };
  }
  if (isUnreachableRedirectUri(redirectUri)) {
    return {
      ok: false,
      code: 'REDIRECT_NOT_REACHABLE',
      reason: M(lang, 'connect.redirectNotReachable', { uri: redirectUri }),
    };
  }
  if (IG_APP_ID && !IG_APP_SECRET) {
    return { ok: false, code: 'IG_APP_SECRET_MISSING', reason: M(lang, 'connect.igSecretMissing') };
  }
  return { ok: true, code: null, reason: null };
}

/**
 * Deep links into the Meta App Dashboard, built from the configured app id so
 * they stay correct if the app is ever re-provisioned or moved to a new domain.
 *
 * Two audiences use these: the operator (adding a client as a tester, checking
 * the app secret) and a business owner who was handed the direct-token path and
 * has no idea where a token comes from. Labelled buttons that open the exact
 * page beat instructions that name a page the reader has never seen.
 */
function getMetaSetupLinks(): {
  appDashboard: string;
  instagramApiSetup: string;
  appRoles: string;
  basicSettings: string;
  graphApiExplorer: string;
  accessTokenDebugger: string;
  flavour: 'instagram_login' | 'facebook';
} | null {
  // These links are for the *app dashboard*, which is keyed by the FACEBOOK app
  // id — see appIdentity.ts. The OAuth client id is not dashboard-keyed, and
  // building a Roles URL from it sent the operator to a page with no app on it;
  // the next app open in that tab was a different app of the same developer
  // account, and the testers invited there were useless for every connect (the
  // access gate rejects them, so the bot never gets a token). One app id for the
  // dashboard, one for OAuth — showing them apart is the whole fix.
  const identity = getOAuthAppIdentity();
  const dashboard = identity.appDashboardUrl;
  if (!dashboard) return null;

  const app = dashboard.replace(/\/$/, '');
  return {
    appDashboard: dashboard,
    // Every Instagram step (permissions, token generation, webhook setup,
    // "Set up Instagram business login") lives on this single page.
    instagramApiSetup:
      identity.instagramApiSetupUrl || `${app}/use_cases/customize/API-Setup/?product_route=instagram-business`,
    appRoles: identity.appRolesUrl || `${app}/roles/roles/`,
    basicSettings: `${app}/settings/basic/`,
    graphApiExplorer: 'https://developers.facebook.com/tools/explorer/',
    accessTokenDebugger: 'https://developers.facebook.com/tools/debug/accesstoken/',
    flavour: identity.flavour,
  };
}

// Express does not expose the unparsed body, so we stash it on the request.
type RequestWithRawBody = express.Request & { rawBody?: Buffer };

/**
 * Verifies Meta's X-Hub-Signature-256 header for an incoming webhook delivery.
 *
 * Meta signs every delivery with HMAC-SHA256 over the exact raw request bytes
 * using the app secret. Without this check anyone who learns the public webhook
 * URL can POST a fabricated DM and make the bot reply to it.
 *
 * Returns ok:false with a reason whenever the delivery cannot be trusted.
 */
/**
 * Every secret a delivery may legitimately have been signed with.
 *
 * Facebook-Login deliveries are signed with the app secret; Instagram Login
 * deliveries are signed with the Instagram app's own secret, which is a
 * different value. Accepting either (still HMAC + timing-safe) keeps signature
 * enforcement on for both flavours.
 */
function webhookSecrets(): { label: string; secret: string }[] {
  const secrets: { label: string; secret: string }[] = [];
  if (META_APP_SECRET) secrets.push({ label: 'META_APP_SECRET', secret: META_APP_SECRET });
  if (IG_APP_SECRET && IG_APP_SECRET !== META_APP_SECRET) {
    secrets.push({ label: 'IG_APP_SECRET', secret: IG_APP_SECRET });
  }
  return secrets;
}

function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | string[] | undefined
): { ok: boolean; reason?: string } {
  const secrets = webhookSecrets();
  if (secrets.length === 0) {
    return { ok: false, reason: 'META_APP_SECRET is not configured on the server' };
  }

  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header) {
    return { ok: false, reason: 'missing X-Hub-Signature-256 header' };
  }

  const separator = header.indexOf('=');
  const algorithm = separator === -1 ? '' : header.slice(0, separator);
  const providedHex = separator === -1 ? '' : header.slice(separator + 1);
  if (algorithm !== 'sha256' || !providedHex) {
    return { ok: false, reason: `unsupported signature format "${header}"` };
  }

  if (!rawBody || rawBody.length === 0) {
    return { ok: false, reason: 'the raw request body was not captured' };
  }

  const provided = Buffer.from(providedHex, 'hex');

  for (const { secret } of secrets) {
    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
    // timingSafeEqual throws on differing lengths, so compare those first.
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: `signature mismatch against ${secrets.map((s) => s.label).join(' / ')}`,
  };
}

/**
 * Extra detail for a delivery that failed verification.
 *
 * The point is to answer "what exactly did Meta send us" without guessing: the
 * header value, whether the body arrived compressed (which would change the
 * bytes we hash), the exact byte count and hash we signed, and a short preview
 * of the payload. The preview is truncated on purpose.
 */
function logWebhookRejectionDiagnostics(req: express.Request, rawBody: Buffer | undefined) {
  const header = req.headers['x-hub-signature-256'];
  console.warn(
    `WEBHOOK_DIAGNOSTICS: signature=${Array.isArray(header) ? header[0] : header || 'none'} ` +
      `content-encoding=${req.headers['content-encoding'] || 'identity'} ` +
      `raw-body-bytes=${rawBody?.length ?? 0} ` +
      `raw-body-sha256=${rawBody ? crypto.createHash('sha256').update(rawBody).digest('hex') : 'none'}`
  );
  console.warn(`WEBHOOK_DIAGNOSTICS: payload preview ${JSON.stringify(req.body ?? {}).slice(0, 300)}`);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Public customer-facing booking page.
 *
 * The bot can only reply inside Meta's 24-hour messaging window and must never
 * take payment details in chat, so the sale has to hand over to something the
 * customer can open later. This page is that handover: it is rendered from the
 * tenant's own knowledge base (no separate CMS to keep in sync) and posts the
 * lead into the dashboard.
 *
 * Server-rendered on purpose — it sits behind no login, on mobile traffic from
 * Instagram, and must work even if the SPA bundle fails to load.
 */
function renderBookingPage(args: {
  slug: string;
  handle: string;
  packages: { title: string; content: string; category?: string }[];
  extras: { title: string; content: string; category?: string }[];
  lang?: Lang;
}): string {
  const { slug, handle, packages, extras, lang = DEFAULT_LANG } = args;
  const c = BOOKING[lang];

  const card = (item: { title: string; content: string; category?: string }) => `
        <div class="card">
          <div class="card-head">
            <h3>${escapeHtml(item.title)}</h3>
            ${item.category ? `<span class="chip">${escapeHtml(item.category)}</span>` : ''}
          </div>
          <p>${escapeHtml(item.content)}</p>
        </div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fillTemplate(c.pageTitle, { handle }))}</title>
<meta name="description" content="${escapeHtml(fillTemplate(c.metaDescription, { handle }))}" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0B0B0F; color: #FFFFFF; line-height: 1.55; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 0 16px 64px; }
  header { background: linear-gradient(135deg, #6d28d9, #a21caf); color: #fff; padding: 28px 16px 24px; }
  header .wrap { padding-bottom: 0; }
  header h1 { margin: 8px 0 4px; font-size: 22px; }
  header p { margin: 0; opacity: .85; font-size: 13px; }
  .badge { display: inline-block; background: rgba(255,255,255,.18); padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #C5C5D0; margin: 28px 0 12px; }
  .card { background: #15151D; border: 1px solid #343440; border-radius: 14px; padding: 14px 16px; margin-bottom: 10px; }
  .card-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .card h3 { margin: 0; font-size: 15px; }
  .card p { margin: 6px 0 0; font-size: 13px; color: #C5C5D0; white-space: pre-wrap; }
  .chip { background: rgba(109,40,217,.18); color: #C5C5D0; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  form { background: #15151D; border: 1px solid #343440; border-radius: 16px; padding: 18px; }
  label { display: block; font-size: 12px; font-weight: 600; color: #C5C5D0; margin: 12px 0 4px; }
  input, textarea { width: 100%; padding: 11px 12px; border: 1px solid #343440; border-radius: 10px; font-size: 14px; font-family: inherit; background: #20202A; color: #FFFFFF; }
  input:focus, textarea:focus { outline: none; border-color: #6d28d9; background: #20202A; }
  .row { display: flex; gap: 10px; }
  .row > div { flex: 1; }
  button { width: 100%; margin-top: 18px; padding: 14px; border: 0; border-radius: 12px; background: #6d28d9; color: #fff; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .err { color: #be123c; font-size: 13px; margin-top: 10px; display: none; }
  .ok { background: rgba(34,197,94,.12); border: 1px solid #22C55E; color: #86efac; border-radius: 14px; padding: 18px; font-size: 14px; }
  .honeypot { position: absolute; left: -9999px; }
  .langswitch { display: flex; gap: 4px; margin-top: 14px; }
  .langswitch a { font-size: 12px; font-weight: 700; color: rgba(255,255,255,.75); text-decoration: none; padding: 4px 11px; border-radius: 999px; background: rgba(255,255,255,.14); }
  .langswitch a.on { background: #6d28d9; color: #fff; }
  footer { margin-top: 28px; font-size: 11px; color: #94a3b8; text-align: center; }
  footer a { color: #a78bfa; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <span class="badge">@${escapeHtml(handle)}</span>
    <h1>${escapeHtml(c.h1)}</h1>
    <p>${escapeHtml(c.sub)}</p>
    <div class="langswitch">
      <a class="${lang === 'en' ? 'on' : ''}" href="?lang=en">English</a>
      <a class="${lang === 'hi' ? 'on' : ''}" href="?lang=hi">हिंदी</a>
    </div>
  </div>
</header>
<div class="wrap">
  ${packages.length ? `<h2>${escapeHtml(c.packagesTitle)}</h2>${packages.map(card).join('')}` : ''}
  ${extras.length ? `<h2>${escapeHtml(c.extrasTitle)}</h2>${extras.map(card).join('')}` : ''}
  ${!packages.length && !extras.length ? `<h2>${escapeHtml(c.emptyTitle)}</h2><div class="card"><p>${escapeHtml(c.emptyBody)}</p></div>` : ''}

  <h2>${escapeHtml(c.detailsTitle)}</h2>
  <form id="book-form" novalidate>
    <label for="name">${escapeHtml(c.labelName)}</label>
    <input id="name" name="name" autocomplete="name" required placeholder="${escapeHtml(c.placeholderName)}" />

    <label for="whatsapp">${escapeHtml(c.labelWhatsapp)}</label>
    <input id="whatsapp" name="whatsapp" inputmode="tel" autocomplete="tel" required placeholder="+91 98765 43210" />

    <label for="email">Email (optional)</label>
    <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" />

    <div class="row">
      <div>
        <label for="travelDates">${escapeHtml(c.labelTravelDates)}</label>
        <input id="travelDates" name="travelDates" placeholder="${escapeHtml(c.placeholderTravelDates)}" />
      </div>
      <div>
        <label for="travellers">${escapeHtml(c.labelTravellers)}</label>
        <input id="travellers" name="travellers" placeholder="${escapeHtml(c.placeholderTravellers)}" />
      </div>
    </div>

    <label for="message">${escapeHtml(c.labelMessage)}</label>
    <textarea id="message" name="message" rows="3" placeholder="${escapeHtml(c.placeholderMessage)}"></textarea>

    <div class="honeypot" aria-hidden="true">
      <label for="company">Company</label>
      <input id="company" name="company" tabindex="-1" autocomplete="off" />
    </div>

    <button type="submit" id="submit">${escapeHtml(c.submit)}</button>
    <p class="err" id="err"></p>
  </form>

  <footer>
    Powered by InstaFlow AI · <a href="/privacy-policy">Privacy</a> · <a href="/terms-of-service">Terms</a> · <a href="/refund-policy">Refund &amp; Cancellation</a> · <a href="/complaint">Complaint</a> · <a href="/contact">Contact</a>
  </footer>
</div>
<script>
(function () {
  var form = document.getElementById('book-form');
  var button = document.getElementById('submit');
  var err = document.getElementById('err');
  if (!form) return;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    err.style.display = 'none';

    var data = {};
    new FormData(form).forEach(function (value, key) { data[key] = value; });

    button.disabled = true;
    button.textContent = ${JSON.stringify(c.sending)};

    fetch('/api/book/${encodeURIComponent(slug)}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok || !result.body.success) {
          throw new Error((result.body && result.body.error) || ${JSON.stringify(c.errorGeneric)});
        }
        form.outerHTML = '<div class="ok"><strong>' + ${JSON.stringify(c.thankYouBefore)}.replace('{name}', data.name || '') + '</strong><br />' + ${JSON.stringify(c.thankYouAfter)} + '</div>';
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.style.display = 'block';
        button.disabled = false;
        button.textContent = ${JSON.stringify(c.submit)};
      });
  });
})();
</script>
</body>
</html>`;
}

/** Very small in-memory throttle so the public form cannot be hammered. */
const bookingSubmissions = new Map<string, { count: number; windowStart: number }>();
const BOOKING_RATE_LIMIT = 6;
const BOOKING_RATE_WINDOW_MS = 60 * 60 * 1000;

function throttle(bucket: Map<string, { count: number; windowStart: number }>, limit: number, windowMs: number, key: string): boolean {
  const now = Date.now();
  if (bucket.size > 5000) bucket.clear();

  const entry = bucket.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    bucket.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function bookingRateLimited(ip: string): boolean {
  return throttle(bookingSubmissions, BOOKING_RATE_LIMIT, BOOKING_RATE_WINDOW_MS, ip);
}

/**
 * The complaint form writes customer data *and* triggers an outbound WhatsApp
 * message, so it carries the tightest budget of the public forms.
 */
const complaintSubmissions = new Map<string, { count: number; windowStart: number }>();
/** Owner-alert anti-spam for fire-and-forget pushes (per-key 30-min windows). */
const adminAlertThrottle = new Map<string, { count: number; windowStart: number }>();
const COMPLAINT_RATE_LIMIT = 6;
const COMPLAINT_RATE_WINDOW_MS = 60 * 60 * 1000;

function complaintRateLimited(ip: string): boolean {
  return throttle(complaintSubmissions, COMPLAINT_RATE_LIMIT, COMPLAINT_RATE_WINDOW_MS, ip);
}

/** How many complaints the owner view hands back in one response. */
const MAX_COMPLAINTS_RETURNED = 200;

/**
 * Push a stored complaint to the owner's WhatsApp and record the outcome.
 *
 * Runs after the customer's response has already been sent: the complaint is on
 * disk before this is called, so a slow or down relay delays nobody and loses
 * nothing. A failure is logged loudly and kept on the record, where the owner's
 * complaints view shows it as not-delivered.
 */
async function deliverComplaint(complaint: Complaint): Promise<void> {
  // Never echo the problem text into the log — it is the customer's own words.
  const delivery = await sendOwnerWhatsApp(
    [
      'InstaFlow AI — new complaint',
      `ID: ${complaint.accountId}`,
      `Contact: ${complaint.contact}`,
      '',
      complaint.problem,
      '',
      `Ref: ${complaint.id}`,
    ].join('\n')
  );

  markComplaintNotified(complaint.id, delivery);
  if (delivery.ok) {
    console.log(`COMPLAINT_DELIVERED ${complaint.id}`);
  } else {
    console.error(`COMPLAINT_NOTIFY_FAILED ${complaint.id}: ${delivery.error}`);
  }
}

/**
 * The demo simulator is the one AI endpoint reachable without a sign-in (Demo
 * Mode has no account behind it), so it carries its own budget per browser. Real
 * tenants are metered by their plan instead — this only stops an anonymous
 * visitor from turning the demo into a free LLM proxy.
 */
const demoSimulations = new Map<string, { count: number; windowStart: number }>();
const DEMO_SIM_LIMIT = 25;
const DEMO_SIM_WINDOW_MS = 15 * 60 * 1000;
const DEMO_SIM_GLOBAL_LIMIT = 200; // the ceiling on demo spend, whatever the source

function demoSimulationRateLimited(ip: string): boolean {
  // A per-visitor budget is friendly, but a visitor address can be routed around,
  // so the whole demo is also capped. Whichever trips first wins.
  const perVisitor = throttle(demoSimulations, DEMO_SIM_LIMIT, DEMO_SIM_WINDOW_MS, `ip:${ip}`);
  const overall = throttle(demoSimulations, DEMO_SIM_GLOBAL_LIMIT, DEMO_SIM_WINDOW_MS, 'global');
  return perVisitor || overall;
}

/** The visitor address behind Railway's proxy, for the two throttles above. */
const clientIp = (req: express.Request): string =>
  String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

/**
 * Split knowledge documents into things a customer books (packages, prices)
 * and background information. Nothing is hidden — the fallback shows everything.
 */
function splitBookingDocuments(items: { title: string; content: string; category?: string }[]) {
  const HINT = /package|tour|trip|deal|offer|price|pricing|catalog|itinerary|hotel/i;
  const packages = items.filter((item) => HINT.test(`${item.title} ${item.category || ''}`));
  const extras = items.filter((item) => !packages.includes(item));
  if (!packages.length) return { packages: items, extras: [] };
  return { packages, extras };
}

/**
 * Public pricing page — the front door for a business owner who lands on the
 * product without an account. Server-rendered so it works before any JS bundle
 * loads, and so the plans live in exactly one place (the plan store).
 */
/**
 * The crossed-out anchor shown on the ₹99 offer card: the regular price of the
 * plan the offer is equivalent to. Read from the plan store so the two can never
 * disagree if the Starter price changes.
 */
const STARTER_PRICE_INR = getPlan('starter')?.priceInr ?? 999;

function renderPlansPage(
  plans: { id: string; name: string; priceInr: number; tagline: string; features: string[]; highlight?: boolean }[],
  paymentsConfigured: boolean,
  lang: Lang = DEFAULT_LANG
): string {
  const c = PLANS[lang];
  const card = (plan: (typeof plans)[number]) => `
      <div class="plan${plan.highlight ? ' plan-hot' : ''}">
        ${plan.highlight ? '<span class="hot">Most popular</span>' : ''}
        <h3>${escapeHtml(plan.name)}</h3>
        <p class="tag">${escapeHtml(planTagline(plan.id, plan.tagline, lang))}</p>
        <div class="price">${plan.id === 'launch99' ? `<s>\u20b9${STARTER_PRICE_INR.toLocaleString('en-IN')}</s> ` : ''}\u20b9${plan.priceInr.toLocaleString('en-IN')}<span>/month</span></div>
        <ul>${plan.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <a class="btn" href="/app?plan=${encodeURIComponent(plan.id)}">Start with ${escapeHtml(plan.name)}\u2009\u2192</a>
      </div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(c.pageTitle)}</title>
<meta name="description" content="${escapeHtml(c.metaDescription)}" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0B0B0F; color: #FFFFFF; line-height: 1.55; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px 72px; }
  header { background: linear-gradient(135deg, #6d28d9, #a21caf); color: #fff; padding: 56px 20px 48px; text-align: center; }
  header h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: -0.02em; }
  header p { margin: 0 auto; max-width: 620px; opacity: .9; font-size: 15px; }
  .steps { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 26px; font-size: 13px; }
  .steps span { background: rgba(255,255,255,.16); padding: 6px 14px; border-radius: 999px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: -36px; }
  .plan { background: #15151D; border: 1px solid #343440; border-radius: 18px; padding: 22px; position: relative; display: flex; flex-direction: column; }
  .plan-hot { border-color: #a21caf; box-shadow: 0 14px 40px rgba(109,40,217,.16); }
  .hot { position: absolute; top: -11px; left: 22px; background: #a21caf; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: .04em; }
  .plan h3 { margin: 0; font-size: 18px; }
  .tag { margin: 4px 0 14px; color: #C5C5D0; font-size: 13px; }
  .price { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; }
  .price s { font-size: 14px; font-weight: 600; color: #94a3b8; margin-right: 4px; }
  .price span { font-size: 13px; font-weight: 500; color: #475569; }
  ul { list-style: none; padding: 0; margin: 16px 0 22px; font-size: 13px; color: #C5C5D0; flex: 1; }
  li { padding-left: 20px; position: relative; margin-bottom: 7px; }
  li:before { content: "\u2713"; position: absolute; left: 0; color: #16a34a; font-weight: 700; }
  .btn { display: block; text-align: center; padding: 12px; border-radius: 12px; background: #6d28d9; color: #fff; text-decoration: none; font-weight: 700; font-size: 14px; }
  .btn:hover { background: #5b21b6; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #C5C5D0; margin: 48px 0 14px; }
  .card { background: #15151D; border: 1px solid #343440; border-radius: 14px; padding: 18px 20px; font-size: 14px; color: #C5C5D0; }
  .card ol { margin: 0; padding-left: 20px; }
  .card li { margin-bottom: 6px; }
  footer { margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: center; }
  footer a { color: #7e22ce; }
  .note { background: rgba(245,158,11,.12); border: 1px solid #343440; color: #C5C5D0; border-radius: 12px; padding: 12px 16px; font-size: 13px; margin-top: 18px; }
  .langswitch { display: flex; gap: 4px; justify-content: center; margin-top: 18px; }
  .langswitch a { font-size: 12px; font-weight: 700; color: rgba(255,255,255,.75); text-decoration: none; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.14); }
  .langswitch a.on { background: #6d28d9; color: #fff; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(c.h1)}</h1>
  <p>${escapeHtml(c.sub)}</p>
  <div class="steps">${c.steps.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</div>
  <div class="langswitch">
    <a class="${lang === 'en' ? 'on' : ''}" href="?lang=en">English</a>
    <a class="${lang === 'hi' ? 'on' : ''}" href="?lang=hi">हिंदी</a>
  </div>
</header>
<div class="wrap">
  <div class="grid">${plans.map(card).join('')}</div>
  ${paymentsConfigured ? '' : `<div class="note">${escapeHtml(c.paymentsNote)}</div>`}

  <h2>${escapeHtml(c.howTitle)}</h2>
  <div class="card">
    <ol>
      ${c.howItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ol>
  </div>

  <footer>InstaFlow AI \u00b7 <a href="/app">${escapeHtml(c.footerLogin)}</a> \u00b7 <a href="/privacy-policy">Privacy</a> \u00b7 <a href="/terms-of-service">Terms</a> \u00b7 <a href="/refund-policy">Refund &amp; Cancellation</a> \u00b7 <a href="/complaint">Complaint</a> \u00b7 <a href="/contact">Contact</a></footer>
</div>
</body>
</html>`;
}

/**
 * Who the public pages say they are reachable at.
 *
 * Payment providers (
 * Razorpay) and Meta both check that a live domain names a contactable
 * business before approving it, so these come from the environment instead of
 * being invented — a made-up support address fails activation just as hard as a
 * missing one.
 */
function getPublicBusinessInfo() {
  return {
    businessName: (process.env.BUSINESS_NAME || 'InstaFlow AI').trim(),
    supportEmail: (process.env.SUPPORT_EMAIL || '').trim(),
    supportPhone: (process.env.SUPPORT_PHONE || '').trim(),
    businessAddress: (process.env.BUSINESS_ADDRESS || '').trim(),
  };
}

const POLICY_PAGE_STYLE =
  'body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;background:#0B0B0F;color:#FFFFFF;}a{color:#a78bfa}h2{margin-top:28px;color:#FFFFFF}footer{margin-top:40px;padding-top:16px;border-top:1px solid #343440;font-size:13px;color:#C5C5D0}footer p{margin:4px 0}';

/**
 * Shared shell for the public policy pages. Every one of them repeats the
 * business name, the contact route and the cross-links, because a reviewer
 * (payment provider, Meta, or a customer) usually opens exactly one page and
 * decides from it whether the business is real.
 */
function renderPolicyPage(title: string, bodyHtml: string): string {
  const { businessName, supportEmail, businessAddress } = getPublicBusinessInfo();
  return `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8" /><title>${escapeHtml(title)} - ${escapeHtml(businessName)}</title><style>${POLICY_PAGE_STYLE}</style></head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <p style="color:#94a3b8">Last updated: September 29, 2026</p>
      ${bodyHtml}
      <footer>
        <p><strong>${escapeHtml(businessName)}</strong>${businessAddress ? ` · ${escapeHtml(businessAddress)}` : ''}</p>
        ${supportEmail ? `<p>Email: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></p>` : ''}
        <p>Any problem? <a href="/complaint">Send a complaint</a> — a human reads every one.</p>
        <p><a href="/">Home</a> · <a href="/plans">Pricing</a> · <a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-of-service">Terms of Service</a> · <a href="/refund-policy">Refund &amp; Cancellation</a> · <a href="/complaint">Complaint</a> · <a href="/contact">Contact Us</a></p>
      </footer>
    </body>
  </html>`;
}

/**
 * The public complaint form, as a self-contained block.
 *
 * It replaced the owner's mobile number on `/contact` and the policy footers, so
 * it is deliberately inline and dependency-free: it renders on the contact page
 * (which is read by a reviewer with no login) and on its own `/complaint` page.
 *
 * The destination WhatsApp number is never part of this markup — it lives in the
 * host environment and the browser only ever sees `/api/complaints`.
 */
function renderComplaintForm(lang: Lang = DEFAULT_LANG): string {
  const c = COMPLAINT[lang];
  return `
  <style>
    .cmp-form { background: #15151D; border: 1px solid #343440; border-radius: 14px; padding: 16px; margin: 8px 0 4px; }
    .cmp-form label { display: block; font-size: 13px; font-weight: 600; color: #C5C5D0; margin: 12px 0 4px; }
    .cmp-form label:first-child { margin-top: 0; }
    .cmp-form input, .cmp-form textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #343440; border-radius: 10px; font-size: 14px; font-family: inherit; background: #20202A; color: #FFFFFF; }
    .cmp-form input:focus, .cmp-form textarea:focus { outline: none; border-color: #6d28d9; background: #20202A; }
    .cmp-form button { width: 100%; margin-top: 16px; padding: 13px; border: 0; border-radius: 12px; background: #6d28d9; color: #fff; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; }
    .cmp-form button:disabled { opacity: .6; cursor: default; }
    .cmp-form .cmp-err { color: #fca5a5; font-size: 13px; margin-top: 10px; display: none; }
    .cmp-form .cmp-note { font-size: 12px; color: #94a3b8; margin: 10px 0 0; }
    .cmp-form .cmp-honeypot { position: absolute; left: -9999px; }
    .cmp-ok { background: rgba(34,197,94,.12); border: 1px solid #22C55E; color: #86efac; border-radius: 14px; padding: 18px; font-size: 14px; }
  </style>
  <form id="complaint-form" class="cmp-form" novalidate>
    <label for="cmp-account">${escapeHtml(c.labelAccountId)}</label>
    <input id="cmp-account" name="accountId" required autocomplete="username" placeholder="${escapeHtml(c.placeholderAccountId)}" />

    <label for="cmp-contact">${escapeHtml(c.labelContact)}</label>
    <input id="cmp-contact" name="contact" inputmode="tel" autocomplete="tel" required placeholder="+91 98765 43210" />

    <label for="cmp-problem">${escapeHtml(c.labelProblem)}</label>
    <textarea id="cmp-problem" name="problem" rows="4" required placeholder="${escapeHtml(c.placeholderProblem)}"></textarea>

    <div class="cmp-honeypot" aria-hidden="true">
      <label for="cmp-company">Company</label>
      <input id="cmp-company" name="company" tabindex="-1" autocomplete="off" />
    </div>

    <button type="submit" id="cmp-submit">${escapeHtml(c.submit)}</button>
    <p class="cmp-err" id="cmp-err"></p>
    <p class="cmp-note">${escapeHtml(c.reassurance)}</p>
  </form>
  <script>
  (function () {
    var form = document.getElementById('complaint-form');
    if (!form) return;
    var button = document.getElementById('cmp-submit');
    var err = document.getElementById('cmp-err');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      err.style.display = 'none';

      var data = {};
      new FormData(form).forEach(function (value, key) { data[key] = value; });

      button.disabled = true;
      button.textContent = ${JSON.stringify(c.sending)};

      fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
        .then(function (result) {
          if (!result.ok || !result.body.success) {
            throw new Error((result.body && result.body.error) || ${JSON.stringify(c.errorGeneric)});
          }
          form.outerHTML = '<div class="cmp-ok"><strong>' + ${JSON.stringify(c.thankYouTitle)} + '</strong><br />' + ${JSON.stringify(c.thankYouBody)} + '</div>';
        })
        .catch(function (e) {
          err.textContent = e.message;
          err.style.display = 'block';
          button.disabled = false;
          button.textContent = ${JSON.stringify(c.submit)};
        });
    });
  })();
  </script>`;
}

/**
 * The standalone complaint page, so the form is linkable from anywhere (the
 * policy footers, a DM, an email) without dragging the whole contact page along.
 */
function renderComplaintPage(lang: Lang = DEFAULT_LANG): string {
  const c = COMPLAINT[lang];
  return `<!doctype html>
  <html lang="${lang}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(c.pageTitle)} - InstaFlow AI</title>
      <meta name="description" content="${escapeHtml(c.metaDescription)}" />
      <style>${POLICY_PAGE_STYLE}body{padding-bottom:48px}.langswitch{display:flex;gap:4px;margin:0 0 14px}.langswitch a{font-size:12px;font-weight:700;color:#a78bfa;text-decoration:none;padding:4px 11px;border-radius:999px;background:#20202A}.langswitch a.on{background:#6d28d9;color:#fff}</style>
    </head>
    <body>
      <h1>${escapeHtml(c.h1)}</h1>
      <div class="langswitch">
        <a class="${lang === 'en' ? 'on' : ''}" href="?lang=en">English</a>
        <a class="${lang === 'hi' ? 'on' : ''}" href="?lang=hi">हिंदी</a>
      </div>
      <p>${escapeHtml(c.sub)}</p>
      ${renderComplaintForm(lang)}
      <footer>
        <p><a href="/">${escapeHtml(c.backToSite)}</a> · <a href="/contact">Contact Us</a> · <a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-of-service">Terms of Service</a> · <a href="/refund-policy">Refund &amp; Cancellation</a></p>
      </footer>
    </body>
  </html>`;
}

/**
 * The public home page.
 *
 * Two things need this to exist. A visitor answering an ad or an Instagram
 * profile link must see what is being sold before being asked to log in, and
 * payment providers review the domain they are being asked to approve — a bare
 * login box neither explains the product nor satisfies a "website must be live
 * and functional" review.
 *
 * Server-rendered on purpose: no JS bundle has to load for the page to describe
 * the product and the prices. The one script only forwards people who are
already signed in, so the dashboard stays one click away for existing users.
 */
function renderLandingPage(
  plans: { id: string; name: string; priceInr: number; tagline: string; features: string[]; highlight?: boolean }[],
  lang: Lang = DEFAULT_LANG,
  banner: { mode: string; updatedAt: string } | null = null,
  /** Real seat numbers for the launch offer; null when the offer is closed. */
  offer: { sold: number; cap: number } | null = null
): string {
const BANNER_CSS = `\n  .sitebanner { background: #15151D; padding: 12px 0; border-bottom: 1px solid #343440; }\n  /* Koi bhi size ka image fit ho jata hai: page se chaudi nahi, screen se\n     zyada unchi nahi, aur apna proportion kabhi nahi khoti. Sirf max-width\n     aur max-height diye hain, width/height auto — tabhi browser dono limits\n     ke andar image ko shrink karke ratio bachata hai. Width 100% jaan-boojh\n     kar nahi hai: woh height ko dabata tha aur lambi image stretch ho jaati\n     thi. Chhoti image stretch nahi hoti, apne size me center rehti hai. */\n  .sitebanner img { display: block; width: auto; height: auto; max-width: 100%; max-height: 70vh; margin: 0 auto; border-radius: 14px; }\n  .sitebanner.portrait img { max-width: min(420px, 100%); max-height: 78vh; }\n  @media (max-width: 640px) {\n    .sitebanner { padding: 8px 0; }\n    .sitebanner img { max-height: 50vh; border-radius: 10px; }\n    .sitebanner.portrait img { max-height: 62vh; }\n  }\n`;
  const c = LANDING[lang];
  const supportEmail = (process.env.SUPPORT_EMAIL || '').trim();

  const planCard = (plan: (typeof plans)[number]) => `
      <div class="plan${plan.highlight ? ' plan-hot' : ''}">
        ${plan.highlight ? '<span class="hot">Most popular</span>' : ''}
        <h3>${escapeHtml(plan.name)}</h3>
        <p class="tag">${escapeHtml(planTagline(plan.id, plan.tagline, lang))}</p>
        <div class="price">${plan.id === 'launch99' ? `<s>\u20b9${STARTER_PRICE_INR.toLocaleString('en-IN')}</s> ` : ''}\u20b9${plan.priceInr.toLocaleString('en-IN')}<span>/month</span></div>
        <ul>${plan.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <a class="btn btn-block" href="/app?plan=${encodeURIComponent(plan.id)}">${escapeHtml(fillTemplate(c.planCta, { plan: plan.name }))}</a>
      </div>`;

  const step = (n: number, title: string, body: string) => `
      <div class="step">
        <span class="num">${n}</span>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </div>`;

  const feature = (title: string, body: string) => `
      <div class="feature">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </div>`;

  const faq = (q: string, a: string) => `
      <details>
        <summary>${escapeHtml(q)}</summary>
        <p>${escapeHtml(a)}</p>
      </details>`;

  // The offer block states real numbers only: the seat count comes from the
  // subscription store, and when the offer is closed the whole block disappears
  // instead of showing a stale "limited time" badge.
  const offerBlock = offer && offer.cap > 0
    ? `<div class="wrap" id="offer">
  <div class="offer">
    <div>
      <p class="offer-kicker">${escapeHtml(c.offerKicker)}</p>
      <h2 class="offer-title">${escapeHtml(c.offerTitle)}</h2>
      <p class="offer-price"><s>${escapeHtml(c.offerOldPrice)}</s><strong>${escapeHtml(c.offerPrice)}</strong><span>${escapeHtml(c.offerPer)}</span></p>
      <p class="offer-body">${escapeHtml(c.offerBody)}</p>
      <p class="offer-prize">${escapeHtml(c.offerPrize)}</p>
      <p class="offer-terms">${escapeHtml(c.offerTerms)}</p>
    </div>
    <div class="offer-side">
      <p class="offer-seats">${escapeHtml(fillTemplate(c.offerSeats, { sold: String(offer.sold), cap: String(offer.cap) }))}</p>
      <a class="btn offer-btn" href="/app?plan=launch99">${escapeHtml(c.offerCta)}</a>
    </div>
  </div>
</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>InstaFlow AI \u2014 Instagram DM automation with an AI that knows your business</title>
<meta name="description" content="InstaFlow AI replies to Instagram DMs from your own knowledge base, sends interested customers to your booking page, and delivers every lead straight to you. Plans from \u20b9999/month." />
<style>
  :root { color-scheme: dark; --brand: #6d28d9; --brand-2: #a21caf; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0B0B0F; color: #FFFFFF; line-height: 1.55; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
  a { color: inherit; }
  header.nav { background: #15151D; border-bottom: 1px solid #343440; position: sticky; top: 0; z-index: 10; }
  header.nav .wrap { display: flex; align-items: center; gap: 20px; height: 64px; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 16px; text-decoration: none; }
  .logo .mark { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, var(--brand), var(--brand-2)); }
  nav.links { margin-left: auto; display: flex; align-items: center; gap: 20px; }
  nav.links a { font-size: 13px; font-weight: 600; color: #C5C5D0; text-decoration: none; }
  nav.links a:hover { color: var(--brand); }
  .signin { background: #6d28d9; color: #fff !important; padding: 9px 16px; border-radius: 10px; font-weight: 700 !important; }
  .hero { background: #0B0B0F; color: #fff; padding: 72px 0 64px; }
  .hero h1 { font-size: 40px; line-height: 1.15; margin: 0 0 16px; letter-spacing: -0.02em; }
  .hero p.lede { font-size: 17px; max-width: 680px; margin: 0 0 12px; color: rgba(255,255,255,.92); }
  .hero .cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
  .btn { display: inline-block; background: #15151D; color: #fff; padding: 13px 22px; border-radius: 12px; font-weight: 700; text-decoration: none; font-size: 15px; }
  .btn-ghost { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.35); }
  .btn-block { display: block; text-align: center; background: var(--brand); color: #fff; font-size: 13px; padding: 11px; }
  .hero .fine { font-size: 12px; color: rgba(255,255,255,.8); margin-top: 14px; }
  h2 { font-size: 26px; letter-spacing: -0.01em; margin: 0 0 6px; }
  section { padding: 56px 0; }
  section > .wrap > p.sub { color: #C5C5D0; font-size: 15px; margin: 0 0 28px; max-width: 720px; }
  .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
  .step { background: #15151D; border: 1px solid #343440; border-radius: 16px; padding: 20px; }
  .step .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; background: rgba(109,40,217,.18); color: var(--brand); font-weight: 800; font-size: 13px; }
  .step h3 { font-size: 15px; margin: 12px 0 6px; }
  .step p { margin: 0; font-size: 13px; color: #C5C5D0; }
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .feature { background: #15151D; border: 1px solid #343440; border-radius: 16px; padding: 20px; }
  .feature h3 { font-size: 15px; margin: 0 0 6px; }
  .feature p { margin: 0; font-size: 13px; color: #C5C5D0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chips span { background: #20202A; border: 1px solid #343440; border-radius: 999px; padding: 6px 14px; font-size: 13px; color: #C5C5D0; }
  .pricing { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 18px; align-items: start; }
  .plan { background: #15151D; border: 1px solid #343440; border-radius: 18px; padding: 22px; position: relative; }
  .plan-hot { border: 2px solid var(--brand); box-shadow: 0 12px 30px rgba(109,40,217,.28); }
  .hot { position: absolute; top: -11px; left: 22px; background: var(--brand); color: #fff; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
  .plan h3 { margin: 0; font-size: 17px; }
  .plan .tag { margin: 2px 0 14px; font-size: 13px; color: #C5C5D0; }
  .plan .price { font-size: 30px; font-weight: 800; }
  .plan .price s { font-size: 15px; font-weight: 600; color: #94a3b8; margin-right: 4px; }
  .plan .price span { font-size: 13px; font-weight: 500; color: #94a3b8; }
  .plan ul { list-style: none; padding: 0; margin: 16px 0 20px; }
  .plan li { font-size: 13px; color: #C5C5D0; padding: 4px 0 4px 22px; position: relative; }
  .plan li::before { content: "\\2713"; position: absolute; left: 0; color: #22C55E; font-weight: 800; }
  .note { margin-top: 18px; font-size: 13px; color: #C5C5D0; }
  details { background: #15151D; border: 1px solid #343440; border-radius: 14px; padding: 14px 18px; margin-bottom: 10px; }
  details summary { font-weight: 700; font-size: 14px; cursor: pointer; }
  details p { margin: 10px 0 0; font-size: 13px; color: #C5C5D0; }
  footer.site { background: #08080c; color: #C5C5D0; padding: 40px 0; font-size: 13px; }
  footer.site a { color: #a78bfa; text-decoration: none; margin-right: 18px; }
  footer.site a:hover { text-decoration: underline; }
  footer.site .row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
  .langswitch { display: inline-flex; gap: 2px; background: #20202A; border: 1px solid #343440; border-radius: 9px; padding: 2px; }
  .langswitch a { font-size: 12px; font-weight: 700; color: #C5C5D0; text-decoration: none; padding: 4px 9px; border-radius: 7px; }
  .langswitch a.on { background: #6d28d9; color: #fff; }
  .offerlink { background: #fef3c7; color: #92400e !important; border: 1px solid #fcd34d; padding: 7px 12px; border-radius: 999px; font-weight: 800 !important; }
  .offerlink:hover { color: #78350f !important; }
  /* Founders offer: overlaps the hero so it is the first thing under the
     headline, and carries the real seat count from the subscription store. */
  .offer { position: relative; z-index: 2; margin: -30px auto 0; max-width: 1000px; background: #15151D; border: 2px solid var(--brand); border-radius: 18px; padding: 22px 24px; display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; box-shadow: 0 16px 44px rgba(109,40,217,.28); }
  .offer-kicker { margin: 0 0 6px; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #b45309; }
  .offer-title { margin: 0 0 8px; font-size: 18px; }
  .offer-price { margin: 0 0 8px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .offer-price s { color: #94a3b8; font-size: 15px; }
  .offer-price strong { font-size: 30px; font-weight: 900; color: var(--brand); letter-spacing: -0.02em; }
  .offer-price span { font-size: 13px; color: #94a3b8; font-weight: 600; }
  .offer-body { margin: 0 0 8px; font-size: 13px; color: #C5C5D0; }
  .offer-prize { margin: 0 0 8px; font-size: 13px; font-weight: 700; color: #fcd34d; background: rgba(252,211,77,.12); border: 1px solid #343440; border-radius: 10px; padding: 8px 10px; }
  .offer-terms { margin: 0; font-size: 12px; color: #94a3b8; }
  .offer-side { text-align: center; }
  .offer-seats { margin: 0 0 10px; font-size: 12px; font-weight: 700; color: #fcd34d; background: rgba(252,211,77,.12); border: 1px solid #343440; border-radius: 999px; padding: 5px 12px; display: inline-block; }
  .offer-btn { background: var(--brand); color: #fff; white-space: nowrap; }
  .brandkicker { margin: 0 0 16px; font-size: 27px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #fff; }
  .brandkicker small { display: block; margin-top: 7px; font-size: 12px; font-weight: 700; letter-spacing: 0.22em; color: rgba(255,255,255,.78); }
  @media (max-width: 640px) {
    .hero h1 { font-size: 30px; } .brandkicker { font-size: 18px; } .brandkicker small { font-size: 10px; }
    nav.links a:not(.signin):not(.lang-link):not(.offerlink) { display: none; }
    /* Keep the ₹99 offer, language and Sign in reachable at 375px: the wordmark
       gives way (the gradient mark still identifies the site) and every control
       shrinks instead of wrapping the sticky header into two rows. */
    header.nav .wrap { gap: 8px; height: 56px; }
    .logo { font-size: 0; gap: 0; }
    nav.links { gap: 6px; }
    .offerlink { padding: 6px 10px; font-size: 11px; }
    .langswitch a { padding: 3px 7px; font-size: 11px; }
    .signin { padding: 7px 12px; font-size: 12px; }
    .offer { margin-top: -22px; padding: 18px; grid-template-columns: 1fr; text-align: left; }
    .offer-side { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .offer-seats { margin: 0; }
    .offer-btn { padding: 11px 16px; font-size: 13px; }
  }
${BANNER_CSS}
</style>
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="logo" href="/" aria-label="InstaFlow AI — home"><span class="mark"></span>InstaFlow AI</a>
    <nav class="links">
      <a href="#how">${escapeHtml(c.navHow)}</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="/plans">${escapeHtml(c.navFullPricing)}</a>
      ${offer ? `<a class="offerlink" href="#offer">${escapeHtml(c.navOffer)}</a>` : ''}
      <span class="langswitch">
        <a class="lang-link${lang === 'en' ? ' on' : ''}" href="?lang=en">English</a>
        <a class="lang-link${lang === 'hi' ? ' on' : ''}" href="?lang=hi">हिंदी</a>
      </span>
      <a class="signin" href="/app">Sign in</a>
    </nav>
  </div>
</header>

${banner ? `<div class="sitebanner ${escapeHtml(banner.mode)}"><div class="wrap"><img src="/api/banner/image?v=${encodeURIComponent(banner.updatedAt)}" alt="Offer banner" /></div></div>` : ''}
<div class="hero">
  <div class="wrap">
    <p class="brandkicker">FUTURE GROWTH AND TECHNOLOGY<small>InstaFlow AI SaaS</small></p>
    <h1>${escapeHtml(c.heroH1)}</h1>
    <p class="lede"><strong>${escapeHtml(c.heroSub)}</strong></p>
    <p class="lede">${escapeHtml(c.heroLede1)}</p>
    <div class="cta">
      <a class="btn" href="${offer ? '/app?plan=launch99' : '/app'}">${escapeHtml(c.heroCtaPrimary)}</a>
      <a class="btn btn-ghost" href="/plans">${escapeHtml(c.heroCtaPricing)}</a>
    </div>
    <p class="fine">${escapeHtml(c.heroFine)}</p>
  </div>
</div>

${offerBlock}

<section id="how">
  <div class="wrap">
    <h2>${escapeHtml(c.howTitle)}</h2>
    <p class="sub">${escapeHtml(c.howSub)}</p>
    <div class="steps">
      ${c.howSteps.map(([title, body], index) => step(index + 1, title, body)).join('')}
    </div>
  </div>
</section>

<section id="features" style="background:#15151D;border-top:1px solid #343440;border-bottom:1px solid #343440">
  <div class="wrap">
    <h2>${escapeHtml(c.featuresTitle)}</h2>
    <p class="sub">${escapeHtml(c.featuresSub)}</p>
    <div class="features">
      ${c.features.map(([title, body]) => feature(title, body)).join('')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>${escapeHtml(c.whoTitle)}</h2>
    <p class="sub">${escapeHtml(c.whoSub)}</p>
    <div class="chips">
      <span>Travel &amp; tour agencies</span><span>Boutiques &amp; D2C brands</span><span>Salons &amp; spas</span>
      <span>Fitness &amp; yoga studios</span><span>Coaches &amp; consultants</span><span>Real estate agents</span>
      <span>Clinics &amp; labs</span><span>Event planners</span><span>Photographers</span><span>Home services</span>
    </div>
  </div>
</section>

<section id="pricing" style="background:#15151D;border-top:1px solid #343440;border-bottom:1px solid #343440">
  <div class="wrap">
    <h2>Pricing</h2>
    <p class="sub">${escapeHtml(c.pricingSub)}</p>
    <div class="pricing">${plans.map(planCard).join('')}</div>
    <p class="note">${escapeHtml(c.pricingNoteBefore)} <a href="/plans" style="color:#6d28d9;font-weight:700">${escapeHtml(c.pricingNoteLink)}</a>${escapeHtml(c.pricingNoteAfter)}</p>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>${escapeHtml(c.faqTitle)}</h2>
    <p class="sub">${escapeHtml(c.faqSub)}</p>
    ${c.faqs.map(([q, a]) => faq(q, a)).join('')}
  </div>
</section>

<footer class="site">
  <div class="wrap">
    <div class="row">
      <a href="/plans">Pricing</a>
      <a href="/app">Sign in</a>
      <a href="/privacy-policy">Privacy Policy</a>
      <a href="/terms-of-service">Terms of Service</a>
      <a href="/refund-policy">Refund &amp; Cancellation</a>
      <a href="/complaint">Complaint</a>
      <a href="/contact">Contact Us</a>
      ${supportEmail ? `<a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>` : ''}
    </div>
    <p style="margin:0;color:#94a3b8">${escapeHtml(c.footerTag)}</p>
  </div>
</footer>

<script>
// Already signed in (Firebase keeps its session in localStorage)? Then the
// dashboard is what they wanted from this URL.
(function () {
  try {
    var signedIn = false;
    for (var i = 0; i < localStorage.length; i += 1) {
      var key = localStorage.key(i) || '';
      if (key.indexOf('firebase:authUser:') === 0 && localStorage.getItem(key)) { signedIn = true; break; }
    }
    // Keep the query string: the OAuth callback lands here with
    // ?oauth=success|error, and dropping it would silently swallow the result.
    if (signedIn) window.location.replace('/app' + location.search);
  } catch (err) {
    /* private mode or blocked storage: the sign-in link below still works */
  }
})();
</script>
</body>
</html>`;
}

/**
 * Tenant authentication.
 *
 * The dashboard used to name its own tenant with an `x-tenant-id` header, and
 * the server believed it. That is enough to make a demo work and not nearly
 * enough to sell: anyone who learned (or guessed) a customer's uid could read
 * their connection status, knowledge base, leads and DM conversations, and even
 * send replies as them. Now the tenant comes from a verified Firebase ID token,
 * and the header is only a hint that is checked against it.
 *
 * Two things stay deliberately open:
 *   - the webhook and payment routes, which authenticate by signature (Meta's
 *     HMAC and Razorpay's), because Meta and Razorpay have no Firebase login;
 *   - the public catalogue, booking form and version endpoint, which are read by
 *     anonymous visitors by design.
 *
 * Demo Mode has no account behind it, so it is allowed through without a token
 * — but it can only ever reach the demo tenant, which holds nothing but its own
 * (empty) data. It can no longer see other customers' leads or inboxes.
 */
const DEMO_TENANT_ID = 'default_tenant';

const PUBLIC_API_PATHS: RegExp[] = [
  /^\/api\/version$/,
  /^\/api\/plans$/,
  /^\/api\/book\/[^/]+$/, // the public booking form a customer fills in
  /^\/api\/complaints$/, // the public complaint form
  /^\/api\/banner$/, // the public main-page banner (owner supplies, everyone sees)
  /^\/api\/banner\/image$/, // the banner image itself (bytes, cacheable)
  /^\/api\/webhook\//, // Meta deliveries (HMAC-signed) + data deletion
  /^\/api\/webhooks\//, // Razorpay deliveries (HMAC-signed)
  /^\/api\/instagram\/oauth\/callback$/, // Instagram redirects the browser here
  /^\/api\/auth\/meta\/callback$/, // legacy alias of the same callback
];

interface RequestWithTenant extends express.Request {
  /** The tenant this request is *about* (the claimed id when an owner asked for one). */
  tenantId?: string;
  /** The uid from the verified token — always the caller's own account. */
  userId?: string;
  /**
   * The address on that same verified token. Owners may be listed by email as
   * well as by uid, so the owner checks need this too — see `isOwnerIdentity`.
   */
  userEmail?: string;
}

const bearerToken = (req: express.Request): string => {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
};

const isPublicApiPath = (pathname: string): boolean => PUBLIC_API_PATHS.some((re) => re.test(pathname));

const attachTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith('/api/')) return next();
  if (isPublicApiPath(req.path)) return next();

  const claimed = typeof req.headers['x-tenant-id'] === 'string' ? String(req.headers['x-tenant-id']).trim() : '';
  const token = bearerToken(req);

  if (token) {
    const user = await verifyFirebaseIdToken(token);
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        error: 'Your sign-in has expired. Please sign in again.',
      });
    }
    if (claimed && claimed !== user.uid) {
      // Support, not a hole: the operator's own verified token may open another
      // tenant's account (that is how a customer's problem gets diagnosed), and
      // every such access is logged. Nobody else can name a tenant at all — the
      // header is ignored and the request is served as the token's own uid.
      if (isOwnerIdentity(user.uid, user.email)) {
        console.log(`OWNER_ACCESS: owner ${user.uid} read tenant ${claimed}`);
        (req as RequestWithTenant).tenantId = claimed;
        (req as RequestWithTenant).userId = user.uid;
        (req as RequestWithTenant).userEmail = user.email;
        return next();
      }
      console.warn(`TENANT_MISMATCH: token uid=${user.uid} but the request claimed ${claimed} — serving the token's own tenant`);
    }
    (req as RequestWithTenant).tenantId = user.uid;
    (req as RequestWithTenant).userId = user.uid;
    (req as RequestWithTenant).userEmail = user.email;
    return next();
  }

  if (claimed === DEMO_TENANT_ID) {
    (req as RequestWithTenant).tenantId = DEMO_TENANT_ID;
    return next();
  }

  return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Sign in required.' });
};

async function startServer() {
  const app = express();

  // The public banner is an IMAGE uploaded as a data URL, so this ONE route needs
  // a much larger JSON body than the rest of the API. Registered before the
  // global parser: with express's 100 kb default every real banner was rejected
  // with 413 before it reached the route, so the save silently never happened
  // and the main page stayed empty. Parsed bodies are marked on the request, so
  // the global parser below skips this one.
  const bannerBody = express.json({ limit: '6mb' });
  app.post('/api/owner/banner', (req, res, next) => bannerBody(req, res, next));

  // Capture the raw request body alongside the parsed JSON. Meta signs the exact
  // raw bytes of every webhook delivery, so signature verification is only
  // possible if we keep a copy before express.json() parses it.
  app.use(
    express.json({
      verify: (req: express.Request, _res, buf: Buffer) => {
        (req as RequestWithRawBody).rawBody = buf;
      },
    })
  );

  // Meta's Data Deletion Request callback arrives form-encoded
  // (`signed_request=...`), not as JSON, so without this the body is empty and
  // every deletion request would silently do nothing.
  app.use(express.urlencoded({ extended: false }));

  // Runs before every route below, so no tenant-owned handler can be reached
  // without a verified tenant on the request.
  app.use(attachTenant);

  // Startup log of environment configuration
  console.log('--- InstaFlow AI Server Starting ---');
  console.log(`Port: ${PORT}`);
  console.log(`OpenRouter API: ${OPENROUTER_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`OpenRouter Model: ${process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash (default)'}`);
  console.log(`Gemini API: ${GEMINI_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`Gemini Model: ${process.env.GEMINI_MODEL || 'gemini-flash-latest (default)'}`);
  console.log(`Meta App ID: ${META_APP_ID ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`Meta App Secret: ${META_APP_SECRET ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`Meta Verify Token: ${META_VERIFY_TOKEN ? 'Active' : 'Missing'}`);
  console.log(`Meta Graph API Version: ${META_GRAPH_API_VERSION}`);
  console.log(
    `Instagram Login (Instagram API): ${IG_APP_ID && IG_APP_SECRET ? 'Configured' : 'NOT CONFIGURED (falls back to Facebook Login OAuth)'}`
  );
  console.log(`Webhook signature mode: ${WEBHOOK_SIGNATURE_MODE}`);
  loadOnboarding();
  if (WEBHOOK_SIGNATURE_WARN) {
    console.warn(
      'WARNING: WEBHOOK_SIGNATURE_MODE=warn — unverified webhook deliveries are being processed. ' +
        'Set it back to enforce once the correct app secret is configured.'
    );
  }

  /**
   * The tenant this request belongs to. On any tenant-owned route this is the
   * uid from the verified token, set by `attachTenant` — the header/body/query
   * fallbacks below only ever apply to the public paths that skip that check.
   */
  const getTenantId = (req: express.Request): string => {
    const verified = (req as RequestWithTenant).tenantId;
    if (typeof verified === 'string' && verified) return verified;

    const fromHeader = req.headers['x-tenant-id'];
    if (typeof fromHeader === 'string' && fromHeader.trim()) {
      return fromHeader.trim();
    }
    const fromBody = req.body?.tenantId;
    if (typeof fromBody === 'string' && fromBody.trim()) {
      return fromBody.trim();
    }
    const fromQuery = req.query?.tenantId;
    if (typeof fromQuery === 'string' && fromQuery.trim()) {
      return fromQuery.trim();
    }
    return 'default_tenant';
  };

  // ==========================================
  // 1. META OAUTH 2.0 FLOW ENDPOINTS
  // ==========================================

  // Initiate Meta OAuth (GET /api/instagram/oauth/start)
  app.get('/api/instagram/oauth/start', (req, res) => {
    const tenantId = getTenantId(req);
    const redirectUri = getOAuthRedirectUri(req);

    // Instagram Login wins whenever its own credentials are configured: apps
    // provisioned for "Instagram API with Instagram Login" have no Facebook
    // "Valid OAuth Redirect URIs" page at all, so the Facebook dialog always
    // answers with "URL blocked" for them.
    const useInstagramLogin = Boolean(IG_APP_ID && IG_APP_SECRET);

    // Do not open a consent screen this deployment cannot finish. Meta never
    // redirects back on a refusal, so the operator is otherwise left with a
    // blocked popup and an unchanged button. The dashboard shows this message
    // verbatim and reveals the token form, which is the path that does work.
    const readiness = buildOAuthReadiness(req);
    if (!readiness.ok) {
      console.warn(`Refusing to start Meta OAuth for tenant ${tenantId}: ${readiness.code} (redirect ${redirectUri})`);
      return res.status(400).json({
        success: false,
        code: readiness.code,
        error: readiness.reason,
        oauthRedirectUri: redirectUri,
      });
    }

    if (!useInstagramLogin && !META_APP_ID) {
      return res.status(400).json({
        error: 'Meta App ID is not configured on the server. Please set META_APP_ID and META_APP_SECRET in your environment variables, or use the Direct Meta Access Token connection method.',
        setupGuideUrl: 'https://developers.facebook.com/apps/',
      });
    }

    // The token exchange below needs the app secret. Without it Meta answers
    // with an opaque error only AFTER the user has authorized the app, so fail
    // fast with something actionable instead.
    if (!useInstagramLogin && !META_APP_SECRET) {
      return res.status(400).json({
        error: 'Meta App Secret is not configured on the server, so the OAuth login cannot be completed. Add META_APP_SECRET (Meta App Dashboard > App settings > Basic > App secret) to your environment variables, or use the Direct Meta Access Token connection method.',
        setupGuideUrl: 'https://developers.facebook.com/apps/',
      });
    }

    // An account the owner wires up stays free forever — no trial clock, and no
    // redeploy. The signal is the caller's **verified** identity (attachTenant put
    // it on the request), never a claim in the request: a customer's connect
    // cannot land here, because a customer token is not an owner identity. The
    // owner's own tenant is a different case — it is never billed anyway — so only
    // other tenants get marked.
    const callerUid = (req as RequestWithTenant).userId;
    const callerEmail = (req as RequestWithTenant).userEmail;
    if (callerUid && isOwnerIdentity(callerUid, callerEmail) && !isOwnerTenant(tenantId)) {
      markComped(tenantId, 'owner-connected', callerEmail || callerUid);
    }

    // Surfaces the exact URI that must be whitelisted in the Meta App Dashboard.
    console.log(
      `Starting ${useInstagramLogin ? 'Instagram Login' : 'Facebook'} OAuth for tenant ${tenantId} with redirect URI: ${redirectUri}`
    );

    const state = signOAuthState(tenantId, useInstagramLogin ? 'instagram_login' : 'facebook');

    let authUrl: string;

    if (useInstagramLogin) {
      authUrl = buildInstagramLoginAuthUrl({ clientId: IG_APP_ID, redirectUri, state });
    } else {
      const scopes = [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_metadata',
        'business_management',
      ];
      authUrl = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes.join(','))}&response_type=code`;
    }

    // If query ?redirect=true is present, redirect directly; otherwise return JSON
    if (req.query.redirect === 'true') {
      return res.redirect(authUrl);
    }
    res.json({ authUrl, redirectUri });
  });

  // Meta OAuth Callback (GET /api/instagram/oauth/callback and legacy /api/auth/meta/callback)
  app.get(['/api/instagram/oauth/callback', '/api/auth/meta/callback'], async (req, res) => {
    const { code, state, error, error_reason, error_description } = req.query;

    if (error) {
      console.warn('Meta OAuth error callback received:', error, error_description);
      // Attributed when the signed state still verifies, because this branch is the
      // most valuable record in the file: a refusal here is Meta answering the
      // customer directly, and until now it left nothing behind but a redirect the
      // customer saw for two seconds.
      const refusalState = typeof state === 'string' ? verifyOAuthState(state) : null;
      if (refusalState) {
        recordConnectAttempt({
          tenantId: refusalState.tenantId,
          stage: 'blocked',
          code: String(error),
          message: String(error_description || error_reason || error),
          source: 'callback',
        });
      }
      const msg = encodeURIComponent(String(error_description || error_reason || error));
      return res.redirect(`/app?oauth=error&message=${msg}`);
    }

    if (!code || !state || typeof state !== 'string') {
      return res.redirect('/app?oauth=error&message=Missing+OAuth+code+or+state');
    }

    const verifiedState = verifyOAuthState(state);
    if (!verifiedState) {
      return res.redirect('/app?oauth=error&message=OAuth+session+expired.+Please+try+again.');
    }

    const tenantId = verifiedState.tenantId;
    const mode = verifiedState.mode;
    // Must match the URI sent to Meta in the authorization request above.
    const redirectUri = getOAuthRedirectUri(req, req.path);

    try {
      // Steps A+B: turn the authorization code into a long-lived token. Which API
      // this happens against depends on the flavour the app is provisioned for.
      let accessToken: string;
      // Set when the long-lived upgrade fails but the connection can still be
      // completed with the short-lived token. Carried into the redirect so the
      // dashboard can warn instead of silently handing out an expiring token.
      let tokenWarning: string | null = null;

      if (mode === 'instagram_login') {
        const codeExchange = await exchangeInstagramLoginCode({
          clientId: IG_APP_ID,
          clientSecret: IG_APP_SECRET,
          redirectUri,
          code: String(code),
        });

        if (!codeExchange.success || !codeExchange.accessToken) {
          const msg = encodeURIComponent(codeExchange.error || 'Instagram code exchange failed.');
          return res.redirect(`/app?oauth=error&message=${msg}`);
        }

        accessToken = codeExchange.accessToken;
        const longLived = await exchangeForLongLivedInstagramToken(accessToken, IG_APP_SECRET);
        if (longLived) {
          accessToken = longLived;
        } else {
          // Meta's access-level gate (code 100 on the exchange endpoint) must not
          // end the connect flow: the short-lived token still works, so finish
          // the connection and carry the real reason into the redirect. Blocking
          // here was the difference between "connect works" and "connect is
          // broken" for every account that has a role on the app.
          const reason = getLastLongLivedExchangeError();
          tokenWarning =
            `Connected, but Meta would not upgrade this token to a long-lived one — it may stop working within about an hour. ` +
            `Reason from Meta: ${reason || 'no reason returned'}.`;
          console.warn(`Instagram long-lived upgrade skipped for tenant ${tenantId}: ${reason || 'unknown'}`);
        }
      } else {
        // Step A: Exchange code for short-lived user access token
        const tokenUrl = `${GRAPH_API_BASE}/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`;
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
          console.error('Meta token exchange error:', tokenData.error);
          const msg = encodeURIComponent(formatMetaError(tokenData.error));
          return res.redirect(`/app?oauth=error&message=${msg}`);
        }

        accessToken = tokenData.access_token;

        // Step B: Exchange for long-lived access token (valid ~60 days)
        if (META_APP_SECRET) {
          try {
            const longLivedUrl = `${GRAPH_API_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${accessToken}`;
            const longLivedRes = await fetch(longLivedUrl);
            const longLivedData = await longLivedRes.json();
            if (longLivedData.access_token) {
              accessToken = longLivedData.access_token;
            }
          } catch (llErr) {
            console.warn('Could not exchange for long-lived token, using standard token:', llErr);
          }
        }
      }

      // Step C: Discover the connected Instagram account (Instagram Login tokens
      // are detected automatically and queried against graph.instagram.com).
      const discovery = await discoverInstagramAccount(accessToken);
      if (!discovery.success || !discovery.data) {
        const reason =
          discovery.error || 'No Instagram Business account was found linked to your authorized Meta account.';
        recordConnectAttempt({
          tenantId,
          stage: 'error',
          code: 'DISCOVERY_FAILED',
          message: reason,
          source: 'callback',
        });
        const errorMsg = encodeURIComponent(reason);
        return res.redirect(`/app?oauth=error&message=${errorMsg}`);
      }

      // Step D: Validate real connection against Meta Graph API
      const verification = await verifyLiveInstagramConnection(
        discovery.data.instagramAccountId,
        discovery.data.accessToken
      );

      if (!verification.valid) {
        const reason = verification.error || 'Verification with Meta Graph API failed.';
        recordConnectAttempt({
          tenantId,
          stage: 'error',
          code: 'VERIFICATION_FAILED',
          message: reason,
          username: discovery.data.instagramUsername,
          source: 'callback',
        });
        const errorMsg = encodeURIComponent(reason);
        return res.redirect(`/app?oauth=error&message=${errorMsg}`);
      }

      // Step E: Securely encrypt and save connection
      saveConnection(tenantId, discovery.data, discovery.data.accessToken);

      // Step F: Subscribe the account to our webhook so inbound DMs actually
      // reach us (Meta does not reliably do this automatically after OAuth).
      subscribeInstagramAccountToWebhooks(
        discovery.data.instagramAccountId,
        discovery.data.accessToken
      ).catch((subErr) =>
        console.warn(
          'Post-OAuth webhook subscription error (non-fatal):',
          subErr?.message || subErr
        )
      );

      // Step G: prove the token this app just stored is one this app can USE.
      //
      // Discovery can succeed against a token that our own API calls will still
      // be refused on — the clearest case being a tester who accepted an invite
      // on a different Meta app: the connect completes, the row says CONNECTED,
      // and every later reply fails. Checking now puts that in front of the
      // customer in the same breath as "connected", instead of leaving them to
      // wonder why the bot is silent.
      const health = await checkConnectionHealth(tenantId);
      console.log(
        `Connection health after connect for tenant ${tenantId}: ${health.state}` +
          (health.detail ? ` — ${health.detail}` : '')
      );
      if (health.state === 'NEEDS_REAUTH') {
        tokenWarning = [tokenWarning, `Connected, but Meta refused the token for this app: ${health.detail}`]
          .filter(Boolean)
          .join(' ');
      }

      recordConnectAttempt({
        tenantId,
        stage: 'success',
        message: tokenWarning ? `Connected with a warning: ${tokenWarning}` : 'Connected.',
        username: discovery.data.instagramUsername,
        source: 'callback',
      });

      console.log(`Successfully connected Instagram Account @${discovery.data.instagramUsername} (${discovery.data.instagramAccountId}) for tenant ${tenantId}`);
      const warningParam = tokenWarning ? `&warning=${encodeURIComponent(tokenWarning)}` : '';
      return res.redirect(
        `/app?oauth=success&username=${encodeURIComponent(discovery.data.instagramUsername)}${warningParam}`
      );
    } catch (err: any) {
      console.error('OAuth callback execution error:', err);
      recordConnectAttempt({
        tenantId,
        stage: 'error',
        code: 'CALLBACK_CRASH',
        message: `Unexpected error during OAuth completion: ${err.message}`,
        source: 'callback',
      });
      const msg = encodeURIComponent(`Unexpected error during OAuth completion: ${err.message}`);
      return res.redirect(`/app?oauth=error&message=${msg}`);
    }
  });

  /**
   * What the browser was told when a connect failed (tenant).
   *
   * The OAuth callback explains the failures the *server* handled. The ones the
   * customer sees without a callback — Meta's consent screen refusing them, the
   * popup being blocked, a lost provider session — would otherwise exist only in
   * their screenshot. The dashboard posts them here so the owner can read the
   * actual sentence instead of asking "kya error aaya tha?".
   *
   * Deliberately tiny and body-bounded: it stores a short message, not a log.
   */
  app.post('/api/instagram/connect-report', (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId || tenantId === DEMO_TENANT_ID) {
      return res.status(400).json({ success: false, error: 'Sign in to your own account first.' });
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ success: false, error: 'A message is required.' });
    }

    const attempt = recordConnectAttempt({
      tenantId,
      stage: req.body?.stage === 'success' ? 'success' : 'error',
      code: typeof req.body?.code === 'string' ? req.body.code : 'DASHBOARD_REPORT',
      message,
      username: typeof req.body?.username === 'string' ? req.body.username : undefined,
      source: 'dashboard',
    });

    console.log(`CONNECT_REPORT: tenant ${tenantId} reported a failed connect — ${message.slice(0, 160)}`);
    return res.json({ success: true, attempt });
  });

  // ==========================================
  // 2. REAL INSTAGRAM CONNECTION ENDPOINTS
  // ==========================================

  // Connect & Verify Instagram (POST /api/instagram/connect)
  // Accepts a Meta token and validates the actual Instagram Business Account.
  // NEVER fakes success!
  app.post('/api/instagram/connect', async (req, res) => {
    try {
      const { accessToken, pageId } = req.body;
      const tenantId = getTenantId(req);

      if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 15) {
        return res.status(400).json({
          success: false,
          error: 'A valid Meta Access Token (minimum 15 characters) is required.',
        });
      }

      // Clean input
      const cleanToken = accessToken.trim();
      const cleanHintId = pageId ? String(pageId).trim() : undefined;

      // Onboarding lifecycle: this is a REAL connection attempt (Feature 3/4).
      ensureRegistered(tenantId, 'customer');
      transitionOnboarding(tenantId, 'INSTAGRAM_CONNECTION_PENDING', 'customer', 'connect attempt started');

      console.log(`Initiating real Meta discovery for tenant ${tenantId}...`);

      // 1. Discover the real Instagram Business Account ID
      const discovery = await discoverInstagramAccount(cleanToken, cleanHintId);

      if (!discovery.success || !discovery.data) {
        const failPath = String(discovery.error || discovery.success || 'discovery-failed').slice(0, 150);
        recordEventOnboarding(tenantId, 'Instagram connection failed at discovery', 'system', failPath);
        transitionOnboarding(tenantId, 'CONNECTION_FAILED', 'system', failPath);
        return res.status(400).json({
          success: false,
          error: discovery.error || 'Failed to locate a valid Instagram Business/Professional account with this token.',
        });
      }

      // 2. Make the token last before anything depends on it.
      //
      // The token Meta's own "Generate token" button hands out is SHORT-LIVED
      // (about an hour). Saving that as-is "works" and then the bot silently
      // stops answering, which is the worst possible failure to debug. Exchange
      // it for the 60-day form first; if that cannot be done, say so in the
      // response rather than letting the account quietly expire.
      let tokenToStore = discovery.data.accessToken;
      let tokenWarning: string | null = null;

      if (/^IGAA/i.test(cleanToken)) {
        if (IG_APP_SECRET) {
          const longLived = await exchangeForLongLivedInstagramToken(tokenToStore, IG_APP_SECRET);
          if (longLived) {
            tokenToStore = longLived;
            console.log(`Exchanged the pasted Instagram token for a long-lived one for tenant ${tenantId}`);
          } else {
            tokenWarning =
              `Connected, but Meta would not upgrade this token to a long-lived one — it may stop working within about an hour. ` +
              `Reason from Meta: ${getLastLongLivedExchangeError() || 'no reason returned'}. ` +
              'Generate a fresh token and connect again.';
          }
        } else {
          tokenWarning =
            'Connected, but IG_APP_SECRET is not set on this server, so this token could not be upgraded to a long-lived one — it may stop working within about an hour.';
        }
      }

      // 3. Perform live verification against Meta API, using the token that
      // will actually be stored so the check means something.
      const verification = await verifyLiveInstagramConnection(
        discovery.data.instagramAccountId,
        tokenToStore
      );

      if (!verification.valid) {
        const failPath = String(verification.error || 'verification-failed').slice(0, 150);
        recordEventOnboarding(tenantId, 'Instagram connection failed at verification', 'system', failPath);
        transitionOnboarding(tenantId, 'CONNECTION_FAILED', 'system', failPath);
        return res.status(400).json({
          success: false,
          error: verification.error || 'Failed to verify account permissions with Meta Graph API.',
        });
      }

      // 4. Encrypt and save securely
      const savedStatus = saveConnection(tenantId, discovery.data, tokenToStore);

      // 4b. Onboarding lifecycle: the connection is now REAL (Meta verified
      // the token above), so this is the one place the status is allowed to
      // become INSTAGRAM_CONNECTED — never on a click alone.
      transitionOnboarding(tenantId, 'INSTAGRAM_CONNECTED', 'system', `connected:${savedStatus?.instagramAccountId || ''}`);

      // 4c. Activation lifecycle: every real connection starts pending owner
      // review. This never blocks the connect response — onboarding continues
      // while the owner works the queue.
      void touchActivationOnConnect(
        tenantId,
        savedStatus?.instagramUsername ?? null,
        savedStatus?.instagramAccountId ?? null
      );

      // 4d. Save the real Instagram account details to the contact record so
      // the Ops Console and the customer's own contact screen show the actual
      // account for manual invitation matching. These come from Meta — never
      // guessed or fabricated.
      if (savedStatus?.instagramUsername || savedStatus?.instagramAccountId) {
        saveContact(tenantId, {
          instagramUsername: savedStatus.instagramUsername ?? undefined,
          instagramAccountId: savedStatus.instagramAccountId ?? undefined,
          instagramStatus: 'CONNECTED',
          instagramConnectedAt: new Date().toISOString(),
        });
      }

      const connectContact = getContact(tenantId);
      const connectProfile = getProfile(tenantId);
      queueWhatsAppMessage({
        tenantId,
        template: 'instagram-connected',
        customerName: connectContact?.contactPerson || connectProfile?.username || 'customer',
        lang: connectContact?.language || 'en',
        context: `connected-${savedStatus?.instagramAccountId || Date.now()}`,
      });

      // 5. Subscribe the account to our webhook so inbound DMs reach us.
      subscribeInstagramAccountToWebhooks(
        discovery.data.instagramAccountId,
        discovery.data.accessToken
      ).catch((subErr) =>
        console.warn(
          'Post-connect webhook subscription error (non-fatal):',
          subErr?.message || subErr
        )
      );

      return res.json({
        success: true,
        account: savedStatus,
        tokenWarning,
      });
    } catch (err: any) {
      console.error('Error in /api/instagram/connect:', err);
      return res.status(500).json({
        success: false,
        error: `Server error during connection: ${err.message}`,
      });
    }
  });

  // Get Connection Status (GET /api/instagram/status)
  app.get('/api/instagram/status', (req, res) => {
    const tenantId = getTenantId(req);
    const status = getSafeStatus(tenantId);
    // Sent from the server so the dashboard never shows a localhost URL as if it
    // were the link to hand to customers.
    res.json({
      ...status,
      bookingUrl: status.instagramUsername
        ? `${getPublicAppUrl(req)}/book/${encodeURIComponent(status.instagramUsername)}`
        : null,
      // The exact URI Meta compares against its whitelist. Sent from the server
      // because META_REDIRECT_URI can point somewhere other than this origin.
      oauthRedirectUri: getOAuthRedirectUri(req),
      // Meta validates the redirect URI *against one specific app*. Showing the
      // client id next to the URL is what turns "Invalid redirect_uri" into a
      // five-second check: right URL + wrong app looks exactly like a bad URL.
      oauthClientId: IG_APP_ID || META_APP_ID || null,
      oauthFlavour: IG_APP_ID && IG_APP_SECRET ? 'instagram_login' : 'facebook',
      // Whether the consent screen can finish from here, so the dashboard can
      // explain before the click instead of after a dead end.
      oauthReady: buildOAuthReadiness(req),
      webhookUrl: `${getPublicAppUrl(req)}/api/webhook/instagram`,
      setupLinks: getMetaSetupLinks(),
    });
  });

  // The bundle filename changes on every build, so its hash doubles as a build
  // id. A dashboard tab that was left open keeps running the JavaScript it
  // loaded days ago — which is exactly how a fixed bug "comes back". This lets
  // the open tab notice the next deploy and offer a reload.
  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ buildId: BUILD_ID });
  });

  // Live Verify Connected Account (POST /api/instagram/verify)
  app.post('/api/instagram/verify', async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const status = getSafeStatus(tenantId);

      if (!status.isConnected || !status.instagramAccountId) {
        return res.status(400).json({
          valid: false,
          error: 'No Instagram account is currently connected for this tenant.',
        });
      }

      const rawToken = getDecryptedTokenForTenant(tenantId);
      if (!rawToken) {
        updateVerificationStatus(tenantId, false, 'Failed to decrypt access token.');
        return res.status(400).json({
          valid: false,
          error: 'Stored credentials could not be decrypted. Please reconnect your account.',
        });
      }

      // Run live Meta API check
      const verification = await verifyLiveInstagramConnection(status.instagramAccountId, rawToken);

      if (verification.valid && verification.account) {
        const updated = updateVerificationStatus(tenantId, true, undefined, {
          instagramUsername: verification.account.instagramUsername,
          profilePictureUrl: verification.account.profilePictureUrl,
        });
        return res.json({
          valid: true,
          status: updated,
        });
      } else {
        const updated = updateVerificationStatus(tenantId, false, verification.error);
        return res.status(400).json({
          valid: false,
          error: verification.error || 'Meta Graph API rejected verification request.',
          status: updated,
        });
      }
    } catch (err: any) {
      console.error('Error during manual verification:', err);
      return res.status(500).json({
        valid: false,
        error: `Verification error: ${err.message}`,
      });
    }
  });

  // Disconnect Instagram Account (POST /api/instagram/disconnect)
  app.post('/api/instagram/disconnect', (req, res) => {
    const tenantId = getTenantId(req);
    const success = disconnectAccount(tenantId);
    res.json({ success, isConnected: false });
  });

  // Backward compatibility endpoint for legacy verification UI
  app.post('/api/verify-instagram-token', async (req, res) => {
    try {
      const { accessToken, pageId } = req.body;
      const tenantId = getTenantId(req);

      if (!accessToken || accessToken.trim().length < 15) {
        return res.json({ valid: false, error: 'Access token is required and must be at least 15 characters.' });
      }

      const discovery = await discoverInstagramAccount(accessToken.trim(), pageId ? String(pageId).trim() : undefined);
      if (!discovery.success || !discovery.data) {
        return res.json({ valid: false, error: discovery.error || 'Invalid token or no Instagram Business account found.' });
      }

      const verification = await verifyLiveInstagramConnection(discovery.data.instagramAccountId, discovery.data.accessToken);
      if (!verification.valid) {
        return res.json({ valid: false, error: verification.error || 'Meta API verification failed.' });
      }

      saveConnection(tenantId, discovery.data, discovery.data.accessToken);

      // Keep the webhook subscription fresh on legacy verify too.
      subscribeInstagramAccountToWebhooks(
        discovery.data.instagramAccountId,
        discovery.data.accessToken
      ).catch((subErr) =>
        console.warn(
          'Post-verify webhook subscription error (non-fatal):',
          subErr?.message || subErr
        )
      );

      return res.json({
        valid: true,
        pageName: `@${discovery.data.instagramUsername} (${discovery.data.instagramAccountId})`,
        account: discovery.data,
      });
    } catch (err: any) {
      return res.json({ valid: false, error: `Verification error: ${err.message}` });
    }
  });

  // Diagnostics Endpoint (GET /api/instagram/diagnostics)
  // Safe diagnostic output with NO sensitive secrets
  app.get('/api/instagram/diagnostics', (req, res) => {
    const appUrl = getPublicAppUrl(req);
    const tenantId = getTenantId(req);
    const tenantStatus = getSafeStatus(tenantId);
    const allAccounts = getDiagnosticsInfo();

    res.json({
      timestamp: new Date().toISOString(),
      server: {
        appUrl,
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development',
        graphApiVersion: META_GRAPH_API_VERSION,
      },
      metaConfiguration: {
        appIdConfigured: !!META_APP_ID,
        appSecretConfigured: !!META_APP_SECRET,
        verifyTokenConfigured: !!META_VERIFY_TOKEN,
        webhookCallbackUrl: `${appUrl}/api/webhook/instagram`,
        oauthRedirectUri: `${appUrl}/api/instagram/oauth/callback`,
      },
      aiEngine: getAiConfigStatus(),
      currentTenant: {
        tenantId,
        status: tenantStatus,
      },
      // The public link the bot hands to interested customers.
      bookingPage: {
        slug: tenantStatus.instagramUsername || null,
        url: tenantStatus.instagramUsername
          ? `${appUrl}/book/${encodeURIComponent(tenantStatus.instagramUsername)}`
          : null,
      },
      // What the bot will actually answer from for this tenant. Char counts,
      // never the content — enough to tell "my knowledge base is not being used"
      // apart from "the model ignored it".
      aiSettings: {
        customised: getTenantAiSettings(tenantId).customised,
        systemPromptChars: getTenantAiContext(tenantId).systemPrompt.length,
        knowledgeDocuments: getTenantAiContext(tenantId).itemCount,
        knowledgeBaseChars: getTenantAiContext(tenantId).knowledgeBase?.length ?? 0,
      },
      clusterDiagnostics: {
        totalConnectedTenants: allAccounts.totalTenants,
        indexedIgAccountsCount: allAccounts.indexedIgAccounts.length,
      },
    });
  });

  // ==========================================
  // 2b. PER-TENANT AI SETTINGS (SYSTEM PROMPT + KNOWLEDGE BASE)
  // ==========================================
  // The dashboard's "System Prompt" box and knowledge-base editor used to be
  // React state only: nothing was saved, and the webhook answered from a
  // hardcoded generic prompt. These endpoints make the operator's own words the
  // source of truth, on the same volume as the inbox and the connections.

  // Read the effective settings for the calling tenant.
  app.get('/api/tenant-settings', (req, res) => {
    const tenantId = getTenantId(req);
    const settings = getTenantAiSettings(tenantId);
    return res.json({
      success: true,
      settings,
      defaults: { systemPrompt: DEFAULT_SYSTEM_PROMPT, maxSystemPromptChars: MAX_SYSTEM_PROMPT_CHARS },
    });
  });

  // Save them. PUT because the body always describes the full desired state.
  app.put('/api/tenant-settings', (req, res) => {
    const tenantId = getTenantId(req);
    try {
      const settings = saveTenantAiSettings(tenantId, {
        systemPrompt: req.body?.systemPrompt,
        persona: req.body?.persona,
        knowledgeItems: req.body?.knowledgeItems,
      });
      console.log(
        `Saved AI settings for tenant ${tenantId}: prompt ${settings.systemPrompt.length} chars, ` +
          `${settings.knowledgeItems.length} knowledge document(s)`
      );
      return res.json({ success: true, settings });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 2c. KNOWLEDGE-BASE GAPS (QUESTIONS THE BOT COULD NOT ANSWER)
  // ==========================================
  // A knowledge base is only as good as its coverage, and only the bot sees what
  // customers actually ask. These endpoints expose those unanswered questions as
  // a to-do list for the operator.

  app.get('/api/kb-gaps', (req, res) => {
    const tenantId = getTenantId(req);
    const gaps = getKbGaps(tenantId);
    return res.json({ success: true, total: gaps.length, gaps });
  });

  // The operator answered a question (or it does not matter) — drop it.
  app.post('/api/kb-gaps/resolve', (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!key) {
      return res.status(400).json({ success: false, error: 'A gap key is required.' });
    }
    const removed = resolveKbGap(key, getTenantId(req));
    return res.json({ success: true, removed });
  });

  app.post('/api/kb-gaps/clear', (req, res) => {
    const removed = clearKbGaps(getTenantId(req));
    console.log(`Cleared ${removed} knowledge-base gap(s) for tenant ${getTenantId(req)}`);
    return res.json({ success: true, removed });
  });

  // ==========================================
  // 2c-2. INSTAGRAM TESTER REQUESTS
  // ==========================================
  // While Meta's access gate is open, the owner has to add every new customer by
  // hand — and the *failed* OAuth carries no username, so the server never learns
  // the handle any other way. The customer types it on the blocked-connect screen;
  // the owner picks it up as a queue.

  // The caller's own request, so the blocked card still shows "bhej diya" after a
  // reload instead of asking for the handle a second time.
  app.get('/api/tester-request', (req, res) => {
    const tenantId = getTenantId(req);
    return res.json({ success: true, request: getTesterRequest(tenantId) });
  });

  app.post('/api/tester-request', (req, res) => {
    const tenantId = getTenantId(req);
    // Demo Mode has no account behind it, so a request from there is not a real
    // customer and would only clutter the owner's queue.
    if (!tenantId || tenantId === DEMO_TENANT_ID) {
      return res.status(400).json({
        success: false,
        error: 'Sign in to your own account to send your Instagram username.',
      });
    }

    const result = submitTesterRequest(tenantId, String(req.body?.username ?? ''));
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // This route is the access-gate path: the dashboard only asks for a handle
    // when the connect could not complete. Recording it here is what gives the
    // Ops Console an answer to "why is this account still not connected?" —
    // and the handle itself, which a failed OAuth never reveals anywhere else.
    recordConnectAttempt({
      tenantId,
      stage: 'blocked',
      code: 'ACCESS_GATE',
      message:
        'Instagram refused the authorization before any account could be discovered — the account is most likely not a tester on this app yet.',
      username: result.request.username,
      source: 'dashboard',
    });

    console.log(
      `Tester request for tenant ${tenantId}: @${result.request.username} (${result.request.status})`
    );

    /**
     * Owner alert: a new handle in the queue is a paying customer parked at
     * Instagram's consent screen until *someone* adds them in the Meta
     * dashboard — and only the owner knows how. Fire-and-forget on purpose:
     * the request is already on disk, so a slow relay must never delay the
     * customer's HTTP response, and a failed push is logged loudly + visible
     * in the Ops queue instead of being lost. A repeat submit waits through the
     * same 30-min anti-spam window as the complaint form (one row per tenant
     * already prevents duplicates in the queue itself).
     */
    const pushKey = `tester-request:${tenantId}`;
    if (
      isOwnerWhatsAppConfigured() &&
      !throttle(adminAlertThrottle, 1, 30 * 60 * 1000, pushKey)
    ) {
      const contact = getContact(tenantId);
      const pushText = [
        'InstaFlow AI — tester invite needed',
        `Handle: @${result.request.username}`,  // copy-paste target for the Meta dashboard
        `Customer: ${contact?.businessName || contact?.contactPerson || tenantId.slice(0, 12)}`,
        contact?.whatsappNumber && !contact.optOut
          ? `WhatsApp: ${contact.whatsappNumber} (tap to send the accept-invite message)`
          : null,
        '',
        `Open /ops → tester queue to mark it invited.`,
      ]
        .filter(Boolean)
        .join('\n');
      void sendOwnerWhatsApp(pushText).then((delivery) => {
        if (delivery.ok) console.log(`TESTER_REQUEST_NOTIFY_OK ${tenantId}`);
        else console.error(`TESTER_REQUEST_NOTIFY_FAILED ${tenantId}: ${delivery.error}`);
      });
    }

    return res.json({ success: true, request: result.request });
  });

  /**
   * Owner action on the queue: "invite bhej diya" / "ho gaya".
   *
   * The same owner gate as `/api/owner/tenants`, because this one writes. A
   * *customer* can create their own request; only the owner can move it forward,
   * otherwise the queue would clear itself the moment a customer clicked.
   */
  app.post('/api/owner/tester-requests/status', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to update a tester request`
      );
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const status = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }
    // ACCEPTED is deliberately absent: acceptance has its own route so the row
    // always records who confirmed it and whether Meta itself verified it. A bare
    // status flip would be an "accepted" label with no evidence behind it.
    const validStatuses: TesterRequestStatus[] = [
      'REQUESTED',
      'NEEDS_IDENTITY_CONFIRMATION',
      'READY_TO_INVITE',
      'INVITATION_SENT',
      'ACCEPTANCE_PENDING',
      'EXPIRED',
      'FAILED',
      'CANCELLED',
    ];
    if (!validStatuses.includes(status as TesterRequestStatus)) {
      return res.status(400).json({
        success: false,
        code: status === 'ACCEPTED' ? 'USE_ACCEPT_ROUTE' : 'UNKNOWN_STATUS',
        error:
          status === 'ACCEPTED'
            ? 'Record acceptance through the confirm endpoint so the evidence is stored.'
            : 'Unknown tester-request status.',
      });
    }

    const updated = setTesterRequestStatus(
      tenantId,
      status as TesterRequestStatus,
      typeof req.body?.note === 'string' ? req.body.note : undefined,
      viewerEmail || viewer
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'No tester request for that account.' });
    }

    console.log(`OWNER_ACTION: tester request for ${tenantId} marked ${status} by ${viewer}`);

    /**
     * Tell the CUSTOMER the ball moved. The customer portal already shows the
     * request's live status when it reloads, but mostly-re-read-less owners get
     * asked "add ho gaya?" on WhatsApp within the minute — so the outbox also
     * queues the `permission-required` template here. It lands as
     * `provider-unconfigured` + manual copy, which the Ops onboarding board
     * already surfaces; consent and the 60-min duplicate window are enforced by
     * the outbox itself, so this call is safe to repeat.
     */
    if (status === 'INVITATION_SENT' || status === 'ACCEPTED') {
      const contact = getContact(tenantId);
      const customerName = getProfile(tenantId)?.username || contact?.businessName || tenantId.slice(0, 12);
      const msg = queueWhatsAppMessage({
        tenantId,
        template: 'permission-required',
        customerName,
        lang: contact?.language || 'en',
        context: `tester-request-${status}`,
      });
      console.log(
        `OWNER_ACTION: customer notify for ${tenantId} (${status}) → ${msg.message.status}${msg.ok ? '' : ` — ${msg.reason}`}`
      );
    }

    return res.json({ success: true, request: updated });
  });

  /**
   * Owner action: "Prepare Invitation".
   *
   * After reviewing the connected Instagram username against the correct Meta
   * app identity (see getOAuthAppIdentity / appIdentity.ts), the owner marks the
   * request READY_TO_INVITE. No URL is generated here — Meta has no tester
   * invitation API, so the owner confirms the handle and the correct app id.
   */
  app.post('/api/owner/tester-requests/prepare', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to prepare a tester invitation`
      );
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    // Prepare means "the account is verified as the right one on the right app".
    // Without the recorded Meta-dashboard step that claim is unbacked, and the
    // invite that follows is exactly the one the customer cannot accept.
    const current = getTesterRequest(tenantId);
    if (!current) {
      return res.status(404).json({ success: false, error: 'No tester request for that account.' });
    }
    if (!current.accountAddedAt) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_NOT_ADDED',
        error: `Record the Meta dashboard step first: add @${current.username} as an Instagram Tester… then confirm it here.`,
      });
    }

    const updated = setTesterRequestStatus(
      tenantId,
      'READY_TO_INVITE',
      typeof req.body?.note === 'string' ? req.body.note : undefined,
      viewerEmail || viewer
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'No tester request for that account, or transition not allowed.' });
    }

    console.log(`OWNER_ACTION: tester request for ${tenantId} prepared for invite by ${viewer}`);
    return res.json({ success: true, request: updated });
  });

  /**
   * Owner action: "I added @handle as an Instagram Tester on this app".
   *
   * Meta has no API for this, so the server cannot verify it — but it refuses to
   * pretend: Prepare and Send stay locked until this is recorded, and the row
   * keeps who recorded it and when. The optional `handle` lets the UI prove the
   * operator copied the right one instead of typing from memory.
   */
  app.post('/api/owner/tester-requests/account-added', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to record a Meta dashboard step`
      );
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    const result = recordTesterAccountAdded(
      tenantId,
      viewerEmail || viewer,
      typeof req.body?.handle === 'string' ? req.body.handle : undefined
    );
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    console.log(`OWNER_ACTION: tester account recorded as added for ${tenantId} by ${viewer}`);
    return res.json({ success: true, request: result.request });
  });

  /**
   * Owner action: "the invitation was accepted".
   *
   * There is no Meta acceptance API or webhook to call, so this records an
   * explicitly *unverified* confirmation (`acceptanceVerified: false`) instead of
   * pretending the platform told us. If Meta ever exposes such a signal it lands
   * in the same field with `verified: true`.
   */
  app.post('/api/owner/tester-requests/accept', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to record an acceptance`
      );
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    const result = recordTesterAcceptance(tenantId, 'owner', viewerEmail || viewer, {
      verified: false,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    if (!result.ok) {
      return res.status(409).json({ success: false, error: result.error });
    }

    console.log(`OWNER_ACTION: tester acceptance recorded (unverified) for ${tenantId} by ${viewer}`);
    return res.json({ success: true, verified: false, request: result.request });
  });

  /**
   * Customer action: "I accepted the invitation".
   *
   * Only their own request, only from INVITATION_SENT, and only up to
   * ACCEPTANCE_PENDING — the queue's "done" stays the owner's call because the
   * customer's word is not Meta's verdict.
   */
  app.post('/api/tester-request/confirmed', (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId || tenantId === DEMO_TENANT_ID) {
      return res.status(400).json({ success: false, error: 'Sign in to your own account to confirm your invitation.' });
    }

    const result = recordCustomerConfirmation(tenantId);
    if (!result.ok) {
      return res.status(409).json({ success: false, error: result.error });
    }

    console.log(`CUSTOMER_ACTION: tester invitation confirmed by customer for ${tenantId}`);
    return res.json({ success: true, request: result.request });
  });

  /**
   * Owner action: "Send Invitation".
   *
   * Records the verified invitation destination URL and the Meta app id the
   * customer must accept on. The URL comes from Meta's dashboard (manual step)
   * — it is never invented or fabricated here.
   */
  app.post('/api/owner/tester-requests/send', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to send a tester invitation`
      );
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const invitationUrl = typeof req.body?.invitationUrl === 'string' ? req.body.invitationUrl.trim() : '';
    const metaAppId = typeof req.body?.metaAppId === 'string' ? req.body.metaAppId.trim() : '';

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }
    if (!invitationUrl) {
      return res.status(400).json({ success: false, error: 'A verified invitation URL is required.' });
    }
    if (!metaAppId) {
      return res.status(400).json({ success: false, error: 'The Meta app id is required.' });
    }

    // The portal renders this string as a clickable button, so the scheme and
    // host are a security boundary, not a format check.
    const checkedUrl = validateInvitationUrl(invitationUrl);
    if (!checkedUrl.ok) {
      return res.status(400).json({ success: false, code: 'INVALID_INVITATION_URL', error: checkedUrl.error });
    }

    const current = getTesterRequest(tenantId);
    if (!current) {
      return res.status(404).json({ success: false, error: 'No tester request for that account.' });
    }
    if (!current.accountAddedAt) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_NOT_ADDED',
        error: `Add @${current.username} as an Instagram Tester in the Meta dashboard and confirm it before sending the invitation.`,
      });
    }
    if (
      current.status === 'INVITATION_SENT' ||
      current.status === 'ACCEPTANCE_PENDING' ||
      current.status === 'ACCEPTED'
    ) {
      return res.status(409).json({
        success: false,
        code: 'INVITATION_ALREADY_SENT',
        error: 'An invitation is already recorded for this account. Reopen the request to send a new one.',
      });
    }

    const updated = setTesterRequestInvitation(
      tenantId,
      checkedUrl.url,
      metaAppId,
      typeof req.body?.note === 'string' ? req.body.note : undefined,
      viewerEmail || viewer
    );
    if (!updated) {
      return res.status(409).json({
        success: false,
        error: 'Not ready to send: the request must be prepared (account added, identity confirmed) first.',
      });
    }

    // Notify the customer through the existing outbox: consent-gated, deduped and
    // honest about the provider (today usually `provider-unconfigured` + manual
    // copy). The outbox status is stored on the request so the queue can show
    // "message queued" vs "message needs a manual copy" instead of assuming sent.
    const contact = getContact(tenantId);
    const customerName =
      getProfile(tenantId)?.username || contact?.businessName || tenantId.slice(0, 12);
    const queued = queueWhatsAppMessage({
      tenantId,
      template: 'permission-required',
      customerName,
      lang: contact?.language || 'en',
      context: `tester-invitation:${tenantId}:${updated.invitedAt || ''}`,
    });
    const finalRequest =
      recordTesterNotification(tenantId, {
        status: queued.message.status,
        at: queued.message.at,
        reason: queued.reason || queued.message.error,
        toMasked: queued.message.toMasked,
      }) || updated;

    console.log(
      `OWNER_ACTION: tester request for ${tenantId} invitation sent by ${viewer} (app ${metaAppId}); notify=${queued.message.status}`
    );
    return res.json({ success: true, request: finalRequest, notify: finalRequest.notify });
  });

  // ==========================================
  // 2e. CUSTOMER ACTIVATION WORKFLOW (owner-only)
  // ==========================================
  // Tracks a newly connected Instagram account through owner review, tester
  // invitation, activation instructions, and a real test-DM confirmation.
  // Meta exposes no tester-acceptance API, so acceptance is never assumed —
  // only a successful test reply marks an account FULLY_ACTIVE.

  // Tenant reads their own activation state.
  app.get('/api/activation/status', (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId || tenantId === DEMO_TENANT_ID) {
      return res.status(400).json({ success: false, error: 'Sign in to your own account.' });
    }
    const state = getActivationState(tenantId);
    return res.json({ success: true, state });
  });

  // Owner: mark the tester invitation as sent. Requires the Meta dashboard
  // step (accountAddedAt) to have been recorded first.
  app.post('/api/owner/activation/mark-invitation-sent', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated'} tried to mark invitation sent`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });

    // The Meta dashboard step must be recorded before an invite can be sent.
    const current = getTesterRequest(tenantId);
    if (!current) return res.status(404).json({ success: false, error: 'No tester request for that account.' });
    if (!current.accountAddedAt) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_NOT_ADDED',
        error: `Record that @${current.username} was added as an Instagram Tester in the Meta dashboard first.`,
      });
    }

    const result = markInvitationSent(tenantId, viewerEmail || viewer, typeof req.body?.note === 'string' ? req.body.note : undefined);
    if (!result.ok) return res.status(409).json({ success: false, error: result.error });

    console.log(`OWNER_ACTIVATION: ${tenantId} invitation sent marked by ${viewer}`);
    return res.json({ success: true, state: result.state });
  });

  // Owner: send activation instructions through a supported channel (WhatsApp
  // via the existing outbox — consent-gated, deduped, honest about provider).
  // Moves INVITATION_SENT → AWAITING_CUSTOMER_ACCEPTANCE.
  app.post('/api/owner/activation/send-instructions', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated'} tried to send activation instructions`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });

    const state = getActivationState(tenantId);
    if (!state) return res.status(404).json({ success: false, error: 'No activation state for that account.' });
    if (state.status !== 'INVITATION_SENT') {
      return res.status(409).json({
        success: false,
        code: 'NOT_INVITATION_SENT',
        error: `Activation instructions can only be sent after the invitation is marked sent (current: ${state.status}).`,
      });
    }

    const contact = getContact(tenantId);
    const customerName = getProfile(tenantId)?.username || contact?.businessName || tenantId.slice(0, 12);

    // Only send when the customer has consented; otherwise record the block.
    if (!contact?.consent.given || contact?.optOut) {
      const failed = requireAction(tenantId, viewerEmail || viewer, 'No WhatsApp consent recorded — instructions cannot be sent automatically.');
      if (!failed.ok) return res.status(409).json({ success: false, error: failed.error });
      return res.status(202).json({
        success: false,
        code: 'NO_CONSENT',
        error: 'Customer has not consented to WhatsApp notifications. Instructions require manual delivery.',
        state: failed.state,
      });
    }

    const queued = queueWhatsAppMessage({
      tenantId,
      template: 'permission-required',
      customerName,
      lang: contact?.language || 'en',
      context: `activation-instructions:${tenantId}:${Date.now()}`,
      allowDuplicate: false,
    });

    const result = sendActivationInstructions(
      tenantId,
      viewerEmail || viewer,
      {
        status: queued.message.status,
        at: queued.message.at,
        reason: queued.reason || queued.message.error,
        toMasked: queued.message.toMasked,
      },
      typeof req.body?.note === 'string' ? req.body.note : undefined
    );
    if (!result.ok) return res.status(409).json({ success: false, error: result.error });

    console.log(
      `OWNER_ACTIVATION: ${tenantId} activation instructions sent by ${viewer} → ${queued.message.status}`
    );
    return res.json({
      success: true,
      state: result.state,
      notify: { status: queued.message.status, reason: queued.reason, toMasked: queued.message.toMasked },
    });
  });

  // Owner: confirm the customer's test DM was answered successfully.
  // Moves AWAITING_TEST_DM → FULLY_ACTIVE.
  app.post('/api/owner/activation/confirm-test-dm', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated'} tried to confirm test DM`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });

    const result = confirmTestDm(tenantId, viewerEmail || viewer, typeof req.body?.note === 'string' ? req.body.note : undefined);
    if (!result.ok) return res.status(409).json({ success: false, error: result.error });

    console.log(`OWNER_ACTIVATION: ${tenantId} test DM confirmed by ${viewer}`);
    return res.json({ success: true, state: result.state });
  });

  // Owner: mark that the customer needs to take action before activation can
  // continue (reconnect, add tester, fix permissions, etc.).
  app.post('/api/owner/activation/require-action', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated'} tried to require action`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    if (!note.trim()) return res.status(400).json({ success: false, error: 'A reason is required.' });

    const result = requireAction(tenantId, viewerEmail || viewer, note);
    if (!result.ok) return res.status(409).json({ success: false, error: result.error });

    console.log(`OWNER_ACTIVATION: ${tenantId} action required by ${viewer}: ${note}`);
    return res.json({ success: true, state: result.state });
  });

  // Owner: record that a message send attempt failed.
  app.post('/api/owner/activation/message-send-failed', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated'} tried to record send failure`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    if (!reason.trim()) return res.status(400).json({ success: false, error: 'A reason is required.' });

    const result = messageSendFailed(tenantId, viewerEmail || viewer, reason);
    if (!result.ok) return res.status(409).json({ success: false, error: result.error });

    console.log(`OWNER_ACTIVATION: ${tenantId} message send failed recorded by ${viewer}: ${reason}`);
    return res.json({ success: true, state: result.state });
  });

  // ==========================================
  // 2d. GETTING-STARTED GUIDE + IN-PORTAL ASSISTANT
  // ==========================================
  // A brand-new customer used to land on a dashboard full of finished-looking
  // panels with no indication of what to do first. This endpoint reports the
  // ordered setup path for the calling tenant, with each step's done/not-done
  // read from the store that actually owns that fact — so a step can only turn
  // green because the real thing happened, and it turns red again if it breaks.

  app.get('/api/onboarding', (req, res) => {
    const tenantId = getTenantId(req);
    const snapshot = buildOnboardingSnapshot(tenantId, { lang: langFromRequest(req) });
    return res.json({ success: true, ...snapshot });
  });

  // Hide/show the guide. Cosmetic, but it is a per-account preference, so it is
  // stored on the volume rather than in one browser's localStorage.
  app.post('/api/onboarding/hide', (req, res) => {
    const tenantId = getTenantId(req);
    const hidden = req.body?.hidden !== false;
    try {
      const marks = setGuideHidden(tenantId, hidden);
      return res.json({ success: true, hiddenAt: marks.hiddenAt ?? null });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  /**
   * The in-portal assistant: "mujhe samajh nahi aa raha, kaha jaana hai?".
   *
   * Deliberately NOT `/api/simulate-dm` with a support prompt. That endpoint
   * answers as the *customer's* business bot and is metered against their plan;
   * using it here would spend the quota they paid for on our own onboarding
   * copy, and it would hand the assistant the wrong persona. This one is funded
   * by the platform, so it carries its own budget instead.
   */
  const guideAsks = new Map<string, { count: number; windowStart: number }>();
  const GUIDE_ASK_LIMIT = 30; // per account
  const GUIDE_ASK_WINDOW_MS = 15 * 60 * 1000;
  const GUIDE_ASK_GLOBAL_LIMIT = 400; // total ceiling, whatever the source

  app.post('/api/support/ask', async (req, res) => {
    const tenantId = getTenantId(req);
    const question = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!question) {
      return res.status(400).json({ success: false, error: 'A question is required.' });
    }
    if (question.length > 1000) {
      return res.status(400).json({ success: false, error: 'That question is too long — please shorten it.' });
    }

    // Per-account budget, plus a platform-wide ceiling so a scripted caller
    // cannot turn the help button into a free LLM proxy.
    const perAccount = throttle(guideAsks, GUIDE_ASK_LIMIT, GUIDE_ASK_WINDOW_MS, `tenant:${tenantId}`);
    const overall = throttle(guideAsks, GUIDE_ASK_GLOBAL_LIMIT, GUIDE_ASK_WINDOW_MS, 'global');
    if (perAccount || overall) {
      console.warn(`Guide assistant rate limited for tenant ${tenantId}`);
      return res.status(429).json({
        success: false,
        error: 'Bahut zyada sawaal ek saath — thodi der baad phir pooch lein.',
      });
    }

    try {
      // Grounded in this account's own live state, so the answer can name the
      // exact step that is blocking and the exact tab to open.
      const snapshot = buildOnboardingSnapshot(tenantId, { lang: langFromRequest(req) });

      // Only the last few turns: enough to follow "aur uske baad?" without
      // letting one visitor grow the prompt without bound.
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
      const conversationHistory = history
        .filter((m: any) => m && typeof m.text === 'string')
        .map((m: any) => ({
          sender: m.sender === 'guide' ? 'ai' : 'customer',
          text: String(m.text).slice(0, 600),
        }));

      const aiResult = await generateAiReply({
        systemPrompt: buildSupportSystemPrompt(snapshot, {
          // Same values the connect flow uses, so "connect kyu fail hua?" is
          // answered from this server's real configuration.
          flavour: IG_APP_ID && IG_APP_SECRET ? 'instagram_login' : 'facebook',
          redirectUri: getOAuthRedirectUri(req),
          clientId: IG_APP_ID || META_APP_ID || null,
          blockedReason: buildOAuthReadiness(req).reason,
        }),
        userMessage: question,
        conversationHistory,
      });

      // `generateAiReply` answers with a canned DM-style greeting when every
      // provider is down. That reply was written for a *customer*, so showing it
      // to the operator would be confusing and useless — answer the one question
      // we never need a model for instead.
      const degraded = aiResult.provider === 'fallback';
      const reply = degraded
        ? offlineGuideAnswer(snapshot, langFromRequest(req), buildOAuthReadiness(req).reason)
        : aiResult.reply;

      if (degraded) {
        console.warn(`Guide assistant degraded to the step pointer for tenant ${tenantId} (all AI providers failed)`);
      } else {
        console.log(`Guide assistant answered a question for tenant ${tenantId} via ${aiResult.provider}`);
      }

      return res.json({
        success: true,
        reply,
        degraded,
        provider: aiResult.provider,
        // The step the answer was written against, so the panel can point at it.
        currentStep: snapshot.progress.current,
        progress: snapshot.progress,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Guide assistant failed:', err.message);
      return res.status(502).json({
        success: false,
        error: 'Assistant se jawab nahi aaya. Thodi der baad koshish karein.',
      });
    }
  });

  // ==========================================
  // 2e. PUBLIC BOOKING PAGE + LEADS
  // ==========================================
  // The link the bot shares once a customer is interested. It is public (no
  // login) because the customer is not an InstaFlow user, and it is rendered
  // from the tenant's own knowledge base so there is nothing extra to keep in
  // sync. Whatever the customer types lands in the dashboard inbox.

  app.get('/book/:slug', (req, res) => {
    const resolved = getTenantByInstagramUsername(req.params.slug);
    const lang = langFromRequest(req);
    const c = BOOKING[lang];
    if (req.query.lang) res.setHeader('Set-Cookie', langCookieHeader(lang));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!resolved) {
      return res.status(404).send(
        '<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Page not found</title></head>' +
          '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0B0B0F;color:#FFFFFF;padding:48px 20px;text-align:center">' +
          `<h1 style="font-size:20px">${escapeHtml(c.notFoundTitle)}</h1>` +
          `<p style="color:#C5C5D0;font-size:14px">${escapeHtml(c.notFoundBody)}</p>` +
          '</body></html>'
      );
    }

    const { tenantId, connection } = resolved;
    const settings = getTenantAiSettings(tenantId);
    const { packages, extras } = splitBookingDocuments(settings.knowledgeItems);
    const handle = connection.instagramUsername || req.params.slug;

    return res.send(renderBookingPage({ slug: handle, handle, packages, extras, lang }));
  });

  app.post('/api/book/:slug', (req, res) => {
    const resolved = getTenantByInstagramUsername(req.params.slug);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'This booking page does not exist.' });
    }

    // The honeypot field is hidden from humans; only bots fill it in.
    if (typeof req.body?.company === 'string' && req.body.company.trim()) {
      console.warn('Booking form honeypot triggered; ignoring submission');
      return res.json({ success: true });
    }

    const ip = clientIp(req);
    if (bookingRateLimited(ip)) {
      console.warn(`Booking form rate limited for ${ip}`);
      return res.status(429).json({ success: false, error: 'Too many requests — please try again later.' });
    }

    const result = addLead({
      tenantId: resolved.tenantId,
      instagramUsername: resolved.connection.instagramUsername,
      name: req.body?.name,
      whatsapp: req.body?.whatsapp,
      email: req.body?.email,
      travelDates: req.body?.travelDates,
      travellers: req.body?.travellers,
      message: req.body?.message,
    });

    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    console.log(
      `NEW_LEAD for tenant ${resolved.tenantId}: ${result.lead.name} / ${result.lead.whatsapp}` +
        (result.lead.travelDates ? ` / ${result.lead.travelDates}` : '') +
        (result.lead.travellers ? ` / ${result.lead.travellers} pax` : '')
    );
    return res.json({ success: true, leadId: result.lead.id });
  });

  // ==========================================
  // 2f. PUBLIC COMPLAINT FORM
  // ==========================================
  // This replaced the owner's mobile number on `/contact` and the policy
  // footers. The customer types their own id, a mobile / WhatsApp number and the
  // problem; the server stores it and pushes it to the owner's own WhatsApp.
  // The destination number is a host secret and never reaches a browser — the
  // customer only ever sees this endpoint.
  app.get('/complaint', (req, res) => {
    const lang = langFromRequest(req);
    if (req.query.lang) res.setHeader('Set-Cookie', langCookieHeader(lang));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderComplaintPage(lang));
  });

  app.post('/api/complaints', (req, res) => {
    // The honeypot field is hidden from humans; only bots fill it in.
    if (typeof req.body?.company === 'string' && req.body.company.trim()) {
      console.warn('Complaint form honeypot triggered; ignoring submission');
      return res.json({ success: true });
    }

    const ip = clientIp(req);
    if (complaintRateLimited(ip)) {
      console.warn(`Complaint form rate limited for ${ip}`);
      return res
        .status(429)
        .json({ success: false, error: 'Too many complaints from this connection — please try again later.' });
    }

    const result = addComplaint({
      accountId: req.body?.accountId,
      contact: req.body?.contact,
      problem: req.body?.problem,
    });

    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const { complaint } = result;
    console.log(`NEW_COMPLAINT ${complaint.id} from ${complaint.contact}`);

    // Fire-and-forget: the complaint is already on disk, so the customer does
    // not wait on WhatsApp's relay to see a confirmation.
    void deliverComplaint(complaint);
    return res.json({ success: true, complaintId: complaint.id });
  });

  app.get('/api/leads', (req, res) => {
    const tenantId = getTenantId(req);
    const leads = getLeads(tenantId);
    return res.json({ success: true, total: leads.length, leads, stats: getLeadStats() });
  });

  app.post('/api/leads/handled', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) return res.status(400).json({ success: false, error: 'A lead id is required.' });
    const lead = markLeadHandled(id, getTenantId(req));
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    return res.json({ success: true, lead });
  });

  // ==========================================
  // 2e. PLANS, SUBSCRIPTION & CHECKOUT
  // ==========================================
  // Self-serve purchase: a business owner picks a plan, pays through Razorpay,
  // and their bot turns on. No manual step for the developer in between.

  // Public: the catalogue, so the pricing page and the dashboard agree.
  app.get('/api/plans', (_req, res) => {
    res.json({
      success: true,
      plans: getPurchasablePlans(),
      trialDays: TRIAL_DAYS,
      payments: getPublicPaymentConfig(),
    });
  });

  // ==============================================================
  // ONBOARDING WIZARD — self-service (Feature 1 / Feature 4.
  // Every endpoint below is tenant-scoped by the verified token.
  // ===============================================================

  /**
   * POST /api/plan/activate — the Free Plan entitlement (Feature 1 Step 2).
   *
   * Server-verified, persists a real `free` subscription row via the existing
   * entitlement system, and is idempotent. No payment details are collected —
   * this plan has priceInr 0 by definition. Registering the tenant on the
   * first touch also gives the OPS list its real registration timestamp.
   */
  app.post('/api/plan/activate', (req, res) => {
    const tenantId = getTenantId(req);
    ensureRegistered(tenantId, 'customer');
    try {
      const activation = activateFreePlan(tenantId);
      if (activation.ok && !activation.alreadyActive) {
        const transitioned = transitionOnboarding(tenantId, 'FREE_PLAN_ACTIVE', 'customer', 'free plan activated');
        console.log(
          `[onboarding] Free plan activated for tenant ${tenantId}` +
            (transitioned.ok ? '' : ` (status transition pending: ${transitioned.reason || 'kept'})`)
        );
      }
      return res.json({
        success: true,
        ...activation,
        access: decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured(), lang: langFromRequest(req) }),
      });
    } catch (err: any) {
      recordEventOnboarding(tenantId, 'free plan activation failed', 'system', String(err?.message || err).slice(0, 200));
      return res.status(500).json({ success: false, error: 'Free plan activation failed. The team has been notified.', detail: null });
    }
  });

  /** GET /api/onboarding/categories — the category picker for the KB builder. */
  app.get('/api/onboarding/categories', (_req, res) => {
    return res.json({ success: true, categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label })) });
  });

  /**
   * GET/POST /api/onboarding/contact — business details + WhatsApp consent
   * (Feature 1 Step 4). The WhatsApp number is validated and normalised
   * server-side and stored E.164; responses to a customer NEVER include raw
   * numbers (their own record is masked too — the raw form is only for OPS).
   */
  app.get('/api/onboarding/contact', (req, res) => {
    const tenantId = getTenantId(req);
    ensureRegistered(tenantId, 'customer');
    const record = getContact(tenantId);
    return res.json({
      success: true,
      contact: record
        ? {
            ...record,
            whatsappNumber: record.whatsappNumber ? maskPhone(record.whatsappNumber) : undefined,
            // Instagram fields are real values from Meta — safe to return raw to the owner's own record.
            instagramUsername: record.instagramUsername ?? null,
            instagramAccountId: record.instagramAccountId ?? null,
            instagramStatus: record.instagramStatus ?? null,
            instagramConnectedAt: record.instagramConnectedAt ?? null,
          }
        : null,
    });
  });

  app.post('/api/onboarding/contact', (req, res) => {
    const tenantId = getTenantId(req);
    ensureRegistered(tenantId, 'customer');
    const body = (req.body || {}) as Record<string, unknown>;

    if (body.optOut === true) {
      const record = optOutContact(tenantId, 'customer-self-service');
      recordEventOnboarding(tenantId, 'WhatsApp opt-out recorded', 'customer', 'customer chose to stop onboarding/status messages');
      return res.json({ success: Boolean(record), contact: null, message: 'You will not receive further automated WhatsApp messages.' });
    }

    // Validate everything server-side; frontend checks are a convenience only.
    // contactPerson and whatsappNumber are MANDATORY. businessName is optional
    // (replaced by the Instagram section; kept only for legacy saved data).
    const input: Parameters<typeof validateContactInput>[0] = {
      businessName: body.businessName,
      contactPerson: body.contactPerson,
      whatsappNumber: body.whatsappNumber,
      language: body.language,
      email: body.email,
    };
    const checked = validateContactInput(input);
    if (!checked.ok) {
      return res.status(400).json({ success: false, errors: checked.errors });
    }

    // saveContact applies the consent timestamps itself, so the endpoint only
    // carries the explicit choice + source.
    let consent: { given: boolean; source: 'customer-self-service' } | undefined;
    // Consent is an EXPLICIT boolean; its absence never silently consents.
    if (body.consent !== undefined) {
      if (body.consent !== true && body.consent !== false) {
        return res.status(400).json({ success: false, errors: ['consent must be true or false.'] });
      }
      consent = { given: body.consent as boolean, source: 'customer-self-service' };
    }

    // The validator already produced a safe patch; the consent blob is applied
    // by saveContact itself (timestamp-change rules live there).
    const contactPatch: ContactPatch = { ...checked.patch };
    if (consent) contactPatch.consent = { given: consent.given, source: consent.source };

    // Instagram fields passed from the frontend after a successful Meta connect.
    // These are real values from Meta — never guessed or fabricated.
    const instagramPatch: Partial<ContactRecord> = {};
    if (typeof body.instagramUsername === 'string' && body.instagramUsername.trim()) {
      instagramPatch.instagramUsername = body.instagramUsername.trim();
    }
    if (typeof body.instagramAccountId === 'string' && body.instagramAccountId.trim()) {
      instagramPatch.instagramAccountId = body.instagramAccountId.trim();
    }
    if (typeof body.instagramStatus === 'string') {
      instagramPatch.instagramStatus = body.instagramStatus as ContactRecord['instagramStatus'];
    }
    if (typeof body.instagramConnectedAt === 'string' && body.instagramConnectedAt.trim()) {
      instagramPatch.instagramConnectedAt = body.instagramConnectedAt.trim();
    }
    if (Object.keys(instagramPatch).length) {
      Object.assign(contactPatch, instagramPatch);
    }

    const saved = saveContact(tenantId, contactPatch);
    recordEventOnboarding(tenantId, 'contact details saved', 'customer', `fields=${Object.keys(checked.patch as object).join(',') || 'none'}${Object.keys(instagramPatch).length ? `, instagram=${Object.keys(instagramPatch).join(',')}` : ''}`);

    return res.json({
      success: true,
      contact: {
        ...saved,
        whatsappNumber: saved.whatsappNumber ? maskPhone(saved.whatsappNumber) : undefined,
        instagramUsername: saved.instagramUsername ?? null,
        instagramAccountId: saved.instagramAccountId ?? null,
        instagramStatus: saved.instagramStatus ?? null,
        instagramConnectedAt: saved.instagramConnectedAt ?? null,
      },
    });
  });

  /** GET /api/onboarding/status — the customer's own lifecycle view. */
  app.get('/api/onboarding/status', (req, res) => {
    const tenantId = getTenantId(req);
    const state = getOnboardingState(tenantId);
    const igStatus = getSafeStatus(tenantId);
    const ig = igStatus as any;
    // Honest completion message ONLY when a real connection exists — never
    // because a button was pressed (Feature 1 Step 5 / Feature 4).
    const reallyConnected = Boolean(ig?.connected);
    const lang = state.status === 'REGISTERED' ? langFromRequest(req) : (langFromRequest(req) as Lang);
    return res.json({
      success: true,
      status: state.status,
      statusChangedAt: state.statusChangedAt,
      approved: Boolean(state.approvedAt),
      connected: reallyConnected,
      instagram: reallyConnected
        ? { username: ig.instagramUsername || null, accountIdMasked: ig.instagramAccountId ? `${String(ig.instagramAccountId).slice(0, 5)}***` : null }
        : null,
      connectionMessageKey: reallyConnected ? 'onboarding.connected.success' : null,
      timeline: state.events,
      kb: (() => {
        const draft = getKbDraft(tenantId);
        return draft ? { status: draft.status, version: draft.draft?.version || 0, pendingInput: draft.draft?.pendingInput ?? 0 } : null;
      })(),
    });
  });

  /**
   * POST /api/onboarding/kb-draft — the customer generates/edits their KB draft.
   * Fields stay empty + `needsCustomerInput` when the source data does not
   * contain a fact — the bot never invents one.
   */
  app.post('/api/onboarding/kb-draft', (req, res) => {
    const tenantId = getTenantId(req);
    ensureRegistered(tenantId, 'customer');
    const body = (req.body || {}) as Record<string, unknown>;

    const categories = Array.isArray(body.categories)
      ? (body.categories as unknown[]).map((c) => String(c)).filter((c) => CATEGORIES.some((def) => def.id === c))
      : [];
    if (categories.length === 0) {
      return res.status(400).json({ success: false, error: 'Pick at least one business category.' });
    }

    try {
      if (body.action === 'save' && Array.isArray(body.fields)) {
        const entry = saveDraftEdits(tenantId, { fields: body.fields as never, faqs: Array.isArray(body.faqs) ? (body.faqs as never) : undefined });
        if (!entry) return res.status(404).json({ success: false, error: 'Generate a draft first.' });
        return res.json({ success: true, draft: entry.draft, status: entry.status });
      }
      const entry = generateKbDraft(tenantId, categories);
      return res.json({
        success: true,
        draft: entry.draft,
        status: entry.status,
        note: `${entry.draft?.pendingInput ?? 0} field(s) marked "Needs customer input" — nothing was invented.`,
      });
    } catch (err: any) {
      recordEventOnboarding(tenantId, 'KB draft generation failed', 'system', String(err?.message || err).slice(0, 200));
      return res.status(500).json({ success: false, error: 'Draft generation failed. Try again or contact the team.' });
    }
  });

  // Public pricing page (the front door for a business owner).
  app.get('/plans', (req, res) => {
    const lang = langFromRequest(req);
    if (req.query.lang) res.setHeader('Set-Cookie', langCookieHeader(lang));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderPlansPage(getPurchasablePlans(), isPaymentsConfigured(), lang));
  });

  // The tenant's own plan, plus whether their bot is allowed to run.
  app.get('/api/subscription', (req, res) => {
    const tenantId = getTenantId(req);
    const subscription = findSubscription(tenantId);
    return res.json({
      success: true,
      subscription,
      plan: subscription ? getPlan(subscription.planId) : null,
      access: decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured(), lang: langFromRequest(req) }),
      // Lets the dashboard offer "Payment check karo" only when one is actually
      // waiting, instead of showing a button that answers 404.
      pendingOrder: getPendingOrder(tenantId),
      plans: getPurchasablePlans(),
      trialDays: TRIAL_DAYS,
      // Whether *the caller* is one of the owner accounts — the dashboard uses
      // this to decide if the Ops Console tab exists at all. The tab is a
      // convenience; /api/owner/tenants checks it again on the server.
      isOwner: isOwnerIdentity(
        (req as RequestWithTenant).userId || '',
        (req as RequestWithTenant).userEmail
      ),
      payments: getPublicPaymentConfig(),
      // Real platform counters. The dashboard shows a starting figure plus these
      // deltas, so the numbers on screen move as accounts and messages arrive
      // instead of sitting frozen at a template value forever.
      platformStats: {
        paidAccounts: getSubscriptionStats().active,
        trialingAccounts: getSubscriptionStats().trialing,
        totalAccounts: getSubscriptionStats().total,
        conversations: getChatStoreStats().conversations,
        messages: getChatStoreStats().messages,
        newLeads: getLeadStats().newLeads,
      },
    });
  });

  /**
   * The customer's own name for their account (tenant).
   *
   * A tenant id is a Firebase uid — 28 opaque characters that nobody can read
   * aloud or search for. This is the readable identity the customer picks on
   * their first sign-in, and the name every screen and every owner list uses from
   * then on. Set once by design (see `profileStore`); the owner resets it from the
   * Ops Console when it genuinely has to change.
   */
  app.get('/api/profile', (req, res) => {
    const tenantId = getTenantId(req);
    const profile = getProfile(tenantId);
    return res.json({
      success: true,
      tenantId,
      username: profile?.username || null,
      usernameSetAt: profile?.createdAt || null,
      // The dashboard asks once and cannot skip it: a name everybody can read IS
      // the feature, so an optional field would just recreate the uid problem.
      canSet: !profile,
      isOwner: isOwnerIdentity(
        (req as RequestWithTenant).userId || '',
        (req as RequestWithTenant).userEmail
      ),
    });
  });

  app.post('/api/profile/username', (req, res) => {
    const tenantId = getTenantId(req);
    try {
      const record = setUsername(tenantId, req.body?.username, 'customer');
      console.log(`USERNAME_SET: tenant ${tenantId} is now @${record.username}`);
      return res.json({
        success: true,
        username: record.username,
        usernameSetAt: record.createdAt,
      });
    } catch (err) {
      const code = (err as Error & { code?: string }).code || 'USERNAME_INVALID';
      const status = code === 'USERNAME_LOCKED' ? 409 : 400;
      console.warn(`USERNAME_REJECTED: tenant ${tenantId} — ${code}`);
      return res.status(status).json({ success: false, code, error: (err as Error).message });
    }
  });

  /**
   * Every account at a glance — the Ops Console.
   *
   * This is the one read path that deliberately crosses tenants, so it is the
   * one path with an extra gate: the caller must be inside OWNER_TENANT_IDS.
   * AttachTenant has already verified the token by the time we get here (an
   * anonymous request never reaches this handler), so "owner" means a real
   * signed-in uid on that list — not a header anyone can set. Read-only, and
   * every look is logged, because a support tool that can see all customers
   * should leave a trail. "Owner" here means the uid *or* the verified email on
   * OWNER_TENANT_IDS / OWNER_EMAILS, so an owner listed by address still gets in
   * without having to hunt for their uid first.
   */
  /**
   * Task 2 diagnostics: recent failed DM replies with their fase category.
   * Owner-only (same gate as /api/owner/tenants) — tenants must never read
   * each other's failure history. Payload is already redacted by the store:
   * sender is a hash, message text is never present, secrets are stripped.
   */
  app.get('/api/owner/message-traces', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to read message traces`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    return res.json({ success: true, ...getTraceHealth() });
  });

  // ==============================================================
  // OPS ONBOARDING BOARD — owner-only (Feature 3 / Feature 4 / Feature 5).
  // Same verified-uid/email owner gate as the other /api/owner/* endpoints.
  // ===============================================================

  /** GET /api/owner/onboarding — real metrics + per-customer board rows. */
  app.get('/api/owner/onboarding', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to read the onboarding board`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const rows = listOnboardingStates().map((state) => {
      const contact = getContact(state.tenantId);
      const draft = getKbDraft(state.tenantId);
      const profile = getProfile(state.tenantId);
      const whatsappNumberMasked = contact?.whatsappNumber ? maskPhone(contact.whatsappNumber) : null;
      return {
        tenantId: state.tenantId,
        customerName: contact?.businessName || profile?.username || null,
        status: state.status,
        statusChangedAt: state.statusChangedAt,
        registeredAt: state.events[0]?.at || null,
        approvedAt: state.approvedAt,
        contact: {
          businessName: contact?.businessName || null,
          contactPerson: contact?.contactPerson || null,
          whatsappNumber: whatsappNumberMasked,
          language: contact?.language || null,
          consentGiven: Boolean(contact?.consent.given),
          consentAt: contact?.consent.at || null,
          optedOut: Boolean(contact?.optOut),
        },
        kb: draft
          ? {
              status: draft.status,
              version: draft.draft?.version || 0,
              pendingInput: draft.draft?.pendingInput ?? 0,
              unverified: draft.draft?.unverified || [],
              approvedBy: draft.approvedBy,
              approvedAt: draft.approvedAt,
            }
          : null,
      };
    });

    return res.json({
      success: true,
      metrics: getOnboardingMetrics(),
      rows,
      whatsapp: {
        providerConfigured: isCustomerWhatsAppProviderConfigured(),
        detail: providerStatusDetail(),
      },
    });
  });

  // ==============================================================
  // PUBLIC BANNER — owner designs it in Ops, everyone sees it on the
  // public main page. Any size image, Portrait/Landscape tag.
  // ===============================================================

  /** GET /api/banner — public: the active banner (or null when none is saved). */
  app.get('/api/banner', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const banner = getPublicBanner();
    res.json({ success: true, banner });
  });

  /** GET /api/banner/image — the banner bytes. Sent as a real image URL (not an
   * inlined data URL) so the main page HTML stays a few KB instead of carrying
   * a 1–3 MB string, and so the browser can cache the picture. The `v=` stamp
   * in the page's <img> changes whenever the owner saves a new banner. */
  app.get('/api/banner/image', (_req, res) => {
    const banner = getOwnerBanner();
    if (!banner?.dataUrl) return res.status(404).end();
    const semicolon = banner.dataUrl.indexOf(';');
    const comma = banner.dataUrl.indexOf(',');
    if (semicolon < 0 || comma < 0) return res.status(404).end();
    const mime = banner.dataUrl.slice(5, semicolon);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(banner.dataUrl.slice(comma + 1), 'base64');
    } catch {
      return res.status(500).end();
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Short cache, keyed by the ?v= stamp: replacing the banner is visible at once.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Length', String(bytes.length));
    return res.end(bytes);
  });

  /** POST /api/owner/banner — owner saves/replaces the banner. */
  app.post('/api/owner/banner', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to save the banner`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This action is limited to the account owner.' });
    }
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const saved = saveBanner({
        dataUrl: String(body.dataUrl || ''),
        mode: body.mode === 'portrait' ? 'portrait' : 'landscape',
        filename: String(body.filename || ''),
      });
      console.log(`OWNER_ACTION: banner save by ${viewerEmail || viewer}`);
      return res.json({ success: true, banner: { ...saved, dataUrl: undefined } as Record<string, unknown> });
    } catch (err) {
      if (err instanceof BannerInputError) return res.status(400).json({ success: false, error: err.message });
      console.error('banner save failed:', err);
      return res.status(500).json({ success: false, error: 'The banner could not be saved.' });
    }
  });

  /** DELETE /api/owner/banner — owner removes the banner from the public page. */
  app.delete('/api/owner/banner', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to delete the banner`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This action is limited to the account owner.' });
    }
    const removed = deleteBanner();
    console.log(`OWNER_ACTION: banner delete by ${viewerEmail || viewer} (had=${removed})`);
    return res.json({ success: true, removed });
  });

  // ==============================================================
  // HELP-VIDEO LIBRARY — the owner's own demo links (Step 6). Ops lists
  // them; every "copy into WhatsApp" reply step pulls the freshest link.
  // ===============================================================

  /** Owner list (with labels); newest first. */
  app.get('/api/owner/videos', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }
    res.json({ success: true, videos: listVideos() });
  });

  /** Owner adds a video link. */
  app.post('/api/owner/videos', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This action is limited to the account owner.' });
    }
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const entry = addVideo(String(body.label || ''), String(body.url || ''));
      console.log(`OWNER_ACTION: video added by ${viewerEmail || viewer} id=${entry.id}`);
      res.json({ success: true, video: entry });
    } catch (err) {
      if (err instanceof VideoInputError) return res.status(400).json({ success: false, error: err.message });
      console.error('video add failed:', err);
      res.status(500).json({ success: false, error: 'The video link could not be saved.' });
    }
  });

  /** Owner removes a video link. */
  app.delete('/api/owner/videos/:id', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This action is limited to the account owner.' });
    }
    const removed = deleteVideo(String(req.params.id || ''));
    if (!removed) return res.status(404).json({ success: false, error: 'Video not found.' });
    console.log(`OWNER_ACTION: video deleted by ${viewerEmail || viewer} id=${String(req.params.id || '')}`);
    res.json({ success: true, removed });
  });

  /** GET /api/owner/onboarding/detail/:tenantId — one customer, full timeline + raw number. */
  app.get('/api/owner/onboarding/detail/:tenantId', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }
    const tenantId = String(req.params.tenantId || '');
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(tenantId)) {
      return res.status(400).json({ success: false, error: 'Invalid customer id.' });
    }
    const _board = listOnboardingStates();
    if (!_board.some((s) => s.tenantId === tenantId)) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }
    const contact = getContact(tenantId);
    return res.json({
      success: true,
      state: getOnboardingState(tenantId),
      contact: contact || null, // owner is the authorized viewer for the raw number
      kb: getKbDraft(tenantId),
      outbox: listOutbox(tenantId),
    });
  });

  /**
   * POST /api/owner/onboarding/actions — the authorized quick actions.
   * Consequential actions are idempotent and every result is recorded; the
   * response only says "done" when the backend actually did it.
   */
  app.post('/api/owner/onboarding/actions', async (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This action is limited to the account owner.' });
    }
    const actorEmail = viewerEmail || viewer;
    const body = (req.body || {}) as Record<string, unknown>;
    const tenantId = String(body.tenantId || '');
    const action = String(body.action || '');
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(tenantId)) {
      return res.status(400).json({ success: false, error: 'Invalid customer id.' });
    }
    const actor: OnboardingActor = 'ops';
    const state = getOnboardingState(tenantId);
    const contact = getContact(tenantId);
    const customerName = getProfile(tenantId)?.username || contact?.businessName || tenantId.slice(0, 10);

    try {
      switch (action) {
        case 'request-info': {
          const t = transitionOnboarding(tenantId, 'NEEDS_CUSTOMER_ACTION', actor, String(body.reason || 'OPS requested details').slice(0, 200));
          const msg = queueWhatsAppMessage({ tenantId, template: 'additional-info-required', customerName, lang: contact?.language || 'en', context: 'request-info' });
          return res.json({ success: t.ok, action, status: t.ok ? t.state.status : state.status, reason: t.reason, notification: msg.message.status });
        }
        case 'mark-review-pending': {
          const t = transitionOnboarding(tenantId, 'BUSINESS_REVIEW_PENDING', actor, 'mark-account-review');
          return res.json({ success: t.ok, status: t.ok ? t.state.status : state.status, reason: t.reason });
        }
        case 'regenerate-draft': {
          const cats = Array.isArray(body.categories)
            ? (body.categories as unknown[]).map(String).filter((c) => CATEGORIES.some((def) => def.id === c))
            : getKbDraft(tenantId)?.draft?.categories || ['other'];
          const entry = generateKbDraft(tenantId, cats);
          return res.json({ success: true, action, status: entry.status, draft: entry.draft });
        }
        case 'approve-kb': {
          const approved = approveKbDraft(tenantId, String(actorEmail));
          if (!approved.ok) {
            recordEventOnboarding(tenantId, 'KB approval blocked', 'ops', approved.reason || 'unknown reason');
            return res.status(409).json({ success: false, error: approved.reason || 'Approval blocked.' });
          }
          return res.json({ success: true, kbStatus: approved.entry?.status, approvedAt: approved.entry?.approvedAt });
        }
        case 'request-kb-changes': {
          const entry = rejectKbDraft(tenantId, String(body.reason || 'Changes requested by OPS').slice(0, 200));
          return res.json({ success: Boolean(entry), kbStatus: entry?.status || null });
        }
        case 'approve-customer': {
          // Honest gate: a customer can only be APPROVED when the connections
          // and reviews below genuinely happened (Feature 4):
          const kb = getKbDraft(tenantId);
          const kbApproved = kb?.status === 'approved';
          const ig = getSafeStatus(tenantId) as any;
          const connected = Boolean(ig?.connected);
          if (!connected) {
            recordEventOnboarding(tenantId, 'approval blocked: Instagram not connected', 'ops', 'connected check');
            return res.status(409).json({ success: false, error: 'Approval blocked: the Instagram account is not actually connected.' });
          }
          if (!kbApproved) {
            recordEventOnboarding(tenantId, 'approval blocked: Knowledge Base not approved', 'ops', 'KB approval check');
            return res.status(409).json({ success: false, error: 'Approval blocked: the Knowledge Base has not been approved yet.' });
          }
          transitionOnboarding(tenantId, 'AWAITING_APPROVAL', actor, 'pre-approval state sync');
          const t = transitionOnboarding(tenantId, 'APPROVED', actor, `approved by ${actorEmail}`);
          const notification = t.ok
            ? queueWhatsAppMessage({ tenantId, template: 'approval-completed', customerName, lang: contact?.language || 'en', context: 'approved' })
            : null;
          return res.json({ success: t.ok, status: t.ok ? t.state.status : state.status, reason: t.reason, notification: notification?.message.status || null });
        }
        case 'send-whatsapp': {
          const template = String(body.template || '') as TemplateId;
          if (!['instagram-connected', 'permission-required', 'approval-completed', 'additional-info-required'].includes(template)) {
            return res.status(400).json({ success: false, error: 'Unknown WhatsApp template.' });
          }
          const msg = queueWhatsAppMessage({
            tenantId,
            template,
            customerName,
            lang: String(body.lang || contact?.language || 'en') as Lang,
            context: String(body.context || template),
            allowDuplicate: body.allowDuplicate === true,
          });
          return res.json({
            success: msg.ok,
            status: msg.message.status,
            reason: msg.reason,
            providerConfigured: isCustomerWhatsAppProviderConfigured(),
            manualCopy: msg.message.text,
          });
        }
        case 'mark-reconnect-needed': {
          const t = transitionOnboarding(tenantId, 'INSTAGRAM_CONNECTION_PENDING', actor, 'owner requested reconnection');
          return res.json({ success: t.ok, status: t.ok ? t.state.status : state.status, reason: t.reason });
        }
        default:
          return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (err: any) {
      recordEventOnboarding(tenantId, `OPS action failed: ${action}`, 'system', String(err?.message || err).slice(0, 200));
      return res.status(500).json({ success: false, error: 'Action failed. Check the console log.' });
    }
  });

  /**
   * Owner-only Customer Health monitor for the Ops Console "System Health"
   * section: per-tenant lifecycle facts (real recorded events only), overall
   * health status, open incidents and the actual alert-channel setup state.
   * Same owner gate as /api/owner/tenants: verified uid/email on the owner list.
   */
  app.get('/api/owner/health', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to read system health`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const overview = buildTenantOverview(langFromRequest(req));
    const chatCounts = getChatCountsByTenant();
    const rootInput: RootCauseAccount[] = [];
    const rows = overview.rows.map((row) => {
      // Overall health from REAL fields only:
      //  - Critical: token rejected by Meta, confirmed recent error, or an open
      //    critical incident for this tenant.
      //  - Disconnected: no connected Instagram account.
      //  - Warning: (intentionally paused bot is NOT a fault — it stays
      //    "healthy-but-paused" as a separate flag) stale verification,
      //    recent uncertain sends, or open non-critical incidents.      //      - Healthy: connected, no recent failures.
      //  - Unknown: no inbound events observed since process start.
      const h = row.health;
      const recentWindowFail = h.lastSendFailAt && Date.now() - Date.parse(h.lastSendFailAt) <= 24 * 3600_000;
      const facts = getTenantHealthFacts(row.tenantId);
      const ambiguousLastAt = facts.events.find((e2) => e2.kind === 'send-fail' && e2.ambiguous)?.at || null;
      const verdict = evaluateSilentBot({
        tenantId: row.tenantId,
        customerName: row.username || row.instagram.username || row.tenantId.slice(0, 10),
        connected: row.instagram.connected,
        liveState: row.instagram.liveState,
        botEnabled: row.bot.allowed && !row.bot.paused,
        humanTakeover: (chatCounts[row.tenantId]?.takeovers || 0) > 0,
        lastInboundAt: h.lastInboundAt,
        lastSendOkAt: h.lastSendOkAt,
        lastSendFailAt: h.lastSendFailAt,
        ambiguousLastAt,
        maxSilenceHours: Math.max(1, parseInt(process.env.ALERT_SILENCE_MAX_HOURS || '6', 10) || 6),
      });
      let overall: 'healthy' | 'warning' | 'critical' | 'disconnected' | 'unknown' = 'unknown';
      if (!row.instagram.connected) overall = 'disconnected';
      else if (row.instagram.liveState === 'NEEDS_REAUTH') overall = 'critical';
      else if (recentWindowFail && !h.ambiguousLastAt) overall = 'critical';
      else if (row.instagram.verificationStale || h.lastSendFailAt || h.lastErrorAt || row.attention.includes('instagramError')) overall = 'warning';
      else if (verdict.alert) overall = 'warning';
      else if (h.lastInboundAt || h.lastSendOkAt) overall = 'healthy';

      rootInput.push({
        connected: row.instagram.connected,
        liveState: row.instagram.liveState,
        botEnabled: row.bot.allowed && !row.bot.paused,
        botPaused: row.bot.paused,
        needsPlan: row.bot.needsPlan,
        overall,
      });

      return {
        tenantId: row.tenantId,
        customerName: row.username || row.instagram.username || null,
        instagramAccountIdMasked: row.instagram.accountId ? row.instagram.accountId.slice(0, 5) + '***' : null,
        connected: row.instagram.connected,
        liveState: row.instagram.liveState,
        botEnabled: row.bot.allowed && !row.bot.paused,
        botPaused: row.bot.paused,
        lastInboundAt: h.lastInboundAt,
        lastSendOkAt: h.lastSendOkAt,
        lastSendFailAt: h.lastSendFailAt,
        lastSendFailCategory: h.lastSendFailCategory,
        lastErrorAt: h.lastErrorAt,
        lastErrorCategory: h.lastErrorCategory,
        lastErrorDetail: h.lastErrorDetail,
        ambiguousLastAt,
        overall,
      };
    });

    const incidents = listIncidents();
    // The single plain-language "why has the project stopped" answer for the
    // ops notification banner (server/rootCause.ts) — same real facts as the
    // table below, reduced to the ONE reason that covers the most accounts.
    const rootCause = explainRootCause(rootInput, incidents);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      rows,
      rootCause,
      // Incidents for the lifecycle UI (detected → acknowledged → investigating → resolved).
      incidents: incidents.slice(0, 100),
      incidentSummary: { open: getOpenIncidentCount() },
      thresholds: ALERT_DEFAULTS,
      channels: getAlertChannelStatus(),
    });
  });

  /**
   * Owner incident lifecycle actions: acknowledge / investigate / resolve.
   * Owner-gated like every other owner route; the acting viewer is audited.
   */
  app.post('/api/owner/health/incident', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;
    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to update a health incident`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }
    const id = String(req.body?.id || '').trim();
    const status = String(req.body?.status || '').trim() as IncidentStatus;
    if (!id || !['detected', 'acknowledged', 'investigating', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, code: 'INCIDENT_BAD_REQUEST', error: 'id and a valid status are required.' });
    }
    const updated = setIncidentStatus(id, status, viewer);
    if (!updated) {
      console.warn(`OWNER_ACTION: incident ${id} not found or already resolved for ${viewer}`);
      return res.status(404).json({ success: false, code: 'INCIDENT_NOT_FOUND', error: 'Incident not found (or already resolved).' });
    }
    console.log(`OWNER_ACTION: incident ${id} → ${status} by ${viewer}`);
    return res.json({ success: true, incident: updated });
  });

  app.get('/api/owner/tenants', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to list tenants`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const overview = buildTenantOverview(langFromRequest(req));
    console.log(
      `OWNER_CONSOLE: ${viewer} listed ${overview.rows.length} tenant(s) — ` +
        `${overview.summary.needsAttention} need attention, ` +
        `${overview.summary.testerRequestsPending} tester invite(s) pending`
    );
    return res.json({
      success: true,
      // The queue's primary action is "type this handle into Meta", so the exact
      // Roles page travels with the data instead of being hardcoded in the
      // console. Built from the configured app id, it follows the app if it is
      // ever re-provisioned. Null (and the button hides) if no app id is set.
      metaRolesUrl: getMetaSetupLinks()?.appRoles ?? null,
      // The app an invite has to be accepted on, spelled out. The console shows
      // both ids next to each tester request, because the mistake that broke
      // real connects was inviting on a *different* app of the same developer
      // account — which looks identical from inside Instagram.
      oauthApp: getOAuthAppIdentity(),
      // DMs delivered for accounts that are not connected here. Ready-to-show
      // alarms rather than something the owner has to find in the server log.
      unroutedDeliveries: getUnroutedDeliveryStats(),
      // Bot defence: how many bot-to-bot replies were refused, and by which rule.
      // Read-only counters plus a small in-memory ring buffer — this is how the
      // owner confirms a loop actually stopped.
      botGuard: {
        ...getBotGuardStats(),
        recent: getRecentGuardEvents(),
      },
      // Which accounts the owner has switched off, and whether the global brake
      // is on. Cheap: one JSON file.
      botControl: getBotControlSnapshot(),
      ...overview,
    });
  });

  /**
   * The owner gate for the three list-hygiene routes below, in one place.
   *
   * All three take a `tenantId` straight from the request body, so "am I allowed to
   * call this" and "is this a sane account to touch" have to be asked on every one
   * of them. Returns the reason to refuse, or null to carry on.
   */
  function refuseTenantRemoval(req: any, res: any, action: string): string | null {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to ${action} an account`
      );
      res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
      return null;
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'A tenant id is required.' });
      return null;
    }

    // The owner's own account cannot leave the list: it is the account that opens
    // this console, and its row is the only place OWNER_TENANT_IDS is visible.
    if (getOwnerTenantIds().includes(tenantId)) {
      res.status(400).json({
        success: false,
        code: 'OWNER_ACCOUNT',
        error: 'The owner account cannot be hidden or deleted.',
      });
      return null;
    }

    return tenantId;
  }

  /**
   * Take an account off the console's list — without deleting anything.
   *
   * The case it exists for: a customer stops paying, or asks to be taken off while
   * they sort something out. Their Instagram connection, inbox, leads and settings
   * are all left exactly as they are, so the bot keeps working if their plan is
   * still live and nothing surprises them; only the owner's list changes. Restore
   * puts the row straight back.
   */
  app.post('/api/owner/tenants/hide', (req, res) => {
    const tenantId = refuseTenantRemoval(req, res, 'hide');
    if (!tenantId) return;

    const viewer = (req as RequestWithTenant).userId;
    const connection = listConnections().find((c) => c.tenantId === tenantId);
    const subscription = findSubscription(tenantId);
    // Hiding is idempotent, so the same button pressed twice keeps the original
    // "hidden at" — the answer says whether this press changed anything.
    const alreadyHidden = isAccountHidden(tenantId);

    try {
      const record = hideAccount({
        tenantId,
        hiddenBy: String((req as RequestWithTenant).userEmail || viewer),
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        instagramUsername: connection?.instagramUsername,
        planName: subscription ? getPlan(subscription.planId)?.name || subscription.planId : undefined,
        planStatus: subscription?.status,
      });

      console.log(
        `OWNER_ACTION: tenant ${tenantId} HIDDEN by ${viewer} (data untouched, restore available)`
      );
      return res.json({ success: true, hidden: record, alreadyHidden });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  /** Put a hidden account back on the list. Never touches any store but its own. */
  app.post('/api/owner/tenants/restore', (req, res) => {
    const tenantId = refuseTenantRemoval(req, res, 'restore');
    if (!tenantId) return;

    const viewer = (req as RequestWithTenant).userId;
    const restored = restoreAccount(tenantId);
    if (!restored) {
      return res.status(404).json({ success: false, error: 'That account is not hidden.' });
    }

    console.log(`OWNER_ACTION: tenant ${tenantId} RESTORED to the list by ${viewer}`);
    return res.json({ success: true, tenantId });
  });

  /**
   * Delete an account for good: every server-side record for it, gone.
   *
   * The one irreversible route in the console, so it takes two things the other
   * write routes do not:
   *
   *   - a `confirm` value that has to equal the account's Instagram handle or its
   *     tenant id. A typed confirmation cannot be produced by a mis-click, a
   *     stale tab or a stray retry, which is exactly the failure mode that makes
   *     an irreversible button dangerous;
   *   - a tombstone, written after the purge succeeds, that stops the same account
   *     from signing in again and claiming a fresh free trial.
   *
   * What it does NOT do: touch the customer's Instagram account (only Meta can),
   * or their Firebase sign-in (the server has no authority over it).
   */
  app.post('/api/owner/tenants/delete', (req, res) => {
    const tenantId = refuseTenantRemoval(req, res, 'delete');
    if (!tenantId) return;

    const viewer = (req as RequestWithTenant).userId;
    const connection = listConnections().find((c) => c.tenantId === tenantId);
    const handle = (connection?.instagramUsername || '').replace(/^@/, '');

    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
    if (!deleteConfirmMatches(tenantId, connection?.instagramUsername, confirm)) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRM_MISMATCH',
        error: handle
          ? `Type @${handle} (or the tenant id) to confirm the delete.`
          : 'Type the tenant id to confirm the delete.',
        expected: handle ? `@${handle}` : tenantId,
      });
    }

    const result = removeTenantCompletely({
      tenantId,
      removedBy: String((req as RequestWithTenant).userEmail || viewer),
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });

    console.warn(
      `OWNER_ACTION: tenant ${tenantId} DELETED by ${viewer} — ` +
        `ig=${result.instagramUsername || '(none)'} chats=${result.deleted.chats} ` +
        `leads=${result.deleted.leads} plan=${result.deleted.subscription} kbGaps=${result.deleted.kbGaps} ` +
        `(tombstone written; a new trial is now refused for this account)`
    );
    return res.json({ success: true, removed: result });
  });

  /**
   * Clear the billing gate for accounts a used-up trial has locked (owner).
   *
   * The failure this exists for is the quietest one this product had: a host with
   * payments switched off promises "every account keeps its bot running (no plan
   * required)", and that promise holds for every account *except* the ones that
   * started a trial and let it run out. Their `trial` row still exists, so
   * `decideAccess` sees an expired period and blocks the bot, while the console
   * has no button that clears a row: the only removal action was the permanent
   * delete, which erases the connection, the inbox and the knowledge base and
   * writes a tombstone that refuses every future trial. An operator looking at a
   * fleet of blocked accounts therefore had two wrong answers — delete them and
   * lose their data, or renew each one by hand — and no right one.
   *
   * So this route removes **only** the billing row (and any abandoned checkout),
   * for one account or for all of them. Connections, inboxes, leads, knowledge
   * bases and trials are left exactly as they are, no tombstone is written, and
   * the account can start a fresh trial with its history intact.
   *
   * The all-accounts call carries a typed confirmation for the same reason a
   * delete does: it is the one form of this action that can take a *paying*
   * customer's row by accident. What has to be typed is the server's own count of
   * the rows it is about to clear, so a number read from a tab opened before the
   * last signup no longer matches and the reset is refused with the fresh count.
   */
  app.post('/api/owner/billing/reset', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to reset billing rows`
      );
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const overview = buildTenantOverview(langFromRequest(req));
    const rowByTenant = new Map(overview.rows.map((row) => [row.tenantId, row]));
    const billingTenantIds = listSubscriptions().map((sub) => sub.tenantId);

    const requested = Array.isArray(req.body?.tenantIds)
      ? (req.body.tenantIds as unknown[])
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      : [];
    const targeted = requested.length > 0;

    // Which rows may be touched is decided in `server/billingReset.ts`, not here:
    // that rule decides whether a paying customer's row can be cleared, and it has
    // to be callable from a check rather than only from a signed-in owner's HTTP
    // request. The fleet-wide form (no ids named) starts from every billing row and
    // lets that function drop the owner's own accounts.
    const { candidates, skipped } = planBillingReset({
      requested: targeted ? requested : billingTenantIds,
      billingTenantIds,
      ownerTenantIds: [...getOwnerTenantIds(), ...overview.rows.filter((row) => row.isOwner).map((row) => row.tenantId)],
      knownTenantIds: overview.rows.map((row) => row.tenantId),
    });

    const describe = (tenantId: string) => {
      const subscription = findSubscription(tenantId);
      const row = rowByTenant.get(tenantId);
      const planId = subscription?.planId || '';
      return {
        tenantId,
        username: row?.instagram.username ?? null,
        planId,
        planName: getPlan(planId)?.name || planId,
        status: subscription?.status || '',
        periodEndsAt: subscription?.currentPeriodEnd ?? null,
        trialUsed: Boolean(subscription?.trialUsedAt),
        /** Billing gate as it stands right now, before anything is written. */
        botBlockedNow: row ? !row.bot.allowed : null,
        botAllowedAfter: decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured() })
          .allowed,
      };
    };

    // The dry run is the whole safety net for the all-accounts call: the owner
    // sees the exact rows, the effects, and the number they then have to type.
    if (req.body?.dryRun === true) {
      return res.json({
        success: true,
        dryRun: true,
        resetCount: candidates.length,
        reset: candidates.map(describe),
        skipped,
      });
    }

    if (!candidates.length) {
      return res.status(400).json({
        success: false,
        code: 'NOTHING_TO_RESET',
        error: 'No account here has a billing row to clear.',
        resetCount: 0,
        skipped,
      });
    }

    if (!targeted && !billingResetConfirmMatches(candidates.length, req.body?.confirm)) {
      return res.status(400).json({
        success: false,
        code: 'CONFIRM_MISMATCH',
        error: `Type ${candidates.length} to confirm clearing the billing row of ${candidates.length} account(s).`,
        expected: String(candidates.length),
        resetCount: candidates.length,
        skipped,
      });
    }

    const before = candidates.map(describe);
    const removed = resetSubscriptions(candidates);

    console.warn(
      `OWNER_ACTION: billing reset by ${viewerEmail || viewer} — cleared ${removed.length} row(s): ` +
        `${removed.map((row) => `${row.tenantId}:${row.planId}/${row.status}`).join(', ') || 'none'} ` +
        `(connections, inboxes, leads and knowledge bases untouched; no tombstone, so these accounts can trial again)`
    );

    const allowedAfter = new Map(
      candidates.map((tenantId) => [
        tenantId,
        decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured() }).allowed,
      ])
    );

    return res.json({
      success: true,
      dryRun: false,
      resetCount: removed.length,
      reset: before.map((row) => ({
        ...row,
        botAllowedAfter: allowedAfter.get(row.tenantId) ?? row.botAllowedAfter,
      })),
      skipped,
    });
  });

  /**
   * "Why is this account not connected — and what do I do?" in one press (owner).
   *
   * The console could already show that an account had no connection. It could not
   * say which of four very different things was wrong, and two of those four are
   * invisible from outside: a refusal at Instagram's consent screen leaves no
   * server-side trace at all, and a customer who never pressed Connect looks
   * identical to one whose token Meta rejected.
   *
   * So this does both halves:
   *   - it performs the fixes this server is allowed to make (re-check a stored
   *     token against Meta, and keep the handle the customer was trying with, so
   *     the invite queue has it);
   *   - it hands back the classification plus the exact state of play, for the
   *     console to turn into steps in the owner's own language.
   *
   * It cannot connect the account: only the customer can press Allow, and Meta has
   * no API for adding an Instagram tester. That is why the answer is a plan and
   * not a promise.
   */
  /**
   * Owner console — the "customer bole reply nahi aaya" panel. Lists every
   * queued send (with its last error) and lets the owner force one due now,
   * flush the whole queue, or drop a job the customer no longer needs.
   */
  app.post('/api/owner/retry-queue', async (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to read the retry queue`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const action = typeof req.body?.action === 'string' ? req.body.action : 'list';

    if (action === 'list') {
      return res.json({ success: true, jobs: listRetryJobs(), stats: getRetryQueueStats() });
    }

    if (action === 'retry' || action === 'retryAll') {
      let promoted = 0;
      if (action === 'retry') {
        const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
        if (!jobId) return res.status(400).json({ success: false, error: 'A jobId is required.' });
        promoted = promoteRetryJob(jobId) ? 1 : 0;
      } else {
        for (const job of listRetryJobs()) {
          if (promoteRetryJob(job.jobId)) promoted += 1;
        }
      }
      console.log(`OWNER_ACTION: retry-queue ${action} by ${viewer} — promoted ${promoted} job(s)`);
      // Run the due jobs through the exact same sender as the sweeper, so a
      // manual retry cannot take a different (weaker) path than the automatic one.
      const run = await processDueRetryJobs(retrySender).catch((err) => {
        console.error('[retryQueue] manual retry error:', err?.message || err);
        return { processed: 0, delivered: 0, failures: 0 };
      });
      return res.json({ success: true, promoted, run, jobs: listRetryJobs(), stats: getRetryQueueStats() });
    }

    if (action === 'discard') {
      const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
      if (!jobId) return res.status(400).json({ success: false, error: 'A jobId is required.' });
      const dropped = discardRetryJob(jobId);
      console.log(`OWNER_ACTION: retry-queue discard job=${jobId} by ${viewer} — ${dropped ? 'removed' : 'already gone'}`);
      return res.json({ success: true, dropped, jobs: listRetryJobs(), stats: getRetryQueueStats() });
    }

    return res.status(400).json({ success: false, error: 'Unknown action.' });
  });

  /**
   * Owner console — extend a tenant's current period ("trial khatam ho gaya")
   * by N days without wiping the billing row the way billing/reset does.
   */
  app.post('/api/owner/tenants/trial-extend', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to extend a subscription`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const days = Number(req.body?.days);
    if (!tenantId) return res.status(400).json({ success: false, error: 'A tenant id is required.' });

    try {
      const extension = extendSubscriptionDays(tenantId, days);
      console.log(
        `OWNER_ACTION: trial-extend tenant=${tenantId} +${extension.days}d by ${viewer} — ` +
          `${extension.previousEnd} -> ${extension.newEnd}`
      );
      return res.json({ success: true, extension });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message || 'Could not extend this subscription.' });
    }
  });

  /**
   * Owner console — KNOWN_ISSUES A4: when two tenants hold one Instagram
   * account its DMs can only reach one of them. This is the human decision
   * behind a button: pick the tenant that keeps the account. The shadowed
   * tenant keeps all its data; it just stops receiving (and silently dropping)
   * that account's DMs. The decision persists across restarts.
   */
  app.post('/api/owner/connections/route', (req, res) => {
    const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;

    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to route a shared account`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    // The console's shared-account panel reads the roster before any decision
    // exists: `list` is a pure read and never touches the routing overrides.
    if (req.body?.action === 'list') {
      return res.json({ success: true, shared: getSharedInstagramAccounts() });
    }

    const instagramAccountId =
      typeof req.body?.instagramAccountId === 'string' ? req.body.instagramAccountId.trim() : '';
    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!instagramAccountId || !tenantId) {
      return res
        .status(400)
        .json({ success: false, error: 'Both an Instagram account id and a tenant id are required.' });
    }

    try {
      const routing = resolveSharedAccountRouting(instagramAccountId, tenantId);
      console.log(
        `OWNER_ACTION: connections/route ${instagramAccountId} -> tenant ${tenantId} by ${viewer} (was ${routing.before || 'unrouted'})`
      );
      return res.json({ success: true, routing, shared: getSharedInstagramAccounts() });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message || 'Could not route this account.' });
    }
  });

  app.post('/api/owner/tenants/connect-fix', async (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to diagnose a connect`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    const readiness = buildOAuthReadiness(req);
    // The URI the server itself will send to Meta — never one guessed from the
    // browser, because Meta compares it byte for byte against the app's whitelist.
    const redirectUri = getOAuthRedirectUri(req);
    const autoFixed: string[] = [];

    // 1) A stored token is worth re-asking about. `lastVerifiedAt` only records the
    //    moment of connect; a token Meta killed afterwards left the row saying
    //    CONNECTED, and an account whose check simply never ran reads as unhealthy
    //    even when the token is fine. One `GET /me` settles both.
    if (getSafeStatus(tenantId).isConnected) {
      const health = await checkConnectionHealth(tenantId);
      autoFixed.push(`liveCheck:${health.state}`);
      console.log(
        `CONNECT_FIX: tenant ${tenantId} live check → ${health.state}` +
          (health.detail ? ` — ${health.detail}` : '')
      );
    }

    // 2) Keep the handle. A refused OAuth never reaches discovery, so the only
    //    place the server can learn it is the record of the attempt — and an
    //    invite cannot be sent for a handle the queue does not have.
    if (ensureHandleRecorded(tenantId)) autoFixed.push('handleRecorded');

    const facts = buildConnectFixFacts({ tenantId, readiness, redirectUri });
    console.log(
      `OWNER_ACTION: connect-fix for tenant ${tenantId} by ${viewer} — blocker=${facts.blocker} ` +
        `handle=${facts.handle ? '@' + facts.handle : '(unknown)'} autoFixed=[${autoFixed.join(', ')}]`
    );

    return res.json({ success: true, facts, autoFixed });
  });

  /**
   * The same diagnosis for every account at once (owner).
   *
   * Deliberately performs NO Meta calls and writes nothing: the point is one list
   * the owner works down, and a button that quietly fired a Graph request per
   * customer would turn a click into a rate-limit incident. The single-account
   * route above is where the live re-check happens.
   */
  app.post('/api/owner/tenants/connect-fix-all', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to diagnose every connect`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const readiness = buildOAuthReadiness(req);
    const redirectUri = getOAuthRedirectUri(req);
    const overview = buildTenantOverview(langFromRequest(req));

    // Everything that is not a healthy, routed connection — including accounts
    // whose Instagram row is fine but whose DMs land on a different tenant.
    const plans: ConnectFixFacts[] = overview.rows
      .filter(
        (row) =>
          !row.instagram.connected ||
          row.instagram.liveState === 'NEEDS_REAUTH' ||
          (row.instagram.sharedWith?.length || 0) > 0
      )
      .map((row) => buildConnectFixFacts({ tenantId: row.tenantId, readiness, redirectUri }));

    const sorted = sortFixPlans(plans);
    const counts = sorted.reduce<Record<string, number>>((acc, plan) => {
      acc[plan.blocker] = (acc[plan.blocker] || 0) + 1;
      return acc;
    }, {});

    console.log(
      `OWNER_ACTION: connect-fix-all by ${viewer} — ${sorted.length} account(s): ` +
        Object.entries(counts).map(([blocker, count]) => `${blocker}=${count}`).join(' ')
    );

    return res.json({ success: true, plans: sorted, counts, readiness });
  });

  /**
   * Free forever, or back on the normal plan path (owner).
   *
   * The runtime half of the comped list. `COMP_TENANT_IDS` still works and still
   * wins, but marking one account free used to need an env edit *and* a redeploy
   * while the operator was mid-test — so the owner's own test accounts kept
   * expiring their 3-day trial and going silent.
   *
   * Deliberately reversible: a customer marked by mistake is put back with the
   * same button, and `envListed` says when the env var is the thing keeping the
   * account free (removing the store record would not change anything then).
   */
  app.post('/api/owner/tenants/free-forever', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to change the free-forever list`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }
    if (isOwnerTenant(tenantId)) {
      return res.status(400).json({
        success: false,
        code: 'OWNER_ACCOUNT',
        error: "The owner's own account is never billed — nothing to change.",
      });
    }

    const free = req.body?.free !== false;
    const record = free
      ? markComped(tenantId, 'manual', viewerEmail || viewer, 'marked in the Ops Console')
      : unmarkComped(tenantId);
    console.log(
      `OWNER_ACTION: free-forever ${free ? 'ON' : 'OFF'} for tenant ${tenantId} by ${viewer}`
    );

    return res.json({
      success: true,
      tenantId,
      freeForever: isCompedTenant(tenantId),
      envListed: getCompedTenantIds().includes(tenantId),
      record,
    });
  });

  /**
   * Let a customer pick their username again (owner).
   *
   * The username is set once, so this is the only way it changes hands. The old
   * name goes back into the pool on purpose — a reset is a deliberate act, and a
   * typo'd or abusive name should be reclaimable — and the customer is asked again
   * on their next sign-in.
   */
  app.post('/api/owner/tenants/username-reset', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to reset a username`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    const removed = resetUsername(tenantId);
    console.log(
      `OWNER_ACTION: username reset for tenant ${tenantId} by ${viewer}` +
        (removed ? ` (was @${removed.username})` : ' (there was none)')
    );
    return res.json({ success: true, tenantId, removed: removed?.username || null });
  });

  /**
   * "Is this bot actually answering?" — a dry run, no DM sent (owner).
   *
   * The only test that used to exist was to send the bot a real DM, and that test is
   * the one people misread: two InstaFlow-connected accounts messaging each other are
   * the loop the guard exists to stop, so the guard refuses, the owner sees silence,
   * and concludes the product is broken. Pressing "message myself" cannot work either
   * — Instagram does not deliver a DM to its own account.
   *
   * So this runs the real chain (bot switch → plan access → connection → the
   * tenant's own prompt and knowledge base → the AI provider) and reports each stage,
   * without calling Meta to send. `sent: false` is part of the response, not a
   * footnote, so nobody reads it as a delivered message.
   */
  app.post('/api/owner/tenants/self-test', async (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to self-test a bot`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }

    const result = await runBotSelfTest({
      tenantId,
      message: typeof req.body?.message === 'string' ? req.body.message : undefined,
    });

    console.log(
      `OWNER_ACTION: self-test for tenant ${tenantId} by ${viewer} — ` +
        `${result.ok ? 'PASS' : 'FAIL'} provider=${result.provider || '-'} ms=${result.elapsedMs} ` +
        `(no DM sent)`
    );

    return res.json({ success: true, result });
  });

  /**
   * Switch one customer's bot on or off.
   *
   * The Ops Console's single button. `enabled: false` stops everything that sends
   * a DM for that account — AI replies and manual agent replies — and the customer
   * sees "this bot is switched off" on their own dashboard instead of silence. The
   * inbound message is still stored while paused, so nothing a customer sent is
   * lost. Owner-gated exactly like the other write routes.
   */
  app.post('/api/owner/bots/control', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to switch a bot`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'A tenant id is required.' });
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be true or false.' });
    }

    let record;
    try {
      record = setBotEnabled(
        tenantId,
        enabled,
        String(viewerEmail || viewer),
        typeof req.body?.note === 'string' ? req.body.note : undefined
      );
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }

    console.log(
      `OWNER_ACTION: bot for tenant ${tenantId} ${enabled ? 'ENABLED' : 'PAUSED'} by ${viewer}`
    );
    return res.json({ success: true, tenantId, ...record });
  });

  /**
   * The emergency brake: stop (or restart) every bot at once.
   *
   * Exists because the incident this feature came from was a loop running faster
   * than anyone could click account by account. One request, one file write, every
   * bot quiet — and it deliberately clears the per-account switches in both
   * directions, so "resume all" really means all.
   */
  app.post('/api/owner/bots/control-all', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(
        `OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to use the bot brake`
      );
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be true or false.' });
    }

    const result = setAllBots(
      enabled,
      String(viewerEmail || viewer),
      typeof req.body?.note === 'string' ? req.body.note : undefined
    );

    console.warn(
      `OWNER_ACTION: BOT_BRAKE ${enabled ? 'RESUME ALL' : 'PAUSE ALL'} by ${viewer} — ` +
        'every account follows this until it is released.'
    );
    return res.json({ success: true, ...result });
  });

  /**
   * Ask Meta, account by account, whether the stored token still works here.
   *
   * The console's "check every account" button. It exists because a connection
   * can die with nothing changing on our side — the account removes the app, or
   * a tester accepted an invite on a different Meta app and the token that
   * arrived cannot be used by this one — and the row kept saying CONNECTED while
   * DMs went unanswered. One `/me` call per account separates the two.
   *
   * Sequential and owner-gated: it talks to Meta, so it is not something an
   * anonymous caller may trigger, and it does not fire in parallel bursts.
   */
  app.post('/api/owner/connections/health', async (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to check connection health`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const sweep = await checkAllConnectionHealth();
    console.log(
      `OWNER_CONSOLE: ${viewer} checked ${sweep.checked} connection(s) — ` +
        `${sweep.needingReauth.length} need a reconnect, ${sweep.unreachable.length} could not be told`
    );
    return res.json({ success: true, ...sweep });
  });

  /**
   * One tenant's connection health, on demand (the customer's own screen and the
   * expanded Ops profile both use it).
   */
  app.post('/api/instagram/health', async (req, res) => {
    // The customer checks their own account; the owner may check any account
    // from the console, so a body tenantId is honoured only for an owner.
    const ownTenantId = getTenantId(req);  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    const requested = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const canUseRequested = Boolean(requested) && viewer ? isOwnerIdentity(viewer, viewerEmail) : false;
    const tenantId = canUseRequested ? requested : ownTenantId;

    const health = await checkConnectionHealth(tenantId);
    return res.json({ success: true, health, status: getSafeStatus(tenantId) });
  });

  /**
   * "I have dealt with these" for the unrouted-delivery alarms.
   *
   * Clears the visible list, keeps the running total — the point of the counter
   * is that a drop like this can never become invisible again, so it is not
   * reset by tidying the list.
   */
  app.post('/api/owner/delivery-alerts/clear', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to clear delivery alerts`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    const stats = clearUnroutedDeliveries();
    console.log(`OWNER_ACTION: ${viewer} cleared the unrouted-delivery list (total kept at ${stats.total})`);
    return res.json({ success: true, unroutedDeliveries: stats });
  });

  /**
   * Complaints customers sent through the public form.
   *
   * Owner-only, newest first. This is the safety net behind the WhatsApp relay:
   * a complaint is stored *before* it is pushed, so a relay outage shows up here
   * as `notified: false` instead of losing the message.
   */
  app.get('/api/owner/complaints', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to list complaints`);
      return res.status(403).json({
        success: false,
        code: 'OWNER_ONLY',
        error: 'This view is limited to the account owner.',
      });
    }

    loadComplaints();
    const complaints = getComplaints();
    return res.json({
      success: true,
      total: complaints.length,
      maxReturned: MAX_COMPLAINTS_RETURNED,
      stats: getComplaintStats(),
      // Whether the push actually works, and a masked form of the destination so
      // the owner can confirm the right number is wired without it being exposed.
      whatsappConfigured: isOwnerWhatsAppConfigured(),
      whatsappLabel: getOwnerWhatsAppLabel(),
      complaints: complaints.slice(0, MAX_COMPLAINTS_RETURNED),
    });
  });

  app.post('/api/owner/complaints/resolve', (req, res) => {  const viewer = (req as RequestWithTenant).userId;
    const viewerEmail = (req as RequestWithTenant).userEmail;


    if (!viewer || !isOwnerIdentity(viewer, viewerEmail)) {
      console.warn(`OWNER_CONSOLE_DENIED: ${viewer || 'unauthenticated caller'} tried to resolve a complaint`);
      return res.status(403).json({ success: false, code: 'OWNER_ONLY', error: 'This view is limited to the account owner.' });
    }

    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!id) return res.status(400).json({ success: false, error: 'A complaint id is required.' });

    const complaint = resolveComplaint(id);
    if (!complaint) return res.status(404).json({ success: false, error: 'Complaint not found.' });

    console.log(`OWNER_CONSOLE: ${viewer} resolved complaint ${id}`);
    return res.json({ success: true, complaint });
  });

  app.post('/api/subscription/trial', (req, res) => {
    const tenantId = getTenantId(req);
    try {
      const subscription = startTrial(tenantId, TRIAL_DAYS, langFromRequest(req));
      console.log(`Trial started for tenant ${tenantId} until ${subscription.currentPeriodEnd}`);
      return res.json({ success: true, subscription, plan: getPlan(subscription.planId) });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // Create the Razorpay order the browser checkout will open with.
  app.post('/api/subscription/checkout', async (req, res) => {
    const tenantId = getTenantId(req);
    const planId = typeof req.body?.planId === 'string' ? req.body.planId : '';
    const plan = getPlan(planId);

    if (!plan || plan.hidden) {
      return res.status(400).json({ success: false, error: 'Unknown plan.' });
    }
    // The ₹99 offer is capped and time-boxed server-side: no overselling past
    // the first 100 seats even if a stale pricing page is open.
    if (plan.id === 'launch99' && !isLaunchOfferAvailable()) {
      return res.status(410).json({
        success: false,
        error: `The ₹99 Launch Offer is over (first ${LAUNCH_OFFER_CAP} customers / limited time — ${launchOfferSold()} claimed). Pick another plan.`,
      });
    }
    if (!isPaymentsConfigured()) {
      return res
        .status(503)
        .json({ success: false, error: M(langFromRequest(req), 'pay.notConfigured') });
    }

    const result = await createOrder({
      amountInr: plan.priceInr,
      receipt: `${tenantId.slice(0, 12)}-${plan.id}-${Date.now()}`,
      notes: { tenantId, planId: plan.id },
    });
    if (!result.ok) {
      console.error(`Checkout order failed for tenant ${tenantId}: ${result.error}`);
      return res.status(502).json({ success: false, error: result.error });
    }

    // Remember the order so the customer can reconcile a stuck payment later
    // without writing to support.
    rememberPendingOrder(tenantId, result.order.id, plan.id);

    console.log(`Checkout order ${result.order.id} created for tenant ${tenantId} (${plan.id}, INR ${plan.priceInr})`);
    return res.json({
      success: true,
      order: { id: result.order.id, amount: result.order.amount, currency: result.order.currency },
      plan: { id: plan.id, name: plan.name, priceInr: plan.priceInr },
      keyId: getPublicPaymentConfig().keyId,
    });
  });

  // Verify the checkout callback, then activate. The amount is re-checked with
  // Razorpay rather than trusted from the browser.
  app.post('/api/subscription/verify', async (req, res) => {
    const tenantId = getTenantId(req);
    const orderId = String(req.body?.razorpay_order_id || '');
    const paymentId = String(req.body?.razorpay_payment_id || '');
    const signature = String(req.body?.razorpay_signature || '');
    const plan = getPlan(String(req.body?.planId || ''));

    if (!plan || plan.hidden) {
      return res.status(400).json({ success: false, error: 'Unknown plan.' });
    }
    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      console.warn(`PAYMENT_SIGNATURE_REJECTED for tenant ${tenantId} (order ${orderId})`);
      return res.status(400).json({ success: false, error: 'Payment could not be verified.' });
    }

    const lookup = await fetchPayment(paymentId);
    if (!lookup.ok) {
      console.warn(`Payment lookup failed for ${paymentId}: ${lookup.error}`);
      return res.status(502).json({ success: false, error: lookup.error });
    }

    const payment = lookup.payment;
    const expectedPaise = plan.priceInr * 100;
    const paidPaise = Number(payment.amount) || 0;

    if (paidPaise !== expectedPaise) {
      console.warn(
        `PAYMENT_MISMATCH for tenant ${tenantId}: paid=${paidPaise} expected=${expectedPaise} status=${payment.status}`
      );
      return res.status(400).json({ success: false, error: 'Payment amount does not match the plan.' });
    }

    if (payment.status === 'failed') {
      // The customer's money is a bank hold that reverses itself; say so plainly
      // instead of leaving them staring at a checkout window.
      console.warn(`PAYMENT_FAILED for tenant ${tenantId}: ${payment.error_code} ${payment.error_reason}`);
      return res.status(402).json({ success: false, error: describePaymentFailure(payment) });
    }

    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return res.status(402).json({
        success: false,
        error: M(langFromRequest(req), 'pay.notComplete', { status: payment.status }),
      });
    }

    // Manual-capture accounts only *hold* the money until someone captures it.
    // Do it here so the customer is never left paid-but-without-a-plan.
    if (payment.status === 'authorized') {
      const captured = await capturePayment(paymentId, paidPaise);
      if (captured.ok) {
        console.log(`Payment ${paymentId} captured on verify (tenant ${tenantId}).`);
      } else {
        console.warn(`Capture failed for ${paymentId}: ${captured.error}`);
      }
    }

    const subscription = activateSubscription({
      tenantId,
      planId: plan.id,
      paymentId,
      orderId,
      amountPaidInr: Math.round(paidPaise / 100),
    });
    clearPendingOrder(tenantId);
    console.log(`SUBSCRIPTION_ACTIVATED tenant ${tenantId} -> ${plan.id} until ${subscription.currentPeriodEnd}`);
    return res.json({ success: true, subscription, plan });
  });

  /**
   * "Maine pay kiya par plan nahi mila" — the customer's own escape hatch.
   *
   * A webhook can be missed (endpoint down during a deploy, secret rotated and
   * not saved). Rather than making them email us, we look up the order they last
   * opened, capture it if it is only authorised, activate it if it went through,
   * and otherwise tell them exactly what Razorpay said.
   */
  app.post('/api/subscription/recheck', async (req, res) => {
    const tenantId = getTenantId(req);

    if (!isPaymentsConfigured()) {
      return res.status(503).json({ success: false, error: 'Payments are not configured yet.' });
    }

    const pending = getPendingOrder(tenantId);
    if (!pending) {
      return res.status(404).json({ success: false, error: M(langFromRequest(req), 'pay.noPendingOrder') });
    }

    const plan = getPlan(pending.planId);
    if (!plan) {
      clearPendingOrder(tenantId);
      return res.status(400).json({ success: false, error: M(langFromRequest(req), 'pay.planGone') });
    }

    const lookup = await fetchOrderPayments(pending.orderId);
    if (!lookup.ok) {
      return res.status(502).json({ success: false, error: lookup.error });
    }
    if (!lookup.payments.length) {
      return res.json({
        success: false,
        code: 'NO_ATTEMPT',
        error: M(langFromRequest(req), 'pay.noAttempt'),
      });
    }

    const expectedPaise = plan.priceInr * 100;
    const usable = lookup.payments.filter((p: any) => Number(p.amount) === expectedPaise);

    // Captured wins; otherwise an authorised hold we can still complete.
    const captured = usable.find((p: any) => p.status === 'captured');
    if (captured) {
      const subscription = activateSubscription({
        tenantId,
        planId: plan.id,
        paymentId: String(captured.id),
        orderId: pending.orderId,
        amountPaidInr: Math.round(expectedPaise / 100),
      });
      clearPendingOrder(tenantId);
      console.log(`SUBSCRIPTION_ACTIVATED via recheck: tenant ${tenantId} -> ${plan.id}`);
      return res.json({ success: true, subscription, plan, recovered: true });
    }

    const authorised = usable.find((p: any) => p.status === 'authorized');
    if (authorised) {
      const done = await capturePayment(String(authorised.id), expectedPaise);
      if (done.ok) {
        const subscription = activateSubscription({
          tenantId,
          planId: plan.id,
          paymentId: String(authorised.id),
          orderId: pending.orderId,
          amountPaidInr: Math.round(expectedPaise / 100),
        });
        clearPendingOrder(tenantId);
        console.log(`SUBSCRIPTION_ACTIVATED via recheck+capture: tenant ${tenantId} -> ${plan.id}`);
        return res.json({ success: true, subscription, plan, recovered: true });
      }
      return res.status(502).json({ success: false, error: done.error });
    }

    // Nothing succeeded — report the most recent attempt's reason verbatim.
    const latest = usable[0];
    console.warn(
      `Payment recheck found no usable payment for tenant ${tenantId} (order ${pending.orderId}, status ${latest?.status})`
    );
    return res.json({ success: false, code: 'NOT_PAID', error: describePaymentFailure(latest) });
  });

  // Server-to-server webhook: activates even if the customer closed the browser.
  app.post('/api/webhooks/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature((req as RequestWithRawBody).rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      console.warn('RAZORPAY_WEBHOOK_REJECTED: signature mismatch');
      return res.status(401).send('INVALID_SIGNATURE');
    }

    const event = String(req.body?.event || '');
    const entity = req.body?.payload?.payment?.entity || {};
    const notes = entity.notes || {};
    const tenantId = String(notes.tenantId || '');
    const planId = String(notes.planId || '');

    // Ack immediately — Razorpay retries slow webhooks.
    res.status(200).send('OK');

    if (!['payment.captured', 'order.paid', 'payment.authorized'].includes(event)) {
      console.log(`Razorpay webhook ignored (event ${event || 'unknown'})`);
      return;
    }
    const targetPlan = getPlan(planId);
    if (!tenantId || !targetPlan) {
      console.warn(`Razorpay webhook has no usable tenant/plan notes: ${JSON.stringify(notes)}`);
      return;
    }

    const paidPaise = Number(entity.amount) || 0;
    if (paidPaise !== targetPlan.priceInr * 100) {
      console.warn(
        `Razorpay webhook amount mismatch for tenant ${tenantId}: paid=${paidPaise} expected=${targetPlan.priceInr * 100} (${planId})`
      );
      return;
    }

    try {
      // Manual-capture accounts fire `payment.authorized` first: complete the
      // capture so a hold never leaves the customer without a plan.
      if (event === 'payment.authorized') {
        const captured = await capturePayment(String(entity.id || ''), paidPaise);
        if (!captured.ok) {
          console.warn(`Webhook capture failed for ${entity.id}: ${captured.error}`);
          return;
        }
      }

      const subscription = activateSubscription({
        tenantId,
        planId,
        paymentId: String(entity.id || ''),
        orderId: String(entity.order_id || ''),
        amountPaidInr: Math.round(paidPaise / 100),
      });
      clearPendingOrder(tenantId);
      console.log(
        `SUBSCRIPTION_ACTIVATED via webhook: tenant ${tenantId} -> ${planId} until ${subscription.currentPeriodEnd}`
      );
    } catch (err: any) {
      console.error('Razorpay webhook activation failed:', err.message);
    }
  });

  app.post('/api/subscription/cancel', (req, res) => {
    const tenantId = getTenantId(req);
    const subscription = cancelSubscription(tenantId);
    if (!subscription) {
      return res.status(404).json({ success: false, error: 'No subscription to cancel.' });
    }
    console.log(`Subscription cancelled for tenant ${tenantId}; paid period ends ${subscription.currentPeriodEnd}`);
    return res.json({ success: true, subscription });
  });

  // ==========================================
  // 3. META WEBHOOK FOR INSTAGRAM MESSAGING
  // ==========================================

  // Webhook Verification (GET /api/webhook/instagram)
  app.get('/api/webhook/instagram', (req, res) => {
    console.log('GET /api/webhook/instagram challenge check:', req.query);
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED successfully with challenge:', challenge);
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(challenge || ''));
    } else {
      console.warn(`WEBHOOK_VERIFICATION_FAILED. Expected token: "${META_VERIFY_TOKEN}", received: "${token}"`);
      return res.sendStatus(403);
    }
  });

  // Centralized Real-time Webhook Receiver (POST /api/webhook/instagram)
  app.post('/api/webhook/instagram', async (req, res) => {
    try {
      // Authenticate the delivery BEFORE doing any work or replying.
      const signatureCheck = verifyMetaSignature(
        (req as RequestWithRawBody).rawBody,
        req.headers['x-hub-signature-256']
      );

      if (!signatureCheck.ok) {
        // Always record why, plus what the delivery actually looked like.
        logWebhookRejectionDiagnostics(req, (req as RequestWithRawBody).rawBody);

        if (META_APP_SECRET && !WEBHOOK_SIGNATURE_WARN) {
          // The secret is configured, so a bad signature means this did not come
          // from Meta (or it was signed with a secret we do not hold). Drop it
          // without processing or acknowledging the payload.
          console.warn(`WEBHOOK_SIGNATURE_REJECTED: ${signatureCheck.reason}`);
          return res.status(401).send('INVALID_SIGNATURE');
        }
        // Either no secret is configured at all, or the operator explicitly
        // asked for unverified deliveries. Fail open so testing still works,
        // but say so loudly on every request.
        console.warn(
          `WEBHOOK_SIGNATURE_SKIPPED (mode=${WEBHOOK_SIGNATURE_MODE}): ${signatureCheck.reason}. ` +
            'Set META_APP_SECRET (and IG_APP_SECRET for Instagram Login) and use WEBHOOK_SIGNATURE_MODE=enforce.'
        );
      }

      const body = req.body;

      // Immediately respond 200 OK to Meta to prevent request timeout & retries
      res.status(200).send('EVENT_RECEIVED');

      if (body.object === 'instagram' || body.object === 'page') {
        for (const entry of body.entry || []) {
          const igAccountId = String(entry.id);

          // Normalize messages from both entry.messaging and entry.changes
          const rawEvents: any[] = [];
          if (Array.isArray(entry.messaging)) {
            rawEvents.push(...entry.messaging);
          }
          if (Array.isArray(entry.changes)) {
            for (const ch of entry.changes) {
              if (ch.value) rawEvents.push(ch.value);
            }
          }

          for (const messaging of rawEvents) {
            const senderId = messaging.sender?.id;
            const recipientId = messaging.recipient?.id;
            const messageObj = messaging.message;
            const mid = messageObj?.mid;
            // Text-less messages are only dropped when they carry nothing to
            // answer. A product-page inquiry (Instagram Shops) arrives with
            // product context and often NO text — that is a real customer
            // asking about a product, so it must reach the bot. Previously
            // every text-less message died here, which is exactly why the bot
            // answered profile DMs but not product-page DMs.
            const inbound = parseInboundMessage(messageObj);
            const messageText = inbound.displayText;

            // 1. Skip if nothing to answer (read receipt, sticker, lone
            //    reaction) or missing sender
            if (!senderId || !inbound.isProcessable) {
              updateTrace(igAccountId, String(senderId || 'unknown'), { stage: 'no-message' });
              continue;
            }

            // 2. Ignore messages sent by ourselves (bot echoing own message)
            if (senderId === igAccountId || senderId === recipientId) {
              updateTrace(igAccountId, senderId, { stage: 'self-echo' });
              continue;
            }

            // 3. Deduplicate by Meta Message ID (mid). Persisted to disk, so a
            // restart/redeploy mid-retry cannot trigger a second AI reply.
            if (mid) {
              if (hasProcessedMessage(mid)) {
                console.log(`Skipping duplicate message (mid len ${String(mid).length})`);
                updateTrace(igAccountId, senderId, { stage: 'duplicate' });
                continue;
              }
              markMessageProcessed(mid);
            }

            // Sender id + text length only — the customer's words are not console
            // material: any log drain may be shared storage. (Task 2 privacy rule.)
            console.log(
              `Received incoming DM (len ${messageText.length}) from sender=${String(senderId).slice(0, 4)}… for IG Account ${igAccountId}`
            );
            const trace: MessageTrace | null = startTrace({
              igAccountId,
              senderId,
              stage: 'received',
            });

            // 4. Resolve the tenant connection using both entry.id and recipient.id as candidate IDs
            const resolved = getTenantByInstagramAccountId(igAccountId, recipientId);
            if (!resolved) {
              // Recorded, not just logged. This is the silent failure that made a
              // tester's bot look dead: Meta delivered the DM, no connected
              // account matched, the message was dropped. The console now shows
              // which accounts are receiving DMs with nothing behind them.
              const alert = recordUnroutedDelivery({
                igAccountId: String(igAccountId || recipientId || ''),
                senderId,
                text: messageText,
              });
              noteWebhookFailure({ kind: 'unrouted', detail: `DM for account ${alert.igAccountId} not routed` });
              updateTrace(igAccountId, senderId, { stage: 'unrouted' });
              console.warn(
                `UNROUTED_DELIVERY: DM for IG Account ${alert.igAccountId} (sender len ${String(senderId).length}) has no connected account — ` +
                  'the message was dropped (never answered by another tenant). ' +
                  `Total since install: ${getUnroutedDeliveryStats().total}. Active indexed accounts:`,
                getDiagnosticsInfo().indexedIgAccounts
              );
              continue;
            }

            const { tenantId, connection } = resolved;
            updateTrace(igAccountId, senderId, { stage: 'routed', tenantId }, trace);
            // Health monitor: "correct tenant identified" — real event only.
            noteInbound(tenantId);
            const decryptedToken = getDecryptedTokenForTenant(tenantId);
            if (!decryptedToken) {
              console.error(`Cannot send reply: Token decryption failed for tenant ${tenantId}`);
              updateTrace(igAccountId, senderId, { stage: 'send-failed', tenantId, send: { status: 'failed', errorCategory: 'auth', errorDetail: 'token decryption failed', retryable: false }, note: 'token decrypt failed' }, trace);
              continue;
            }

            // 4b. Billing gate. decideAccess only blocks once payments are
            // actually configured, so turning billing on can never stop a bot
            // that is already live. The message is still recorded either way, so
            // nothing a customer sent is ever lost.
            const access = decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured() });
            if (!access.allowed) {
              recordIncomingMessage({
                instagramAccountId: igAccountId,
                senderId,
                tenantId,
                text: messageText,
              });
              console.warn(
                `AI reply skipped for tenant ${tenantId} (${access.reason}) — message still saved to the inbox.`
              );
              updateTrace(igAccountId, senderId, { stage: 'billing-blocked', tenantId, note: access.reason }, trace);
              continue;
            }

            // 4c. Bot-to-bot guard. The whole point of this gate is that two
            //     InstaFlow-connected accounts must never hold a conversation:
            //     if they did, both bots would answer each other forever (this
            //     happened for real — see server/botGuard.ts). It also caps how
            //     many replies one conversation can receive in a window, which
            //     stops any other loop shape. Nothing is stored for a blocked
            //     message, so a loop can never grow the inbox either.
            //     Always called: identity isolation can be switched off with an
            //     env flag, but the burst cap is the last line of defence.
            {
              const guard = await evaluateInbound({
                igAccountId,
                tenantId,
                senderId,
                rawToken: decryptedToken,
                authMode: connection.authMode,
              });
              if (!guard.allow) {
                console.warn(
                  `BOT_GUARD_BLOCKED (${guard.code}) for IG account ${igAccountId} / tenant ${tenantId}: ` +
                    `${guard.reason}. No AI reply was generated.`
                );
                updateTrace(igAccountId, senderId, { stage: 'guard-blocked', tenantId, note: guard.code }, trace);
                continue;
              }
            }

            // 5. Human takeover: if an agent has paused automation for this
            // conversation we still record the customer's message for the
            // inbox, but must never auto-reply (and skip the AI call entirely).
            const logKey = buildChatId(igAccountId, senderId);
            if (isHumanTakeover(logKey)) {
              recordIncomingMessage({
                instagramAccountId: igAccountId,
                senderId,
                tenantId,
                text: messageText,
              });
              console.log(`Human takeover is active for ${logKey}; recorded message without an AI reply.`);
              updateTrace(igAccountId, senderId, { stage: 'takeover', tenantId }, trace);
              continue;
            }

            // 6. Generate the AI reply from THIS tenant's instructions and
            // knowledge base, plus the conversation so far, so follow-up
            // questions do not need the customer to repeat themselves.
            //
            // This placeholder is ONLY the initial value so the variable is
            // always a string; if the AI call below throws (or returns an empty
            // reply) we fall back to the canned AI_FALLBACK_REPLY, and we also
            // check we have not JUST sent that same fallback to this exact
            // conversation a moment ago (see the de-dup check before sending).
            let aiReply = AI_FALLBACK_REPLY;
            // True whenever the reply that goes out is the canned fallback (AI
            // provider failed, or returned nothing usable). Lets the send step
            // avoid repeating the same fallback back-to-back (Phase 4).
            let usedFallback = true;

            // Trace: AI call is starting. The attemptLog from aiService records
            // OpenRouter and Gemini outcomes SEPARATELY (Task 2 requirement #4).
            const aiStartedAt = new Date().toISOString();
            updateTrace(igAccountId, senderId, { stage: 'ai-started', tenantId }, trace);

            try {
              const aiContext = getTenantAiContext(tenantId);
              const priorChat = getChatById(logKey);
              const conversationHistory = (priorChat?.messages || [])
                .slice(-10)
                .map((m) => ({ sender: m.sender, text: m.text }));

              // The sale has to leave the DM eventually (Meta's 24-hour window,
              // and payment details must never be taken in chat), so the bot is
              // told where to send an interested customer — and, just as
              // importantly, when NOT to.
              const handle = connection.instagramUsername || '';
              const bookingInstruction = handle
                ? `Booking page for this business: ${getPublicAppUrl(req)}/book/${encodeURIComponent(handle)} . ` +
                  'Share this link only when the customer is ready for the next step (asks about booking, price confirmation, ' +
                  'availability, payment or says yes) — never in your first reply, and never more than once in a reply. ' +
                  'Bookings and payments always happen on that page; never ask for card, UPI or payment details in chat.'
                : '';

              const aiResult = await generateAiReply({
                // The marker instruction only changes how the answer is REPORTED
                // to us; the customer never sees it (extracted below).
                systemPrompt: [aiContext.systemPrompt, ANSWERING_RULES, bookingInstruction, productContextInstruction(inbound), KB_MISS_INSTRUCTION]
                  .filter(Boolean)
                  .join('\n\n'),
                knowledgeBase: aiContext.knowledgeBase,
                conversationHistory,
                userMessage: messageText,
              });

              // Never let the marker reach the customer, whatever the model does.
              const parsed = extractKbMiss(aiResult.reply);
              // A reply that was ONLY the marker would become empty; never send a
              // blank DM. Fall back to the canned human-hand-off message so the
              // customer still gets a coherent reply (and it is tagged 'fallback'
              // so the health monitor and the owner can tell it from a real AI
              // answer).
              aiReply = parsed.text || AI_FALLBACK_REPLY;
              usedFallback = aiResult.provider === 'fallback' || !parsed.text;
              console.log(
                `AI reply generated via ${aiResult.provider} (${aiResult.model}) using ` +
                  `${aiContext.customised ? 'tenant' : 'default'} settings, ${aiContext.itemCount} knowledge document(s), ` +
                  `${conversationHistory.length} prior message(s)`,
                // Diagnostics (never the raw prompt, never customer text): which
                // tenant, which account, whether the KB loaded and how big it is,
                // which provider/model actually answered, and whether a fallback
                // was used. The trace id links this line to the stored trace.
                { traceId: trace?.id, tenantId, igAccountId, kbLoaded: aiContext.itemCount > 0, kbDocs: aiContext.itemCount, provider: aiResult.provider, model: aiResult.model, usedFallback: aiResult.provider === 'fallback', historyLen: conversationHistory.length }
              );
              updateTrace(igAccountId, senderId, {
                stage: 'ai-completed',
                tenantId,
                ai: {
                  provider: aiResult.provider,
                  model: aiResult.model,
                  startedAt: aiStartedAt,
                  status: aiResult.provider === 'fallback' ? 'canned-fallback' : 'ok',
                  attempts: (aiResult.attempts || []).map((a) => ({
                    provider: a.provider,
                    ok: a.ok,
                    durationMs: null,
                    errorCategory: a.ok ? null : classifyError(a.error).category,
                    errorDetail: a.ok ? null : classifyError(a.error).detail,
                  })),
                },
              }, trace);

              // The knowledge base did not cover this question: file it so the
              // operator can see what customers actually ask and close the gap.
              if (parsed.missed) {
                const gap = recordKbGap(tenantId, messageText);
                console.log(
                  `KB_GAP recorded (asked ${gap?.count ?? 1}x, ${aiContext.itemCount} document(s) available): "${messageText.slice(0, 80)}"`
                );
              }
            } catch (aiErr) {
              console.error('AI generation error in webhook:', aiErr);
              // aiReply stays the canned AI_FALLBACK_REPLY (usedFallback is
              // still true); the trace marks this DM as failed-at-AI so the
              // owner sees WHY (never a silent canned send), and step 7 above
              // still records the customer's message.
              const classified = classifyError(aiErr);
              // Health monitor: AI provider failure (fallback still replies).
              noteAiFailure(tenantId, { detail: classified.detail });
              updateTrace(igAccountId, senderId, {
                stage: 'ai-failed',
                tenantId,
                ai: {
                  provider: 'fallback',
                  model: 'unknown',
                  startedAt: aiStartedAt,
                  status: 'error',
                  attempts: [{ provider: 'openrouter', ok: false, durationMs: null, errorCategory: classified.category, errorDetail: classified.detail }],
                },
                note: classified.detail,
              }, trace);
            }

            // 7. De-dup the canned fallback (Phase 4). If the AI failed AND we
            // already sent this same fallback to this conversation, do NOT send
            // the identical "human will reply" DM again — the customer asked a
            // second question and deserves a real answer, not a repeat of the
            // apology. The incoming message is still recorded (nothing the
            // customer sent is ever lost), just without a fabricated reply, and
            // the trace is marked so the owner sees the fallback was suppressed.
            const priorChatForDedup = getChatById(logKey);
            const lastAiMessage = priorChatForDedup?.messages
              ? [...priorChatForDedup.messages].reverse().find((m) => m.sender === 'ai')
              : undefined;
            if (isDuplicateFallbackReply(usedFallback, lastAiMessage?.text)) {
              recordIncomingMessage({
                instagramAccountId: igAccountId,
                senderId,
                tenantId,
                text: messageText,
              });
              console.log(
                `Canned fallback suppressed for ${logKey} (tenant ${tenantId}): the previous AI reply was the same fallback. ` +
                  'The incoming message was recorded but no duplicate DM was sent.'
              );
              updateTrace(igAccountId, senderId, {
                // 'duplicate' is a terminal, non-failure stage (finalStatus
                // 'blocked'), so the trace closes instead of hanging 'pending'.
                stage: 'duplicate',
                tenantId,
                send: { status: 'skipped', endedAt: new Date().toISOString() },
                note: 'canned fallback suppressed (duplicate)',
              }, trace);
              continue;
            }

            // 8. Record the exchange in the volume-backed inbox store.
            recordIncomingMessage({
              instagramAccountId: igAccountId,
              senderId,
              tenantId,
              text: messageText,
              aiReply,
            });

            // 9. Send the reply back via Meta Graph API
            console.log(`Sending automated reply via Instagram Account ${connection.instagramAccountId}...`);
            updateTrace(igAccountId, senderId, { stage: 'send-started', tenantId }, trace);
            const sendResult = await sendInstagramMessage(
              connection.instagramAccountId,
              senderId,
              aiReply,
              decryptedToken,
              connection.authMode
            );

            if (sendResult.success) {
              // Count the reply against this conversation's burst budget, so a
              // loop trips the guard on its own even if identity matching could
              // not name the sender (see botGuard.evaluateInbound).
              noteOutboundReply(igAccountId, senderId);
              noteSendSuccess(tenantId, connection.instagramAccountId);
              console.log('DM reply delivered successfully.');
              updateTrace(igAccountId, senderId, { stage: 'send-completed', tenantId, send: { status: 'sent', endedAt: new Date().toISOString() } }, trace);
            } else {
              // Safe category only — the raw error may echo provider payloads.
              const classified = classifyError(sendResult.error);
              // Health monitor: record the lifecycle outcome with its safe
              // category. Ambiguous outcomes (timeout/network) are flagged so
              // neither the queue nor the alert rules treat them as confirmed.
              noteSendFailure(tenantId, {
                igAccountId: connection.instagramAccountId,
                category: classified.category,
                detail: classified.detail,
                ambiguous: classified.category === 'timeout' || classified.category === 'network',
              });
              console.error(
                `Failed to send DM — category=${classified.category} retryable=${isRetryableCategory(classified.category) || false} detail=${classified.detail}`
              );
              // Task 3: confirmed transient failures go to the durable retry
              // queue; ambiguous (timeout/network — the send may have gone
              // through) and permanent (auth/permission/invalid) are only
              // counted, never blindly resent. Inert until RETRY_ENABLED=true
              // (default false — owner activates explicitly).
              offerFailedSend({
                tenantId,
                instagramAccountId: connection.instagramAccountId,
                recipientId: senderId,
                senderId,
                replyText: aiReply,
                authMode: connection.authMode,
                rawError: sendResult.error,
                mid: mid || null,
              });
              // A refused reply is the first place a dead or wrong-app token
              // shows up in normal traffic, so the connection is flagged here
              // instead of waiting for a manual check.
              noteSendAuthFailure(tenantId, classified.detail);
              updateTrace(igAccountId, senderId, {
                stage: 'send-failed',
                tenantId,
                send: {
                  status: 'failed',
                  endedAt: new Date().toISOString(),
                  errorCategory: classified.category,
                  errorDetail: classified.detail,
                  // Labelled for Task 3; Task 2 never acts on it.
                  retryable: isRetryableCategory(classified.category),
                },
                note: classified.detail,
              }, trace);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Webhook processing exception:', err);
      noteWebhookFailure({ kind: 'exception', detail: err?.message || String(err) });
    }
  });

  // Get active inbox chats (GET /api/inbox-chats)
  app.get('/api/inbox-chats', (req, res) => {
    const tenantId = getTenantId(req);
    res.json({ chats: getChatsForTenant(tenantId) });
  });

  /**
   * Pause / resume the AI bot for one conversation (POST
   * /api/inbox-chats/:id/takeover). The flag is persisted, so the webhook
   * honours it across redeploys and an agent can safely take a thread over.
   */
  app.post('/api/inbox-chats/:id/takeover', (req, res) => {
    const tenantId = getTenantId(req);
    const chat = getChatById(req.params.id);
    if (!chat) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (chat.tenantId !== tenantId) {
      return res.status(403).json({ error: 'This conversation belongs to another tenant' });
    }

    const updated = setHumanTakeover(chat.id, Boolean(req.body?.humanTakeover));
    console.log(
      `[inbox] Human takeover set to ${updated?.humanTakeover} for ${chat.id} by tenant ${tenantId}`
    );
    res.json({ chat: updated });
  });

  /**
   * Send a manual agent reply (POST /api/inbox-chats/:id/reply). Used while
   * human takeover is on: the text goes out over the Instagram Messaging API
   * and is stored in the conversation history.
   */
  app.post('/api/inbox-chats/:id/reply', async (req, res) => {
    const tenantId = getTenantId(req);
    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Reply text is required' });
    }

    const chat = getChatById(req.params.id);
    if (!chat) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (chat.tenantId !== tenantId) {
      return res.status(403).json({ error: 'This conversation belongs to another tenant' });
    }

    // A paused account is a HARD stop, not just an AI stop: during the incident
    // that motivated the switch, a human reply would have restarted the flood.
    if (!isBotEnabled(chat.tenantId).enabled) {
      return res
        .status(409)
        .json({ code: 'BOT_PAUSED', error: M(langFromRequest(req), 'access.paused') });
    }

    const decryptedToken = getDecryptedTokenForTenant(chat.tenantId);
    if (!decryptedToken) {
      return res.status(400).json({ error: 'No connected Instagram account for this tenant' });
    }

    try {
      const sendResult = await sendInstagramMessage(
        chat.instagramAccountId,
        chat.senderId,
        text,
        decryptedToken,
        getTenantByInstagramAccountId(chat.instagramAccountId)?.connection.authMode
      );
      // Store the message even when delivery failed, so the agent sees what happened.
      const updated = appendOutboundMessage(chat.id, 'agent', text);
      return res.json({
        delivered: sendResult.success,
        error: sendResult.success ? undefined : sendResult.error,
        chat: updated,
      });
    } catch (err: any) {
      console.error('[inbox] Failed to send manual agent reply:', err);
      return res.status(500).json({ error: formatMetaError(err) });
    }
  });

  // ==========================================
  // 4. SIMULATOR ENDPOINT (TESTING & SANDBOX)
  // ==========================================
  app.post('/api/simulate-dm', async (req, res) => {
    try {
      const { message, systemPrompt, knowledgeBase, conversationHistory = [] } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Demo Mode is the only way to reach an AI reply without signing in, so it
      // gets a per-visitor budget. A signed-in tenant is metered by its plan.
      const simTenantId = (req as RequestWithTenant).tenantId || DEMO_TENANT_ID;
      if (simTenantId === DEMO_TENANT_ID) {
        const ip = clientIp(req);
        if (demoSimulationRateLimited(ip)) {
          console.warn(`Demo simulator rate limited for ${ip}`);
          return res.status(429).json({
            success: false,
            error: 'Too many demo messages from this browser — please wait a few minutes and try again.',
          });
        }
      } else {
        // A signed-in tenant actually ran the simulator, which is the act the
        // guide's "test the bot" step asks for. Recording it here — the only
        // place it can be observed — is what stops that step from being ticked
        // by a client that never sent a test message at all.
        markSimulatorTested(simTenantId);
      }

      const basePrompt = systemPrompt || 'You are an expert AI sales and support agent for Instagram DMs. Be concise, friendly, and helpful.';
      const kbContext = knowledgeBase ? `\n\nBusiness Knowledge Base & FAQs:\n${knowledgeBase}` : '';
      const historyContext = conversationHistory.map((m: any) => `${m.sender === 'customer' ? 'Customer' : 'AI'}: ${m.text}`).join('\n');

      const fullPrompt = `${basePrompt}${kbContext}\n\nRecent Conversation History:\n${historyContext}\n\nCustomer: "${message}"\n\nAI Response:`;

      // Multi-tenant rule: for a signed-in tenant the simulator MUST test that
      // tenant's own stored persona and knowledge base — never a client-supplied
      // prompt, never another tenant's data, never any global business content.
      // (DEMO_TENANT_ID visitors have no tenant state at all, so the generic
      // default prompt with an empty KB is exactly what they should get.)
      let simSystemPrompt = systemPrompt;
      let simPersona = '';
      let simKnowledgeBase = knowledgeBase;
      if (simTenantId !== DEMO_TENANT_ID) {
        const own = getTenantAiContext(simTenantId);
        simSystemPrompt = own.systemPrompt;
        simPersona = own.persona;
        simKnowledgeBase = own.knowledgeBase;
      }

      const aiResult = await generateAiReply({
        systemPrompt: [simSystemPrompt, simPersona, ANSWERING_RULES].filter(Boolean).join('\n\n'),
        userMessage: message,
        knowledgeBase: simKnowledgeBase,
        conversationHistory,
      });

      res.json({
        reply: aiResult.reply,
        provider: aiResult.provider,
        model: aiResult.model,
        creditsUsed: aiResult.creditsUsed,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Simulation error:', err);
      res.status(500).json({ error: 'Failed to generate simulation response' });
    }
  });

  // ==========================================
  // 5. META COMPLIANCE PAGES
  // ==========================================
  app.post('/api/webhook/data-deletion', (req, res) => {
    const appUrl = getPublicAppUrl(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const signedRequest = typeof body.signed_request === 'string' ? body.signed_request : '';

    // Instagram-Login apps are signed with the Instagram app secret, Facebook-
    // Login apps with the app secret, and this app has been both — so try each
    // and remember which one matched, exactly like the webhook does.
    const candidates: Array<{ name: string; secret: string }> = [
      { name: 'META_APP_SECRET', secret: META_APP_SECRET },
      { name: 'IG_APP_SECRET', secret: process.env.IG_APP_SECRET || '' },
    ].filter((c) => Boolean(c.secret));

    let payload: any = null;
    let verifiedWith: string | undefined;
    for (const candidate of candidates) {
      payload = parseSignedRequest(signedRequest, candidate.secret);
      if (payload) {
        verifiedWith = candidate.name;
        break;
      }
    }

    if (!payload) {
      console.warn(
        `DATA_DELETION_REJECTED: signed_request missing or signature did not match. ` +
          `body-bytes=${(req as RequestWithRawBody).rawBody?.length ?? 0} secrets=${JSON.stringify(
            candidates.map((c) => c.name)
          )}`
      );
      res.status(400).json({ error: 'Invalid signed_request' });
      return;
    }

    const userId = String(payload.user_id || '').trim();
    const match = userId ? getTenantByInstagramAccountId(userId) : null;
    const tenantId = match?.tenantId || null;

    const deleted = {
      connection: false,
      chats: 0,
      leads: 0,
      aiSettings: false,
    };

    if (tenantId) {
      deleted.connection = disconnectAccount(tenantId);
      deleted.chats = deleteChatsForTenant(tenantId);
      deleted.leads = deleteLeadsForTenant(tenantId);
      deleted.aiSettings = deleteTenantAiSettings(tenantId);
      console.log(
        `DATA_DELETION_FULFILLED: tenant=${tenantId} ig=${match?.connection.instagramAccountId} ` +
          `connection=${deleted.connection} chats=${deleted.chats} leads=${deleted.leads} aiSettings=${deleted.aiSettings}`
      );
    } else {
      console.log(
        `DATA_DELETION_RECORDED: no tenant matched user_id=${userId || '(absent)'} — nothing on disk to delete`
      );
    }

    const code = newConfirmationCode();
    recordDataDeletion({
      code,
      requestedAt: new Date().toISOString(),
      userId,
      tenantId,
      instagramUsername: match?.connection.instagramUsername,
      deleted,
      verifiedWith,
    });

    res.json({
      url: `${appUrl}/data-deletion-status?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    });
  });

  // Where Meta's callback sends the user: must actually show the outcome of the
  // request, including the confirmation code Meta gave them.
  app.get('/data-deletion-status', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const record = code ? getDataDeletionRequest(code) : null;

    const known = record
      ? `
        <p>Confirmation code: <strong>${escapeHtml(record.code)}</strong></p>
        <p>Received: ${escapeHtml(new Date(record.requestedAt).toUTCString())}</p>
        <h2>What was deleted</h2>
        <ul>
          <li>Instagram connection and stored access token: ${record.deleted.connection ? 'deleted' : 'nothing stored'}</li>
          <li>Conversations and DM history: ${record.deleted.chats} conversation(s) deleted</li>
          <li>Leads (name and WhatsApp number): ${record.deleted.leads} lead(s) deleted</li>
          <li>AI settings and knowledge base: ${record.deleted.aiSettings ? 'deleted' : 'nothing stored'}</li>
        </ul>
        ${record.instagramUsername ? `<p>Instagram account: @${escapeHtml(record.instagramUsername)}</p>` : ''}
        <p>Nothing else about this account is kept: there is no copy in a backup queue, and the encrypted token is gone.</p>
      `
      : `
        <p>${
          code
            ? `We have no request recorded under <strong>${escapeHtml(code)}</strong>. Check the code, or ask us to look it up using the contact details below.`
            : 'Add <code>?code=</code> with the confirmation code Meta gave you to see the outcome of a specific request.'
        }</p>
      `;

    res.send(
      renderPolicyPage(
        'Data Deletion Status',
        `
        ${known}
        <h2>Not what you expected?</h2>
        <p>Write to us from the email on your account and quote the confirmation code — see <a href="/data-deletion">Data Deletion</a> for the full process.</p>
        `
      )
    );
  });

  // The instructions page Meta points at (App Settings → Basic → User data
  // deletion) and the one a Razorpay or Meta reviewer opens to check that a
  // deletion request can actually be honoured.
  app.get('/data-deletion', (_req, res) => {
    const { supportEmail } = getPublicBusinessInfo();
    const reachUs = supportEmail
      ? `email <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>`
      : 'use the details on our <a href="/contact">Contact Us</a> page';

    res.send(
      renderPolicyPage(
        'Data Deletion',
        `
        <p>InstaFlow AI processes Instagram direct messages on behalf of the business that connected its Instagram account. You can have that data deleted at any time.</p>

        <h2>1. What we store</h2>
        <ul>
          <li>The connected Instagram account id, username and profile picture.</li>
          <li>An access token for that account, encrypted at rest with AES-256-GCM (never in plaintext).</li>
          <li>The DM conversations the bot handled, so the business can read its own inbox.</li>
          <li>Leads a customer submitted through a booking page (name and WhatsApp number).</li>
          <li>The business's own system prompt and knowledge base.</li>
        </ul>

        <h2>2. Delete it via Meta (instant)</h2>
        <p>If you signed in with Instagram or Facebook, remove the app from your Instagram or Facebook settings. Meta sends that request straight to us at <code>/api/webhook/data-deletion</code>, we delete the records listed above, and Meta gives you a confirmation code. You can check the result on the <a href="/data-deletion-status">data deletion status</a> page by adding <code>?code=&lt;your code&gt;</code>.</p>

        <h2>3. Delete it by asking us</h2>
        <p>${reachUs} from the email address on your account, writing <em>"delete my data"</em> in the subject. We delete the same records and reply with a confirmation code, normally within 2 working days and always within 30 days as required by the GDPR.</p>

        <h2>4. What deletion means</h2>
        <p>The encrypted token is destroyed, so the bot immediately stops replying for that account. Conversations, leads, AI settings and knowledge base are removed from the running system; billing records needed for tax and accounting are kept for the period the law requires.</p>

        <h2>5. Automatic retention</h2>
        <p>Even without a request, chat history is kept for a limited period only (30 days by default) and lead records for 90 days, after which they are dropped automatically.</p>
        `
      )
    );
  });

  // Refund & cancellation policy. Razorpay asks for this explicitly during
  // account activation, and it must state the actual terms: how to cancel,
  // whether a partial month is refunded, and how long a refund takes.
  app.get('/refund-policy', (_req, res) => {
    res.send(
      renderPolicyPage(
        'Refund & Cancellation Policy',
        `
        <p>InstaFlow AI is sold as a monthly plan (Launch Offer, Starter, Growth, Agency). New accounts can start with the ₹99 Launch Offer — for the first 100 customers, for a limited time.</p>

        <h2>1. Launch Offer</h2>
        <p>The ₹99 payment opens the Launch Offer plan — the same limits as Starter — for one billing month. Nothing is charged automatically: there is no mandate or saved card, so when the month ends the bot stops sending new replies unless you buy again.</p>
        <p>Each month you buy is ₹99 while the offer is still open; once the first 100 seats are taken or the offer period ends, the next month costs the normal Starter price of ₹999. No refund arises from the offer itself — the account simply needs a further plan to keep sending replies.</p>

        <h2>2. Cancellation</h2>
        <p>You can cancel at any time from your dashboard (Plan &amp; billing). After cancelling you keep the access you already paid for until the end of the current billing period; no further charge is made. We do not ask you to email us to cancel.</p>

        <h2>3. Refunds</h2>
        <p>We refund in the following situations:</p>
        <ul>
          <li><strong>Duplicate or double charge</strong> — refunded in full.</li>
          <li><strong>The service never worked for you</strong> — if the bot could not be made to reply to your Instagram account within 7 days of your first payment, and our support could not fix it, the full amount of that period is refunded.</li>
          <li><strong>Charged after cancelling</strong> — refunded in full.</li>
        </ul>
        <p>We do not refund a partial month requested mid-cycle, because cancelling already keeps the paid period active until it ends.</p>

        <h2>4. How to request a refund</h2>
        <p>Email us with your registered email address and the Razorpay payment id. We reply within 2 working days, and approved refunds are credited to the original payment method (UPI, card, netbanking or wallet) within 5-7 working days, depending on your bank.</p>

        <h2>5. Contact</h2>
        <p>For any billing question, use the details on our <a href="/contact">Contact Us</a> page.</p>
        `
      )
    );
  });

  // Contact page. A live domain with no way to reach a human is one of the
  // fastest ways to fail a payment-provider review, and the details are also
  // what Meta's data-deletion process points users at.
  // Contact page. A live domain with no way to reach a human is one of the
  // fastest ways to fail a payment-provider review, and the details are also
  // what Meta's data-deletion process points users at. There is deliberately no
  // phone number here: the complaint form below is the reachable channel, and it
  // routes to WhatsApp on the server without publishing the number.
  app.get('/contact', (req, res) => {
    const lang = langFromRequest(req);
    if (req.query.lang) res.setHeader('Set-Cookie', langCookieHeader(lang));
    const { supportEmail, businessAddress } = getPublicBusinessInfo();
    const details = [
      supportEmail ? `<p>Email: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></p>` : '',
      businessAddress ? `<p>Address: ${escapeHtml(businessAddress)}</p>` : '',
    ].filter(Boolean).join('\n');

    res.send(
      renderPolicyPage(
        'Contact Us',
        `
        <p>InstaFlow AI is an Instagram DM automation service for businesses. We answer every message ourselves — there is no ticket queue.</p>
        ${details || '<p style="color:#b45309">Support contact details are being finalised. If you reached this page from a payment provider review, please write to the email address shown on your invoice.</p>'}
        <h2>Have a problem? Send a complaint</h2>
        <p>Write what went wrong below. It reaches us on WhatsApp straight away and a human replies on the number you give.</p>
        ${renderComplaintForm(lang)}
        <h2>Support hours</h2>
        <p>Monday to Saturday, 10:00-19:00 IST. Setup problems are answered within one working day; billing questions within two.</p>
        <h2>What we can help with</h2>
        <ul>
          <li>Connecting your Instagram account and getting the first reply working</li>
          <li>Filling your knowledge base so the bot stops giving generic answers</li>
          <li>Billing, invoices, plan changes and cancellations</li>
          <li>Deleting your data (see the <a href="/privacy-policy">Privacy Policy</a>)</li>
        </ul>
        <h2>Business details</h2>
        <p>${escapeHtml(getPublicBusinessInfo().businessName)}${businessAddress ? ` · ${escapeHtml(businessAddress)}` : ''}</p>
        `
      )
    );
  });

  app.get('/privacy-policy', (req, res) => {
    res.send(`
      <!doctype html>
      <html lang="en">
        <head><title>Privacy Policy - InstaFlow AI</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;background:#0B0B0F;color:#FFFFFF;}</style></head>
        <body>
          <h1>Privacy Policy</h1>
          <p>Last updated: September 29, 2026</p>
          <p>InstaFlow AI ("we", "our", or "us") respects your privacy and is committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our multi-tenant Instagram AI automation SaaS platform.</p>
          <h2>1. Information We Collect</h2>
          <p>We collect business profile information, Instagram page credentials (encrypted at rest with AES-256-GCM), knowledge base FAQs, and conversation logs necessary to provide AI-powered customer support automation.</p>
          <h2>2. Data Security & Zero-Knowledge Encryption</h2>
          <p>All sensitive tokens and business secrets are encrypted at rest with AES-256-GCM. We never store or log plaintext access tokens or secrets.</p>
          <h2>3. Your Data Rights &amp; Deletion</h2>
          <p>You can ask us to delete your data at any time. Requests sent through Meta are honoured automatically and answered with a confirmation code you can check at any time — the full process, and what gets removed, is on the <a href="/data-deletion">Data Deletion</a> page.</p>
          <h2>4. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy${getPublicBusinessInfo().supportEmail ? `, write to ${escapeHtml(getPublicBusinessInfo().supportEmail)}` : ''} or use our <a href="/contact">Contact Us</a> page.</p>
        </body>
      </html>
    `);
  });

  app.get('/terms-of-service', (req, res) => {
    res.send(`
      <!doctype html>
      <html lang="en">
        <head><title>Terms of Service - InstaFlow AI</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;background:#0B0B0F;color:#FFFFFF;}</style></head>
        <body>
          <h1>Terms of Service</h1>
          <p>Last updated: September 23, 2026</p>
          <p>Welcome to InstaFlow AI. By accessing or using our platform, you agree to be bound by these Terms of Service.</p>
          <h2>1. Use of Service</h2>
          <p>You agree to use InstaFlow AI in compliance with Meta Platform Terms and Instagram Community Guidelines.</p>
          <h2>2. Subscription & Billing</h2>
          <p>Services are billed on a monthly subscription basis through Razorpay. You may cancel your subscription at any time from your dashboard, and the paid period stays active until it ends.</p>
          <h2>3. Refunds & Cancellation</h2>
          <p>Refunds and cancellations are governed by our <a href="/refund-policy">Refund &amp; Cancellation Policy</a>, which forms part of these terms.</p>
          <h2>4. Instagram & Meta Compliance</h2>
          <p>You confirm that the Instagram account you connect is yours or that you are authorised to manage it, and that your use of automated replies complies with Meta Platform Terms and Instagram's messaging policies. We may suspend an account that Meta has restricted.</p>
          <h2>5. Governing Law</h2>
          <p>These terms are governed by the laws of India, and disputes are subject to the jurisdiction of Indian courts.</p>
          <h2>6. Contact</h2>
          <p>Questions about these terms: see our <a href="/contact">Contact Us</a> page.</p>
        </body>
      </html>
    `);
  });

  // ==========================================
  // 5b. HEALTHCHECK (GET /healthz)
  // ==========================================
  // Deliberately cheap and dependency-free so a load balancer can gate traffic
  // on it: Railway will only cut over to a new deploy once this returns 200.
  // Reports configuration as booleans only, never secret values.
  const aiStatus = getAiConfigStatus();
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      // Which build is actually live — the fastest way to tell "my fix did not
      // work" apart from "my browser is showing me the old bundle".
      buildId: BUILD_ID,
      uptimeSeconds: Math.round(process.uptime()),
      nodeEnv: process.env.NODE_ENV || 'development',
      aiProvider: aiStatus.primary.provider,
      // The model name we would actually call (after retired-name remapping)
      // plus the host's raw value, so "the bot answers with the canned reply"
      // can be diagnosed from outside without reading the host's env. Names
      // only — never the key.
      // Primary = the FIRST provider the reply chain actually calls
      // (OmniRoute -> Gemini). OpenRouter is dormant in the chain.
      aiModel: aiStatus.primary.model,
      aiModelConfigured: aiStatus.primary.modelConfigured,
      aiGeminiModel: aiStatus.gemini.model,
      metaConfigured: Boolean(META_APP_ID && META_APP_SECRET && META_VERIFY_TOKEN),
      webhookSignatureEnforced: webhookSecrets().length > 0 && !WEBHOOK_SIGNATURE_WARN,
      webhookSignatureMode: WEBHOOK_SIGNATURE_MODE,
      webhookSecretsConfigured: webhookSecrets().map((s) => s.label),
      instagramLoginConfigured: Boolean(IG_APP_ID && IG_APP_SECRET),
      dedupeTrackedIds: getMessageDedupeStats().trackedIds,
      inboxConversations: getChatStoreStats().conversations,
      humanTakeovers: getChatStoreStats().humanTakeovers,
      tenantsWithCustomAiSettings: getTenantSettingsStats().customisedTenants,
      knowledgeDocuments: getTenantSettingsStats().knowledgeItems,
      kbGapsTracked: getKbGapStats().trackedQuestions,
      testerRequestsTotal: getTesterRequestStats().total,
      testerRequestsPending: getTesterRequestStats().pending,
    newLeads: getLeadStats().newLeads,
    pendingCheckouts: getSubscriptionStats().pendingOrders,
    paymentsConfigured: isPaymentsConfigured(),
      activeSubscriptions: getSubscriptionStats().active,
      trialingSubscriptions: getSubscriptionStats().trialing,
      // Count only — COMP_TENANT_IDS contents are not exposed.
      compedTenants: getCompedTenantIds().length,
      // What a payment-provider review looks for on the public pages: a name,
      // an email and a way to reach a human. The public complaint form is
      // reachable without a login on every page, so a support address plus that
      // channel is what "contactable" means now. Reported as a boolean only.
      supportContactConfigured: Boolean(
        getPublicBusinessInfo().supportEmail && getPublicBusinessInfo().businessName
      ),
      // The complaint form's WhatsApp relay. False means complaints are still
      // accepted and stored, but nobody is pinged on WhatsApp until the host is
      // configured. Never reports the number itself.
      complaintWhatsAppConfigured: isOwnerWhatsAppConfigured(),
      complaintWhatsAppTarget: getOwnerWhatsAppLabel(),
      complaintsOpen: getComplaintStats().open,
      complaintsUndelivered: getComplaintStats().undelivered,
      // Bot defence: whether connected accounts are isolated from each other, the
      // burst cap, and how many replies were refused since boot. Counters only —
      // this is how "the loop is really stopped" gets checked from outside.
      botIsolationEnabled: isBotIsolationEnabled(),
      botGuard: getBotGuardStats(),
      // Task 2 instrumentation: where DM replies are failing, by count and by
      // category. Aggregate numbers and safe categories only — no message text,
      // no raw sender ids, no secrets. Full records stay on the owner endpoint.
      messageTrace: getTraceHealth(),
      // Task 3 instrumentation: retry-queue depth, capacity and counters.
      // Numbers only — never message text, recipient ids or tokens.
      retryQueue: getRetryQueueStats(),
      customerHealth: {
        monitoring: true,
        openIncidents: getOpenIncidentCount(),
        alertEmailConfigured: isEmailAlertConfigured(),
        alertChannels: getAlertChannelStatus(),
      },
      // Which Meta app this deployment actually connects through, and how many
      // connected accounts Meta currently refuses a token for. Both are answers
      // to "why is the bot silent for this account?" — counts and public ids
      // only, never a secret.
      oauthApp: {
        flavour: getOAuthAppIdentity().flavour,
        clientId: getOAuthAppIdentity().oauthClientId,
        instagramAppId: getOAuthAppIdentity().instagramAppId,
        facebookAppId: getOAuthAppIdentity().facebookAppId,
      },
      connectionsNeedingReauth: listConnections().filter((c) => c.liveState === 'NEEDS_REAUTH').length,
      // DMs that arrived for an account with no connection behind them: the
      // exact signature of "the bot stopped answering" from the customer's side.
      unroutedDeliveries: {
        total: getUnroutedDeliveryStats().total,
        lastAt: getUnroutedDeliveryStats().lastAt,
        accounts: getUnroutedDeliveryStats().recent.map((entry) => entry.igAccountId),
      },
      // The owner's switches. `pausedAll` is the emergency brake; the per-account
      // switch count is deliberately a number, not a list of customers.
      botsPausedAll: getBotControlStats().pausedAll,
      botsSwitchedOff: getBotControlStats().pausedTenants,
      // Accounts the owner took off the console's list (hidden, restorable) and
      // accounts deleted for good. Counts only — the tenant ids stay behind the
      // owner gate, so this stays a number a load balancer can read.
      accountsHidden: getAccountRemovalStats().hidden,
      accountsRemoved: getAccountRemovalStats().removed,
      // Why connects fail, and where one Instagram account is connected twice.
      // The second is a live production issue: two tenants on one IG account means
      // the webhook can only ever route that account's DMs to one of them.
      connectAttempts: getConnectAttemptStats(),
      sharedInstagramAccounts: getSharedInstagramAccounts().map((entry) => ({
        igAccountId: entry.instagramAccountId,
        username: entry.instagramUsername,
        routedTo: entry.routedTo,
        tenantCount: entry.tenantIds.length,
      })),
    });
  });

  // ==========================================
  // 5b. PUBLIC HOME PAGE
  // ==========================================
  // Registered before the SPA below so a logged-out visitor (and any review of
  // this domain) gets the real product page at `/`, while the dashboard itself
  // lives at `/app`.
  app.get('/', (req, res) => {
    const lang = langFromRequest(req);
    if (req.query.lang) res.setHeader('Set-Cookie', langCookieHeader(lang));    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); // a fresh banner save must reach every visitor at once
    const offer = isLaunchOfferAvailable()
      ? { sold: launchOfferSold(), cap: LAUNCH_OFFER_CAP }
      : null;
    return res.send(renderLandingPage(getPurchasablePlans(), lang, getPublicBanner(), offer));
  });

  // ==========================================
  // 6. FRONTEND SERVING (DEV VS PROD)
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Vite answers `/` with `index.html` on its own, but nothing maps the pretty
    // `/ops` URL onto `ops.html`. Run that shell through Vite's HTML transform so
    // the dev server gets the same module graph (and HMR) the dashboard has.
    app.get('/ops', async (_req, res, next) => {
      try {
        const shell = await fs.promises.readFile(path.join(process.cwd(), 'ops.html'), 'utf8');
        const html = await vite.transformIndexHtml('/ops.html', shell);
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } catch (err) {
        // Hand a build error back to Vite so its overlay shows up, instead of a
        // bare Express error page that hides the real cause.
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Vite fingerprints every asset, so hashed files can be cached forever while
    // the HTML shell must never be cached — otherwise a returning visitor keeps
    // loading a bundle that predates the deploy.
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    // The owner console is a separate app with its own shell. Registered before
    // the dashboard's catch-all so the SPA fallback cannot swallow it, and it is
    // the only URL that ever hands the owner bundle to a browser.
    app.get('/ops', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      fs.readFile(DIST_OPS_HTML, 'utf8', (err, html) => {
        if (err) {
          console.warn('Could not read dist/ops.html for /ops:', err.message);
          return res
            .status(404)
            .type('text')
            .send('The owner console bundle is missing from this build.');
        }
        res.type('html').send(stampBuildId(html));
      });
    });

    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      // Stamp the running build id into the shell so an already-open tab can tell
      // it is out of date (see /api/version).
      fs.readFile(DIST_INDEX_HTML, 'utf8', (err, html) => {
        if (err) {
          console.warn('Could not read dist/index.html to stamp the build id:', err.message);
          return res.sendFile(DIST_INDEX_HTML);
        }
        res.type('html').send(stampBuildId(html));
      });
    });
  }

  // Body-parser failures must answer in JSON: the dashboard reads JSON, and an
  // HTML "Payload Too Large" page surfaced in the console as a meaningless
  // "Save failed (413)" with no hint about what to do.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        code: 'BODY_TOO_LARGE',
        error: 'That file is too large — the banner must be under about 3 MB.',
      });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, code: 'BAD_JSON', error: 'Malformed request body.' });
    }
    console.error('Unhandled request error:', err);
    return res.status(500).json({ success: false, error: 'The server could not complete that request.' });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : PORT;
    console.log(`InstaFlow AI Server running on http://localhost:${boundPort}`);
    // Fire-and-forget: never make the server (or a deploy's healthcheck) wait on
    // a third party. This only prints a line saying whether the configured AI
    // model still exists — see the function for why that is worth a request.
    void verifyOpenRouterModelAtBoot();
    // Same fire-and-forget spirit: a mistyped OmniRoute model id (or the
    // unreachable localhost default on a hosted box) gets one boot-time log
    // line instead of silently failing every backup attempt later.
    void verifyOmniRouteModelAtBoot();

    // Connection health, checked on a slow loop.
    //
    // A token can die with nothing changing here (the account removes the app in
    // Instagram, or a tester accepted an invite on a different Meta app), and the
    // only place that shows up today is a DM that gets no reply. One `/me` call
    // per connected account every few hours makes it visible in the console
    // first. Sequential inside the sweep, and unref'd so it never keeps the
    // process alive on its own.
    // One sweep shortly after boot, so a token that died while the deploy was in
    // flight is already visible in the console the first time the owner opens it
    // — instead of waiting up to the full interval. Delayed past the platform's
    // healthcheck cutover, and it is the same sequential call as the timer.
    const BOOT_HEALTH_SWEEP_DELAY_MS = 60 * 1000;
    const bootSweep = setTimeout(() => {
      void checkAllConnectionHealth()
        .then((sweep) =>
          console.log(
            `CONNECTION_HEALTH (boot): ${sweep.checked} checked, ` +
              `${sweep.needingReauth.length} need a reconnect, ${sweep.unreachable.length} could not be told.`
          )
        )
        .catch((err) => console.warn('CONNECTION_HEALTH boot sweep failed:', err?.message || err));
    }, BOOT_HEALTH_SWEEP_DELAY_MS);
    bootSweep.unref?.();

    const CONNECTION_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const healthTimer = setInterval(() => {
      void checkAllConnectionHealth()
        .then((sweep) => {
          if (sweep.needingReauth.length || sweep.unreachable.length) {
            console.warn(
              `CONNECTION_HEALTH: ${sweep.needingReauth.length} account(s) need a reconnect, ` +
                `${sweep.unreachable.length} could not be checked (of ${sweep.checked}).`
            );
          }
        })
        .catch((err) => console.warn('CONNECTION_HEALTH sweep failed:', err?.message || err));
    }, CONNECTION_HEALTH_INTERVAL_MS);
    healthTimer.unref?.();
  });
}

startServer();
