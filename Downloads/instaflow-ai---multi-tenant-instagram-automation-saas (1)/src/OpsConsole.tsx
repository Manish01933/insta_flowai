import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  KeyRound,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  Trash2,
  Unlink,
  UserPlus,
  Users,
  Wrench,
  AlertCircle,
} from 'lucide-react';
import HealthPanel from './HealthPanel';
import RootCauseBanner from './RootCauseBanner';
// OPS Onboarding board (owner-only): real metrics, server-validated lifecycle
// statuses and the idempotent quick actions. Mounted right after System Health
// so the owner reads every customer end-to-end in one screen.
import OpsOnboarding from './OpsOnboarding';
// Public-banner manager (owner-only): design size ki choice ke saath, live
// preview, save par window minimize + public page par live.
import OpsBannerManager from './OpsBannerManager';
// Video-library panel (owner-only): customer ko WhatsApp par jaane wale
// setup/demo video links — copy + wa.me actions.
import OpsVideosPanel from './OpsVideosPanel';
import {
  sortRows,
  filterRows,
  paginate,
  type SortField,
  type SortDir,
  type DatePreset,
  type DateFilter,
} from './customerListLogic';
import { apiFetch } from './api';
import { useI18n } from './i18n';

/**
 * Ops Console — the owner's view of every account in one screen.
 *
 * Why a separate screen: the dashboard is scoped to one tenant on purpose, so
 * there was no way to answer "kaun kitne paise pe hai, kiska bot band hai" without
 * running `check-tenant` once per customer. This joins the same stores into one
 * read-only table.
 *
 * Two deliberate choices:
 *   - it renders nothing but what `/api/owner/tenants` sends, and that route is
 *     gated on OWNER_TENANT_IDS — the tab is hidden for everyone else, but the
 *     real gate is on the server, so hiding it is convenience, not security;
 *   - every value comes from the same stores the customer's own screens read, and
 *     never from a token or a secret, so a screenshot of this page is safe to
 *     share and there is nothing here that changes an account.
 */

/** One row of the owner's retry-queue panel (mirrors server `RetryJobView`). */
interface RetryJobRow {
  jobId: string;
  tenantId: string;
  instagramAccountId: string;
  /** Trailing digits of the recipient id — enough to recognise, not to leak. */
  recipientMasked: string;
  replyText: string;
  attempts: number;
  maxAttempts: number;
  /** Epoch ms — when the sweeper will try this send next. */
  nextAttemptAt: number;
  createdAt: number;
  lastErrorCategory?: string;
  lastErrorDetail?: string;
}

/** What trial-extend reports back (mirrors server `SubscriptionExtension`). */
interface TrialExtension {
  tenantId: string;
  planId: string;
  status: string;
  previousEnd: string | null;
  newEnd: string;
  days: number;
}

/** One Instagram account held by two tenants (mirrors `getSharedInstagramAccounts`). */
interface SharedAccountRow {
  instagramAccountId: string;
  instagramUsername?: string;
  /** The tenant a DM from this account reaches today. */
  routedTo: string | null;
  tenantIds: string[];
}

interface OverviewPlan {
  planId: string;
  planName: string;
  status: string;
  periodEndsAt: string | null;
  daysLeft: number | null;
  trialUsed: boolean;
  startedAt: string;
  updatedAt: string;
  amountPaidInr: number | null;
}

type TesterRequestStatus =
  | 'REQUESTED'
  | 'NEEDS_IDENTITY_CONFIRMATION'
  | 'READY_TO_INVITE'
  | 'INVITATION_SENT'
  | 'ACCEPTANCE_PENDING'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED';

interface TesterRequest {
  tenantId: string;
  username: string;
  status: TesterRequestStatus;
  requestedAt: string;
  updatedAt: string;
  note?: string;
  /** The verified invitation destination URL, set when INVITATION_SENT. */
  invitationUrl?: string;
  /** The Meta app id this invitation must be accepted on. */
  metaAppId?: string;
  /** Timestamp the invitation was marked sent. */
  invitedAt?: string;
  /** Timestamp acceptance was recorded. */
  acceptedAt?: string;
  /** Who recorded acceptance. Meta exposes no acceptance API, so this is human evidence. */
  acceptedBy?: 'owner' | 'customer';
  /** True only if a reliable Meta signal confirmed it — always false today. */
  acceptanceVerified?: boolean;
  /** The recorded Meta-dashboard step: "this handle was added as a tester". */
  accountAddedAt?: string;
  accountAddedBy?: string;
  /** Outcome of the customer notification attempt for this invitation. */
  notify?: { status: string; at: string; reason?: string; toMasked?: string | null };
  /** Immutable audit trail of admin actions on this request. */
  auditLog?: { action: string; by: string; at: string; detail?: string }[];
  /** Enriched by buildTenantOverview: how to reach the customer about this invite. */
  contact?: {
    maskedNumber: string | null;
    waDigits: string | null;
    language: 'en' | 'hi';
    consentGiven: boolean;
    optedOut: boolean;
    businessName: string | null;
  } | null;
}

interface OverviewRow {
  tenantId: string;
  /** The customer's own readable name, or null before they have picked one. */
  username: string | null;
  isOwner: boolean;
  /**
   * Never billed, never expires. `reason` says what put it there, `envListed`
   * says the env var is what keeps it free (so turning the record off would not
   * change anything).
   */
  freeForever: {
    active: boolean;
    reason: 'owner-connected' | 'manual' | null;
    markedBy: string | null;
    markedAt: string | null;
    envListed: boolean;
  };
  plan: OverviewPlan | null;
  bot: {
    allowed: boolean;
    reason: string;
    needsPlan: boolean;
    /** Switched off by the owner, as opposed to blocked by billing. */
    paused: boolean;
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
    verificationStale: boolean;
    /** Live check against Meta — `NEEDS_REAUTH` means the bot cannot answer. */
    liveState: 'OK' | 'NEEDS_REAUTH' | 'UNREACHABLE' | 'NOT_CONNECTED' | 'UNKNOWN';
    liveDetail?: string;
    liveCheckedAt?: string;
    /** Other accounts holding this SAME Instagram account (a routing collision). */
    sharedWith: string[];
  };
  knowledge: { documents: number; customPrompt: boolean; openQuestions: number };
  /** The last connect attempt we know about. Usually the whole answer. */
  connectAttempt: {
    at: string;
    stage: 'blocked' | 'error' | 'success';
    code?: string;
    message?: string;
    username?: string;
    source: string;
  } | null;
  testerRequest: TesterRequest | null;
  leads: { total: number; fresh: number; latestAt: string | null };
  chats: { conversations: number; takeovers: number; lastMessageAt: string | null };
  attention: string[];
  lastActivityAt: string | null;
  /**
   * Customer registration timestamp (see opsOverview.ts for the source-priority
   * order) — the ONLY field the “newest first” default may sort on. Null =
   * unknown, always sorts last and is labelled in the UI, never faked.
   */
  createdAt: string | null;
  createdFrom: 'profile' | 'plan' | 'connection' | null;
  /** Owner-facing activation lifecycle state for this tenant's Instagram account. */
  activationState: {
    tenantId: string;
    instagramUsername: string | null;
    instagramAccountId: string | null;
    status: string;
    connectedAt: string;
    updatedAt: string;
    invitationSentAt?: string;
    lastActionBy?: string;
    lastAction?: string;
    instructionSend?: { status: string; at: string; reason?: string; toMasked?: string | null };
    whatsappConsent?: boolean;
    testDmConfirmedAt?: string;
    auditLog?: { action: string; by: string; at: string; detail?: string }[];
  } | null;
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

interface OverviewSummary {
  tenants: number;
  active: number;
  trialing: number;
  pastDue: number;
  noPlan: number;
  botsBlocked: number;
  botsPaused: number;
  InstagramConnected: number;
  InstagramDisconnected: number;
  connectionsNeedingReauth: number;
  sharedInstagramAccounts: number;
  trialsEndingSoon: number;
  emptyKnowledge: number;
  needsAttention: number;
  testerRequestsPending: number;
  /** Archived: off this list, data untouched, restorable. */
  hidden: number;
  /** Deleted for good: only a tombstone is left. */
  removed: number;
}

/** An account off the list, with everything needed to restore it. */
interface HiddenAccountRecord {
  tenantId: string;
  hiddenAt: string;
  hiddenBy: string;
  note?: string;
  instagramUsername?: string;
  planName?: string;
  planStatus?: string;
  leads?: number;
  chats?: number;
}

/** A deleted account. Counts of what was removed, never the content itself. */
interface RemovedAccountRecord {
  tenantId: string;
  removedAt: string;
  removedBy: string;
  note?: string;
  instagramUsername?: string;
  planName?: string;
  deleted: {
    connection: boolean;
    chats: number;
    leads: number;
    aiSettings: boolean;
    subscription: boolean;
    testerRequest: boolean;
    botControl: boolean;
    kbGaps: number;
  };
}

/**
 * One account a billing reset would clear, with the gate on either side of it.
 *
 * The pair is the point of the panel: `botBlockedNow` is the reason the owner
 * opened this, and `botAllowedAfter` is what the same check answers once the row
 * is gone — so "will this actually fix it?" is answered before anything is
 * written, not after.
 */
interface BillingResetRow {
  tenantId: string;
  username: string | null;
  planId: string;
  planName: string;
  status: string;
  periodEndsAt: string | null;
  trialUsed: boolean;
  botBlockedNow: boolean | null;
  botAllowedAfter: boolean;
}

interface BillingResetPreview {
  resetCount: number;
  reset: BillingResetRow[];
  skipped: { tenantId: string; reason: string }[];
}

interface GuardEvent {
  at: string;
  code: 'SENDER_IS_CONNECTED_ACCOUNT' | 'SENDER_USERNAME_IS_CONNECTED' | 'REPLY_BURST';
  igAccountId: string;
  tenantId: string;
  senderId: string;
  senderUsername?: string;
  senderTenantId?: string;
  handle?: string;
  replyCount?: number;
}

/** Bot-to-bot defence counters — how the owner sees that a loop really stopped. */
interface BotGuard {
  isolationEnabled: boolean;
  usernameResolutionEnabled: boolean;
  burstMax: number;
  burstWindowSeconds: number;
  messagesChecked: number;
  blockedIdentity: number;
  blockedUsername: number;
  blockedBurst: number;
  usernameLookups: number;
  usernameLookupFailures: number;
  cachedSenderProfiles: number;
  recent: GuardEvent[];
}

/**
 * "Is this bot actually answering?" — the stages the server walked, in order.
 *
 * The server reports facts (`ok`, a machine-readable `detail`), never a sentence: the
 * console owns the wording, so the answer exists in both languages instead of an
 * English one arriving pre-baked.
 */
type SelfTestStageKey = 'botSwitch' | 'access' | 'connection' | 'knowledge' | 'ai';

interface SelfTestStage {
  key: SelfTestStageKey;
  ok: boolean;
  detail?: string;
}

interface SelfTestResult {
  tenantId: string;
  ok: boolean;
  /** Always false. Present so nobody reads a dry run as a delivered DM. */
  sent: false;
  stages: SelfTestStage[];
  /** What the customer would have received, when every stage passed. */
  reply?: string;
  provider?: string;
  model?: string;
  elapsedMs: number;
  knowledgeDocuments: number;
  customPrompt: boolean;
  /**
   * Other tenants whose connection is the same Instagram account. One Instagram account
   * routes to one tenant, so the other side silently receives nothing — the collision
   * that reads as "this bot is dead" while every check here passes.
   */
  sharedWithTenants: string[];
}

/** Which accounts the owner has switched off, plus the global brake. */
interface BotControl {
  pausedAll: boolean;
  pausedAllAt: string | null;
  pausedAllBy: string | null;
  pausedTenants: string[];
}

/**
 * The Meta app this deployment connects through, spelled out by the server.
 *
 * Two different ids matter and they are not interchangeable: `oauthClientId` is
 * what Meta sees during a connect (so a tester invite has to be accepted on that
 * app), while the dashboard/roles links are built from the Facebook app id.
 */
interface OAuthAppIdentity {
  flavour: 'instagram_login' | 'facebook';
  oauthClientId: string | null;
  instagramAppId: string | null;
  facebookAppId: string | null;
  instagramLoginReady: boolean;
  appDashboardUrl: string | null;
  appRolesUrl: string | null;
  instagramApiSetupUrl: string | null;
}

/** A DM Meta delivered for an account this server has no connection for. */
interface UnroutedDelivery {
  at: string;
  igAccountId: string;
  senderId: string;
  preview: string;
}

interface UnroutedDeliveries {
  total: number;
  lastAt: string | null;
  recent: UnroutedDelivery[];
}

interface Overview {
  generatedAt: string;
  paymentsConfigured: boolean;
  trialDays: number;
  summary: OverviewSummary;
  rows: OverviewRow[];
  /** Pending first, then the finished ones. Hidden accounts are already excluded. */
  testerRequests: TesterRequest[];
  /** Accounts the owner took off the list — restorable, nothing deleted. */
  hiddenAccounts: HiddenAccountRecord[];
  /** Accounts deleted for good. Kept as proof, and to refuse a second trial. */
  removedAccounts: RemovedAccountRecord[];
  /** Meta App Dashboard → App Roles page for the app OAuth actually runs on. */
  metaRolesUrl: string | null;
  oauthApp: OAuthAppIdentity;
  unroutedDeliveries: UnroutedDeliveries;
  botGuard: BotGuard;
  botControl: BotControl;
}

interface Complaint {
  id: string;
  accountId: string;
  contact: string;
  problem: string;
  status: 'new' | 'resolved';
  notified: boolean;
  notifyError?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface ComplaintsPayload {
  total: number;
  stats: { total: number; open: number; undelivered: number };
  /** Whether the WhatsApp push is configured on the host at all. */
  whatsappConfigured: boolean;
  /** Masked destination, e.g. `+91******33` — enough to confirm the right number. */
  whatsappLabel: string;
  complaints: Complaint[];
}

type ConnectBlocker =
  | 'ALREADY_OK'
  | 'RECONNECT_NEEDED'
  | 'REVERIFY_NEEDED'
  | 'SERVER_NOT_READY'
  | 'TRY_FAILED'
  | 'INVITE_NOT_SENT'
  | 'INVITE_SENT_WAITING'
  | 'HANDLE_UNKNOWN'
  | 'SHARED_ACCOUNT';

/**
 * The server's answer to "why is this account not connected?" — structured, never
 * prose: the sentence the owner reads is looked up here by `blocker`, so the whole
 * answer exists in both languages instead of the English one arriving pre-baked.
 */
interface ConnectFixFacts {
  tenantId: string;
  blocker: ConnectBlocker;
  severity: 'ok' | 'action' | 'blocked';
  handle: string | null;
  handleSource: 'connection' | 'testerRequest' | 'attempt' | null;
  connected: boolean;
  receivesDms: boolean;
  liveState: 'OK' | 'NEEDS_REAUTH' | 'UNREACHABLE' | 'NOT_CONNECTED' | 'UNKNOWN';
  liveDetail?: string;
  connectedAt?: string;
  lastVerifiedAt?: string;
  testerRequest: {
    username: string;
    status: TesterRequestStatus;
    requestedAt: string;
    updatedAt: string;
  } | null;
  lastAttempt: {
    at: string;
    stage: 'blocked' | 'error' | 'success';
    code?: string;
    message?: string;
    username?: string;
    source: string;
  } | null;
  readiness: { ok: boolean; code: string | null; reason: string | null };
  /** The exact URI this server sends to Meta — pasted into Meta, byte for byte. */
  redirectUri: string;
  sharedWith: string[];
  routedTo: string | null;
  /**
   * Why Meta refused the token, read from `liveDetail`. Present only on a refused
   * (`NEEDS_REAUTH`) connection, and it changes the order of the reconnect steps —
   * accepting the tester invite has to come first in the most common case.
   */
  tokenRefusal: {
    cause:
      | 'NOT_AUTHORIZED_THIS_APP'
      | 'NOT_AUTHORIZED_OTHER_APP'
      | 'TOKEN_EXPIRED'
      | 'PASSWORD_CHANGED'
      | 'UNKNOWN';
    appId: string | null;
    appIdIsOurs: boolean;
  } | null;
  oauthApp: { flavour: string; clientId: string | null; facebookAppId: string | null };
}

const blockerTone: Record<ConnectBlocker, string> = {
  ALREADY_OK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REVERIFY_NEEDED: 'bg-slate-100 text-slate-700 border-slate-200',
  INVITE_NOT_SENT: 'bg-amber-50 text-amber-800 border-amber-200',
  INVITE_SENT_WAITING: 'bg-purple-50 text-purple-700 border-purple-200',
  TRY_FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  HANDLE_UNKNOWN: 'bg-amber-50 text-amber-800 border-amber-200',
  RECONNECT_NEEDED: 'bg-rose-50 text-rose-700 border-rose-200',
  SERVER_NOT_READY: 'bg-rose-50 text-rose-700 border-rose-200',
  SHARED_ACCOUNT: 'bg-rose-50 text-rose-700 border-rose-200',
};

/**
 * `readiness.code` values that have their own step-by-step wording. When the
 * server named the exact failure, those steps are the real instruction; the
 * generic SERVER_NOT_READY line ("fix the app id / secret / redirect URI")
 * only applies when there is nothing more specific to say — otherwise it sends
 * the owner to fix config that is already correct.
 */
const READINESS_STEP_CODES = ['REDIRECT_NOT_REACHABLE', 'NO_APP_ID', 'IG_APP_SECRET_MISSING'];

function fixStepsKey(fixPlan: ConnectFixFacts): string {
  const code = fixPlan.readiness.code;
  return code && READINESS_STEP_CODES.includes(code)
    ? `ops.fix.steps.${code}`
    : `ops.fix.steps.${fixPlan.blocker}`;
}

/**
 * Where the customer's “press Connect” link should point: the origin of the
 * server's own redirect URI — the public host Meta is whitelisted for — not the
 * browser's. An owner running the console on localhost still copies a working
 * live link that way. `isUnreachableHostUrl` then decides whether there is a
 * working link to offer at all (Meta never returns to localhost, so a link to
 * it can only waste the customer's time).
 */
function connectOriginOf(fixPlan: ConnectFixFacts): string {
  try {
    return new URL(fixPlan.redirectUri).origin;
  } catch {
    return typeof window === 'undefined' ? '' : window.location.origin;
  }
}

/** Client mirror of server.ts `isUnreachableRedirectUri`. */
function isUnreachableHostUrl(uri: string): boolean {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local')
    );
  } catch {
    return true;
  }
}

const AUTO_REFRESH_MS = 60_000;

const statusTone: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  trial: 'bg-purple-50 text-purple-700 border-purple-200',
  past_due: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const testerStatusTone: Record<TesterRequestStatus, string> = {
  REQUESTED: 'bg-rose-50 text-rose-700 border-rose-200',
  NEEDS_IDENTITY_CONFIRMATION: 'bg-amber-50 text-amber-700 border-amber-200',
  READY_TO_INVITE: 'bg-purple-50 text-purple-700 border-purple-200',
  INVITATION_SENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ACCEPTANCE_PENDING: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  EXPIRED: 'bg-slate-100 text-slate-600 border-slate-200',
  FAILED: 'bg-rose-100 text-rose-900 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
};

function CopyButton({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard is blocked outside a secure context; the text is on screen anyway.
    }
    setDone(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="px-2 py-0.5 rounded-md text-[10px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"
    >
      {done ? copied : label}
    </button>
  );
}

export default function OpsConsole() {
  const { t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [query, setQuery] = useState('');
  // The tester queue's own date window. The page-wide date filter is tied to
  // account rows (a different `ListRowLike` shape), so reusing it here would mean
  // widening that type for one list; a two-preset window answers the only real
  // question — "is this invite stale?".
  const [testerWindow, setTesterWindow] = useState<'all' | '7d' | '30d'>('all');

  // ── Activation queue state ─────────────────────────────────────────────
  const [activationBusy, setActivationBusy] = useState<string | null>(null);
  const [activationNotice, setActivationNotice] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);

  // ── Feature 2: date-wise customer browsing ──────────────────────────
  // Default = newest first by the REAL registration timestamp. The sort never
  // compares formatted strings; pagination always paginates the sorted list.
  const [sortChoice, setSortChoice] = useState<
    'created-desc' | 'created-asc' | 'activity-desc' | 'activity-asc'
  >('created-desc');
  const [dateFilterField, setDateFilterField] = useState<SortField>('created');
  const [dateFilter, setDateFilter] = useState<DateFilter>({ preset: 'all' as DatePreset });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  // Captured once per console mount: day-boundary math uses the app's local
  // timezone consistently, and a refresh re-captures it — tests inject their own.
  const nowRef = useRef(Date.now());
  const dir: SortDir = sortChoice.endsWith('-asc') ? 'asc' : 'desc';
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Which queue row is mid-write, so only that row's buttons go quiet.
  const [busyTenant, setBusyTenant] = useState<string | null>(null);
  const [complaints, setComplaints] = useState<ComplaintsPayload | null>(null);
  const [busyComplaint, setBusyComplaint] = useState<string | null>(null);
  // Which bot switch is mid-write. `'*'` is the global brake.
  const [busyBot, setBusyBot] = useState<string | null>(null);
  // Which account's "check this token" call is running (`'*'` = every account).
  const [busyHealth, setBusyHealth] = useState<string | null>(null);
  // Which account a hide / restore / delete is running for.
  const [busyRemoval, setBusyRemoval] = useState<string | null>(null);
  // The billing reset: what the last preview said it would clear, and the count
  // the owner has to type back before it is allowed to run.
  const [billingPreview, setBillingPreview] = useState<BillingResetPreview | null>(null);
  const [billingConfirm, setBillingConfirm] = useState('');
  const [billingBusy, setBillingBusy] = useState<'preview' | 'apply' | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingDone, setBillingDone] = useState<number | null>(null);
  // The typed-confirmation dialog — the one irreversible action in this console.
  const [confirmTarget, setConfirmTarget] = useState<OverviewRow | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // The outcome of the last hide / restore / delete, cleared by the next one.
  const [notice, setNotice] = useState<string | null>(null);
  /** One account at a time for the two identity actions below. */
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  // Which account's connect diagnosis is running (`'*'` = all of them).
  const [busyFix, setBusyFix] = useState<string | null>(null);
  // The diagnosis for one account, shown in a dialog.
  const [fixPlan, setFixPlan] = useState<ConnectFixFacts | null>(null);
  // What the server already did when the button was pressed (`liveCheck:OK`, …).
  const [fixAutoFixed, setFixAutoFixed] = useState<string[]>([]);
  // The all-accounts roster.
  const [fixRoster, setFixRoster] = useState<ConnectFixFacts[] | null>(null);
  // Which account's bot self-test is running, and its last result.
  const [busySelfTest, setBusySelfTest] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null);
  // Which copy button was pressed last, so only that one says "copied".
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // ── The three customer-error fix panels ─────────────────────────────────
  // Stuck / failed sends ("customer bole reply nahi aaya") and their buttons.
  const [retryRows, setRetryRows] = useState<RetryJobRow[]>([]);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Trial / period extend — stretches the billing row instead of wiping it.
  const [trialTenant, setTrialTenant] = useState('');
  const [trialDays, setTrialDays] = useState('7');
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialNotice, setTrialNotice] = useState<string | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  // Shared-account routing (KNOWN_ISSUES A4) — which tenant keeps the account.
  const [sharedRows, setSharedRows] = useState<SharedAccountRow[]>([]);
  const [routeBusy, setRouteBusy] = useState<string | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  /**
   * Best-effort reads for the fix panels (retry queue + shared accounts).
   * A failure here keeps the previous list instead of blanking the panel.
   */
  const refreshFixLists = useCallback(async (): Promise<void> => {
    try {
      const rRes = await apiFetch('/api/owner/retry-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
        cache: 'no-store',
      });
      const rPayload = await rRes.json().catch(() => null);
      if (rRes.ok && rPayload?.success && Array.isArray(rPayload.jobs)) {
        setRetryRows(rPayload.jobs as RetryJobRow[]);
        setRetryError(null);
      }
    } catch {
      // Keep the previous list rather than pretending it is empty.
    }
    try {
      const sRes = await apiFetch('/api/owner/connections/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
        cache: 'no-store',
      });
      const sPayload = await sRes.json().catch(() => null);
      if (sRes.ok && sPayload?.success && Array.isArray(sPayload.shared)) {
        setSharedRows(sPayload.shared as SharedAccountRow[]);
      }
    } catch {
      // Keep the previous list rather than pretending it is empty.
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/owner/tenants', { cache: 'no-store' });
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        setError(null);
        return;
      }
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setForbidden(false);
      setError(null);
      setData(payload as Overview);

      // Complaints are a separate owner-only read. A failure here must not blank
      // the whole console, so it is fetched best-effort after the main payload.
      try {
        const cRes = await apiFetch('/api/owner/complaints', { cache: 'no-store' });
        if (cRes.ok) {
          const cPayload = await cRes.json().catch(() => null);
          if (cPayload?.success) setComplaints(cPayload as ComplaintsPayload);
        }
      } catch {
        // Leave the previous list in place rather than pretending it is empty.
      }

      // The fix panels read their own owner-only lists the same best-effort way.
      await refreshFixLists();
    } catch (err: any) {
      setError(err?.message || 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [refreshFixLists]);

  useEffect(() => {
    void load();
  }, [load]);

  // Support conversations happen while the page is open, so the numbers refresh
  // themselves instead of needing a reload from someone who is mid-call.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  /**
   * The customer-error fix writes. Every one of them re-checks ownership on the
   * server — these buttons are convenience, not the gate.
   */

  /** Force one (or every) stuck send out through the sweeper's own sender. */
  const retrySend = useCallback(
    async (jobId: string | null): Promise<void> => {
      setRetryBusy(jobId ?? '*');
      setRetryNotice(null);
      setRetryError(null);
      try {
        const res = await apiFetch('/api/owner/retry-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jobId ? { action: 'retry', jobId } : { action: 'retryAll' }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        const promoted = Number(payload.promoted) || 0;
        setRetryNotice(
          promoted > 0
            ? t('ops.retry.done', { count: String(promoted) })
            : t('ops.retry.doneNone')
        );
        setRetryRows(Array.isArray(payload.jobs) ? (payload.jobs as RetryJobRow[]) : []);
      } catch (err: any) {
        setRetryError(err?.message || 'unknown error');
      } finally {
        setRetryBusy(null);
      }
    },
    [t]
  );

  /** Drop one stuck send (e.g. the customer was answered by hand). */
  const discardSend = useCallback(async (jobId: string): Promise<void> => {
    setRetryBusy(jobId);
    setRetryNotice(null);
    setRetryError(null);
    try {
      const res = await apiFetch('/api/owner/retry-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discard', jobId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setRetryRows(Array.isArray(payload.jobs) ? (payload.jobs as RetryJobRow[]) : []);
    } catch (err: any) {
      setRetryError(err?.message || 'unknown error');
    } finally {
      setRetryBusy(null);
    }
  }, []);

  /** Push the billing period forward without touching the rest of the row. */
  const extendTrial = useCallback(async (): Promise<void> => {
    const tenantId = trialTenant.trim();
    const days = Math.round(Number(trialDays));
    if (!tenantId || !Number.isFinite(days) || days < 1 || days > 90) return;
    setTrialBusy(true);
    setTrialNotice(null);
    setTrialError(null);
    try {
      const res = await apiFetch('/api/owner/tenants/trial-extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, days }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      const ext = payload.extension as TrialExtension;
      setTrialNotice(t('ops.trial.done', { days: String(ext.days), date: day(ext.newEnd) }));
      setTrialTenant('');
      void load();
    } catch (err: any) {
      setTrialError(err?.message || 'unknown error');
    } finally {
      setTrialBusy(false);
    }
  }, [trialTenant, trialDays, t, load]);

  /** KNOWN_ISSUES A4 — pick the one tenant a shared account's DMs reach. */
  const routeSharedAccount = useCallback(
    async (instagramAccountId: string, tenantId: string): Promise<void> => {
      setRouteBusy(instagramAccountId);
      setRouteNotice(null);
      setRouteError(null);
      try {
        const res = await apiFetch('/api/owner/connections/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instagramAccountId, tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setSharedRows(Array.isArray(payload.shared) ? (payload.shared as SharedAccountRow[]) : []);
        setRouteNotice(t('ops.shared.routed', { id: tenantId }));
      } catch (err: any) {
        setRouteError(err?.message || 'unknown error');
      } finally {
        setRouteBusy(null);
      }
    },
    [t]
  );

  /**
   * Move one request forward. The server re-checks that the caller is the owner
   * — this button is convenience, not the gate.
   */
  const updateTesterStatus = useCallback(
    async (tenantId: string, status: TesterRequestStatus): Promise<void> => {
      setBusyTenant(tenantId);
      try {
        const res = await apiFetch('/api/owner/tester-requests/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, status }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyTenant(null);
      }
    },
    [load]
  );

  /**
   * Record the verified invitation URL and Meta app id, then advance the
   * request to INVITATION_SENT. The server re-checks owner identity.
   */
  const sendTesterInvitation = useCallback(
    async (tenantId: string, invitationUrl: string, metaAppId: string): Promise<void> => {
      setBusyTenant(tenantId);
      try {
        const res = await apiFetch('/api/owner/tester-requests/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, invitationUrl, metaAppId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyTenant(null);
      }
    },
    [load]
  );

  /**
   * Record the Meta-dashboard step ("added @handle as an Instagram Tester").
   *
   * The server cannot verify this — Meta has no API for it — but it stores who
   * recorded it and when, and refuses to Prepare/Send until it exists. The handle
   * is sent along so a copy-paste mistake is caught instead of trusted.
   */
  const markAccountAdded = useCallback(
    async (tenantId: string, handle: string): Promise<void> => {
      setBusyTenant(tenantId);
      try {
        const res = await apiFetch('/api/owner/tester-requests/account-added', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, handle }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyTenant(null);
      }
    },
    [load]
  );

  /**
   * Record acceptance. Deliberately labelled "unverified": Meta gives this
   * server no acceptance signal, so the row stores a human confirmation and the
   * UI never presents it as platform-verified.
   */
  const acceptInvitation = useCallback(
    async (tenantId: string): Promise<void> => {
      setBusyTenant(tenantId);
      try {
        const res = await apiFetch('/api/owner/tester-requests/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyTenant(null);
      }
    },
    [load]
  );

  /**
   * Owner action: mark that the tester invitation has been sent (after the
   * Meta dashboard step and a genuine invitation URL are recorded). Moves the
   * activation state to INVITATION_SENT.
   */
  const markActivationInvitationSent = useCallback(
    async (tenantId: string): Promise<void> => {
      setActivationBusy(tenantId);
      setActivationNotice(null);
      setActivationError(null);
      try {
        const res = await apiFetch('/api/owner/activation/mark-invitation-sent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setActivationNotice(t('ops.activation.instructionsSent'));
        await load();
      } catch (err: any) {
        setActivationError(err?.message || 'unknown error');
      } finally {
        setActivationBusy(null);
      }
    },
    [load, t]
  );

  /**
   * Owner action: send activation instructions through the existing WhatsApp
   * outbox (consent-gated, honest about provider status). Moves the activation
   * state to AWAITING_CUSTOMER_ACCEPTANCE.
   */
  const sendActivationInstructions = useCallback(
    async (tenantId: string): Promise<void> => {
      setActivationBusy(tenantId);
      setActivationNotice(null);
      setActivationError(null);
      try {
        const res = await apiFetch('/api/owner/activation/send-instructions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) {
          if (payload?.code === 'NO_CONSENT') {
            setActivationNotice(t('ops.activation.noConsent'));
          } else {
            setActivationError(payload?.error || `HTTP ${res.status}`);
          }
          await load();
          return;
        }
        setActivationNotice(t('ops.activation.instructionsSent'));
        await load();
      } catch (err: any) {
        setActivationError(err?.message || 'unknown error');
      } finally {
        setActivationBusy(null);
      }
    },
    [load, t]
  );

  /**
   * Owner action: confirm the customer's test DM was answered successfully.
   * Moves AWAITING_TEST_DM → FULLY_ACTIVE.
   */
  const confirmActivationTestDm = useCallback(
    async (tenantId: string): Promise<void> => {
      setActivationBusy(tenantId);
      setActivationNotice(null);
      setActivationError(null);
      try {
        const res = await apiFetch('/api/owner/activation/confirm-test-dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setActivationNotice(t('ops.activation.testDmConfirmed'));
        await load();
      } catch (err: any) {
        setActivationError(err?.message || 'unknown error');
      } finally {
        setActivationBusy(null);
      }
    },
    [load, t]
  );

  /**
   * Owner action: require the customer to take a step before activation can
   * continue.
   */
  const requireActivationAction = useCallback(
    async (tenantId: string, reason: string): Promise<void> => {
      setActivationBusy(tenantId);
      setActivationNotice(null);
      setActivationError(null);
      try {
        const res = await apiFetch('/api/owner/activation/require-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, note: reason }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setActivationNotice(t('ops.activation.actionRequiredNote', { reason }));
        await load();
      } catch (err: any) {
        setActivationError(err?.message || 'unknown error');
      } finally {
        setActivationBusy(null);
      }
    },
    [load, t]
  );

  /**
   * Mark one complaint resolved. Like the tester queue, the server re-checks
   * ownership — this button is convenience, not the gate.
   */
  const resolveComplaint = useCallback(
    async (id: string): Promise<void> => {
      setBusyComplaint(id);
      try {
        const res = await apiFetch('/api/owner/complaints/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyComplaint(null);
      }
    },
    [load]
  );

  /**
   * The single button the owner asked for: stop or start one customer's bot.
   *
   * The server re-checks ownership — this is convenience, not the gate. A pause
   * takes effect on the very next DM; the reply already leaving Meta's queue is
   * the only thing that can still arrive.
   */
  const setBotState = useCallback(
    async (tenantId: string, enabled: boolean): Promise<void> => {
      setBusyBot(tenantId);
      try {
        const res = await apiFetch('/api/owner/bots/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, enabled }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyBot(null);
      }
    },
    [load]
  );

  /**
   * Ask Meta whether the stored token still works for this account.
   *
   * The answer that matters is `NEEDS_REAUTH`: the account is connected, so the
   * row looked healthy, but Meta refuses the token — the bot cannot answer until
   * the customer reconnects. Nothing else in the console can tell those apart.
   */
  const checkHealth = useCallback(
    async (tenantId?: string): Promise<void> => {
      setBusyHealth(tenantId || '*');
      try {
        const res = tenantId
          ? await apiFetch('/api/instagram/health', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId }),
            })
          : await apiFetch('/api/owner/connections/health', { method: 'POST' });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyHealth(null);
      }
    },
    [load]
  );

  /** Clear the "DM arrived with no account" list. The running total stays. */
  const clearDeliveryAlerts = useCallback(async (): Promise<void> => {
    setBusyHealth('alerts');
    try {
      const res = await apiFetch('/api/owner/delivery-alerts/clear', { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setError(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'unknown error');
    } finally {
      setBusyHealth(null);
    }
  }, [load]);

  /** The emergency brake: every bot, one press. */
  const setBrake = useCallback(
    async (enabled: boolean): Promise<void> => {
      setBusyBot('*');
      try {
        const res = await apiFetch('/api/owner/bots/control-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyBot(null);
      }
    },
    [load]
  );

  /**
   * Ask the server what a billing reset would clear, before anything is written.
   *
   * The number in the answer is not decoration: it is the exact value the owner
   * then has to type to run the reset, and the server recomputes that count at the
   * moment of the write. A count read here and typed from a tab left open through
   * the next signup therefore stops matching, and the reset is refused with the
   * fresh number instead of clearing a row nobody looked at.
   */
  const previewBillingReset = useCallback(async (): Promise<void> => {
    setBillingBusy('preview');
    setBillingError(null);
    setBillingDone(null);
    try {
      const res = await apiFetch('/api/owner/billing/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const payload = await res.json().catch(() => null);
      // "Nothing to reset" is an answer, not a failure: there is no row to clear,
      // and the panel says so instead of showing an error the owner would chase.
      if (res.status === 400 && payload?.code === 'NOTHING_TO_RESET') {
        setBillingPreview({ resetCount: 0, reset: [], skipped: payload?.skipped ?? [] });
        setBillingConfirm('');
        return;
      }
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setBillingPreview({
        resetCount: Number(payload.resetCount) || 0,
        reset: (payload.reset ?? []) as BillingResetRow[],
        skipped: payload.skipped ?? [],
      });
      setBillingConfirm('');
    } catch (err: any) {
      setBillingError(err?.message || 'unknown error');
    } finally {
      setBillingBusy(null);
    }
  }, []);

  /** Run the reset. The typed count is the confirmation the server insists on. */
  const applyBillingReset = useCallback(async (): Promise<void> => {
    setBillingBusy('apply');
    setBillingError(null);
    try {
      const res = await apiFetch('/api/owner/billing/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: billingConfirm.trim() }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setBillingDone(Number(payload.resetCount) || 0);
      setBillingPreview(null);
      setBillingConfirm('');
      await load();
    } catch (err: any) {
      setBillingError(err?.message || 'unknown error');
    } finally {
      setBillingBusy(null);
    }
  }, [billingConfirm, load]);

  /**
   * Take an account off the list — without deleting a byte of it.
   *
   * The case it exists for: a customer stops paying, or asks to be taken off while
   * they sort something out. Their connection and inbox are left alone, so the bot
   * keeps working if their plan is still live; only this list changes. Restore is
   * one press, which is why hide can be the safe default and delete the exception.
   */
  const hideTenant = useCallback(
    async (tenantId: string): Promise<void> => {
      setBusyRemoval(tenantId);
      try {
        const res = await apiFetch('/api/owner/tenants/hide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setNotice(t('ops.remove.hiddenDone'));
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyRemoval(null);
      }
    },
    [load, t]
  );

  /** Put a hidden account back on the list. */
  const restoreTenant = useCallback(
    async (tenantId: string): Promise<void> => {
      setBusyRemoval(tenantId);
      try {
        const res = await apiFetch('/api/owner/tenants/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setNotice(t('ops.remove.restored'));
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyRemoval(null);
      }
    },
    [load, t]
  );

  /**
   * The irreversible one. The server re-checks the typed confirmation, so this
   * dialog is a safety rail rather than the gate — and the button stays disabled
   * until what was typed matches the handle (or uid) exactly.
   */
  const deleteTenant = useCallback(
    async (tenantId: string, confirm: string): Promise<void> => {
      setBusyRemoval(tenantId);
      setConfirmError(null);
      try {
        const res = await apiFetch('/api/owner/tenants/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, confirm }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setNotice(t('ops.remove.deletedDone'));
        setConfirmTarget(null);
        setConfirmText('');
        await load();
      } catch (err: any) {
        // Keep the dialog open with the reason: a mistyped handle should be
        // correctable in place, not a reason to hunt for the row and start over.
        setConfirmError(err?.message || 'unknown error');
      } finally {
        setBusyRemoval(null);
      }
    },
    [load, t]
  );

  /**
   * Ask the server why this account is not connected, and what it can fix itself.
   *
   * The answer is a classification, not a promise: two of the causes cannot be
   * solved from this server at all (only the customer can press Allow, and Meta
   * has no API for adding a tester). What this buys is that the owner never has to
   * guess which of the four situations they are looking at.
   */
  const runFix = useCallback(
    async (tenantId: string): Promise<void> => {
      setBusyFix(tenantId);
      try {
        const res = await apiFetch('/api/owner/tenants/connect-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setFixPlan(payload.facts as ConnectFixFacts);
        setFixAutoFixed(Array.isArray(payload.autoFixed) ? (payload.autoFixed as string[]) : []);
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyFix(null);
      }
    },
    [load]
  );

  /**
   * The same for every account at once. No Meta calls by design — a per-customer
   * Graph request behind one click is how a page turns into a rate-limit incident;
   * the single-account button above is where the live re-check happens.
   */
  const runFixAll = useCallback(async (): Promise<void> => {
    setBusyFix('*');
    try {
      const res = await apiFetch('/api/owner/tenants/connect-fix-all', { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setError(null);
      setFixRoster(payload.plans as ConnectFixFacts[]);
    } catch (err: any) {
      setError(err?.message || 'unknown error');
    } finally {
      setBusyFix(null);
    }
  }, []);

  /**
   * Take one account off the plan path for good, or put it back.
   *
   * The runtime half of the comped list, so the owner's own test accounts stop
   * expiring their 3-day trial at the moment the connect is wired up — and so a
   * customer marked by mistake can be returned to normal billing with the same
   * button, instead of an env edit nobody can undo from the console.
   */
  const setFreeForever = useCallback(
    async (tenantId: string, free: boolean): Promise<void> => {
      setBusyIdentity(tenantId);
      try {
        const res = await apiFetch('/api/owner/tenants/free-forever', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, free }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setNotice(t('ops.free.label'));
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyIdentity(null);
      }
    },
    [load, t]
  );

  /**
   * Let the customer pick their username again.
   *
   * The only way a username ever changes: it is set once on purpose, so an
   * abusive or simply wrong name is fixed deliberately here, and the freed name
   * goes back into the pool. The customer is asked again on the next sign-in.
   */
  const resetTenantUsername = useCallback(
    async (row: OverviewRow): Promise<void> => {
      if (!row.username) return;
      const question = t('ops.username.resetConfirm', { username: row.username });
      if (typeof window !== 'undefined' && !window.confirm(question)) return;
      setBusyIdentity(row.tenantId);
      try {
        const res = await apiFetch('/api/owner/tenants/username-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: row.tenantId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
        setError(null);
        setNotice(t('ops.username.resetDone', { username: payload.removed || row.username }));
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusyIdentity(null);
      }
    },
    [load, t]
  );

  /**
   * Ask the server to walk the whole answering chain for one account, sending nothing.
   *
   * This is the replacement for "main apne aap ko DM kar ke dekhta hoon", which cannot
   * work: Instagram does not deliver a DM to its own account, and a DM from a *different*
   * connected account is refused by the loop guard on purpose. The owner then reads the
   * guard's silence as "bot kharab hai" for every customer. A dry run answers the real
   * question — do the switch, the plan, the connection, the knowledge base and the AI
   * provider all line up — and says plainly that no message was sent.
   */
  const runSelfTest = useCallback(async (tenantId: string): Promise<void> => {
    setBusySelfTest(tenantId);
    try {
      const res = await apiFetch('/api/owner/tenants/self-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setError(null);
      setSelfTest(payload.result as SelfTestResult);
    } catch (err: any) {
      setError(err?.message || 'unknown error');
    } finally {
      setBusySelfTest(null);
    }
  }, []);

  const copyValue = useCallback(async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard is blocked outside a secure context; the text is on screen.
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    const matched = !needle
      ? data.rows
      : data.rows.filter(
          (row) =>
            row.tenantId.toLowerCase().includes(needle) ||
            // The username is the reason this field exists: it is what support
            // actually types, so it has to be the first thing that matches.
            (row.username || '').toLowerCase().includes(needle) ||
            (row.instagram.username || '').toLowerCase().includes(needle) ||
            // The requested handle is often the only handle this account has, so
            // searching for it has to find the row.
            (row.testerRequest?.username || '').toLowerCase().includes(needle)
        );
    // Feature 2 — date-wise browsing: search first, then the real date filter,
    // then sorting, then pagination (the paginate() step works on the already-
    // sorted list, so changing sort/page can never skip or duplicate rows).
    const field: SortField = sortChoice.startsWith('activity') ? 'activity' : 'created';
    const filtered = filterRows(matched, dateFilterField, dateFilter, nowRef.current);
    return sortRows(filtered, { field, dir });
  }, [data, query, dir, sortChoice, dateFilter, dateFilterField]);

  const paged = useMemo(
    () => paginate(rows, page, PAGE_SIZE),
    [rows, page]
  );

  /**
   * Accounts whose Instagram is not doing its job, whatever the reason.
   *
   * Not just `!connected`: an account can be connected, Meta-accepted, and still
   * receive nothing because the same Instagram account is connected elsewhere, and
   * a token Meta refuses looks identical to a healthy one until someone asks.
   */
  const needConnect = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    return data.rows.filter((row) => {
      const broken =
        !row.instagram.connected ||
        row.instagram.liveState === 'NEEDS_REAUTH' ||
        (row.instagram.sharedWith?.length || 0) > 0;
      if (!broken) return false;
      if (!needle) return true;
      return (
        row.tenantId.toLowerCase().includes(needle) ||
        (row.username || '').toLowerCase().includes(needle) ||
        (row.instagram.username || '').toLowerCase().includes(needle) ||
        (row.testerRequest?.username || '').toLowerCase().includes(needle)
      );
    });
  }, [data, query]);

  /**
   * The invite queue: searchable, date-windowed, newest first.
   *
   * Newest-first is the default because the row that needs action is almost
   * always the one that just arrived; the pending count in the header keeps the
   * older ones visible so a stale invite cannot hide at the bottom.
   */
  const testerQueue = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    const windowMs = testerWindow === '7d' ? 7 * 86_400_000 : testerWindow === '30d' ? 30 * 86_400_000 : 0;
    const now = Date.now();
    return (data?.testerRequests || [])
      .filter((request) => {
        if (needle) {
          const haystack = [request.username, request.tenantId, request.contact?.businessName || '']
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (windowMs > 0) {
          const at = Date.parse(request.requestedAt);
          if (Number.isFinite(at) && now - at > windowMs) return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  }, [data, query, testerWindow]);

  const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : t('ops.never'));
  const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : t('ops.never'));

  /**
   * The accounts a refused answer came *from* — i.e. the accounts whose owner is
   * staring at silence and concluding the bot is dead. `event.tenantId` is the
   * receiving account, which is the one that stayed quiet.
   */
  const guardRefusedTenants = useMemo(() => {
    if (!data) return [] as { tenantId: string; count: number; handle: string }[];
    const counts = new Map<string, number>();
    data.botGuard.recent.forEach((event) => {
      if (!event.tenantId) return;
      counts.set(event.tenantId, (counts.get(event.tenantId) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([tenantId, count]) => {
      const row = data.rows.find((r) => r.tenantId === tenantId);
      return {
        tenantId,
        count,
        handle: row?.instagram.username || row?.testerRequest?.username || '',
      };
    });
  }, [data]);

  /**
   * One result card, rendered where the button was pressed. Stages come back in the
   * order the real webhook walks them, so the first red one is the culprit.
   */
  const renderSelfTest = (result: SelfTestResult) => (
    <div
      className={`rounded-xl border px-3 py-2 space-y-2 ${
        result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className={`text-xs font-bold ${result.ok ? 'text-emerald-900' : 'text-rose-900'}`}>
          {result.ok ? t('ops.test.ok') : t('ops.test.fail')}
        </p>
        {result.provider && (
          <span className="text-[10px] text-slate-500">
            {t('ops.test.provider', {
              provider: result.provider,
              ms: String(result.elapsedMs),
            })}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold border border-slate-300 text-slate-600 bg-white">
          {t('ops.test.noSend')}
        </span>
      </div>
      <ul className="space-y-0.5">
        {result.stages.map((stage) => (
          <li
            key={stage.key}
            className={`text-[11px] flex flex-wrap items-baseline gap-x-2 ${
              stage.ok ? 'text-slate-600' : 'text-rose-700 font-semibold'
            }`}
          >
            <span className="w-3 text-center">{stage.ok ? '✓' : '✕'}</span>
            <span className="font-semibold">{t(`ops.test.stage.${stage.key}`)}</span>
            {stage.detail && <span className="text-slate-400">{stage.detail}</span>}
          </li>
        ))}
      </ul>
      {result.reply && (
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            {t('ops.test.reply')}
          </p>
          <p className="text-[11px] text-slate-700 mt-0.5 whitespace-pre-wrap">{result.reply}</p>
        </div>
      )}
      {result.sharedWithTenants.length > 0 && (
        <p className="text-[11px] text-amber-800 leading-snug">
          {t('ops.test.sharedWith', { tenants: result.sharedWithTenants.join(', ') })}
        </p>
      )}
    </div>
  );

  // What the owner has to type to delete a row: the handle they know the account
  // by, or the uid when the account never got that far. Mirrors the server, which
  // accepts either — and the dialog keeps its Delete button disabled until it matches.
  const confirmHint = (row: OverviewRow) =>
    row.instagram.username ? `@${row.instagram.username}` : row.tenantId;
  const confirmMatches = (row: OverviewRow) => {
    const typed = confirmText.trim().replace(/^@/, '').toLowerCase();
    if (!typed) return false;
    const handle = (row.instagram.username || '').toLowerCase();
    return typed === handle || typed === row.tenantId.toLowerCase();
  };

  if (forbidden) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-900">{t('ops.title')}</h2>
        <p className="mt-2 text-sm text-slate-600">{t('ops.forbidden')}</p>
      </div>
    );
  }

  const summary = data?.summary;
  const pendingInvites = summary?.testerRequestsPending ?? 0;
  // Defensive copies of the two new lists: a browser holding a cached bundle can be
  // served by a server that predates this panel during a deploy, and a missing
  // array must not blank the whole console.
  const hiddenAccounts = data?.hiddenAccounts ?? [];
  const removedAccounts = data?.removedAccounts ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('ops.title')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('ops.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-[11px] text-slate-400">
              {t('ops.updatedAt', { time: new Date(data.generatedAt).toLocaleTimeString() })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            {loading ? t('ops.loading') : t('ops.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">
          {t('ops.failed', { msg: error })}
        </div>
      )}

      {data && !data.paymentsConfigured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-4 py-3">
          {t('ops.paymentsOff', { days: String(data.trialDays) })}
        </div>
      )}

      {/* Project notification: ONE simple-language line — project rukne ka main
          karan + kya karein. Server (rootCause.ts) decide karta hai kya dikhana
          hai; ye banner sirf use padhne layak banata hai. */}
      <RootCauseBanner />

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {/* Main points, each with its own accent (left bar + tint + icon) so
              every counter is recognisable at a glance instead of eleven
              identical white tiles. Problem counters keep their loud colours. */}
          {[
            { label: t('ops.sum.tenants'), value: summary.tenants, icon: Users, accent: 'border-l-indigo-500 bg-indigo-50/60', tone: 'text-indigo-700' },
            { label: t('ops.sum.active'), value: summary.active, icon: Activity, accent: 'border-l-emerald-500 bg-emerald-50/60', tone: 'text-emerald-700' },
            { label: t('ops.sum.trialing'), value: summary.trialing, icon: Timer, accent: 'border-l-purple-500 bg-purple-50/60', tone: 'text-purple-700' },
            { label: t('ops.sum.blocked'), value: summary.botsBlocked, icon: Ban, accent: 'border-l-rose-500 bg-rose-50/60', tone: 'text-rose-700' },
            { label: t('ops.sum.paused'), value: summary.botsPaused, icon: Pause, accent: 'border-l-orange-500 bg-orange-50/60', tone: 'text-orange-700' },
            { label: t('ops.sum.noInstagram'), value: summary.InstagramDisconnected, icon: Unlink, accent: 'border-l-cyan-500 bg-cyan-50/60', tone: 'text-cyan-700' },
            { label: t('ops.sum.reauth'), value: summary.connectionsNeedingReauth, icon: KeyRound, accent: 'border-l-red-500 bg-red-50/60', tone: 'text-red-700' },
            { label: t('ops.sum.tester'), value: summary.testerRequestsPending, icon: UserPlus, accent: 'border-l-pink-500 bg-pink-50/60', tone: 'text-pink-700' },
            { label: t('ops.sum.attention'), value: summary.needsAttention, icon: AlertTriangle, accent: 'border-l-amber-500 bg-amber-50/60', tone: 'text-amber-700' },
            { label: t('ops.sum.hidden'), value: summary.hidden, icon: EyeOff, accent: 'border-l-slate-400 bg-slate-50', tone: 'text-slate-600' },
            { label: t('ops.sum.removed'), value: summary.removed, icon: Trash2, accent: 'border-l-stone-400 bg-stone-50', tone: 'text-stone-600' },
          ].map((card) => (
            <div key={card.label} className={`rounded-2xl border border-slate-200 border-l-4 ${card.accent} px-4 py-3`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium text-slate-600">{card.label}</p>
                <card.icon className={`w-4 h-4 shrink-0 ${card.tone}`} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Bot control ────────────────────────────────────────────────────
          Born from a real incident: three connected accounts started replying to
          each other and nothing could stop them. The brake kills every bot in one
          press; the per-account switch sits on each row below. The guard strip is
          how the owner sees that bot-to-bot traffic is actually being refused. */}
      {data && (
        <div
          className={`rounded-2xl border px-4 py-3 ${
            data.botControl.pausedAll ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                {t('ops.control.title')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {data.botControl.pausedAll
                  ? t('ops.control.brakeOn', {
                      by: data.botControl.pausedAllBy || '—',
                      time: time(data.botControl.pausedAllAt),
                    })
                  : t('ops.control.brakeOff', {
                      count: String(summary?.botsPaused ?? data.botControl.pausedTenants.length),
                    })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  data.botGuard.isolationEnabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {t('ops.control.guard', {
                  state: data.botGuard.isolationEnabled
                    ? t('ops.control.guardOn')
                    : t('ops.control.guardOff'),
                })}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 text-slate-600 bg-white">
                {t('ops.control.blocked', {
                  count: String(
                    data.botGuard.blockedIdentity +
                      data.botGuard.blockedUsername +
                      data.botGuard.blockedBurst
                  ),
                })}
              </span>
              {data.botControl.pausedAll ? (
                <button
                  type="button"
                  disabled={busyBot === '*'}
                  onClick={() => void setBrake(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {t('ops.control.resumeAll')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyBot === '*'}
                  onClick={() => void setBrake(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <Pause className="w-3.5 h-3.5" />
                  {t('ops.control.pauseAll')}
                </button>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── "Bot jawab de raha hai ya nahi?" ───────────────────────────────
          This panel exists because of one specific, repeated misreading: the bot was
          tested by DMing it from another InstaFlow-connected account, the loop guard
          refused (correctly — that is the loop it defends against), and the silence was
          read as "no account works". Instagram also refuses to deliver a DM to its own
          account, so that test can never succeed. So: name the refusal in plain words,
          and offer the test that does work. */}
      {data && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-600" />
                {t('ops.test.title')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
                {t('ops.test.hint')}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 text-slate-600 bg-white">
              {t('ops.test.noSend')}
            </span>
          </div>

          {/* Refused answers, explained where they are listed. The counters in the
              bot-control strip above say *that* the guard fired; only this says why
              that is the guard working, not the bot failing. */}
          {data.botGuard.recent.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('ops.guardRefused.title', { count: String(data.botGuard.recent.length) })}
              </p>
              <p className="text-[11px] text-amber-900 mt-1 leading-snug max-w-3xl">
                {t('ops.guardRefused.why')}
              </p>
              <ul className="mt-2 border-t border-amber-200 divide-y divide-amber-200">
                {data.botGuard.recent.slice(0, 5).map((event, index) => (
                  <li
                    key={event.at + '-' + index}
                    className="py-2 text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1"
                  >
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white font-semibold">
                      {t(`ops.guard.code.${event.code}`)}
                    </span>
                    <span className="text-slate-800 font-medium">
                      {event.senderUsername ? `@${event.senderUsername}` : event.senderId}
                    </span>
                    <span className="text-slate-500">{event.igAccountId}</span>
                    {event.senderTenantId && (
                      <code className="text-slate-400">owned by {event.senderTenantId}</code>
                    )}
                    {event.replyCount != null && (
                      <span className="text-slate-400">
                        {t('ops.guard.replies', { count: String(event.replyCount) })}
                      </span>
                    )}
                    <span className="text-slate-400">{time(event.at)}</span>
                  </li>
                ))}
              </ul>
              {data.botGuard.recent.length > 5 && (
                <p className="text-[10px] text-amber-800 mt-1">
                  {t('ops.guardRefused.others', {
                    count: String(data.botGuard.recent.length - 5),
                  })}
                </p>
              )}
            </div>
          )}

          {/* The accounts those refused DMs were aimed at. The owner is looking at
              exactly these, so the button is here as well as inside each account. */}
          {guardRefusedTenants.map(({ tenantId, count, handle }) => (
            <div
              key={tenantId}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">
                  {handle ? `@${handle}` : t('ops.noHandle')}
                  <code className="ml-2 text-[10px] text-slate-400">{tenantId}</code>
                  <span className="ml-2 text-[10px] text-rose-600">
                    {t('ops.guard.replies', { count: String(count) })}
                  </span>
                </p>
                <button
                  type="button"
                  disabled={busySelfTest === tenantId}
                  onClick={() => void runSelfTest(tenantId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {busySelfTest === tenantId ? t('ops.remove.busy') : t('ops.test.button')}
                </button>
              </div>
              {selfTest?.tenantId === tenantId && renderSelfTest(selfTest)}
            </div>
          ))}

          {/* A result for an account that is not in the list above — pressed from
              inside its own row, where the row's other actions live. */}
          {selfTest && !guardRefusedTenants.some((entry) => entry.tenantId === selfTest.tenantId) && (
            renderSelfTest(selfTest)
          )}
        </div>
      )}

      {/* ── Billing rows that still hold a bot back ──────────────────────────
          The one gap this console had: a host with payments switched off promises
          that every bot runs without a plan, and that promise is false for the
          accounts whose trial row is still present and expired. Nothing here
          deletes an account — it clears the billing row only, so the customer's
          data survives and the account can start a fresh trial. */}
      {data && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-slate-500" />
                {t('ops.billing.title')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
                {t('ops.billing.hint')}
              </p>
            </div>
            <button
              type="button"
              disabled={billingBusy !== null}
              onClick={() => void previewBillingReset()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              <ListChecks className="w-3.5 h-3.5" />
              {billingBusy === 'preview' ? t('ops.billing.previewing') : t('ops.billing.preview')}
            </button>
          </div>

          {billingPreview && !billingPreview.resetCount && (
            <p className="text-xs text-slate-600">{t('ops.billing.none')}</p>
          )}

          {billingPreview && billingPreview.resetCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-800">
                {t('ops.billing.count', { count: String(billingPreview.resetCount) })}
              </p>
              <ul className="space-y-1.5">
                {billingPreview.reset.map((row) => (
                  <li
                    key={row.tenantId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        {row.username ? `@${row.username}` : t('ops.noHandle')}
                        <code className="ml-2 text-[10px] text-slate-400">{row.tenantId}</code>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {row.planName}
                        {row.status ? ` · ${row.status}` : ''}
                        {row.periodEndsAt ? ` · ${t('ops.planLeft', {
                          date: day(row.periodEndsAt),
                          days: String(
                            Math.ceil((Date.parse(row.periodEndsAt) - Date.now()) / 86_400_000)
                          ),
                        })}` : ''}
                        {row.trialUsed ? ` · ${t('ops.billing.trialUsed')}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-semibold">
                      <span
                        className={
                          row.botBlockedNow
                            ? 'px-2 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700'
                            : 'px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500'
                        }
                      >
                        {t('ops.billing.colNow')}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span
                        className={
                          row.botAllowedAfter
                            ? 'px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'px-2 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700'
                        }
                      >
                        {t('ops.billing.colAfter')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={billingConfirm}
                  onChange={(event) => setBillingConfirm(event.target.value)}
                  placeholder={t('ops.billing.confirmType', {
                    expected: String(billingPreview.resetCount),
                  })}
                  className="w-48 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                />
                <button
                  type="button"
                  disabled={
                    billingBusy !== null ||
                    billingConfirm.trim() !== String(billingPreview.resetCount)
                  }
                  onClick={() => void applyBillingReset()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {billingBusy === 'apply' ? t('ops.billing.busy') : t('ops.billing.confirmGo')}
                </button>
              </div>

              {!!billingPreview.skipped.length && (
                <p className="text-[11px] text-slate-400">
                  {t('ops.billing.skipped', { count: String(billingPreview.skipped.length) })}
                </p>
              )}
            </div>
          )}

          {billingDone !== null && (
            <p className="text-xs font-semibold text-emerald-700">
              {t('ops.billing.done', { count: String(billingDone) })}
            </p>
          )}
          {billingError && <p className="text-xs text-rose-700">{billingError}</p>}
        </div>
      )}

      {/* ── Stuck / failed sends — "customer bole reply nahi aaya" ────────────
          The queue itself is automatic (see server/retryQueue.ts); this panel
          is the owner's hand on it: force one out now, flush everything, or
          drop a job the customer no longer needs. Rows disappear on their own
          once the send goes through. */}
      {data && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-slate-500" />
                {t('ops.retry.title')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
                {t('ops.retry.hint')}
              </p>
            </div>
            {!!retryRows.length && (
              <button
                type="button"
                disabled={retryBusy !== null}
                onClick={() => void retrySend(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {retryBusy === '*' ? t('ops.trial.busy') : t('ops.retry.all')}
              </button>
            )}
          </div>

          {retryRows.length === 0 && <p className="text-xs text-slate-600">{t('ops.retry.empty')}</p>}

          <ul className="space-y-1.5">
            {retryRows.map((job) => (
              <li
                key={job.jobId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">
                    {job.replyText.length > 80 ? `${job.replyText.slice(0, 80)}…` : job.replyText}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    <code className="text-[10px] text-slate-400">{job.tenantId}</code>
                    {job.recipientMasked ? ` · to ${job.recipientMasked}` : ''}
                    {` · ${job.attempts}/${job.maxAttempts}`}
                    {` · next ${day(new Date(job.nextAttemptAt).toISOString())}`}
                    {job.lastErrorDetail
                      ? ` · ${job.lastErrorCategory || 'error'}: ${job.lastErrorDetail}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={retryBusy !== null}
                    onClick={() => void retrySend(job.jobId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
                  >
                    <Send className="w-3 h-3" />
                    {retryBusy === job.jobId ? t('ops.trial.busy') : t('ops.retry.now')}
                  </button>
                  <button
                    type="button"
                    disabled={retryBusy !== null}
                    onClick={() => void discardSend(job.jobId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40"
                  >
                    {t('ops.retry.discard')}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {retryNotice && <p className="text-xs font-semibold text-emerald-700">{retryNotice}</p>}
          {retryError && <p className="text-xs text-rose-700">{retryError}</p>}
        </div>
      )}

      {/* ── Trial / period extend — "trial khatam ho gaya" ───────────────────
          The gentler alternative to billing/reset: it stretches the CURRENT
          period instead of wiping the row, so plan history and status stay. */}
      {data && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div>
            <p className="font-bold text-slate-900 flex items-center gap-2">
              <Timer className="w-4 h-4 text-slate-500" />
              {t('ops.trial.title')}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
              {t('ops.trial.hint')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={trialTenant}
              onChange={(event) => setTrialTenant(event.target.value)}
              placeholder={t('ops.trial.tenant')}
              className="w-64 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-slate-500"
            />
            <input
              value={trialDays}
              onChange={(event) => setTrialDays(event.target.value)}
              placeholder={t('ops.trial.days')}
              inputMode="numeric"
              className="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-slate-500"
            />
            <button
              type="button"
              disabled={
                trialBusy || !trialTenant.trim() || !(Math.round(Number(trialDays)) >= 1)
              }
              onClick={() => void extendTrial()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Timer className="w-3.5 h-3.5" />
              {trialBusy ? t('ops.trial.busy') : t('ops.trial.go')}
            </button>
          </div>
          {trialNotice && <p className="text-xs font-semibold text-emerald-700">{trialNotice}</p>}
          {trialError && <p className="text-xs text-rose-700">{trialError}</p>}
        </div>
      )}

      {/* ── Shared Instagram accounts — KNOWN_ISSUES A4, decided here ─────────
          Two tenants, one Instagram account: the webhook can only route the
          DMs to one of them. This panel is the human decision the routing was
          waiting for — one click and the shadowed tenant stops losing messages
          silently. */}
      {data && (
        <div className="bg-white rounded-2xl border border-amber-300 px-4 py-3 space-y-3">
          <div>
            <p className="font-bold text-amber-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-700" />
              {t('ops.shared.title')}
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5 max-w-3xl leading-snug">
              {t('ops.shared.hint')}
            </p>
          </div>

          {sharedRows.length === 0 && (
            <p className="text-xs text-amber-800">{t('ops.shared.none')}</p>
          )}

          <ul className="space-y-2">
            {sharedRows.map((entry) => (
              <li
                key={entry.instagramAccountId}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 space-y-2"
              >
                <p className="text-xs font-semibold text-amber-900">
                  {entry.instagramUsername ? `@${entry.instagramUsername}` : t('ops.noHandle')}
                  <code className="ml-2 text-[10px] text-amber-700">{entry.instagramAccountId}</code>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {entry.tenantIds.map((tenantId) => {
                    const holder = data.rows.find((row) => row.tenantId === tenantId);
                    return (
                      <span
                        key={tenantId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2 py-1"
                      >
                        <code className="text-[10px] text-amber-800">
                          {holder?.username ? `@${holder.username}` : tenantId}
                        </code>
                        {entry.routedTo === tenantId ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                            <Check className="w-3 h-3" />
                            {t('ops.shared.current')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={routeBusy !== null}
                            onClick={() => void routeSharedAccount(entry.instagramAccountId, tenantId)}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                          >
                            {routeBusy === entry.instagramAccountId
                              ? t('ops.trial.busy')
                              : t('ops.shared.route')}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>

          {routeNotice && <p className="text-xs font-semibold text-amber-900">{routeNotice}</p>}
          {routeError && <p className="text-xs text-rose-700">{routeError}</p>}
        </div>
      )}

      {/* The tester-invite queue.

          It sits above the accounts table on purpose: while Meta's access gate is
          open, this is the single thing that unblocks a paying customer, and a
          to-do that lives inside a collapsed row is a to-do that gets missed.
          Every action here writes — the buttons post to `/api/owner/...`, which
          re-checks ownership on the server. */}
      {/* ── DMs that arrived with nothing to answer them ─────────────────────
          The exact shape of "the bot stopped replying": Meta delivered the
          message, no connected account matched, and it was dropped. Routing is
          right (answering from another account's token would be a cross-tenant
          leak), but silence is not — these accounts have to reconnect, and only
          here is that visible. */}
      {data?.unroutedDeliveries?.recent?.length ? (
        <div className="bg-white rounded-2xl border border-amber-300 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
            <div>
              <p className="font-bold text-amber-900">{t('ops.unrouted.title')}</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                {t('ops.unrouted.subtitle', {
                  count: String(data.unroutedDeliveries.recent.length),
                  total: String(data.unroutedDeliveries.total),
                })}
              </p>
            </div>
            <button
              type="button"
              disabled={busyHealth === 'alerts'}
              onClick={() => void clearDeliveryAlerts()}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-amber-300 text-amber-900 bg-white hover:bg-amber-100 disabled:opacity-50"
            >
              {t('ops.unrouted.clear')}
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.unroutedDeliveries.recent.map((entry, index) => (
              <li
                key={`${entry.igAccountId}-${index}`}
                className="px-4 py-2 text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <code className="font-semibold text-slate-800">{entry.igAccountId}</code>
                <span>{t('ops.unrouted.from', { sender: entry.senderId })}</span>
                {entry.preview && <span className="text-slate-400">“{entry.preview}”</span>}
                <span className="ml-auto text-slate-400">{time(entry.at)}</span>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 text-[11px] text-amber-800 border-t border-amber-100 bg-amber-50/60">
            {t('ops.unrouted.hint')}
          </p>
        </div>
      ) : null}

      {testerQueue.length > 0 && (
        <div className="bg-white rounded-2xl border border-rose-200 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-rose-50 border-b border-rose-200">
            <div>
              <p className="font-bold text-rose-900">{t('ops.tester.title')}</p>
              <p className="text-[11px] text-rose-800 mt-0.5">{t('ops.tester.subtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-600 text-white">
                {t('ops.tester.pendingCount', { count: String(pendingInvites) })}
              </span>
              <select
                value={testerWindow}
                onChange={(event) => setTesterWindow(event.target.value as 'all' | '7d' | '30d')}
                aria-label={t('ops.tester.dateFilter')}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-rose-200 bg-white text-rose-900"
              >
                <option value="all">{t('ops.tester.dateAll')}</option>
                <option value="7d">{t('ops.tester.date7')}</option>
                <option value="30d">{t('ops.tester.date30')}</option>
              </select>
              <span className="text-[11px] text-rose-800">
                {t('ops.tester.counts', {
                  pending: String(testerQueue.filter((r) => r.status === 'REQUESTED' || r.status === 'NEEDS_IDENTITY_CONFIRMATION' || r.status === 'READY_TO_INVITE').length),
                  invited: String(testerQueue.filter((r) => r.status === 'INVITATION_SENT' || r.status === 'ACCEPTANCE_PENDING').length),
                  done: String(testerQueue.filter((r) => r.status === 'ACCEPTED').length),
                })}
              </span>
              {data?.metaRolesUrl && (
                <a
                  href={data.metaRolesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('ops.tester.openRoles')}
                </a>
              )}
            </div>
          </div>

          {/* Which app an invite has to be accepted on.

              The mistake this prevents is silent from inside Instagram: an
              invite accepted on a *different* app of the same developer account
              shows up as "authorized" on the person's phone, but the connect
              then either fails on the access gate or stores a token this server
              cannot use — and the bot stays quiet. So the app id the server
              really connects with is printed here, next to the handle to copy. */}
          {data?.oauthApp && (
            <div className="px-4 py-2.5 bg-white border-b border-rose-100">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-700">{t('ops.tester.appLabel')}</span>
                <code className="px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-800">
                  {data.oauthApp.oauthClientId || t('ops.tester.appUnset')}
                </code>
                {data.oauthApp.oauthClientId && (
                  <CopyButton
                    value={data.oauthApp.oauthClientId}
                    label={t('ops.tester.copyAppId')}
                    copied={t('ops.copied')}
                  />
                )}
                <span className="text-slate-400">
                  {data.oauthApp.flavour === 'instagram_login'
                    ? t('ops.tester.appFlavourIg')
                    : t('ops.tester.appFlavourFb')}
                </span>
                {data.oauthApp.facebookAppId &&
                  data.oauthApp.facebookAppId !== data.oauthApp.oauthClientId && (
                    <span className="text-slate-400">
                      {t('ops.tester.fbAppId', { id: data.oauthApp.facebookAppId })}
                    </span>
                  )}
              </div>
              <p className="text-[11px] text-rose-700 mt-1">{t('ops.tester.appWarning')}</p>
            </div>
          )}

          <ul>
            {testerQueue.map((request) => {
              const busy = busyTenant === request.tenantId;
              return (
                <li
                  key={request.tenantId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-slate-100"
                >
                  <span className="font-bold text-slate-900">@{request.username}</span>
                  <CopyButton
                    value={request.username}
                    label={t('ops.tester.copyHandle')}
                    copied={t('ops.copied')}
                  />
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${testerStatusTone[request.status]}`}
                  >
                    {t(`ops.tester.status.${request.status}`)}
                  </span>
                  <code className="text-[11px] text-slate-500">{request.tenantId}</code>
                  <span className="text-[11px] text-slate-400">
                    {t('ops.tester.requestedAt', { time: time(request.requestedAt) })}
                  </span>
                  {/* Who moved this row last, and when — the queue's own trail, so
                      "kisne bheja tha?" never needs a WhatsApp round trip. */}
                  {request.auditLog && request.auditLog.length > 0 && (
                    <span className="text-[11px] text-slate-400">
                      {t('ops.tester.lastAction', {
                        action: request.auditLog[request.auditLog.length - 1].action,
                        by: request.auditLog[request.auditLog.length - 1].by,
                        at: time(request.auditLog[request.auditLog.length - 1].at),
                      })}
                    </span>
                  )}
                  {/* Honest delivery state: the outbox's word, not an assumption. */}
                  {request.notify && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        request.notify.status === 'queued' || request.notify.status === 'provider-accepted'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : request.notify.status === 'delivered'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {t('ops.tester.notifyStatus', { status: request.notify.status })}
                    </span>
                  )}
                  {request.contact?.businessName && (
                    <span className="text-[11px] font-medium text-slate-700">
                      {t('ops.tester.customerName', { name: request.contact.businessName })}
                    </span>
                  )}
                  {/* The customer's WhatsApp, masked as text. The digits only
                      appear inside the wa.me deep link of the action button —
                      the number is never printed on the page. */}
                  {request.contact?.maskedNumber && (
                    <span className="text-[11px] text-slate-500">
                      {t('ops.tester.waMasked', { num: request.contact.maskedNumber })}
                    </span>
                  )}
                  {request.contact && !request.contact.consentGiven && (
                    <span className="text-[11px] text-slate-400">{t('ops.tester.noConsent')}</span>
                  )}
                  {request.contact?.optedOut && (
                    <span className="text-[11px] text-slate-400">{t('ops.tester.optedOut')}</span>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {/* One-click WhatsApp to the customer about this invite —
                        consent-gated by the server already: no waDigits means
                        no button, so an opted-out customer is never targetable. */}
                    {request.contact?.waDigits && (
                      <a
                        href={`https://wa.me/${request.contact.waDigits}?text=${encodeURIComponent(
                          request.contact.language === 'hi'
                            ? t('ops.tester.waMsgHi', { handle: request.username })
                            : t('ops.tester.waMsgEn', { handle: request.username })
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                      >
                        <Send className="w-3 h-3" />
                        {t('ops.tester.waButton')}
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void copyValue(
                          `msg:${request.tenantId}`,
                          t('ops.fix.customerMessage', { connect: `${window.location.origin}/app` })
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                    >
                      {copiedKey === `msg:${request.tenantId}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedKey === `msg:${request.tenantId}` ? t('ops.copied') : t('ops.tester.copyMessage')}
                    </button>
                    {/* The Meta-dashboard step is the prerequisite, so its control is
                        always visible until it is recorded — the Prepare button next to
                        it refuses to work before this anyway. */}
                    {!request.accountAddedAt &&
                      (request.status === 'REQUESTED' ||
                        request.status === 'NEEDS_IDENTITY_CONFIRMATION' ||
                        request.status === 'READY_TO_INVITE') && (
                        <button
                          type="button"
                          disabled={busy}
                          title={t('ops.tester.accountAddedHint', { handle: request.username })}
                          onClick={() => void markAccountAdded(request.tenantId, request.username)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-sky-300 text-sky-800 bg-sky-50 hover:bg-sky-100 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          {t('ops.tester.accountAdded')}
                        </button>
                      )}
                    {request.accountAddedAt && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
                        {t('ops.tester.accountAddedBadge', { by: request.accountAddedBy || '—' })}
                      </span>
                    )}
                    {request.status === 'REQUESTED' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void updateTesterStatus(request.tenantId, 'READY_TO_INVITE')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-purple-300 text-purple-800 bg-purple-50 hover:bg-purple-100 disabled:opacity-50"
                        >
                          <UserPlus className="w-3 h-3" />
                          {t('ops.tester.prepareInvite')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void updateTesterStatus(request.tenantId, 'NEEDS_IDENTITY_CONFIRMATION')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                        >
                          <AlertCircle className="w-3 h-3" />
                          {t('ops.tester.needsIdentity')}
                        </button>
                      </>
                    )}
                    {request.status === 'NEEDS_IDENTITY_CONFIRMATION' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateTesterStatus(request.tenantId, 'READY_TO_INVITE')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-purple-300 text-purple-800 bg-purple-50 hover:bg-purple-100 disabled:opacity-50"
                      >
                        <UserPlus className="w-3 h-3" />
                        {t('ops.tester.readyToInvite')}
                      </button>
                    )}
                    {request.status === 'READY_TO_INVITE' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const url = window.prompt(
                            t('ops.tester.promptInvitationUrl', {
                              handle: request.username,
                              appId: data?.oauthApp?.oauthClientId || '',
                            })
                          );
                          if (!url) return;
                          void sendTesterInvitation(request.tenantId, url, data?.oauthApp?.oauthClientId || '');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Send className="w-3 h-3" />
                        {t('ops.tester.sendInvite')}
                      </button>
                    )}
                    {(request.status === 'INVITATION_SENT' || request.status === 'ACCEPTANCE_PENDING') && (
                      <button
                        type="button"
                        disabled={busy}
                        title={t('ops.tester.verifyAcceptedHint')}
                        onClick={() => void acceptInvitation(request.tenantId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        {t('ops.tester.verifyAccepted')}
                      </button>
                    )}
                    {(request.status === 'INVITATION_SENT' || request.status === 'ACCEPTANCE_PENDING') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateTesterStatus(request.tenantId, 'REQUESTED')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t('ops.tester.reopen')}
                      </button>
                    )}
                    {request.status === 'ACCEPTED' && (
                      <>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            request.acceptanceVerified
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {request.acceptanceVerified
                            ? t('ops.tester.acceptVerified')
                            : t('ops.tester.acceptUnverified', { by: request.acceptedBy || 'owner' })}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void updateTesterStatus(request.tenantId, 'REQUESTED')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t('ops.tester.reopen')}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── New customer activation queue ──────────────────────────────────
          Accounts that connected Instagram but haven't gone through owner
          activation yet. Every action here is owner-only and re-checked on
          the server. */}
      {data && (
        <div className="bg-white rounded-2xl border border-purple-200 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-purple-50 border-b border-purple-200">
            <div>
              <p className="font-bold text-purple-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-700" />
                {t('ops.activation.title')}
              </p>
              <p className="text-[11px] text-purple-800 mt-0.5 max-w-3xl leading-snug">
                {t('ops.activation.hint')}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-600 text-white">
              {data.rows.filter((row) => row.activationState && row.activationState.status === 'CONNECTED_PENDING_ACTIVATION').length}
            </span>
          </div>

          {data.rows.filter((row) => row.activationState).length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-500">{t('ops.activation.empty')}</p>
          )}

          <ul className="divide-y divide-slate-100">
            {data.rows
              .filter((row) => row.activationState)
              .sort((a, b) => {
                const aTime = a.activationState?.connectedAt ? Date.parse(a.activationState.connectedAt) : 0;
                const bTime = b.activationState?.connectedAt ? Date.parse(b.activationState.connectedAt) : 0;
                return bTime - aTime;
              })
              .map((row) => {
                const state = row.activationState!;
                const busy = activationBusy === row.tenantId;
                const canMarkSent =
                  state.status === 'CONNECTED_PENDING_ACTIVATION' && row.testerRequest?.accountAddedAt;
                const canSendInstructions = state.status === 'INVITATION_SENT';
                const canConfirmTestDm = state.status === 'AWAITING_TEST_DM';
                const canRequireAction = ['CONNECTED_PENDING_ACTIVATION', 'INVITATION_SENT', 'AWAITING_CUSTOMER_ACCEPTANCE', 'AWAITING_TEST_DM'].includes(state.status);
                return (
                  <li
                    key={row.tenantId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-slate-100"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-xs">
                        {row.instagram.username ? `@${row.instagram.username}` : t('ops.noHandle')}
                      </span>
                      <CopyButton
                        value={row.tenantId}
                        label="Copy uid"
                        copied={t('ops.copied')}
                      />
                      <span className="text-[10px] text-slate-500 hidden sm:inline">{row.tenantId}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusTone[state.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}
                    >
                      {t(`activation.status.${state.status}`)}
                    </span>
                    <span className="text-[10px] text-slate-400 hidden sm:inline">
                      {state.connectedAt ? new Date(state.connectedAt).toLocaleString() : '—'}
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {state.lastAction && state.lastActionBy && (
                        <span className="text-[10px] text-slate-500 hidden sm:inline">{state.lastAction}</span>
                      )}
                      {/* Actions — server re-checks owner identity on every write. */}
                      {!canMarkSent && canSendInstructions && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void sendActivationInstructions(row.tenantId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          {busy ? t('ops.remove.busy') : t('ops.activation.sendInstructions')}
                        </button>
                      )}
                      {canMarkSent && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void markActivationInvitationSent(row.tenantId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-purple-300 text-purple-800 bg-purple-50 hover:bg-purple-100 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          {t('ops.activation.markInvitationSent')}
                        </button>
                      )}
                      {canConfirmTestDm && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void confirmActivationTestDm(row.tenantId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          {t('ops.activation.confirmTestDm')}
                        </button>
                      )}
                      {canRequireAction && !canMarkSent && !canSendInstructions && !canConfirmTestDm && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void requireActivationAction(row.tenantId, 'Customer needs to complete a pending step.')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {t('ops.activation.requireAction')}
                        </button>
                      )}
                    </span>
                    {state.instructionSend && (
                      <span className="text-[10px] text-slate-500 flex items-center gap-1 ml-2 hidden sm:inline">
                        <span className="font-medium">{state.instructionSend.status}</span>
                        <span>{state.instructionSend.toMasked ? `to ${state.instructionSend.toMasked}` : ''}</span>
                        <span className="text-slate-400">at {state.instructionSend.at.slice(11, 16)}</span>
                      </span>
                    )}
                    {state.status === 'MESSAGE_SEND_FAILED' && (
                      <span className="text-[10px] text-rose-600 ml-2 hidden sm:inline">
                        {t('ops.activation.instructionsFailed', { reason: state.lastAction || 'provider failure' })}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>

          {activationNotice && <p className="px-4 py-2 text-xs font-semibold text-emerald-700">{activationNotice}</p>}
          {activationError && <p className="px-4 py-2 text-xs text-rose-700">{activationError}</p>}
        </div>
      )}

      {/* Customer complaints from the public form that replaced the printed
          mobile number. It sits next to the tester queue because it is the other
          thing that needs a human: the whistle already went to the owner's
          WhatsApp, and this is where a complaint still shows up when that push
          failed. Read-only except for "mark resolved", and the server re-checks
          ownership on that write — this button is convenience, not the gate. */}
      {complaints && complaints.complaints.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div>
              <p className="font-bold text-slate-800">{t('ops.complaint.title')}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{t('ops.complaint.subtitle')}</p>
              {!complaints.whatsappConfigured && (
                <p className="text-[11px] text-amber-700 mt-1 font-medium">
                  {t('ops.complaint.notConfigured')}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {complaints.whatsappConfigured && complaints.whatsappLabel && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-200 text-slate-500 bg-white">
                  {t('ops.complaint.relay', { target: complaints.whatsappLabel })}
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  complaints.stats.open > 0 ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {t('ops.complaint.openCount', { count: String(complaints.stats.open) })}
              </span>
            </div>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {complaints.complaints.map((complaint) => {
              const busy = busyComplaint === complaint.id;
              const resolved = complaint.status === 'resolved';
              const waNumber = String(complaint.contact || '').replace(/\D/g, '');
              return (
                <li
                  key={complaint.id}
                  className={`px-4 py-3 border-t border-slate-100 ${resolved ? 'opacity-60' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-800 text-[13px]">{complaint.accountId}</span>
                    <span className="text-[11px] text-slate-500">{complaint.contact}</span>
                    <span className="text-[11px] text-slate-400">{day(complaint.createdAt)}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        complaint.notified
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {complaint.notified ? t('ops.complaint.delivered') : t('ops.complaint.undelivered')}
                    </span>
                    {!resolved && (
                      <div className="ml-auto flex items-center gap-2">
                        {waNumber.length >= 8 && (
                          <a
                            href={`https://wa.me/${waNumber}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                          >
                            <Send className="w-3 h-3" />
                            WhatsApp
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resolveComplaint(complaint.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          {t('ops.complaint.markDone')}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[13px] text-slate-700 mt-1.5 whitespace-pre-wrap">{complaint.problem}</p>
                  {!complaint.notified && complaint.notifyError && (
                    <p className="text-[11px] text-amber-700 mt-1">{complaint.notifyError}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Off the list ───────────────────────────────────────────────────
          The two ways an account can leave this table. Hidden ones are one press
          from coming back and lost nothing; deleted ones are gone and are kept
          only so the same account cannot claim a fresh trial. Both live in this
          payload for one reason: an account you cannot see again from the screen
          that removed it is a delete with extra steps. */}
      {!!(hiddenAccounts.length || removedAccounts.length) && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div>
            <p className="font-bold text-slate-900">{t('ops.remove.title')}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
              {t('ops.remove.subtitle')}
            </p>
          </div>

          {!!hiddenAccounts.length && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {t('ops.remove.hiddenPanel', { count: String(hiddenAccounts.length) })}
              </p>
              <ul className="mt-2 space-y-2">
                {hiddenAccounts.map((record) => (
                  <li
                    key={record.tenantId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        {record.instagramUsername ? `@${record.instagramUsername}` : record.tenantId}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('ops.remove.hiddenAt', {
                          time: time(record.hiddenAt),
                          by: record.hiddenBy,
                        })}
                        {record.planName ? ` · ${record.planName}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-400">{t('ops.remove.dataUntouched')}</p>
                      {record.note && (
                        <p className="text-[11px] text-slate-500 mt-0.5">{record.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] text-slate-400">{record.tenantId}</code>
                      <button
                        type="button"
                        disabled={busyRemoval === record.tenantId}
                        onClick={() => void restoreTenant(record.tenantId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t('ops.remove.restore')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!removedAccounts.length && (
            <details>
              <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer">
                {t('ops.remove.removedPanel', { count: String(removedAccounts.length) })}
              </summary>
              <p className="text-[11px] text-slate-400 mt-2">{t('ops.remove.removedNote')}</p>
              <ul className="mt-2 space-y-1">
                {removedAccounts.map((record) => (
                  <li key={record.tenantId} className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {record.instagramUsername ? `@${record.instagramUsername}` : record.tenantId}
                    </span>{' '}
                    <code className="text-slate-400">{record.tenantId}</code> ·{' '}
                    {t('ops.remove.removedAt', {
                      time: time(record.removedAt),
                      by: record.removedBy,
                    })}
                    {' · '}
                    {t('ops.remove.removedCounts', {
                      chats: String(record.deleted.chats),
                      leads: String(record.deleted.leads),
                      gaps: String(record.deleted.kbGaps),
                    })}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {notice && (
        <div className="bg-slate-900 text-white text-xs rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-white/70 hover:text-white font-semibold"
          >
            ×
          </button>
        </div>
      )}

      {/* ── "Instagram juda nahi" → one button ──────────────────────────────
          This was the most common row in the console and the least actionable:
          four completely different causes all rendered as the same three words.
          The panel names the cause per account, does what this server is allowed
          to do, and puts the two steps nobody can automate — Meta's tester list
          and the customer's Allow — in front of the owner already copied. */}
      {!!needConnect.length && (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900">
                {t('ops.fix.panelTitle', { count: String(needConnect.length) })}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl leading-snug">
                {t('ops.fix.panelHint')}
              </p>
            </div>
            <button
              type="button"
              disabled={busyFix === '*'}
              onClick={() => void runFixAll()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              <ListChecks className="w-3.5 h-3.5" />
              {busyFix === '*' ? t('ops.remove.busy') : t('ops.fix.bulk')}
            </button>
          </div>

          <ul className="space-y-2">
            {needConnect.map((row) => {
              const handle = row.instagram.username || row.testerRequest?.username || '';
              return (
                <li
                  key={row.tenantId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">
                      {handle ? `@${handle}` : t('ops.noHandle')}
                      <code className="ml-2 text-[10px] text-slate-400">{row.tenantId}</code>
                    </p>
                    {/* Why, from the real record rather than a generic label. */}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {row.instagram.connected
                        ? t(`ops.live.${row.instagram.liveState}`)
                        : row.connectAttempt
                        ? t('ops.fix.lastTry', {
                            time: time(row.connectAttempt.at),
                            message: (row.connectAttempt.message ||
                              row.connectAttempt.code ||
                              '').slice(0, 140),
                          })
                        : t('ops.fix.neverTried')}
                    </p>
                    {(row.instagram.sharedWith?.length || 0) > 0 && (
                      <p className="text-[11px] text-rose-600 mt-0.5">
                        {t('ops.fix.sharedWith', {
                          ids: row.instagram.sharedWith.join(', '),
                          routed: row.tenantId,
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busyFix === row.tenantId}
                    onClick={() => void runFix(row.tenantId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    {busyFix === row.tenantId ? t('ops.remove.busy') : t('ops.fix.button')}
                  </button>
                </li>
              );
            })}
          </ul>

          {fixRoster && (
            <details open className="rounded-xl border border-slate-200 px-3 py-2">
              <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer">
                {t('ops.fix.roster')}
              </summary>
              <p className="text-[11px] text-slate-400 mt-1">{t('ops.fix.bulkHint')}</p>
              <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-600">
                  {t('ops.fix.legendTitle')}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded border bg-emerald-50 border-emerald-200" />
                    {t('ops.fix.legendOk')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded border bg-purple-50 border-purple-200" />
                    {t('ops.fix.legendWaiting')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded border bg-amber-50 border-amber-200" />
                    {t('ops.fix.legendTodo')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded border bg-rose-50 border-rose-200" />
                    {t('ops.fix.legendBlocked')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded border bg-slate-100 border-slate-200" />
                    {t('ops.fix.legendGrey')}
                  </li>
                </ul>
              </div>
              <ul className="mt-2 space-y-1">
                {fixRoster.map((plan) => (
                  <li key={plan.tenantId} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`px-1.5 py-0.5 rounded-md border font-semibold ${blockerTone[plan.blocker]}`}
                    >
                      {t(`ops.fix.label.${plan.blocker}`)}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {plan.handle ? `@${plan.handle}` : t('ops.fix.handleUnknown')}
                    </span>
                    <code className="text-slate-400">{plan.tenantId}</code>
                    <button
                      type="button"
                      disabled={busyFix === plan.tenantId}
                      onClick={() => void runFix(plan.tenantId)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t('ops.fix.button')}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* System Health: real per-customer lifecycle facts + incident lifecycle. */}
      {data && <HealthPanel />}

      {/* OPS Onboarding board: registrations, plan activation, connections,
          KB approvals and WhatsApp notifications — all from real records. */}
      {data && <OpsOnboarding />}

      {/* Banner manager + video library: the owner's publishing tools. */}
      {data && <OpsBannerManager />}
      {data && <OpsVideosPanel />}

      {/* Feature 2 controls: sort + date filter (the field being filtered is
          labelled explicitly — registration date vs last activity). */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sortChoice}
          onChange={(event) => {
            const next = event.target.value as typeof sortChoice;
            setSortChoice(next);
            if (!next.startsWith('activity')) setDateFilterField('created');
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
        >
          <option value="created-desc">{t('ops.sort.newest')}</option>
          <option value="created-asc">{t('ops.sort.oldest')}</option>
          <option value="activity-desc">{t('ops.sort.activityNewest')}</option>
          <option value="activity-oldest">{t('ops.sort.activityOldest')}</option>
        </select>
        <select
          value={dateFilter.preset}
          onChange={(event) => {
            const preset = event.target.value as DatePreset;
            setDateFilter((current) =>
              preset === 'custom'
                ? { ...current, preset: 'custom' as const, from: current.from || '', to: current.to || '' }
                : { preset }
            );
            // When the owner filters by last-activity, the label must say so.
            setDateFilterField(sortChoice.startsWith('activity') ? 'activity' : 'created');
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
        >
          <option value="all">{t('ops.filter.all')}</option>
          <option value="today">{t('ops.filter.today')}</option>
          <option value="yesterday">{t('ops.filter.yesterday')}</option>
          <option value="7d">{t('ops.filter.7d')}</option>
          <option value="30d">{t('ops.filter.30d')}</option>
          <option value="custom">{t('ops.filter.custom')}</option>
        </select>
        {dateFilter.preset === 'custom' && (
          <>
            <label className="text-[11px] text-slate-500">
              {t('ops.filter.customFrom')}
              <input
                type="date"
                value={dateFilter.from || ''}
                onChange={(event) => {
                  setDateFilter((current) => ({ ...current, from: event.target.value }));
                  setPage(1);
                }}
                className="ml-1 px-2 py-1 rounded-lg border border-slate-200 text-sm"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              {t('ops.filter.customTo')}
              <input
                type="date"
                value={dateFilter.to || ''}
                onChange={(event) => {
                  setDateFilter((current) => ({ ...current, to: event.target.value }));
                  setPage(1);
                }}
                className="ml-1 px-2 py-1 rounded-lg border border-slate-200 text-sm"
              />
            </label>
          </>
        )}
        <span className="text-[11px] text-slate-500">
          {dateFilterField === 'activity' ? t('ops.filter.field.activity') : t('ops.filter.field.created')}
        </span>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('ops.search')}
        className="w-full md:w-80 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-purple-500"
      />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading && !data ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{t('ops.loading')}</p>
        ) : !rows.length ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {data?.rows.length ? t('ops.noMatch') : t('ops.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.account')}</th>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.plan')}</th>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.bot')}</th>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.registered')}</th>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.activity')}</th>
                  <th className="text-left font-semibold px-4 py-3">{t('ops.col.attention')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row) => {
                  const open = openRow === row.tenantId;
                  const status = row.plan?.status;
                  return (
                    <Fragment key={row.tenantId}>
                      <tr
                        onClick={() => setOpenRow(open ? null : row.tenantId)}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer align-top"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800">
                              {row.instagram.username
                                ? `@${row.instagram.username}`
                                : row.testerRequest
                                ? `@${row.testerRequest.username}`
                                : t('ops.noHandle')}
                            </span>
                            {row.isOwner && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-900 text-white">
                                {t('ops.owner')}
                              </span>
                            )}
                            {/* The handle is only *requested*, not connected —
                                without this the row would read as a live
                                account the moment a customer typed it in. */}
                            {!row.instagram.username && row.testerRequest && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-rose-200 bg-rose-50 text-rose-700">
                                {t(`ops.tester.status.${row.testerRequest.status}`)}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            {row.username ? (
                              <span className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                @{row.username}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                {t('ops.username.none')}
                              </span>
                            )}
                            {row.freeForever.active && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                                title={t('ops.free.hint')}
                              >
                                {t('ops.free.label')}
                              </span>
                            )}
                            <code className="text-[11px] text-slate-500">{row.tenantId}</code>
                            <CopyButton value={row.tenantId} label="Copy uid" copied={t('ops.copied')} />
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {row.instagram.connected ? t('ops.igConnected') : t('ops.igMissing')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {row.plan ? (
                            <>
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                  statusTone[status || ''] || statusTone.cancelled
                                }`}
                              >
                                {status} · {row.plan.planName}
                              </span>
                              <p className="text-[11px] text-slate-500 mt-1">
                                {row.plan.periodEndsAt
                                  ? t('ops.planLeft', {
                                      date: day(row.plan.periodEndsAt),
                                      days: String(row.plan.daysLeft ?? 0),
                                    })
                                  : t('ops.planNoExpiry')}
                              </p>
                              {row.plan.trialUsed && (
                                <p className="text-[11px] text-slate-400 mt-0.5">{t('ops.trialUsed')}</p>
                              )}
                            </>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border border-slate-200 text-slate-500">
                              {t('ops.noPlan')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                              row.bot.allowed ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            ● {row.bot.allowed ? t('ops.botOn') : t('ops.botOff')}
                          </span>
                          <p className="text-[11px] text-slate-500 mt-1">{row.bot.reason}</p>
                          {/* The per-customer switch. One press stops (or starts)
                              this account's bot — AI replies and manual agent
                              replies both. Stops the row's click-to-expand so the
                              button never fights the table. */}
                          <button
                            type="button"
                            disabled={busyBot === row.tenantId}
                            onClick={(event) => {
                              event.stopPropagation();
                              void setBotState(row.tenantId, row.bot.paused);
                            }}
                            className={`mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border disabled:opacity-50 ${
                              row.bot.paused
                                ? 'border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
                                : 'border-rose-300 text-rose-800 bg-rose-50 hover:bg-rose-100'
                            }`}
                          >
                            {row.bot.paused ? (
                              <>
                                <Play className="w-3 h-3" />
                                {t('ops.bot.resume')}
                              </>
                            ) : (
                              <>
                                <Pause className="w-3 h-3" />
                                {t('ops.bot.pause')}
                              </>
                            )}
                          </button>
                          {row.bot.paused && (
                            <p className="text-[10px] text-rose-700 mt-1">
                              {row.bot.pausedSource === 'global'
                                ? t('ops.bot.pausedGlobal')
                                : t('ops.bot.pausedTenant')}
                            </p>
                          )}
                        </td>
                        {/* Registered: the REAL registration timestamp, labelled
                            by its source; unknown dates show as such and sort
                            last (never faked with another kind of date). */}
                        <td className="px-4 py-3">
                          <p className="text-[12px] text-slate-700">
                            {row.createdAt ? day(row.createdAt) : t('ops.date.unknown')}
                          </p>
                          {row.createdAt && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {row.createdFrom === 'profile'
                                ? t('ops.filter.field.created')
                                : row.createdFrom === 'plan'
                                ? 'plan startedAt'
                                : row.createdFrom === 'connection'
                                ? 'connectedAt'
                                : ''}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-600">
                          <p>{t('ops.leads', { count: String(row.leads.total), fresh: String(row.leads.fresh) })}</p>
                          <p>{t('ops.chats', { count: String(row.chats.conversations) })}</p>
                          <p>{t('ops.docs', { count: String(row.knowledge.documents) })}</p>
                          <p className="text-slate-400 mt-1">{row.lastActivityAt ? day(row.lastActivityAt) : t('ops.noActivity')}</p>
                        </td>
                        <td className="px-4 py-3">
                          {row.attention.length ? (
                            <div className="flex flex-wrap gap-1">
                              {row.attention.map((flag) => (
                                <span
                                  key={flag}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                    flag === 'tokenRejected'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}
                                >
                                  {t(`ops.flag.${flag}`)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-emerald-600">{t('ops.allGood')}</span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/70 border-t border-slate-100">
                          <td colSpan={6} className="px-4 py-4">
                            {/* The customer's profile is where the owner looks
                                when something is going wrong, so the switch for
                                THIS customer's bot lives here too, not only in
                                the Bot column. Same endpoint, same server-side
                                ownership check — this is convenience, not the
                                gate. */}
                            <div
                              className={`mb-4 rounded-xl border px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
                                row.bot.paused
                                  ? 'border-rose-200 bg-rose-50'
                                  : 'border-emerald-200 bg-emerald-50'
                              }`}
                            >
                              <div>
                                <p className="text-[12px] font-semibold text-slate-900">
                                  {t('ops.detail.bot')}
                                </p>
                                <p className="text-[11px] text-slate-600 mt-0.5">
                                  {row.bot.paused
                                    ? row.bot.pausedSource === 'global'
                                      ? t('ops.bot.pausedGlobal')
                                      : t('ops.bot.pausedTenant')
                                    : t('ops.detail.botRunning')}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-0.5">{row.bot.reason}</p>
                              </div>
                              <button
                                type="button"
                                disabled={busyBot === row.tenantId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void setBotState(row.tenantId, row.bot.paused);
                                }}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border disabled:opacity-50 ${
                                  row.bot.paused
                                    ? 'border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100'
                                    : 'border-rose-300 text-rose-800 bg-white hover:bg-rose-100'
                                }`}
                              >
                                {row.bot.paused ? (
                                  <>
                                    <Play className="w-3.5 h-3.5" />
                                    {t('ops.bot.resume')}
                                  </>
                                ) : (
                                  <>
                                    <Pause className="w-3.5 h-3.5" />
                                    {t('ops.bot.pause')}
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[11px]">
                              <div>
                                <p className="font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  {t('ops.detail.instagram')}
                                </p>
                                <p className="text-slate-700">{t('ops.detail.accountId')}: {row.instagram.accountId || '—'}</p>
                                <p className="text-slate-700">{t('ops.detail.connectedAt')}: {time(row.instagram.connectedAt)}</p>
                                <p className="text-slate-700">{t('ops.detail.lastVerified')}: {time(row.instagram.lastVerifiedAt)}</p>
                                {/* Does the token still work for THIS app? A
                                    connected row can still be unable to send. */}
                                {row.instagram.connected && (
                                  <p
                                    className={`mt-1 font-semibold ${
                                      row.instagram.liveState === 'NEEDS_REAUTH'
                                        ? 'text-rose-600'
                                        : row.instagram.liveState === 'OK'
                                        ? 'text-emerald-600'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {t('ops.detail.liveState')}: {t(`ops.live.${row.instagram.liveState}`)}
                                  </p>
                                )}
                                {row.instagram.liveCheckedAt && (
                                  <p className="text-slate-400">{time(row.instagram.liveCheckedAt)}</p>
                                )}
                                {row.instagram.liveDetail && (
                                  <p className="text-rose-600 mt-1 break-words">{row.instagram.liveDetail}</p>
                                )}
                                {row.instagram.lastError && (
                                  <p className="text-rose-600 mt-1 break-words">{row.instagram.lastError}</p>
                                )}
                                {/* Connected and still silent — the one state that reads
                                    as a broken bot and is really a setup collision. */}
                                {(row.instagram.sharedWith?.length || 0) > 0 && (
                                  <p className="text-rose-600 mt-1 break-words">
                                    {t('ops.fix.sharedWith', {
                                      ids: row.instagram.sharedWith.join(', '),
                                      routed: row.tenantId,
                                    })}
                                  </p>
                                )}
                                {/* Why the last attempt ended the way it did — Meta's own
                                    sentence when it gave one. */}
                                {row.connectAttempt && (
                                  <p className="text-slate-500 mt-1 break-words">
                                    {t('ops.fix.lastTry', {
                                      time: time(row.connectAttempt.at),
                                      message: (
                                        row.connectAttempt.message ||
                                        row.connectAttempt.code ||
                                        ''
                                      ).slice(0, 200),
                                    })}
                                  </p>
                                )}
                                {row.instagram.connected && (
                                  <button
                                    type="button"
                                    disabled={busyHealth === row.tenantId}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void checkHealth(row.tenantId);
                                    }}
                                    className="mt-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    {busyHealth === row.tenantId
                                      ? t('ops.detail.checking')
                                      : t('ops.detail.checkToken')}
                                  </button>
                                )}
                                {/* "Token theek hai" is not the same claim as "jawab
                                    jaata hai". This is the second one, and it sends
                                    nothing. */}
                                <button
                                  type="button"
                                  disabled={busySelfTest === row.tenantId}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void runSelfTest(row.tenantId);
                                  }}
                                  className="mt-2 ml-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-50"
                                >
                                  {busySelfTest === row.tenantId
                                    ? t('ops.remove.busy')
                                    : t('ops.test.button')}
                                </button>
                                <div className="mt-2 max-w-xl">
                                  {selfTest?.tenantId === row.tenantId && renderSelfTest(selfTest)}
                                </div>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  {t('ops.detail.knowledge')}
                                </p>
                                <p className="text-slate-700">{t('ops.docs', { count: String(row.knowledge.documents) })}</p>
                                <p className="text-slate-700">{t('ops.detail.openQuestions')}: {row.knowledge.openQuestions}</p>
                                <p className="text-slate-700">
                                  {row.knowledge.customPrompt ? t('ops.detail.promptCustom') : t('ops.detail.promptDefault')}
                                </p>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  {t('ops.detail.inbox')}
                                </p>
                                <p className="text-slate-700">{t('ops.chats', { count: String(row.chats.conversations) })}</p>
                                <p className="text-slate-700">{t('ops.detail.takeovers')}: {row.chats.takeovers}</p>
                                <p className="text-slate-700">{t('ops.detail.lastMessage')}: {time(row.chats.lastMessageAt)}</p>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                  {t('ops.detail.actions')}
                                </p>
                                <p className="text-slate-700">{t('ops.detail.planStarted')}: {day(row.plan?.startedAt)}</p>
                                {row.plan?.amountPaidInr != null && (
                                  <p className="text-slate-700">{t('ops.detail.paid')}: ₹{row.plan.amountPaidInr.toLocaleString('en-IN')}</p>
                                )}
                                {row.instagram.username && (
                                  <a
                                    href={`/book/${row.instagram.username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block mt-2 text-purple-700 font-semibold hover:underline"
                                  >
                                    {t('ops.detail.openBooking')}
                                  </a>
                                )}
                                {/* List hygiene, at the bottom of the profile because
                                    it is the rarest thing to do here. Hide is the
                                    reversible answer for a customer who stopped
                                    paying; Delete erases everything and asks for a
                                    typed confirmation. */}
                                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-1">
                                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                    {t('ops.remove.dangerTitle')}
                                  </p>
                                  <p className="text-[10px] text-slate-500 leading-snug">
                                    {t('ops.remove.hint')}
                                  </p>
                                  <div className="flex flex-wrap gap-2 pt-0.5">
                                    <button
                                      type="button"
                                      disabled={busyRemoval === row.tenantId}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void hideTenant(row.tenantId);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      <EyeOff className="w-3.5 h-3.5" />
                                      {busyRemoval === row.tenantId
                                        ? t('ops.remove.busy')
                                        : t('ops.remove.hide')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busyRemoval === row.tenantId}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setConfirmError(null);
                                        setConfirmText('');
                                        setConfirmTarget(row);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {t('ops.remove.delete')}
                                    </button>
                                  </div>
                                </div>

                                {/* The two things that decide how this account is
                                    named in every conversation, and whether a
                                    plan gate applies to it at all. */}
                                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-1">
                                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                    {t('ops.free.label')}
                                  </p>
                                  <p className="text-[10px] text-slate-500 leading-snug">
                                    {t('ops.free.hint')}
                                  </p>
                                  {row.freeForever.active && (
                                    <p className="text-[10px] text-slate-600">
                                      {row.freeForever.reason === 'owner-connected'
                                        ? t('ops.free.reason.owner-connected')
                                        : t('ops.free.reason.manual')}
                                      {row.freeForever.envListed && ` · ${t('ops.free.env')}`}
                                    </p>
                                  )}
                                  <div className="flex flex-wrap gap-2 pt-0.5">
                                    <button
                                      type="button"
                                      disabled={
                                        busyIdentity === row.tenantId ||
                                        (row.freeForever.active && row.freeForever.envListed)
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void setFreeForever(row.tenantId, !row.freeForever.active);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      {busyIdentity === row.tenantId
                                        ? t('ops.remove.busy')
                                        : row.freeForever.active
                                        ? t('ops.free.turnOff')
                                        : t('ops.free.turnOn')}
                                    </button>
                                    {row.username && (
                                      <button
                                        type="button"
                                        disabled={busyIdentity === row.tenantId}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void resetTenantUsername(row);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                                        title={t('ops.username.resetHint')}
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        {t('ops.username.reset')}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination over the ALREADY-SORTED list — changing the sort or the
          date filter resets to page 1, so a page boundary can never hide or
          duplicate a row. */}
      {paged.total > paged.items.length && (
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-slate-500">
          <span>
            {t('ops.pager.showing', {
              start: String(((paged.page - 1) || 0) * PAGE_SIZE + (paged.items.length ? 1 : 0)),
              end: String((paged.page - 1) * PAGE_SIZE + paged.items.length),
              total: String(paged.total),
            })}
            {' · '}
            {t('ops.pager.page', { page: String(paged.page), pages: String(paged.pages) })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={paged.page <= 1}
              onClick={() => setPage(paged.page - 1)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {t('ops.pager.prev')}
            </button>
            <button
              type="button"
              disabled={paged.page >= paged.pages}
              onClick={() => setPage(paged.page + 1)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {t('ops.pager.next')}
            </button>
          </div>
        </div>
      )}

      {/* The connect diagnosis. Everything the owner needs is on this one card:
          what is wrong, what to do, and the two values that must be exact (the
          handle Meta wants typed, and the redirect URI Meta compares byte for
          byte) already copied. */}
      {fixPlan && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-5 space-y-4 my-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-slate-700" />
                  {t('ops.fix.modalTitle')}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('ops.fix.account')}:{' '}
                  <span className="font-semibold text-slate-800">
                    {fixPlan.handle ? `@${fixPlan.handle}` : t('ops.fix.handleUnknown')}
                  </span>{' '}
                  <code className="text-[10px] text-slate-400">{fixPlan.tenantId}</code>
                </p>
              </div>
              <span
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${blockerTone[fixPlan.blocker]}`}
              >
                {t(`ops.fix.label.${fixPlan.blocker}`)}
              </span>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {t('ops.fix.steps')}
              </p>
              <ol className="mt-1.5 space-y-1.5 list-decimal list-inside">
                {(fixPlan.tokenRefusal
                  ? `${t(`ops.fix.causeStep.${fixPlan.tokenRefusal.cause}`, {
                      appId: fixPlan.oauthApp.clientId || '—',
                      namedAppId: fixPlan.tokenRefusal.appId || '—',
                    })}\n${t(fixStepsKey(fixPlan), {
                      handle: fixPlan.handle ? `@${fixPlan.handle}` : '',
                      uri: fixPlan.redirectUri,
                      appId: fixPlan.oauthApp.clientId || '—',
                    })}`
                  : t(fixStepsKey(fixPlan), {
                      handle: fixPlan.handle ? `@${fixPlan.handle}` : '',
                      uri: fixPlan.redirectUri,
                      appId: fixPlan.oauthApp.clientId || '—',
                    })
                )
                  .split('\n')
                  .filter(Boolean)
                  .map((step) => (
                    <li key={step} className="text-xs text-slate-700 leading-relaxed">
                      {step}
                    </li>
                  ))}
              </ol>
            </div>

            {!!fixAutoFixed.length && (
              <p className="text-[11px] text-emerald-700">
                {t('ops.fix.autoFixed', {
                  what: fixAutoFixed
                    .map((entry) =>
                      entry.startsWith('liveCheck:')
                        ? t('ops.fix.autoLiveCheck', {
                            state: t(`ops.live.${entry.split(':')[1]}`),
                          })
                        : t('ops.fix.autoHandleRecorded')
                    )
                    .join(' · '),
                })}
              </p>
            )}

            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {t('ops.fix.evidence')}
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
                <li>
                  {t('ops.fix.blocker')}: {t(`ops.fix.label.${fixPlan.blocker}`)}
                </li>
                <li>
                  {fixPlan.handle ? `@${fixPlan.handle}` : t('ops.fix.handleUnknown')}
                  {fixPlan.testerRequest
                    ? ` · ${t(`ops.tester.status.${fixPlan.testerRequest.status}`)} · ${time(fixPlan.testerRequest.updatedAt)}`
                    : ''}
                </li>
                <li>
                  {fixPlan.connected
                    ? `${t('ops.detail.liveState')}: ${t(`ops.live.${fixPlan.liveState}`)}`
                    : fixPlan.lastAttempt
                    ? t('ops.fix.lastTry', {
                        time: time(fixPlan.lastAttempt.at),
                        message: fixPlan.lastAttempt.message || fixPlan.lastAttempt.code || '',
                      })
                    : t('ops.fix.neverTried')}
                </li>
                {fixPlan.liveDetail && <li className="text-rose-600">{fixPlan.liveDetail}</li>}
                {fixPlan.tokenRefusal && (
                  <li className="text-rose-600">
                    {t('ops.fix.causeLabel')}: {t(`ops.fix.causeName.${fixPlan.tokenRefusal.cause}`)}
                  </li>
                )}
                {fixPlan.readiness.code && (
                  <li className="text-rose-600">
                    {t('ops.fix.blocker')}: {fixPlan.readiness.code} — {fixPlan.readiness.reason}
                  </li>
                )}
                {(fixPlan.sharedWith.length || 0) > 0 && (
                  <li className="text-rose-600">
                    {t('ops.fix.sharedWith', {
                      ids: fixPlan.sharedWith.join(', '),
                      routed: fixPlan.routedTo || '—',
                    })}
                  </li>
                )}
                <li>
                  {t('ops.fix.redirectUri')}:{' '}
                  <code className="text-[10px] break-all">{fixPlan.redirectUri}</code>
                </li>
                <li>
                  {t('ops.fix.inviteApp')}:{' '}
                  <code className="text-[10px]">{fixPlan.oauthApp.clientId || '—'}</code>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {t('ops.fix.copyMessage')}
              </p>
              {isUnreachableHostUrl(connectOriginOf(fixPlan)) ? (
                // Yahan se customer ko koi link bhejna bekaar hai — is page ka
                // /app link Meta kabhi whitelist nahi karta. Owner ko asli
                // agla kadam dikhao, warna customer dobara wahi dead end dekhega.
                <p className="text-[11px] text-amber-700 whitespace-pre-line">
                  {t('ops.fix.localhostCustomerMessage')}
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-600 whitespace-pre-line">
                    {t('ops.fix.customerMessage', { connect: `${connectOriginOf(fixPlan)}/app` })}
                  </p>
                  <p className="text-[10px] text-slate-400">{t('ops.fix.pasteHint')}</p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {!isUnreachableHostUrl(connectOriginOf(fixPlan)) && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyValue(
                        'message',
                        t('ops.fix.customerMessage', { connect: `${connectOriginOf(fixPlan)}/app` })
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800"
                  >
                    {copiedKey === 'message' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'message' ? t('ops.copied') : t('ops.fix.copyMessage')}
                  </button>
                )}
                {fixPlan.handle && (
                  <button
                    type="button"
                    onClick={() => void copyValue('handle', fixPlan.handle!)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                  >
                    {copiedKey === 'handle' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {t('ops.fix.copyHandle')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void copyValue('uri', fixPlan.redirectUri)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                >
                  {copiedKey === 'uri' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {t('ops.fix.copyUri')}
                </button>
                {data?.metaRolesUrl && (
                  <a
                    href={data.metaRolesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('ops.fix.openRoles')}
                  </a>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setFixPlan(null);
                  setFixAutoFixed([]);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                {t('ops.fix.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The typed confirmation for the one irreversible action here. The server
          refuses a delete without it, so this dialog is a safety rail rather than
          the gate — which is exactly why the button stays disabled until what was
          typed matches the hint the server would have asked for. */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-5 space-y-3">
            <p className="font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              {t('ops.remove.confirmTitle')}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('ops.remove.confirmBody')}
            </p>
            <p className="text-[11px] text-slate-500">
              <code className="text-slate-800">{confirmHint(confirmTarget)}</code>{' '}
              <code className="text-slate-400">{confirmTarget.tenantId}</code>
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={t('ops.remove.confirmType', { expected: confirmHint(confirmTarget) })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-rose-500"
            />
            {confirmError && <p className="text-xs text-rose-700">{confirmError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmText('');
                  setConfirmError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                {t('ops.remove.confirmCancel')}
              </button>
              <button
                type="button"
                disabled={!confirmMatches(confirmTarget) || busyRemoval === confirmTarget.tenantId}
                onClick={() => void deleteTenant(confirmTarget.tenantId, confirmText)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {busyRemoval === confirmTarget.tenantId
                  ? t('ops.remove.busy')
                  : t('ops.remove.confirmGo')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
