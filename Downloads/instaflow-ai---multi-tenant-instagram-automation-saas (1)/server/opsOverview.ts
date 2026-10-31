import { Lang } from './i18n';
import {
  TRIAL_DAYS,
  decideAccess,
  getCompedTenantIds,
  getOwnerTenantIds,
  getPlan,
  isCompedTenant,
  listSubscriptions,
  type Subscription,
} from './planStore';
import { isPaymentsConfigured } from './payments';
import { listConnections } from './connectionStore';
import { getLeadCountsByTenant } from './leadStore';
import { getChatCountsByTenant } from './chatStore';
import { getSettingsCountsByTenant } from './tenantSettings';
import { getKbGapCountsByTenant } from './kbGapStore';
import {
  listTesterRequests,
  type TesterRequest,
  type TesterRequestStatus,
} from './testerRequestStore';
import {
  getActivationState,
  listActivationStates,
  type ActivationState,
  type ActivationStatus,
} from './activationStore';
import {
  isAccountHidden,
  listHiddenAccounts,
  listRemovedAccounts,
  type HiddenAccountRecord,
  type RemovedAccountRecord,
} from './accountRemovalStore';
import { getLastConnectAttemptByTenant } from './connectAttemptStore';
import { getProfile } from './profileStore';
import { getCompRecord } from './compStore';
import { getHealthFactsByTenant, type TenantHealthRecord } from './tenantHealthStore';
import { getContact, maskPhone } from './contactStore';

/**
 * One row per account, for the owner-only Ops Console.
 *
 * Why this module exists at all: every other read path in the app is scoped to a
 * single tenant on purpose, so "how is everybody doing?" had no way to be asked —
 * the answer was one `check-tenant` command per customer. This joins the same
 * stores into one picture, and the route that serves it is gated on
 * `OWNER_TENANT_IDS` (see `/api/owner/tenants` in server.ts).
 *
 * Two rules keep it honest:
 *   - it is read-only, so opening it can never change a customer's account;
 *   - it carries no secrets — the Instagram side goes through the same redacted
 *     `SafeConnectionStatus` the customer sees, never a token.
 */

export interface TenantOverviewRow {
  tenantId: string;
  /**
   * The customer's own readable name (`profileStore`), or null before they have
   * picked one. This is what the console shows next to the uid — a uid is 28
   * unreadable characters, and support conversations need a name.
   */
  username: string | null;
  /** One of the ids in OWNER_TENANT_IDS: never billed, full access. */
  isOwner: boolean;
  /**
   * Never billed, never expires — the runtime comp list plus `COMP_TENANT_IDS`.
   *
   * `reason` says which of the two put it there: `owner-connected` (the owner was
   * the signed-in caller when that account's Instagram connect started) or
   * `manual` (flipped by hand in this console). `envListed` is true when the env
   * var is what keeps it free, in which case removing the record changes nothing.
   */
  freeForever: {
    active: boolean;
    reason: 'owner-connected' | 'manual' | null;
    markedBy: string | null;
    markedAt: string | null;
    envListed: boolean;
  };
  plan: {
    planId: string;
    planName: string;
    status: string;
    /** ISO end of the current period; null = never expires (owner/comped). */
    periodEndsAt: string | null;
    daysLeft: number | null;
    trialUsed: boolean;
    startedAt: string;
    updatedAt: string;
    amountPaidInr: number | null;
  } | null;
  bot: {
    allowed: boolean;
    /** Already localised by decideAccess, so the UI shows it verbatim. */
    reason: string;
    needsPlan: boolean;
    /** True when the OWNER switched this account off (not billing). */
    paused: boolean;
    /** 'tenant' = this account, 'global' = the emergency brake. */
    pausedSource: 'tenant' | 'global' | null;
  };
  instagram: {
    connected: boolean;
    username?: string;
    accountId?: string;
    status: string;
    connectedAt?: string;
    lastVerifiedAt?: string;
    lastError?: string;
    /** Token verified more than 7 days ago — Instagram drops tokens that idle. */
    verificationStale: boolean;
    /**
     * Result of the last LIVE check against Meta (`connectionHealth.ts`).
     *
     * `NEEDS_REAUTH` is the one that matters: the account is connected, the inbox
     * and booking page still work, but Meta refuses the stored token — the bot
     * cannot answer. It is deliberately separate from `connected`, so a dead
     * token is never displayed as a healthy account.
     */
    liveState: 'OK' | 'NEEDS_REAUTH' | 'UNREACHABLE' | 'NOT_CONNECTED' | 'UNKNOWN';
    liveDetail?: string;
    liveCheckedAt?: string;
    /**
     * Other tenants holding this SAME Instagram account.
     *
     * Non-empty is a routing collision, not a duplicate: the webhook maps an
     * account id to exactly one tenant, so whichever tenant is not on the index
     * receives their customers' DMs and answers nobody.
     */
    sharedWith: string[];
  };
  knowledge: {
    documents: number;
    customPrompt: boolean;
    openQuestions: number;
  };
  leads: {
    total: number;
    fresh: number;
    latestAt: string | null;
  };
  chats: {
    conversations: number;
    takeovers: number;
    lastMessageAt: string | null;
  };
  /**
   * The customer asked us to add their Instagram handle as a Tester.
   *
   * Present even on accounts whose Instagram shows "not connected": the request
   * is exactly the case where it cannot be connected yet, and without it the Ops
   * row had nothing to act on (the failed OAuth never learns the handle).
   */
  testerRequest: {
    username: string;
    status: TesterRequestStatus;
    requestedAt: string;
    updatedAt: string;
    note?: string;
  } | null;
  /**
   * The owner-facing activation lifecycle for this account. Tracks the account
   * from first connect through invitation, activation instructions, and a real
   * test-DM confirmation. Separate from testerRequest (which is about the Meta
   * tester invite) — an account can be invited but never activated, or activated
   * without ever needing a tester invite.
   */
  activationState: {
    tenantId: string;
    instagramUsername: string | null;
    instagramAccountId: string | null;
    status: ActivationStatus;
    connectedAt: string;
    updatedAt: string;
    invitationSentAt?: string;
    lastActionBy?: string;
    lastAction?: string;
    instructionSend?: {
      status: string;
      at: string;
      reason?: string;
      toMasked?: string | null;
    };
    whatsappConsent?: boolean;
    testDmConfirmedAt?: string;
  } | null;
  /**
   * The last thing we know about a connect attempt for this account.
   *
   * Almost always the whole answer to "why is it not connected": a refusal at
   * Instagram's consent screen, Meta's own error sentence, or a success that has
   * since been undone. Null means the customer has never tried.
   */
  connectAttempt: {
    at: string;
    stage: 'blocked' | 'error' | 'success';
    code?: string;
    message?: string;
    username?: string;
    source: string;
  } | null;
  /** Machine-readable flags the UI turns into badges. */
  attention: string[];
  /** Most recent activity across leads and chats — how the list is sorted. */
  lastActivityAt: string | null;
  /**
   * Customer registration timestamp — NEWEST-FIRST ordering MUST use this, not
   * the display name, array order or a formatted string.
   *
   * Source of truth, in priority order: the profile the customer chose on
   * first sign-in (`profiles.json` createdAt), else the plan subscription's
   * startedAt, else the Instagram connection time, else null (unknown — such
   * rows always sort LAST and are labelled in the UI). A label travels along
   * so the console can say which of the three timestamps was used.
   */
  createdAt: string | null;
  createdFrom: 'profile' | 'plan' | 'connection' | null;
  /**
   * Runtime message-lifecycle facts from tenantHealthStore — recorded from
   * real webhook/AI/send events, never synthetic. Nulls mean "not observed
   * while this process has been running".
   */
  health: {
    lastInboundAt: string | null;
    lastSendOkAt: string | null;
    lastSendFailAt: string | null;
    lastSendFailCategory: string | null;
    lastErrorAt: string | null;
    lastErrorCategory: string | null;
    lastErrorDetail: string | null;
    ambiguousLastAt: string | null;
  };
}

export interface TenantOverview {
  generatedAt: string;
  paymentsConfigured: boolean;
  trialDays: number;
  summary: {
    tenants: number;
    active: number;
    trialing: number;
    pastDue: number;
    noPlan: number;
    botsBlocked: number;
    /** Accounts the owner has switched off by hand. */
    botsPaused: number;
    InstagramConnected: number;
    InstagramDisconnected: number;
    /** Connected accounts whose token Meta refuses: they must reconnect. */
    connectionsNeedingReauth: number;
    /** Instagram account ids connected by more than one tenant. */
    sharedInstagramAccounts: number;
    trialsEndingSoon: number;
    emptyKnowledge: number;
    needsAttention: number;
    /** Tester invites still waiting to be sent from the Meta dashboard. */
    testerRequestsPending: number;
    /** Accounts the owner archived: off this list, data untouched, restorable. */
    hidden: number;
    /** Accounts deleted for good — kept only as a tombstone. */
    removed: number;
  };
  rows: TenantOverviewRow[];
  /**
   * The owner's to-do queue, pending first.
   *
   * The same facts also sit on each row, but a queue the owner has to hunt for by
   * expanding accounts is not a queue — this is the list they work down.
   */
  testerRequests: TesterQueueRow[];
  /**
   * Accounts the owner archived, and accounts deleted for good.
   *
   * Both travel in the same payload as the rows because the console has exactly
   * one fetch: an account that cannot be seen again — or restored — from the
   * screen that hid it is a delete with extra steps.
   */
  hiddenAccounts: HiddenAccountRecord[];
  removedAccounts: RemovedAccountRecord[];
}

const DAY_MS = 86_400_000;

export interface TesterQueueRow extends TesterRequest {
  /**
   * What the owner needs to reach the customer about this invite. The WhatsApp
   * number is read-only MASKED for the console view (the wa.me action link is
   * built with waDigits, which is not the raw stored number but the same digits
   * a wa.me link inherently reveals when the owner presses it — never rendered
   * as text). Language so the owner copies the right-language message.
   */
  contact: {
    maskedNumber: string | null;
    waDigits: string | null;
    language: 'en' | 'hi';
    consentGiven: boolean;
    optedOut: boolean;
    businessName: string | null;
  } | null;
}
/** Verified more than this long ago = worth re-verifying before it lapses. */
const STALE_VERIFICATION_MS = 7 * DAY_MS;
/** A trial with this many days left or fewer is called out in the console. */
const ENDING_SOON_DAYS = 1;

export function buildTenantOverview(lang: Lang): TenantOverview {
  const paymentsConfigured = isPaymentsConfigured();
  const ownerIds = getOwnerTenantIds();

  const subscriptions = listSubscriptions();
  const connections = listConnections();
  const leadCounts = getLeadCountsByTenant();
  const chatCounts = getChatCountsByTenant();
  const settingsCounts = getSettingsCountsByTenant();
  const gapCounts = getKbGapCountsByTenant();
  // Archived accounts are off the list on purpose. They are filtered here, at the
  // one place every row is built, so a hidden account cannot leak back in through
  // a store the console reads elsewhere (the tester queue included).
  const hiddenAccounts = listHiddenAccounts();
  const removedAccounts = listRemovedAccounts();
  const hiddenIds = new Set(hiddenAccounts.map((record) => record.tenantId));

  const healthByTenant = getHealthFactsByTenant();
  const attemptsByTenant = getLastConnectAttemptByTenant();
  const testerRequests: TesterQueueRow[] = listTesterRequests()
    .filter((request) => !hiddenIds.has(request.tenantId))
    .map((request) => {
      // Per-row contact so the queue needs no second fetch: "invite bheja, ab
      // message kaise bhejun" is answered in-place.
      const c = getContact(request.tenantId);
      const digits = c?.whatsappNumber ? c.whatsappNumber.replace(/\D/g, '') : null;
      return {
        ...request,
        contact: c
          ? {
              maskedNumber: c.whatsappNumber ? maskPhone(c.whatsappNumber) : null,
              // Only with consent — an opted-out customer is never handed to
              // the owner as a one-click target, by design.
              waDigits: c.consent.given && !c.optOut && digits ? digits : null,
              language: c.language || 'en',
              consentGiven: Boolean(c.consent.given),
              optedOut: Boolean(c.optOut),
              businessName: c.businessName || null,
            }
          : null,
      };
    });
  const testerRequestByTenant = new Map<string, TesterRequest>();
  testerRequests.forEach((request) => testerRequestByTenant.set(request.tenantId, request));

  const activationByTenant = new Map<string, ActivationState>();
  listActivationStates().forEach((state) => activationByTenant.set(state.tenantId, state));

  // A tenant can appear in any one store and nowhere else (someone who connected
  // Instagram but never picked a plan; someone who filled the knowledge base but
  // has no leads yet), so the union is the real customer list.
  const tenantIds = new Set<string>();
  subscriptions.forEach((sub) => tenantIds.add(sub.tenantId));
  connections.forEach((conn) => tenantIds.add(conn.tenantId));
  Object.keys(leadCounts).forEach((id) => tenantIds.add(id));
  Object.keys(chatCounts).forEach((id) => tenantIds.add(id));
  Object.keys(settingsCounts).forEach((id) => tenantIds.add(id));
  Object.keys(gapCounts).forEach((id) => tenantIds.add(id));
  // A tester request is often the *first* thing a new account leaves behind —
  // they connected nothing and saved nothing, because Meta refused the connect.
  testerRequests.forEach((request) => tenantIds.add(request.tenantId));
  ownerIds.forEach((id) => tenantIds.add(id));
  tenantIds.delete('');
  hiddenIds.forEach((id) => tenantIds.delete(id));

  const subscriptionByTenant = new Map<string, Subscription>();
  subscriptions.forEach((sub) => subscriptionByTenant.set(sub.tenantId, sub));

  const rows: TenantOverviewRow[] = [];

  tenantIds.forEach((tenantId) => {
    const sub = subscriptionByTenant.get(tenantId) || null;
    const plan = sub ? getPlan(sub.planId) : null;
    const connection = connections.find((c) => c.tenantId === tenantId);
    const knowledge = settingsCounts[tenantId] || { documents: 0, customised: false };
    const openQuestions = gapCounts[tenantId] || 0;
    const leads = leadCounts[tenantId] || { total: 0, fresh: 0, latestAt: null };
    const chats = chatCounts[tenantId] || { conversations: 0, takeovers: 0, lastMessageAt: null };
    const testerRequest = testerRequestByTenant.get(tenantId) || null;

    const periodEndsAt = sub?.currentPeriodEnd || null;
    const daysLeft = periodEndsAt ? Math.ceil((Date.parse(periodEndsAt) - Date.now()) / DAY_MS) : null;

    const verifiedAt = connection?.lastVerifiedAt ? Date.parse(connection.lastVerifiedAt) : NaN;
    const verificationStale = Boolean(connection?.isConnected) && (
      !Number.isFinite(verifiedAt) || Date.now() - verifiedAt > STALE_VERIFICATION_MS
    );

    const bot = decideAccess(tenantId, { paymentsConfigured, lang });

    const attention: string[] = [];
    if (!connection?.isConnected) attention.push('instagramMissing');
    else if (connection?.liveState === 'NEEDS_REAUTH') attention.push('tokenRejected');
    else if (connection?.lastError) attention.push('instagramError');
    else if (verificationStale) attention.push('tokenStale');
    // Connected, but the same Instagram account is also connected elsewhere. The
    // row looks perfect and the bot is silent for one of the two tenants.
    if ((connection?.sharedWith?.length || 0) > 0) attention.push('sharedInstagramAccount');
    // A paused bot is a deliberate decision, not a fault — it gets its own flag
    // so the console does not report the owner's own brake as "bot broke".
    if (bot.paused) attention.push('botPaused');
    else if (!bot.allowed) attention.push('botBlocked');
    if (knowledge.documents === 0) attention.push('knowledgeEmpty');
    else if (openQuestions >= 5) attention.push('manyOpenQuestions');
    if (sub?.status === 'trial' && daysLeft !== null && daysLeft <= ENDING_SOON_DAYS) attention.push('trialEnding');
    if (sub?.status === 'past_due') attention.push('pastDue');
    if (!sub && !bot.allowed) attention.push('neverPaid');
    if (testerRequest?.status === 'REQUESTED') attention.push('testerRequestPending');
    else if (testerRequest?.status === 'INVITATION_SENT' && !connection?.isConnected) attention.push('testerInviteWaiting');

    const activityTimestamps = [leads.latestAt, chats.lastMessageAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((value) => Number.isFinite(value)) as number[];

    const profile = getProfile(tenantId);
    const compRecord = getCompRecord(tenantId);
    const healthFacts: TenantHealthRecord | undefined = healthByTenant[tenantId];

    // Registration timestamp: prefer the profile the customer created on first
    // sign-in (validated); the others are fallbacks with an explicit label.
    // A MISSING timestamp stays null — the UI labels it "unknown" and it sorts
    // last; it is never silently replaced by another kind of date.
    let createdAt: string | null = null;
    let createdFrom: 'profile' | 'plan' | 'connection' | null = null;
    const candidates: Array<{ value: string | null | undefined; from: 'profile' | 'plan' | 'connection' }> = [
      { value: profile?.createdAt, from: 'profile' },
      { value: sub?.startedAt, from: 'plan' },
      { value: connection?.connectedAt, from: 'connection' },
    ];
    for (const candidate of candidates) {
      if (candidate.value && Number.isFinite(Date.parse(candidate.value))) {
        createdAt = new Date(Date.parse(candidate.value)).toISOString();
        createdFrom = candidate.from;
        break;
      }
    }

    const ambiguousLastAt =
      healthFacts?.events.find((event) => event.kind === 'send-fail' && event.ambiguous)?.at || null;

    rows.push({
      tenantId,
      username: profile?.username || null,
      isOwner: ownerIds.includes(tenantId),
      freeForever: {
        active: isCompedTenant(tenantId),
        reason: compRecord?.reason || null,
        markedBy: compRecord?.markedBy || null,
        markedAt: compRecord?.markedAt || null,
        envListed: getCompedTenantIds().includes(tenantId),
      },
      plan: sub
        ? {
            planId: sub.planId,
            planName: plan?.name || sub.planId,
            status: sub.status,
            periodEndsAt,
            daysLeft,
            trialUsed: Boolean(sub.trialUsedAt),
            startedAt: sub.startedAt,
            updatedAt: sub.updatedAt,
            amountPaidInr: typeof sub.amountPaidInr === 'number' ? sub.amountPaidInr : null,
          }
        : null,
      bot: {
        allowed: bot.allowed,
        reason: bot.reason,
        needsPlan: bot.needsPlan,
        paused: Boolean(bot.paused),
        pausedSource: bot.paused ? bot.pausedSource || 'tenant' : null,
      },
      instagram: {
        connected: Boolean(connection?.isConnected),
        username: connection?.instagramUsername,
        accountId: connection?.instagramAccountId,
        status: connection?.status || 'DISCONNECTED',
        connectedAt: connection?.connectedAt,
        lastVerifiedAt: connection?.lastVerifiedAt,
        lastError: connection?.lastError,
        verificationStale,
        liveState: connection?.liveState || 'UNKNOWN',
        liveDetail: connection?.liveDetail,
        liveCheckedAt: connection?.liveCheckedAt,
        sharedWith: connection?.sharedWith || [],
      },
      knowledge: {
        documents: knowledge.documents,
        customPrompt: knowledge.customised,
        openQuestions,
      },
      connectAttempt: attemptsByTenant[tenantId] || null,
      testerRequest: testerRequest
        ? {
            username: testerRequest.username,
            status: testerRequest.status,
            requestedAt: testerRequest.requestedAt,
            updatedAt: testerRequest.updatedAt,
            note: testerRequest.note,
          }
        : null,
      activationState: (() => {
        const state = activationByTenant.get(tenantId);
        if (!state) return null;
        return {
          tenantId: state.tenantId,
          instagramUsername: state.instagramUsername,
          instagramAccountId: state.instagramAccountId,
          status: state.status,
          connectedAt: state.connectedAt,
          updatedAt: state.updatedAt,
          invitationSentAt: state.invitationSentAt,
          lastActionBy: state.lastActionBy,
          lastAction: state.lastAction,
          instructionSend: state.instructionSend,
          whatsappConsent: state.whatsappConsent,
          testDmConfirmedAt: state.testDmConfirmedAt,
        };
      })(),
      leads,
      chats,
      attention,
      lastActivityAt: activityTimestamps.length ? new Date(Math.max(...activityTimestamps)).toISOString() : null,
      createdAt,
      createdFrom,
      health: healthFacts
        ? {
            lastInboundAt: healthFacts.lastInboundAt,
            lastSendOkAt: healthFacts.lastSendOkAt,
            lastSendFailAt: healthFacts.lastSendFailAt,
            lastSendFailCategory: healthFacts.lastSendFailCategory,
            lastErrorAt: healthFacts.lastErrorAt,
            lastErrorCategory: healthFacts.lastErrorCategory,
            lastErrorDetail: healthFacts.lastErrorDetail,
            ambiguousLastAt,
          }
        : {
            lastInboundAt: null,
            lastSendOkAt: null,
            lastSendFailAt: null,
            lastSendFailCategory: null,
            lastErrorAt: null,
            lastErrorCategory: null,
            lastErrorDetail: null,
            ambiguousLastAt: null,
          },
    });
  });

  // Customers who need help first, then the most recently active.
  rows.sort((a, b) => {
    // "Needs a reconnect" sorts with the other urgent cases: the customer's bot is
    // silent and only they can fix it.
    const aUrgent = a.attention.some(
      (flag) => flag === 'botBlocked' || flag === 'instagramMissing' || flag === 'tokenRejected'
    );
    const bUrgent = b.attention.some(
      (flag) => flag === 'botBlocked' || flag === 'instagramMissing' || flag === 'tokenRejected'
    );
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.tenantId.localeCompare(b.tenantId);
  });

  const summary = {
    tenants: rows.length,
    active: rows.filter((row) => row.plan?.status === 'active').length,
    trialing: rows.filter((row) => row.plan?.status === 'trial').length,
    pastDue: rows.filter((row) => row.plan?.status === 'past_due').length,
    noPlan: rows.filter((row) => !row.plan).length,
    botsBlocked: rows.filter((row) => !row.bot.allowed).length,
    botsPaused: rows.filter((row) => row.bot.paused).length,
    InstagramConnected: rows.filter((row) => row.instagram.connected).length,
    InstagramDisconnected: rows.filter((row) => !row.instagram.connected).length,
    connectionsNeedingReauth: rows.filter((row) => row.instagram.liveState === 'NEEDS_REAUTH').length,
    sharedInstagramAccounts: rows.filter((row) => row.instagram.sharedWith.length > 0).length,
    trialsEndingSoon: rows.filter((row) => row.attention.includes('trialEnding')).length,
    emptyKnowledge: rows.filter((row) => row.attention.includes('knowledgeEmpty')).length,
    needsAttention: rows.filter((row) => row.attention.length > 0).length,
    testerRequestsPending: testerRequests.filter((request) => request.status === 'REQUESTED' || request.status === 'NEEDS_IDENTITY_CONFIRMATION' || request.status === 'READY_TO_INVITE').length,
    activationPending: rows.filter((row) => row.activationState?.status === 'CONNECTED_PENDING_ACTIVATION').length,
    activationInProgress: rows.filter((row) => row.activationState?.status && row.activationState.status !== 'CONNECTED_PENDING_ACTIVATION' && row.activationState.status !== 'FULLY_ACTIVE').length,
    activationComplete: rows.filter((row) => row.activationState?.status === 'FULLY_ACTIVE').length,
    hidden: hiddenAccounts.length,
    removed: removedAccounts.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    paymentsConfigured,
    trialDays: TRIAL_DAYS,
    summary,
    rows,
    testerRequests,
    hiddenAccounts,
    removedAccounts,
  };
}
