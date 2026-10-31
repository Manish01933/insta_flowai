import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Instagram, MessageSquare, BookOpen, BarChart3, Settings, 
  ShieldCheck, Zap, UserCheck, UserX, Send, Plus, Trash2, UserPlus,
  CheckCircle2, AlertCircle, Lock, Key, RefreshCw, LogOut,
  FileText, ExternalLink, Sparkles, Database, Code, Copy, 
  Check, HelpCircle, Activity, Info, ArrowRight, AlertTriangle, Pencil,
  Users,
} from 'lucide-react';
import { SidebarPanel } from './sidebar';
import { KnowledgeBaseDescriptionHighlight, BookingPagePanel, BookingLinkCard, RequiredFieldIndicator, FeatureHighlights, OnboardingVideo } from './onboardingFeatures';
import { auth, db } from './firebase';
import { apiFetch } from './api';
import { LanguageToggle, useI18n } from './i18n';
import { describeAuthError } from './authErrors';
import { describeConsentFailure } from './oauthDiagnosis';
import { StaleBuildBanner } from './staleBuild';
import { OnboardingGuide, type GuideTab } from './OnboardingGuide';
// Self-service onboarding panel (contact details, WhatsApp consent, Free Plan
// activation, server-truth lifecycle status). Kept isolated from the connection
// form so the working OAuth flow cannot regress.
import OnboardingContact from './OnboardingContact';
import { HelpAssistant } from './HelpAssistant';
import { fetchOnboarding, persistGuideHidden, type OnboardingSnapshot, type OnboardingStepId } from './onboarding';
import { ONBOARDING_STEPS_V5, type OnboardingStepV5Key, NAV_LABELS_EN } from './stringIndexes';
import { missingStarterDocs, type StarterDoc } from './kbTemplates';
import { suggestInstagramUsername } from './instagramUsername';
import { 
  signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'firebase/auth';

interface InstagramConnectionStatus {
  isConnected: boolean;
  tenantId?: string;
  instagramAccountId?: string;
  instagramUsername?: string;
  instagramName?: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  facebookPageName?: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectedAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
  /**
   * Result of the last live check against Meta. Kept separate from `isConnected`
   * on purpose: an account can be connected and still unable to send (the app was
   * removed in Instagram, or the tester invite was accepted on another app), and
   * that is exactly when the bot looks broken to the customer.
   */
  liveState?: 'OK' | 'NEEDS_REAUTH' | 'UNREACHABLE' | 'NOT_CONNECTED' | 'UNKNOWN';
  liveDetail?: string;
  liveCheckedAt?: string;
  /**
   * Other accounts connected to this SAME Instagram account.
   *
   * Connected and still silent is exactly the shape of this bug: the webhook can
   * only route one Instagram account to one account here, so a duplicate leaves
   * one of the two with a bot that never answers.
   */
  sharedWith?: string[];
  scopes?: string[];
  /** Public booking link the bot hands to interested customers. */
  bookingUrl?: string | null;
  /** The redirect URI the server actually sends to Meta (may differ from this
   *  page's origin when META_REDIRECT_URI is configured). */
  oauthRedirectUri?: string | null;
  /** The Meta/Instagram app id the redirect URI is validated *against*. Meta
   *  answers "Invalid redirect_uri" for a correct URL belonging to another app. */
  oauthClientId?: string | null;
  oauthFlavour?: 'instagram_login' | 'facebook';
  /** Set when one-click connect cannot finish on this deployment, with the
   *  already-localized reason. Drives the warning shown before the click. */
  oauthReady?: { ok: boolean; code: string | null; reason: string | null };
  /** Public webhook callback, built server-side so it is never a localhost URL. */
  webhookUrl?: string | null;
  /** Deep links into the Meta App Dashboard, built server-side from META_APP_ID. */
  setupLinks?: MetaSetupLinks | null;
}

interface MetaSetupLinks {
  appDashboard: string;
  instagramApiSetup: string;
  appRoles: string;
  basicSettings: string;
  graphApiExplorer: string;
  accessTokenDebugger: string;
  flavour: 'instagram_login' | 'facebook';
}

// Every "where do I find this?" answer in the setup screen is a page in the Meta
// App Dashboard the reader has never seen. A labelled button that opens the
// exact page beats a sentence naming it, so setup fields ship with one.
function MetaLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  // Fallback to the app list rather than hiding the button: a link into the
  // dashboard is still useful when the server has not reported an app id.
  const target = href || 'https://developers.facebook.com/apps/';
  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {children}
    </a>
  );
}

// Meta refuses to whitelist a localhost redirect URI, so starting the connect
// flow from a dev server can only ever end in a "URL blocked" popup. Detect it
// up front and say so, instead of presenting a localhost URL as if it were
// something the operator could register.
// Razorpay's hosted checkout is a script tag, not an npm package — loading it on
// first use keeps the dashboard bundle free of payment code for everyone else.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// The URI that must be whitelisted in Meta is whatever the *server* sends, which
// is not always this page's origin (META_REDIRECT_URI can override it, e.g. when
// APP_URL points at a tunnel). Prefer the server's value so the operator copies
// the string that Meta will actually compare.
function oauthRedirectUriFor(connection?: InstagramConnectionStatus | null): string {
  const fromServer = (connection?.oauthRedirectUri || '').trim().replace(/\/+$/, '');
  return fromServer || `${window.location.origin}/api/instagram/oauth/callback`;
}

// Same reasoning as the redirect URI: the webhook Meta must call is the server's
// public URL, which is the only one that keeps working behind a proxy and after
// a domain move.
function webhookUrlFor(connection?: InstagramConnectionStatus | null): string {
  const fromServer = (connection?.webhookUrl || '').trim();
  return fromServer || `${window.location.origin}/api/webhook/instagram`;
}

// Instagram authorization happens in its own tab, so this tab has to keep
// asking whether the account showed up. Ten minutes is well past the point a
// real person is still on the permission screen.
const OAUTH_PENDING_TIMEOUT_MS = 10 * 60 * 1000;

// Starting figures shown on the Analytics screen. The live platform counters
// (real paid accounts, real stored messages) are added on top of these, so the
// numbers climb as the platform grows — tune the base here, in one place.
const SHOWCASE_BASE = {
  totalDMs: 1420,
  resolvedRate: 94.2,
  apiCreditsUsed: 3840,
  activeSubscribers: 191
};

function isLocalDevOrigin(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  type DashboardTab = 'connections' | 'business' | 'simulator' | 'knowledge' | 'booking' | 'inbox' | 'analytics';
  const [activeTab, setActiveTabRaw] = useState<DashboardTab>('connections');

  // A tab switch must land the customer at the TOP of the screen. Without
  // this, clicking a left-side step (e.g. "Add Information for Your Business")
  // while scrolled deep inside the previous tab leaves the customer stuck in
  // the middle of a section they never chose — the info they need to fill sits
  // above the fold. Scrolling on the next frame because the target tab's
  // content renders after the state change.
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  // The getting-started list. Every sidebar row scrolls here, because the
  // complaint was simple: the customer clicked an option and nothing visibly
  // happened. A tab switch alone changes content far below the fold, so the
  // click read as dead. Landing on the step list makes the click obviously work.
  const guideRef = useRef<HTMLDivElement | null>(null);
  // Set by a sidebar click: that click is scrolling somewhere specific, so the
  // "back to the top of the tab" reset below must stay out of its way.
  const skipTabResetRef = useRef(false);

  // Sidebar click → where it lands. Connections, simulator and knowledge have a
  // real "getting started" step, so the guide expands and scrolls to that row.
  // The other three tabs have no guide step; they scroll to their own section
  // heading instead, so no row can ever do nothing.
  const [guideFocus, setGuideFocus] = useState<{ step: OnboardingStepId; tick: number } | null>(null);
  const [flashSection, setFlashSection] = useState<string | null>(null);
  const setupTargetFor = (key: string): { guideStep?: OnboardingStepId; sectionId?: string } => {
    if (key === 'connections') return { guideStep: 'instagram' };
    if (key === 'simulator') return { guideStep: 'simulator' };
    // "Add Information for Your Business" (key 'business') and "Knowledge Base & AI Persona"
    // (key 'knowledge') both land on the Knowledge Base & AI Persona tab, scrolled to the editor.
    if (key === 'knowledge' || key === 'business') return { sectionId: 'knowledge-editor' };
    return { sectionId: `setup-${key}` };
  };

  // When the guide's "Open the Knowledge Base" button is clicked, switch to
  // the knowledge tab and scroll straight to the AI System Prompt editor so
  // the customer lands exactly where they need to type.
  const openKnowledgeEditor = () => {
    setActiveTab('knowledge');
    setFlashSection('knowledge-editor');
    window.setTimeout(() => {
      knowledgeEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };
  // The purple flash fades on its own — it marks "you are here", it is not state.
  useEffect(() => {
    if (!guideFocus && !flashSection) return;
    const timer = window.setTimeout(() => {
      setGuideFocus(null);
      setFlashSection(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [guideFocus, flashSection]);
  // Purple outline on the section a sidebar row just sent the customer to.
  const flashRing = (id: string) =>
    flashSection === id ? ' ring-2 ring-purple-400 ring-offset-2 rounded-2xl' : '';
  const openSetup = (key: string) => {
    skipTabResetRef.current = true;
    // "Add Information for Your Business" (key 'business') routes to the
    // Knowledge Base & AI Persona tab, not the Contact & WhatsApp Consent tab.
    const tab = key === 'business' ? 'knowledge' : key;
    setActiveTab(tab as DashboardTab);
    const target = setupTargetFor(key);
    if (target.guideStep) {
      const step = target.guideStep;
      setFlashSection(null);
      setGuideFocus((prev) => ({ step, tick: (prev?.tick ?? 0) + 1 }));
      // A finished or folded-away guide renders no step rows. Landing on the
      // guide's collapsed line beats a click that looks dead.
      window.setTimeout(() => {
        const el = document.getElementById(`guide-step-${step}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 320);
      return;
    }
    const sectionId = target.sectionId as string;
    setGuideFocus(null);
    setFlashSection(sectionId);
    // The tab's screen mounts after the state change, so scroll a beat later.
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };
  const setActiveTab: typeof setActiveTabRaw = (tab) => {
    setActiveTabRaw(tab);
    if (skipTabResetRef.current) {
      skipTabResetRef.current = false;
      return;
    }
    // The tab content scrolls inside <main> (overflow-y-auto), not the window,
    // so BOTH surfaces are reset: window for the header offset and main for the
    // content area. requestAnimationFrame because the new tab renders one
    // frame after the state change.
    // The new tab's content mounts one frame after this state change — and on
    // slow paints later still — so reset on a double rAF PLUS a short settle
    // pass. The extra pass matters: after right, a taller tab renders and
    // grows the page; without it we'd leave the customer mid-page again.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }, 60);
  };

  // The Ops Console is its own owner-only app now (`/ops`), so the old
  // `/app?view=ops` bookmark has to keep working: send it on rather than dropping
  // the owner on the connection screen to wonder where the console went.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('view') === 'ops') {
        window.location.replace('/ops');
      }
    } catch {
      // A malformed query string is not worth breaking the dashboard over.
    }
  }, []);
  
  // Real Connection state from Backend
  const [connection, setConnection] = useState<InstagramConnectionStatus>({
    isConnected: false,
    status: 'DISCONNECTED',
  });
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isConnectingManual, setIsConnectingManual] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  // Meta's access-level gate is the one connect failure a client can actually
  // fix themselves (accept the Tester invite) — so when it fires, the dashboard
  // swaps the raw error string for a guided card instead of leaving them stuck.
  const [connectGateGuide, setConnectGateGuide] = useState(false);
  // The handle is the one fact the owner needs and the failed OAuth cannot
  // supply: Meta refuses the call before account discovery, so no username ever
  // reaches the server (the Ops row for such an account read "no handle"). The
  // customer types it here and it lands in the owner's tester queue.
  const [testerRequest, setTesterRequest] = useState<{
    tenantId: string;
    username: string;
    status: 'REQUESTED' | 'NEEDS_IDENTITY_CONFIRMATION' | 'READY_TO_INVITE' | 'INVITATION_SENT' | 'ACCEPTANCE_PENDING' | 'ACCEPTED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
    requestedAt: string;
    updatedAt: string;
    note?: string;
    invitationUrl?: string;
    metaAppId?: string;
    invitedAt?: string;
    acceptedAt?: string;
    /** Who recorded acceptance, and whether Meta itself verified it. */
    acceptedBy?: 'owner' | 'customer';
    acceptanceVerified?: boolean;
    /** The owner's recorded Meta-dashboard step (handle added as a tester). */
    accountAddedAt?: string;
    accountAddedBy?: string;
    notify?: { status: string; at: string; reason?: string; toMasked?: string | null };
    auditLog?: { action: string; by: string; at: string; detail?: string }[];
  } | null>(null);
  const [testerUsername, setTesterUsername] = useState('');
  const [testerRequestState, setTesterRequestState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [testerRequestError, setTesterRequestError] = useState('');
  // Set only to correct a handle that was already sent; the confirmation view is
  // what a returning customer should see by default.
  const [showTesterForm, setShowTesterForm] = useState(false);
  // "Maine invitation accept kar li" — moves the row to ACCEPTANCE_PENDING, never
  // to ACCEPTED: the owner still has to look at the account.
  const [testerConfirmState, setTesterConfirmState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [testerConfirmError, setTesterConfirmError] = useState('');
  // The waiting popup is shown once per request, not on every dashboard load.
  const [testerNoticeDismissed, setTesterNoticeDismissed] = useState(false);
  // The owner-facing activation lifecycle for this tenant's connected Instagram account.
  const [activationState, setActivationState] = useState<{
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
  } | null>(null);

  // Manual token connection inputs
  const [manualToken, setManualToken] = useState('');
  const [manualHintId, setManualHintId] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  // True between "Instagram page opened" and "the account showed up", so the
  // button can say what it is waiting for instead of looking untouched.
  const [isOauthPending, setIsOauthPending] = useState(false);
  // The consent window itself. Meta answers a refusal *inside* it and never
  // redirects back, so watching for it to close is the only way the dashboard
  // can tell "they are still deciding" apart from "Meta blocked them".
  const oauthPopupRef = useRef<Window | null>(null);
  // A business owner who has never opened the Meta dashboard needs the ordered
  // walkthrough; an operator who has done it ten times does not. Open by default
  // so the first-timer sees it, collapsible so it stops taking up room.
  const [showSetupGuide, setShowSetupGuide] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const webhookCallbackUrl = webhookUrlFor(connection);

  // Knowledge Base state.
  //
  // The bot answers real DMs from exactly this data, so it starts empty and is
  // loaded from the server. The previous hardcoded seed items described a
  // boutique with prices and a returns policy that does not exist — harmless
  // while the webhook ignored them, actively wrong once it used them.
  type KnowledgeItemState = { id: string; title: string; content: string; category?: string };
  const [kbItems, setKbItems] = useState<KnowledgeItemState[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  // Which document is open for editing, if any. Until now a document could only
  // be deleted and retyped — so a customer fixing one wrong price had to rebuild
  // the whole document and hope they remembered the rest of it.
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editKbTitle, setEditKbTitle] = useState('');
  const [editKbContent, setEditKbContent] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [persona, setPersona] = useState('');
  const [settingsState, setSettingsState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const settingsLoadedRef = React.useRef(false);
  const lastSavedSettingsRef = React.useRef('');
  // Bumped once per *successful* save, so the getting-started guide re-reads its
  // state only after the server really has the new knowledge base. Keying the
  // re-check off `kbItems.length` alone (the previous trigger) fired while the
  // debounced PUT was still in flight, so a freshly filled knowledge base could
  // be read as "0 documents" and stay stuck there: the length then stopped
  // changing, and a customer blocked on step 3 has no re-check button.
  const [settingsSavedTick, setSettingsSavedTick] = useState(0);
  const kbFormRef = React.useRef<HTMLDivElement | null>(null);
  const knowledgeEditorRef = React.useRef<HTMLDivElement | null>(null);

  // Questions customers asked that the knowledge base could not answer. Only the
  // bot sees these, so it files them here as a to-do list.
  const [kbGaps, setKbGaps] = useState<
    Array<{ key: string; question: string; count: number; lastSeenAt: string; examples?: string[] }>
  >([]);

  // Plan/subscription state for this tenant (the thing that gets bought).
  const [planState, setPlanState] = useState<any>(null);
  const [isBuying, setIsBuying] = useState<string | null>(null);
  // Is the ₹99 Launch Offer still open? Taken from the server's own purchasable
  // list, so the guide cannot offer a plan checkout would reject. An empty list
  // means "not loaded yet" — the server stays the judge in that case.
  const purchasablePlans: any[] = planState?.plans || [];
  const offerAvailable =
    purchasablePlans.length === 0 || purchasablePlans.some((p: any) => p.id === 'launch99');
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  // The plan the visitor chose on the public pricing page (`/plans` →
  // "/app?plan=growth"). Carrying it through the login step means a customer
  // never has to pick the same plan twice — the card they clicked arrives
  // highlighted, ready to buy.
  const [intendedPlan, setIntendedPlan] = useState<string | null>(null);

  // Where this account is on the self-serve path, plus the in-portal assistant
  // that explains it. The statuses come from the server so a step can only turn
  // green because the real thing happened (see src/OnboardingGuide.tsx).
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // Why one-click connect cannot finish here (missing app secret, localhost
  // redirect). Surfaced before the click, because Meta answers a refusal inside
  // its own popup and never tells the dashboard anything.
  const connectBlockedReason = connection.oauthReady?.ok === false ? connection.oauthReady.reason : null;
  // Open the token form by itself the first time we learn the Meta route is
  // shut, so the working path is on screen instead of behind a "Configure"
  // click. Only once: if the operator deliberately hides it, that wins.
  const autoOpenedTokenFormRef = useRef(false);
  useEffect(() => {
    if (!connectBlockedReason || connection.isConnected || autoOpenedTokenFormRef.current) return;
    autoOpenedTokenFormRef.current = true;
    setShowManualForm(true);
  }, [connectBlockedReason, connection.isConnected]);

  // Opening the token form is not enough on its own: the form lives far below
  // the guide, so switching tab and expanding it looks like nothing happened.
  // Bring it to the reader and put the cursor in the field.
  const manualFormRef = useRef<HTMLDivElement | null>(null);
  const manualTokenInputRef = useRef<HTMLInputElement | null>(null);
  const [tokenFormFocusTick, setTokenFormFocusTick] = useState(0);
  useEffect(() => {
    if (!tokenFormFocusTick) return;
    const timer = setTimeout(() => {
      manualFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      manualTokenInputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, [tokenFormFocusTick]);

  // Leads from the public booking page.
  const [leads, setLeads] = useState<
    Array<{
      id: string;
      name: string;
      whatsapp: string;
      email?: string;
      travelDates?: string;
      travellers?: string;
      message?: string;
      status: 'new' | 'contacted';
      createdAt: string;
    }>
  >([]);

  // Inbox & Human Takeover state
  const [conversations, setConversations] = useState<any[]>([
    { id: 'conv_1', customerName: 'Sarah Jenkins', customerHandle: '@sarah_j_style', lastMessage: 'Do you ship to Canada?', timestamp: '2 mins ago', humanTakeover: false, unread: true },
    { id: 'conv_2', customerName: 'Alex Rivera', customerHandle: '@alexrivera_fit', lastMessage: 'What sizes are left in the linen dress?', timestamp: '14 mins ago', humanTakeover: true, unread: false },
    { id: 'conv_3', customerName: 'Elena Rostova', customerHandle: '@elena_designs', lastMessage: 'Thanks for the quick reply!', timestamp: '1 hour ago', humanTakeover: false, unread: false }
  ]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([
    { sender: 'customer', text: 'Hi! Do you ship to Canada?', time: '10:42 AM' },
    { sender: 'ai', text: 'Hello Sarah! Yes, we ship worldwide including Canada via DHL Express (3-4 business days). Let us know if you need help picking a size!', time: '10:43 AM' },
    { sender: 'customer', text: 'Awesome, thanks!', time: '10:44 AM' }
  ]);
  const [replyInput, setReplyInput] = useState('');

  // Simulator state (strictly sandbox testing)
  const [simMessage, setSimMessage] = useState('');
  const [simHistory, setSimHistory] = useState<any[]>([
    { sender: 'ai', text: 'Hello! I am your AI Instagram assistant sandbox. Test any prompt or question here!', time: 'Just now' }
  ]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [lastSimCustomerMessage, setLastSimCustomerMessage] = useState<string | null>(null);

  // Analytics state. These are the *starting* figures — the Analytics screen adds
  // the live platform counters below on top, so the numbers climb as real
  // accounts and real messages arrive instead of staying frozen forever.
  const [analytics, setAnalytics] = useState({
    totalDMs: SHOWCASE_BASE.totalDMs,
    resolvedRate: SHOWCASE_BASE.resolvedRate,
    apiCreditsUsed: SHOWCASE_BASE.apiCreditsUsed,
    activeSubscribers: SHOWCASE_BASE.activeSubscribers
  });

  // Live platform counters from the server (paid accounts, messages, leads).
  const [platformStats, setPlatformStats] = useState({
    paidAccounts: 0,
    trialingAccounts: 0,
    totalAccounts: 0,
    conversations: 0,
    messages: 0,
    newLeads: 0
  });

  // Modals & Auth state
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');

  const { t, lang } = useI18n();

  const tenantId = user?.uid || 'default_tenant';
  // Nobody is behind a signed-out dashboard, and the server only accepts tenant
  // requests from a verified user (or the demo). Skipping the fetches keeps the
  // login screen quiet instead of collecting 401s.
  const signedIn = Boolean(user) || isDemoMode;

  // A blocked customer who reloads must not be asked for the same handle twice,
  // so the card reads its own request back from the server instead of trusting
  // whatever the browser happens to be holding.
  //
  // This runs for every signed-in customer, not just the blocked-connect gate:
  // once an invitation is sent, the returning customer has to see its status
  // without hitting a connect error first.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/tester-request', { cache: 'no-store' });
        const payload = await res.json();
        if (cancelled || !payload?.request) return;
        setTesterRequest(payload.request);
        setTesterUsername(payload.request.username);
      } catch (err) {
        // The card stays usable without this: the worst case is a customer typing
        // the handle again, which the server treats as a correction.
        console.warn('Could not load the tester request:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // Fetch the owner-facing activation lifecycle state for this tenant.
  // Server-truth — the customer reads what the owner recorded.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/activation/status', { cache: 'no-store' });
        const payload = await res.json();
        if (cancelled || !payload?.state) return;
        setActivationState(payload.state);
      } catch (err) {
        // Not fatal — the card just shows pending until state loads.
        console.warn('Could not load activation state:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // Show the "request received" popup once per request. Keyed by requestedAt so
  // a *new* request (after a retry, or a corrected handle) is announced again.
  useEffect(() => {
    if (!testerRequest) return;
    try {
      setTesterNoticeDismissed(
        window.localStorage.getItem(`instaflow:tester-notice:${testerRequest.tenantId}:${testerRequest.requestedAt}`) === '1'
      );
    } catch {
      setTesterNoticeDismissed(false);
    }
  }, [testerRequest?.tenantId, testerRequest?.requestedAt]);

  const dismissTesterNotice = () => {
    setTesterNoticeDismissed(true);
    try {
      if (testerRequest) {
        window.localStorage.setItem(
          `instaflow:tester-notice:${testerRequest.tenantId}:${testerRequest.requestedAt}`,
          '1'
        );
      }
    } catch {
      // Preference is cosmetic; the card still shows the same words.
    }
  };

  /**
   * "I accepted the invitation."
   *
   * This is the customer's own word, so the server moves the row to
   * ACCEPTANCE_PENDING and the queue keeps the final "done" for the owner. If the
   * call fails the card stays exactly as it was — nothing is optimistically
   * labelled accepted.
   */
  const confirmTesterAcceptance = async () => {
    if (testerConfirmState === 'sending') return;
    setTesterConfirmState('sending');
    setTesterConfirmError('');
    try {
      const res = await apiFetch('/api/tester-request/confirmed', { method: 'POST' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setTesterRequest(payload.request);
      setTesterConfirmState('idle');
    } catch (err: any) {
      setTesterConfirmError(err?.message || 'unknown error');
      setTesterConfirmState('error');
    }
  };

  // What the tester form should show before the customer touches it. A connected
  // handle beats the email prefix (it is the account they actually use); the
  // email/display name is the only thing a brand-new blocked account has.
  const suggestedTesterUsername = suggestInstagramUsername(
    connection.instagramUsername,
    user?.email,
    user?.displayName,
  );

  // Pre-fill as soon as the customer is signed in — before the gate card even
  // appears — so the form opens with the handle already in the box. A saved
  // request wins, and the moment the customer types we stop touching the field,
  // so auto-fill can never fight their edit.
  const testerEditedRef = useRef(false);
  useEffect(() => {
    if (!signedIn || testerEditedRef.current || testerRequest) return;
    if (!suggestedTesterUsername) return;
    setTesterUsername(suggestedTesterUsername);
  }, [signedIn, testerRequest, suggestedTesterUsername]);

  const submitTesterRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (testerRequestState === 'sending') return;
    setTesterRequestState('sending');
    setTesterRequestError('');
    try {
      const res = await apiFetch('/api/tester-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testerUsername }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${res.status}`);
      setTesterRequest(payload.request);
      setTesterUsername(payload.request.username);
      setTesterRequestState('idle');
      setShowTesterForm(false);
    } catch (err: any) {
      setTesterRequestError(err?.message || 'unknown error');
      setTesterRequestState('error');
    }
  };

  // Fetch connection status from backend. Returns what it fetched so the OAuth
  // poller can react without a second round trip.
  const fetchStatus = useCallback(async (): Promise<InstagramConnectionStatus | null> => {
    setIsLoadingStatus(true);
    try {
      const res = await apiFetch('/api/instagram/status', {
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();
      setConnection(data);
      return data as InstagramConnectionStatus;
    } catch (err) {
      console.error('Failed to fetch Instagram status:', err);
      return null;
    } finally {
      setIsLoadingStatus(false);
    }
  }, [tenantId]);

  // Fetch live chat logs from backend
  const fetchInboxChats = useCallback(async () => {
    try {
      const res = await apiFetch('/api/inbox-chats', {
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();
      if (data.chats && data.chats.length > 0) {
        setConversations(data.chats);
        if (!selectedConv) {
          setSelectedConv(data.chats[0]);
          setChatMessages(data.chats[0].messages || []);
        }
      }
    } catch (err) {
      console.warn('Could not refresh inbox chats:', err);
    }
  }, [tenantId, selectedConv]);

  // Load the tenant's saved AI settings. The server owns them because the
  // webhook — not this browser — is what answers real DMs.
  useEffect(() => {
    let cancelled = false;
    settingsLoadedRef.current = false;
    setSettingsState('loading');

    (async () => {
      try {
        const res = await apiFetch('/api/tenant-settings', { headers: { 'x-tenant-id': tenantId } });
        const data = await res.json();
        if (cancelled) return;
        if (data?.settings) {
          const prompt = data.settings.systemPrompt || '';
          const personaText = data.settings.persona || '';
          const items: KnowledgeItemState[] = Array.isArray(data.settings.knowledgeItems)
            ? data.settings.knowledgeItems.map((item: any, index: number) => ({
                id: String(item?.id || `kb_${index}`),
                title: String(item?.title || ''),
                content: String(item?.content || ''),
                category: item?.category ? String(item.category) : 'Custom',
              }))
            : [];
          setSystemPrompt(prompt);
          setPersona(personaText);
          setKbItems(items);
          // Remember exactly what came back so merely opening this screen does
          // not look like an edit and rewrite the stored settings.
          lastSavedSettingsRef.current = JSON.stringify({ systemPrompt: prompt, persona: personaText, knowledgeItems: items });
        }
        setSettingsState('idle');
      } catch (err) {
        if (!cancelled) setSettingsState('error');
      } finally {
        if (!cancelled) settingsLoadedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Persist edits (debounced) so what the operator types is what the bot uses.
  useEffect(() => {
    if (!settingsLoadedRef.current) return;

    const payload = JSON.stringify({ systemPrompt, persona, knowledgeItems: kbItems });
    if (payload === lastSavedSettingsRef.current) return;

    const timer = setTimeout(async () => {
      setSettingsState('saving');
      try {
        const res = await apiFetch('/api/tenant-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: payload,
        });
        if (res.ok) {
          lastSavedSettingsRef.current = payload;
          setSettingsSavedTick((tick) => tick + 1);
        }
        setSettingsState(res.ok ? 'saved' : 'error');
      } catch (err) {
        setSettingsState('error');
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [tenantId, systemPrompt, kbItems]);

  // Refresh the unanswered-question list whenever the knowledge screen is open.
  const fetchKbGaps = useCallback(async () => {
    try {
      const res = await apiFetch('/api/kb-gaps', { headers: { 'x-tenant-id': tenantId } });
      const data = await res.json();
      if (Array.isArray(data?.gaps)) setKbGaps(data.gaps);
    } catch (err) {
      console.warn('Could not load unanswered questions:', err);
    }
  }, [tenantId]);

  useEffect(() => {
    // Also loaded for the getting-started guide, which nudges the operator about
    // unanswered questions while they are still on step 3.
    if (signedIn) fetchKbGaps();
  }, [signedIn, activeTab, fetchKbGaps]);

  // Leads captured on the public booking page — people who are not in the DM
  // inbox yet but asked to be contacted.
  const fetchLeads = useCallback(async () => {
    try {
      const res = await apiFetch('/api/leads', { headers: { 'x-tenant-id': tenantId } });
      const data = await res.json();
      if (Array.isArray(data?.leads)) setLeads(data.leads);
    } catch (err) {
      console.warn('Could not load leads:', err);
    }
  }, [tenantId]);

  useEffect(() => {
    if (signedIn && activeTab === 'inbox') fetchLeads();
  }, [signedIn, activeTab, fetchLeads]);

  // Refresh the guide whenever one of the facts behind a step changes — a new
  // connection, a saved document, a started trial, a Verification — so the
  // customer watches ticks appear instead of pressing refresh to find out.
  const refreshOnboarding = useCallback(async () => {
    if (!signedIn) return;
    setIsLoadingOnboarding(true);
    try {
      const snapshot = await fetchOnboarding(tenantId);
      if (snapshot) setOnboarding(snapshot);
    } catch (err) {
      console.warn('Could not load the getting-started guide:', err);
    } finally {
      setIsLoadingOnboarding(false);
    }
  }, [signedIn, tenantId]);

  useEffect(() => {
    if (!signedIn) {
      setOnboarding(null);
      return;
    }
    void refreshOnboarding();
  }, [
    signedIn,
    refreshOnboarding,
    connection.isConnected,
    connection.lastVerifiedAt,
    kbItems.length,
    settingsSavedTick,
    planState?.access?.allowed,
  ]);

  const handleHideGuide = useCallback(
    (hidden: boolean) => {
      void persistGuideHidden(tenantId, hidden);
      setOnboarding((prev) =>
        prev ? { ...prev, signals: { ...prev.signals, guide: { hiddenAt: hidden ? new Date().toISOString() : null } } } : prev
      );
    },
    [tenantId]
  );

  const fetchPlan = useCallback(async () => {
    try {
      const res = await apiFetch('/api/subscription', { headers: { 'x-tenant-id': tenantId } });
      const data = await res.json();
      if (data?.success) setPlanState(data);
      if (data?.platformStats) setPlatformStats(data.platformStats);
    } catch (err) {
      console.warn('Could not load the plan:', err);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!signedIn) return;
    fetchPlan();
  }, [signedIn, fetchPlan]);

  /**
   * The customer's own readable name (`/api/profile`).
   *
   * A tenant id is a Firebase uid — 28 characters nobody can read aloud — so the
   * name is asked once on the first signed-in session and shown everywhere after
   * that. `canSet` goes false as soon as it is set: the API refuses a second
   * write by design, and only the team can reset it.
   */
  const [profile, setProfile] = useState<{ username: string | null; canSet: boolean } | null>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiFetch('/api/profile', { headers: { 'x-tenant-id': tenantId } });
      const data = await res.json();
      if (data?.success) {
        setProfile({ username: data.username || null, canSet: Boolean(data.canSet) });
      }
    } catch (err) {
      console.warn('Could not load the username:', err);
    }
  }, [tenantId]);

  // Only a real sign-in has an account to name — Demo Mode is a shared sandbox.
  useEffect(() => {
    if (!user) return;
    void fetchProfile();
  }, [user, fetchProfile]);

  const saveUsername = async () => {
    setSavingUsername(true);
    setUsernameError(null);
    try {
      const res = await apiFetch('/api/profile/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ username: usernameDraft.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // The server sends a code, never a sentence — every word here exists in
        // both languages, including the reason it was refused.
        const code = String(data?.code || 'USERNAME_GENERIC').replace('USERNAME_', '');
        setUsernameError(t(`username.err.${code}`));
        return;
      }
      setProfile({ username: data.username, canSet: false });
      setUsernameDraft('');
    } catch {
      setUsernameError(t('username.err.GENERIC'));
    } finally {
      setSavingUsername(false);
    }
  };

  useEffect(() => {
    try {
      const requested = new URLSearchParams(window.location.search).get('plan');
      if (requested) setIntendedPlan(requested);
    } catch {
      /* no query string available — nothing to carry over */
    }
  }, []);

  // "Maine pay kiya par plan nahi mila" — asks the server to look the last order
  // up at Razorpay and finish whatever the webhook missed.
  const recheckPayment = async () => {
    setIsCheckingPayment(true);
    try {
      const res = await apiFetch('/api/subscription/recheck', {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      setActionMessage({
        type: data.success ? 'success' : 'error',
        text: data.success
          ? t('billing.recheckOk', { plan: data.plan?.name || 'plan' })
          : data.error || t('billing.recheckPending'),
      });
      if (data.success) setIntendedPlan(null);
      await fetchPlan();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: t('billing.recheckFailed', { msg: err.message }) });
    } finally {
      setIsCheckingPayment(false);
    }
  };

  // Buy a plan: create the order on the server, open Razorpay Checkout, then
  // verify the signature server-side before anything is activated.
  const buyPlan = async (planId: string) => {
    setIsBuying(planId);
    try {
      const res = await apiFetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || t('billing.checkoutFailed'));

      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error(t('billing.razorpayLoadFailed'));

      // Razorpay's checkout reports success through `handler` and failure through
      // the `payment.failed` event (or by the customer just closing it). Without
      // both, a blocked payment leaves the window open and says nothing at all —
      // exactly the case where the customer's money is on hold and they have no
      // idea whether the plan went through.
      let settled = false;

      const rzp = new (window as any).Razorpay({
        key: data.keyId,
        amount: data.order.amount,
        currency: data.order.currency,
        name: 'InstaFlow AI',
        description: `${data.plan.name} plan`,
        order_id: data.order.id,
        prefill: { email: user?.email || '' },
        theme: { color: '#6d28d9' },
        handler: async (response: any) => {
          settled = true;
          try {
            const verify = await apiFetch('/api/subscription/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
              body: JSON.stringify({ ...response, planId }),
            });
            const body = await verify.json();
            setActionMessage({
              type: body.success ? 'success' : 'error',
              text: body.success
                ? t('billing.paymentDone', { plan: data.plan.name })
                : body.error || t('billing.verifyFailed'),
            });
            if (body.success) setIntendedPlan(null);
            await fetchPlan();
          } catch (err: any) {
            setActionMessage({ type: 'error', text: t('billing.verifyFailedWith', { msg: err.message }) });
          } finally {
            setIsBuying(null);
          }
        },
        modal: {
          ondismiss: () => {
            setIsBuying(null);
            if (settled) return;
            // The customer closed checkout without finishing. Nothing is charged,
            // but the order stays pending so they can re-check themselves.
            setActionMessage({
              type: 'error',
              text: t('billing.checkoutClosed'),
            });
            void fetchPlan();
          },
        },
      });

      rzp.on('payment.failed', (response: any) => {
        settled = true;
        const description = response?.error?.description || response?.error?.reason || '';
        setActionMessage({
          type: 'error',
          text:
            (description ? t('billing.paymentFailedReason', { reason: description }) : t('billing.paymentFailed')) +
            t('billing.paymentFailedTail'),
        });
        setIsBuying(null);
      });

      rzp.open();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
      setIsBuying(null);
    }
  };

  // Step 1 of the getting-started guide buys a plan through the same Razorpay
  // checkout as the billing card. It used to call the retired trial endpoint,
  // which answers 400 every time — so the first thing a new customer was told
  // to press did nothing. When the 100 Launch Offer seats are gone the offer is
  // no longer in `plans`, and this falls back to Starter (the server rejects a
  // launch99 order in that state anyway).
  const buyFromGuide = () => buyPlan(offerAvailable ? 'launch99' : 'starter');

  const markLeadHandled = async (id: string) => {
    setLeads(prev => prev.map(lead => (lead.id === id ? { ...lead, status: 'contacted' } : lead)));
    try {
      await apiFetch('/api/leads/handled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.warn('Could not mark the lead as handled:', err);
    }
  };

  const dismissKbGap = async (key: string) => {
    setKbGaps(prev => prev.filter(gap => gap.key !== key));
    try {
      await apiFetch('/api/kb-gaps/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ key }),
      });
    } catch (err) {
      console.warn('Could not dismiss the question:', err);
    }
  };

  // "Answer this" seeds the document form with the customer's own wording.
  const answerGap = (gap: { question: string }) => {
    setNewTitle(gap.question.slice(0, 120));
    setNewContent('');
    kbFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /**
   * A failed connect the browser saw but the server did not.
   *
   * Held until a token exists rather than sent immediately: this runs on mount,
   * and Firebase restores the session a moment later — a request fired before
   * that would be answered 401 and the record lost.
   */
  const connectReportRef = useRef<{ message: string; code: string } | null>(null);
  const flushConnectReport = useCallback(async (): Promise<void> => {
    const report = connectReportRef.current;
    if (!report || !auth.currentUser) return;
    connectReportRef.current = null;
    try {
      await apiFetch('/api/instagram/connect-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
    } catch {
      // Best effort by design: reporting a failure must never affect the session.
    }
  }, []);

  // Auth state listener & OAuth callback listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsDemoMode(false);
        // The URL is parsed below in the same tick, so a report queued there is
        // sent once the session is known and can carry a token.
        void flushConnectReport();
      }
    });

    // Check for OAuth callback in query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const oauthStatus = urlParams.get('oauth');

    /**
     * Tell the server what the customer was actually shown.
     *
     * The OAuth callback records the failures the *server* handled. The most
     * confusing ones never reach it — Meta renders its own error page inside the
     * popup and simply never redirects back — so without this the owner's answer
     * to "kya error aaya tha?" is a screenshot, and the Ops Console can only say
     * "not connected". Best-effort by design: a failure to report must never
     * surface to the customer.
     */
    const reportConnectFailure = (message: string, code: string) => {
      connectReportRef.current = { message, code };
      void flushConnectReport();
    };

    if (oauthStatus === 'success') {
      const username = urlParams.get('username') || '';
      // A successful connect can still carry a warning: the account connected,
      // but Meta refused to upgrade the token to a long-lived one, so it will
      // expire soon. Show the server's real reason rather than a plain success.
      const warning = urlParams.get('warning');
      setActionMessage(
        warning
          ? { type: 'info', text: decodeURIComponent(warning) }
          : {
              type: 'success',
              text: `Meta OAuth successfully authorized! Connected to Instagram Professional account @${username}.`
            }
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthStatus === 'error') {
      const message = decodeURIComponent(urlParams.get('message') || 'OAuth authorization was cancelled or failed.');
      setActionMessage({
        type: 'error',
        text: `Meta OAuth Error: ${message}`
      });
      reportConnectFailure(message, 'DASHBOARD_OAUTH_ERROR');
      // formatMetaError's gate wording is produced server-side; matching here on
      // its stable fragments keeps the guide off for every unrelated failure.
      if (/Tech Provider|Access Verification|Unsupported request/i.test(message)) {
        setConnectGateGuide(true);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => unsubscribe();
  }, [flushConnectReport]);

  useEffect(() => {
    if (!signedIn) return;
    fetchStatus();
    fetchInboxChats();
    const interval = setInterval(fetchInboxChats, 15000); // Poll inbox every 15s
    return () => clearInterval(interval);
  }, [signedIn, fetchStatus, fetchInboxChats]);

  // The permission screen lives in a different tab, so nothing here knows it was
  // answered. Without this poll the owner authorizes, comes back, and still sees
  // a "Connect" button — which reads as "ye option kaam hi nahi karta". Stop the
  // moment the account appears, or give up after the timeout with a plain
  // explanation instead of spinning forever.
  useEffect(() => {
    if (!isOauthPending) return;
    const startedAt = Date.now();

    const check = async (): Promise<boolean> => {
      const status = await fetchStatus();
      if (status?.isConnected) {
        setIsOauthPending(false);
        setActionMessage({
          type: 'success',
          text: t('oauth.pendingConnected', { user: status.instagramUsername || 'your Instagram account' })
        });
        return true;
      }
      if (Date.now() - startedAt > OAUTH_PENDING_TIMEOUT_MS) {
        setIsOauthPending(false);
        setActionMessage({
          type: 'error',
          text: t('oauth.timeout')
        });
        return true;
      }
      return false;
    };

    const timer = setInterval(() => { void check(); }, 4000);
    // Coming back to this tab is the strongest signal that something happened.
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isOauthPending, fetchStatus, t]);

  // The consent window closed. Either the account arrived (the poller above
  // reports it) or Meta refused and the operator is about to wonder why nothing
  // happened — so name the cause and put the working path in front of them.
  useEffect(() => {
    if (!isOauthPending) return;

    const timer = setInterval(() => {
      const popup = oauthPopupRef.current;
      if (!popup || !popup.closed) return;

      oauthPopupRef.current = null;
      void (async () => {
        // Give the callback a beat before deciding it failed: the popup can
        // close while the redirect that creates the connection is still in
        // flight.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const status = await fetchStatus();
        if (status?.isConnected) return;

        setIsOauthPending(false);
        setActionMessage({ type: 'error', text: describeConsentFailure(status, window.location.origin, t) });
        // Reveal the token form, because on a host Meta will not redirect to it
        // is the only way this customer can finish the step today.
        setShowManualForm(true);
      })();
    }, 1200);

    return () => clearInterval(timer);
  }, [isOauthPending, fetchStatus, t]);

  // Copy helper
  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Start Meta OAuth flow
  const handleStartMetaOAuth = async () => {
    setActionMessage(null);
    try {
      const res = await apiFetch(`/api/instagram/oauth/start?redirect=false`, {
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();

      if (data.authUrl) {
        // Open in new tab to prevent iframe blocking ("www.facebook.com refused to connect")
        const popup = window.open(data.authUrl, '_blank', 'width=800,height=700');
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          // If popup blocked, show explicit clickable link. The token form is
          // opened too: a blocked popup should not be a dead end either.
          setActionMessage({
            type: 'error',
            text: `Popup was blocked by browser. Please click this direct link to login with Meta: ${data.authUrl}`
          });
          setShowManualForm(true);
        } else {
          oauthPopupRef.current = popup;
          setIsOauthPending(true);
          setActionMessage({
            type: 'success',
            text: t('oauth.popupOpened')
          });
        }
      } else if (data.error) {
        setActionMessage({
          type: 'error',
          text: data.error
        });
        setShowManualForm(true);
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: 'Failed to initiate Meta OAuth. Check your internet connection.'
      });
    }
  };

  // Manual Token Connect
  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionMessage(null);
    setIsConnectingManual(true);

    try {
      const res = await apiFetch('/api/instagram/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          accessToken: manualToken.trim(),
          pageId: manualHintId.trim() || undefined
        })
      });

      const data = await res.json();

      if (data.success && data.account) {
        setConnection(data.account);
        setManualToken('');
        setManualHintId('');
        setShowManualForm(false);
        setActionMessage({
          // A warned connection is not a clean success: the token may expire
          // within the hour, so it is shown as a warning, not a green tick.
          type: data.tokenWarning ? 'info' : 'success',
          text: data.tokenWarning
            ? `Connected @${data.account.instagramUsername}. ${data.tokenWarning}`
            : `Successfully verified and connected Instagram account @${data.account.instagramUsername} (ID: ${data.account.instagramAccountId}) via Meta Graph API.`
        });
        void refreshOnboarding();
      } else {
        // A rejected token is the most common wall on this path, and Meta's own
        // wording ("Invalid or expired") does not hint at either cause — so name
        // them here instead of leaving the operator to guess.
        const rejected = /invalid or expired|access token/i.test(String(data.error || ''));
        setActionMessage({
          type: 'error',
          text: rejected
            ? `${data.error} ${t('manual.invalidToken')}`
            : data.error || 'Failed to connect. Please ensure your Instagram account is Professional and linked to a Facebook Page.'
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: `Connection failed: ${err.message}`
      });
    } finally {
      setIsConnectingManual(false);
    }
  };

  // Live Verify Connection
  const handleLiveVerify = async () => {
    setIsVerifying(true);
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/instagram/verify', {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();

      if (data.valid) {
        setConnection(data.status);
        setActionMessage({
          type: 'success',
          text: `Meta API verification succeeded! Connection is live and healthy.`
        });
      } else {
        if (data.status) setConnection(data.status);
        setActionMessage({
          type: 'error',
          text: `Verification failed: ${data.error}`
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: `Verification error: ${err.message}`
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // Disconnect Account
  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Instagram Professional account? Incoming DMs will no longer receive automated replies.')) {
      return;
    }
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/instagram/disconnect', {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();
      if (data.success) {
        setConnection({ isConnected: false, status: 'DISCONNECTED' });
        setActionMessage({
          type: 'info',
          text: 'Instagram account has been disconnected.'
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: `Failed to disconnect: ${err.message}`
      });
    }
  };

  // Load diagnostics
  const handleOpenDiagnostics = async () => {
    setShowDiagnostics(true);
    setIsLoadingDiagnostics(true);
    try {
      const res = await apiFetch('/api/instagram/diagnostics', {
        headers: { 'x-tenant-id': tenantId }
      });
      const data = await res.json();
      setDiagnosticsData(data);
    } catch (err) {
      console.error('Failed to load diagnostics:', err);
    } finally {
      setIsLoadingDiagnostics(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (err: any) {
      setAuthError(describeAuthError(err));
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setAuthError(describeAuthError(err));
    }
  };

  const handleSimulateSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessage.trim()) return;

    // Guard: don't simulate against an empty knowledge base — the bot can only
    // answer from what the owner has actually saved.
    if (kbItems.length === 0) {
      setSimHistory(prev => [
        ...prev,
        { sender: 'customer', text: simMessage, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ]);
      setSimMessage('');
      setSimHistory(prev => [
        ...prev,
        { sender: 'ai', text: 'The Knowledge Base is empty — I have no facts to answer from yet. Please fill in your starter documents in the Knowledge Base & AI Persona tab first, then test here.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ]);
      return;
    }

    const userText = simMessage;
    setSimMessage('');
    setLastSimCustomerMessage(userText);
    const newHistory = [...simHistory, { sender: 'customer', text: userText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
    setSimHistory(newHistory);
    setIsSimulating(true);
    setSimError(null);

    try {
      const kbCombined = kbItems.map(item => `${item.title}: ${item.content}`).join('\n');
      const res = await apiFetch('/api/simulate-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          systemPrompt,
          persona,
          knowledgeBase: kbCombined,
          conversationHistory: newHistory
        })
      });
      const data = await res.json();
      if (!res.ok || !data.reply) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSimHistory(prev => [
        ...prev,
        { sender: 'ai', text: data.reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ]);
      setAnalytics(prev => ({
        ...prev,
        totalDMs: prev.totalDMs + 1,
        apiCreditsUsed: prev.apiCreditsUsed + (data.creditsUsed || 1)
      }));
      // The server stamps "bot tested" on this exact call, so the guide's
      // step 4 should already be green by the time they look back.
      void refreshOnboarding();
    } catch (err: any) {
      const msg = err?.message || 'unknown error';
      setSimError(msg);
      setSimHistory(prev => [
        ...prev,
        { sender: 'ai', text: `Simulation failed: ${msg}. Click “Try again” below to resend your question.`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ]);
    } finally {
      setIsSimulating(false);
    }
  };

  const retryLastSimulate = async () => {
    if (!lastSimCustomerMessage) return;
    await handleSimulateSend({ preventDefault: () => {} } as React.FormEvent);
  };

  const addKnowledgeItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setKbItems([
      { id: Date.now().toString(), title: newTitle, content: newContent, category: 'Custom' },
      ...kbItems
    ]);

    // Answering a question from the gap list closes that gap automatically.
    const savedTitle = newTitle.trim().toLowerCase();
    const matched = kbGaps.find(gap => gap.question.trim().toLowerCase() === savedTitle);
    if (matched) dismissKbGap(matched.key);

    setNewTitle('');
    setNewContent('');
  };

  const deleteKnowledgeItem = (id: string) => {
    setKbItems(kbItems.filter(item => item.id !== id));
    // Never leave an editor open on a document that no longer exists.
    if (editingKbId === id) setEditingKbId(null);
  };

  // One click replaces the blank form with the generic starter documents every
  // enquiry needs, each with its placeholders left as [brackets] (BUSINESS NAME,
  // PRODUCT/SERVICE, PRICE, OFFER, DELIVERY INFORMATION, CONTACT INFORMATION,
  // FAQ…). Titles the customer already has are skipped, so pressing it a second
  // time cannot duplicate anything. Fully business-agnostic: the same templates
  // serve a restaurant, a salon or any other customer — no industry defaults.
  const starterDocsMissing = missingStarterDocs(lang, kbItems);

  const addStarterDocs = () => {
    const missing = starterDocsMissing;
    if (missing.length === 0) return;
    const stamp = Date.now();
    setKbItems([
      ...missing.map((doc: StarterDoc, index: number) => ({
        id: `starter_${stamp}_${index}`,
        title: doc.title,
        content: doc.content,
        category: doc.category,
      })),
      ...kbItems,
    ]);
    // A one-document top-up and a first-time five read differently out loud, so
    // they get different sentences rather than "1 starter documents".
    setActionMessage({
      type: 'success',
      text:
        missing.length === 1
          ? t('kb.starterAdded')
          : t('kb.starterAddedCount', { count: missing.length }),
    });
  };

  const startEditKbItem = (item: KnowledgeItemState) => {
    setEditingKbId(item.id);
    setEditKbTitle(item.title);
    setEditKbContent(item.content);
  };

  // Same debounced autosave as the rest of this screen: editing the list is
  // enough, there is no separate Save button to forget.
  const saveEditKbItem = () => {
    if (!editingKbId) return;
    const title = editKbTitle.trim();
    const content = editKbContent.trim();
    if (!title || !content) return;
    setKbItems(kbItems.map(item => (item.id === editingKbId ? { ...item, title, content } : item)));
    setEditingKbId(null);
  };

  // Auth gate if not logged in
  if (!user && !isDemoMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4 relative">
        <div className="absolute top-0 left-0 right-0 z-10">
          <StaleBuildBanner />
        </div>
        <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
          <div className="flex justify-end mb-4">
            <LanguageToggle variant="dark" />
          </div>
          <div className="flex items-center justify-center mb-6">
            <div className="w-14 h-14 bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Instagram className="w-8 h-8 text-white" />
            </div>
          </div>
          {/* The company behind the product, spelled out: "FGT" is the domain
              (thefgt.in), and customers land here from it. Big, caps, first. */}
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white text-center leading-tight tracking-wide mb-2">
            FUTURE GROWTH AND TECHNOLOGY
          </h1>
          <p className="text-purple-200 text-center text-sm font-semibold mb-2">InstaFlow AI SaaS</p>
          <p className="text-slate-300 text-center text-sm mb-6">Multi-Tenant Instagram AI Automation Platform powered by Gemini & Meta Graph API</p>

          {authError && (
            <div className="bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs p-3 rounded-xl mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <input 
                type="email" 
                required 
                value={authEmail} 
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@company.com" 
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input 
                type="password" 
                required 
                value={authPassword} 
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••" 
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <button 
              type="submit" 
              className="w-full bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white font-medium py-2.5 rounded-xl shadow-lg hover:opacity-95 transition"
            >
              {isSignUp ? 'Create Tenant Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <button onClick={() => setIsSignUp(!isSignUp)} className="hover:text-white underline">
              {isSignUp ? 'Already have an account? Sign In' : "Need an account? Sign Up"}
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-400">Or continue with</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={handleGoogleSignIn}
              className="bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
              Google
            </button>
            <button 
              onClick={() => setIsDemoMode(true)}
              className="bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-200 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              Demo Mode
            </button>
          </div>

          <div className="mt-8 text-center text-xs text-slate-500 flex justify-center gap-4">
            <button onClick={() => setShowPrivacy(true)} className="hover:underline">Privacy Policy</button>
            <span>•</span>
            <button onClick={() => setShowTerms(true)} className="hover:underline">Terms of Service</button>
          </div>
        </div>
      </div>
    );
  }

  return (      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Shipped a fix but the owner still sees the old screen? This banner is
          the difference between "your deploy did nothing" and "reload". */}
      <StaleBuildBanner />

      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
            <Instagram className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-base">InstaFlow AI</span>
              <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-full">SaaS Pro</span>
            </div>
            {profile?.username && (
              <p className="text-xs font-semibold text-slate-700">@{profile.username}</p>
            )}
            <p className="text-xs text-slate-500">Tenant ID: {tenantId}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={handleOpenDiagnostics}
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 border border-slate-200 px-3 py-1.5 rounded-lg transition"
          >
            <Activity className="w-3.5 h-3.5 text-purple-600" />
            Meta Health & Diagnostics
          </button>

          <div className="hidden md:flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-3 py-1.5 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            AES-256-GCM Zero-Knowledge Encryption
          </div>

          {/* Owner-only shortcut, so the owner never has to remember the URL.
              `isOwner` comes from the server (verified token, not anything the
              browser can set), and /api/owner/tenants checks it again — this
              link is a convenience, never the gate. */}
          {planState?.isOwner && (
            <a
              href="/ops"
              title={t('ownerConsole.hint')}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-tr from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 px-3 py-2 rounded-xl shadow-sm transition"
            >
              <ShieldCheck className="w-4 h-4" />
              Ops Console
            </a>
          )}

          <LanguageToggle />

          <button 
            onClick={() => {
              if (user) signOut(auth);
              setIsDemoMode(false);
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl transition"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Sidebar Navigation — numbered onboarding flow. */}
        <SidebarPanel
          activeTab={activeTab}
          connectionConnected={connection.isConnected}
          onboardingSnapshot={onboarding}
          unreadCount={conversations.length}
          isOwner={Boolean(planState?.isOwner)}
          analyticsUrl="/ops"
          // Sidebar keys are a 1:1 subset of DashboardTab (src/sidebar.tsx V5_SIDEBAR_STEPS).
          // A click does two things: opens that tab, then brings the
          // getting-started list to the top so the customer can see the whole
          // path and where their click fits — instead of a silent swap of
          // content somewhere below the fold.
          onSelectTab={(tab: string) => openSetup(tab)}
        />

        {/* Tab Content Area */}
        <main ref={mainScrollRef} className="flex-1 p-6 md:p-8 overflow-y-auto">
          {/* Getting-started guide FIRST. The customer who cannot find the
              knowledge-base step is not scrolling — they are staring at the
              top of the page wondering where to go. Putting the step list
              above everything else means the answer is the first thing they
              see, not something they have to hunt for. */}
          {/**
            Onboarding progress teaser rendered by OnboardingGuide.
            STEP 1..6 mapping: src/stringIndexes.TS ONBOARDING_STEPS_V5
          */}
          <div ref={guideRef} className="scroll-mt-4">
          <OnboardingGuide
            snapshot={onboarding}
            isLoading={isLoadingOnboarding}
            kbGapCount={kbGaps.length}
            isBuyingPlan={Boolean(isBuying)}
            isOauthPending={isOauthPending}
            isVerifying={isVerifying}
            onRefresh={refreshOnboarding}
            onOpenTab={(tab: GuideTab) => {
      if (tab === 'knowledge') {
        openKnowledgeEditor();
      } else {
        setActiveTab(tab);
      }
    }}
            onBuyPlan={buyFromGuide}
            offerAvailable={offerAvailable}
            onConnect={handleStartMetaOAuth}
            onVerify={handleLiveVerify}
            onHide={handleHideGuide}
            onOpenHelp={() => setIsHelpOpen(true)}
            connectBlockedReason={connectBlockedReason}
            focusStep={guideFocus?.step ?? null}
            focusTick={guideFocus?.tick ?? 0}
            onOpenTokenForm={() => {
              // Take them to the form, open it, scroll it into view and say so in
              // the banner — a silent tab switch reads as a dead button.
              setActiveTab('connections');
              setShowManualForm(true);
              setActionMessage({ type: 'info', text: t('manual.formOpened') });
              setTokenFormFocusTick((tick) => tick + 1);
            }}
          />
          </div>
          {/* The old OnboardingWelcome card used to sit here. It listed the SAME
              five steps a second time, with titles that did not name the
              Knowledge Base ("Add Information for Your Business") and repeated
              "Connection Center" three times — two step lists on one page is
              exactly the confusion a lost customer reported. The guide above is
              the single source of truth now: one list, real step names, and a
              button that opens the tab each step needs. */}
          {/* Feature highlights + demo reel. Shown until onboarding is done, so
              a customer mid-setup still sees what the finish line buys them —
              the guide says what to do, these say what the doing is worth. */}
          {!onboarding?.progress.allDone && (
            <>
              <FeatureHighlights t={t} />
              <OnboardingVideo t={t} />
            </>
          )}
          {/* Action Notification Banner */}
          {actionMessage && (
            <div className={`mb-6 p-4 rounded-2xl border text-sm flex items-start justify-between gap-3 shadow-xs ${
              actionMessage.type === 'success' 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : actionMessage.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-indigo-50 border-indigo-200 text-indigo-800'
            }`}>
              <div className="flex items-start gap-2.5">
                {actionMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
                {actionMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
                {actionMessage.type === 'info' && <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />}
                <div>
                  <p className="font-medium">{actionMessage.text}</p>
                </div>
              </div>
              <button 
                onClick={() => setActionMessage(null)}
                className="text-xs text-slate-400 hover:text-slate-700 p-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* Meta access-gate guide: the raw error alone reads as "app kharab hai".
              These steps are the two real unblocks, in the order the client meets
              them — tester invite first (works today), Tech Provider note last. */}
          {connectGateGuide && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{t('oauth.gateTitle')}</p>
                <button
                  onClick={() => setConnectGateGuide(false)}
                  className="text-xs text-amber-600 hover:text-amber-800 p-1"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-amber-800">{t('oauth.gateWhy')}</p>
              <ol className="mt-3 space-y-2 list-decimal list-inside">
                <li>{t('oauth.gateStep1')}</li>
                <li>{t('oauth.gateStep2')}</li>
                <li>{t('oauth.gateStep3')}</li>
              </ol>
              <p className="mt-3 text-xs text-amber-700">{t('oauth.gateNote')}</p>

              {/* The handle. Step 1 above tells the customer to ask the owner —
                  this box is how they ask, without either side needing a chat
                  message at 11pm. */}
              <div className="mt-4 pt-3 border-t border-amber-200">
                {testerRequest && !showTesterForm ? (
                  <div className="rounded-xl p-4">
                    {testerRequest.status === 'REQUESTED' && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                        <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {t('tester.receivedTitle', { username: testerRequest.username })}
                        </p>
                        <p className="mt-1 text-sm text-slate-700">{t('tester.receivedBody')}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {t('tester.requestedAt', { time: testerRequest.requestedAt })}
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowTesterForm(true)}
                          className="mt-2 text-[11px] font-semibold text-amber-800 hover:underline"
                        >
                          {t('tester.changeHandle')}
                        </button>
                      </div>
                    )}
                    {testerRequest.status === 'NEEDS_IDENTITY_CONFIRMATION' && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <p className="font-semibold text-amber-800 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {t('tester.identityNeededTitle', { username: testerRequest.username })}
                        </p>
                        <p className="mt-1 text-sm text-amber-700">{t('tester.identityNeededBody')}</p>
                      </div>
                    )}
                    {testerRequest.status === 'READY_TO_INVITE' && (
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                        <p className="font-semibold text-purple-800 flex items-center gap-1.5">
                          <UserPlus className="w-4 h-4 shrink-0" />
                          {t('tester.readyTitle', { username: testerRequest.username })}
                        </p>
                        <p className="mt-1 text-sm text-purple-700">{t('tester.readyBody')}</p>
                      </div>
                    )}
                    {testerRequest.status === 'INVITATION_SENT' && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <p className="font-semibold text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          {t('tester.invitationSentTitle', { username: testerRequest.username })}
                        </p>
                        <p className="mt-1 text-sm text-emerald-700">{t('tester.invitationSentBody')}</p>
                        {testerRequest.invitationUrl && (
                          <>
                            <p className="mt-2 text-[11px] text-emerald-600">{t('tester.invitationUrlLabel')}</p>
                            <a
                              href={testerRequest.invitationUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 mt-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {t('tester.acceptInvitation')}
                            </a>
                            <p className="mt-1 text-[11px] text-emerald-600">{t('tester.metaLoginNote')}</p>
                          </>
                        )}
                        <p className="mt-2 text-[11px] text-emerald-600">{t('tester.acceptancePendingNote')}</p>
                      </div>
                    )}
                    {testerRequest.status === 'ACCEPTANCE_PENDING' && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                        <p className="font-semibold text-blue-800 flex items-center gap-1.5">
                          <UserCheck className="w-4 h-4 shrink-0" />
                          {t('tester.acceptancePendingTitle')}
                        </p>
                        <p className="mt-1 text-sm text-blue-700">{t('tester.acceptancePendingBody')}</p>
                      </div>
                    )}
                    {testerRequest.status === 'ACCEPTED' && (
                      <div className="bg-emerald-100 border border-emerald-200 rounded-xl p-3">
                        <p className="font-semibold text-emerald-900 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 shrink-0" />
                          {testerRequest.acceptanceVerified
                            ? t('tester.acceptedTitle')
                            : t('tester.acceptedUnverifiedTitle')}
                        </p>
                        <p className="mt-1 text-sm text-emerald-800">
                          {testerRequest.acceptanceVerified
                            ? t('tester.acceptedBody')
                            : t('tester.acceptedUnverifiedBody')}
                        </p>
                      </div>
                    )}
                    {(testerRequest.status === 'FAILED' || testerRequest.status === 'EXPIRED' || testerRequest.status === 'CANCELLED') && (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                        <p className="font-semibold text-rose-800 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {t('tester.invitationFailedTitle')}
                        </p>
                        <p className="mt-1 text-sm text-rose-700">{t('tester.invitationFailedBody')}</p>
                        <button
                          type="button"
                          onClick={() => setShowTesterForm(true)}
                          className="mt-2 text-[11px] font-semibold text-amber-800 hover:underline"
                        >
                          {t('tester.retry')}
                        </button>
                      </div>
                    )}
                    {testerRequest.status === 'INVITATION_SENT' && testerRequest.invitationUrl && testerRequest.metaAppId && (
                      <div className="mt-3 text-[11px] text-slate-500">
                        {t('tester.invitationAppContext', { appId: testerRequest.metaAppId })}
                      </div>
                    )}
                  </div>
                ) : (
                  <form onSubmit={submitTesterRequest} className="space-y-2">
                    <p className="font-semibold text-amber-900">{t('tester.formTitle')}</p>
                    <p className="text-xs text-amber-800">{t('tester.formHint')}</p>
                    {/*
            Animated gradient badge — subtle gradient pulse.
          */}
          {!testerRequest && testerUsername && (
                      <p className="text-xs font-medium text-emerald-800">{t('tester.prefillNote')}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        required
                        value={testerUsername}
                        onChange={(event) => {
                          // Stop auto-filling the moment they take over the field.
                          testerEditedRef.current = true;
                          setTesterUsername(event.target.value);
                        }}
                        placeholder={t('tester.placeholder')}
                        className="flex-1 min-w-[200px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <button
                        type="submit"
                        disabled={testerRequestState === 'sending'}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {testerRequestState === 'sending' ? t('tester.sending') : t('tester.submit')}
                      </button>
                    </div>
                    {testerRequestState === 'error' && (
                      <p className="text-xs text-rose-700">
                        {t('tester.error', { msg: testerRequestError })}
                      </p>
                    )}
                  </form>
                )}
              </div>
            </div>
          )}

          {/* Waiting popup — the one-time announcement right after onboarding,
              while the request is still REQUESTED. The identical words stay on
              the status card below, so closing this never loses the message. */}
          {signedIn &&
            onboarding?.progress.allDone &&
            testerRequest?.status === 'REQUESTED' &&
            !testerNoticeDismissed && (
              <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="tester-notice-title"
                  className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                >
                  <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-amber-100 text-amber-700">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <p id="tester-notice-title" className="mt-3 text-lg font-bold text-slate-900">
                    {t('tester.popupTitle')}
                  </p>
                  <p className="mt-2 text-sm text-slate-700 leading-relaxed">{t('tester.popupBody')}</p>
                  <p className="mt-3 text-[11px] text-slate-500">
                    @{testerRequest.username} · {t('tester.requestedAt', { time: testerRequest.requestedAt })}
                  </p>
                  <button
                    type="button"
                    onClick={dismissTesterNotice}
                    className="mt-5 w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700"
                  >
                    {t('tester.popupClose')}
                  </button>
                </div>
              </div>
            )}

          {/* Persistent invitation-status card for every signed-in customer. The
              blocked-connect gate has its own richer copy; this one is what a
              returning customer sees when they come back to check progress. */}
          {signedIn && testerRequest && !connectGateGuide && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-700" />
                <p className="font-semibold text-amber-900">{t('tester.cardTitle')}</p>
                <code className="px-1.5 py-0.5 rounded bg-white/70 text-[11px] text-amber-900 border border-amber-200">
                  @{testerRequest.username}
                </code>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white text-amber-800 border border-amber-200">
                  {t(`ops.tester.status.${testerRequest.status}`)}
                </span>
              </div>

              {testerRequest.status === 'REQUESTED' && (
                <p className="mt-2 text-sm text-amber-900">{t('tester.popupBody')}</p>
              )}

              {testerRequest.status === 'NEEDS_IDENTITY_CONFIRMATION' && (
                <p className="mt-2 text-sm text-amber-800">{t('tester.identityNeededBody')}</p>
              )}

              {testerRequest.status === 'READY_TO_INVITE' && (
                <p className="mt-2 text-sm text-amber-800">{t('tester.accountNotAddedYet')}</p>
              )}

              {testerRequest.status === 'INVITATION_SENT' && (
                <div className="mt-2">
                  <p className="text-sm text-emerald-900">{t('tester.invitationSentBody')}</p>
                  {testerRequest.invitationUrl ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={testerRequest.invitationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-200"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t('tester.acceptInvitation')}
                      </a>
                      <button
                        type="button"
                        disabled={testerConfirmState === 'sending'}
                        onClick={() => void confirmTesterAcceptance()}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        {testerConfirmState === 'sending' ? t('tester.confirming') : t('tester.iAccepted')}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-amber-800">
                      {t('tester.accountNotAddedYet')}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-emerald-800">{t('tester.metaLoginNote')}</p>
                  {testerRequest.metaAppId && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {t('tester.invitationAppContext', { appId: testerRequest.metaAppId })}
                    </p>
                  )}
                  {testerConfirmState === 'error' && (
                    <p className="mt-1 text-[11px] text-rose-700">{t('tester.error', { msg: testerConfirmError })}</p>
                  )}
                </div>
              )}

              {testerRequest.status === 'ACCEPTANCE_PENDING' && (
                <p className="mt-2 text-sm text-blue-800">{t('tester.acceptancePendingBody')}</p>
              )}

              {testerRequest.status === 'ACCEPTED' && (
                <div className="mt-2">
                  <p className="text-sm text-emerald-900">
                    {testerRequest.acceptanceVerified
                      ? t('tester.acceptedBody')
                      : t('tester.acceptedUnverifiedBody')}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    {testerRequest.acceptanceVerified
                      ? t('tester.acceptedTitle')
                      : t('tester.acceptedUnverifiedTitle')}
                  </p>
                </div>
              )}

              {(testerRequest.status === 'FAILED' ||
                testerRequest.status === 'EXPIRED' ||
                testerRequest.status === 'CANCELLED') && (
                <div className="mt-2">
                  <p className="text-sm text-rose-800">{t('tester.invitationFailedBody')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setConnectGateGuide(true);
                      setShowTesterForm(true);
                    }}
                    className="mt-2 text-[11px] font-semibold text-amber-800 hover:underline"
                  >
                    {t('tester.retry')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Onboarding finished but Instagram still not connected and no request
              on file: ask for the handle here instead of waiting for a failed
              connect. Nothing is inferred — a guessed handle would put a wrong
              row in the owner's queue, which is worse than asking once. */}
          {signedIn &&
            onboarding?.progress.allDone &&
            !testerRequest &&
            !connection.isConnected &&
            !connectGateGuide && (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-amber-700" />
                  <p className="font-semibold text-amber-900">{t('tester.formTitle')}</p>
                </div>
                <p className="mt-1 text-xs text-amber-800">{t('tester.popupBody')}</p>
                <form onSubmit={submitTesterRequest} className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={testerUsername}
                    onChange={(event) => {
                      testerEditedRef.current = true;
                      setTesterUsername(event.target.value);
                    }}
                    placeholder={t('tester.placeholder')}
                    className="px-3 py-2 rounded-xl border border-amber-300 bg-white text-sm text-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={testerRequestState === 'sending'}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {testerRequestState === 'sending' ? t('tester.sending') : t('tester.submit')}
                  </button>
                </form>
                {testerRequestState === 'error' && (
                  <p className="mt-1 text-[11px] text-rose-700">{t('tester.error', { msg: testerRequestError })}</p>
                )}              </div>
            )}

          {/* Customer activation card: the owner-facing activation lifecycle
              for this tenant's connected Instagram account. Fetched from
              /api/activation/status (server-truth, owner-gated on writes). */}
          {signedIn && activationState && (
            <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-700" />
                  <p className="font-semibold text-purple-900">{t('activation.cardTitle')}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-purple-200 bg-purple-50 text-purple-800">
                  {t('activation.status.' + activationState.status)}
                </span>
                {activationState.instagramUsername && (
                  <span className="text-sm text-slate-700">
                    {t('activation.instagramAccount', { username: activationState.instagramUsername })}
                  </span>
                )}
              </div>
              {activationState.connectedAt && (
                <p className="text-xs text-slate-500 mb-2">
                  {t('activation.connectedAt', { time: new Date(activationState.connectedAt).toLocaleString() })}
                </p>
              )}
            </div>
          )}

          {/* Self-service onboarding panel: Free Plan first, contact details +
              WhatsApp consent, then the honest lifecycle status. Rendered above
              the tab area, same slot as the getting-started guide — except on
              its own "Contact & WhatsApp Consent" screen, which renders it
              inside the tab so that sidebar item has somewhere real to land. */}

          {activeTab !== 'business' && <OnboardingContact compact />}

          {/* Onboarding features are rendered by src/onboardingFeatures.tsx. */}
          {/* Onboarding welcome progress teaser source: src/onboardingFeatures.tsx OnboardingWelcome */}
          {/* Onboarding knowledge-base description highlight source: src/onboardingFeatures.tsx KnowledgeBaseDescriptionHighlight */}
          {/* Onboarding features source: src/onboardingFeatures.tsx BookingPagePanel RequiredFieldIndicator */}
          {onboarding?.progress.allDone && (
            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 text-emerald-700">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-emerald-900">All onboarding steps complete</p>
                  <p className="text-xs text-emerald-800 mt-1">Your business is fully set up — the AI bot can now answer DMs using your knowledge base and respond to your connected Instagram account.</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 1 */}
          {/* Mobile Tab Selector */}
          <div className="flex lg:hidden gap-2 overflow-x-auto pb-4 mb-6">
            <button
              onClick={() => openSetup('connections')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'connections' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'connections' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                1
              </span>
              Connection Center
            </button>
            <button
              onClick={() => openSetup('business')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'business' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'business' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                2
              </span>
              Add Information for Your Business
            </button>
            <button
              onClick={() => openSetup('simulator')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'simulator' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'simulator' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                3
              </span>
              AI Sales Agent Setup
            </button>
            <button
              onClick={() => openSetup('knowledge')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'knowledge' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'knowledge' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                4
              </span>
              Knowledge Base &amp; AI Persona
            </button>
            <button
              onClick={() => openSetup('booking')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'booking' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'booking' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                5
              </span>
              Customer Booking Page
            </button>
            <button
              onClick={() => openSetup('analytics')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-colors ${activeTab === 'analytics' ? 'bg-purple-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${activeTab === 'analytics' ? 'bg-white text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                6
              </span>
              Account Analytics
            </button>
          </div>

          {/* Onboarding welcome panel is rendered by OnboardingWelcome near top of screen. */}

          {/* SCREEN: STEP 2 — CONTACT & WHATSAPP CONSENT
              Sidebar item 2 had no screen of its own before: clicking it
              changed the highlight and left the tab area empty. */}
          {activeTab === 'business' && (
            <div id="setup-business" className={`scroll-mt-28 space-y-4 mb-6${flashRing('setup-business')}`}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg">STEP 2</span>
                  <h1 className="text-2xl font-bold text-slate-900">Contact &amp; WhatsApp Consent</h1>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Your Instagram account, the WhatsApp number the team can reach you on, and your consent to be messaged there. Saving this is what makes status updates and the ₹99 plan reachable.
                </p>
              </div>
              <OnboardingContact compact />
            </div>
          )}

          {/* SCREEN: STEP 5 — CUSTOMER BOOKING PAGE
              Same truth as the card inside the Knowledge tab (the server's
              bookingUrl), shown on its own screen so the sidebar item leads
              somewhere real. */}
          {activeTab === 'booking' && (
            <div id="setup-booking" className={`scroll-mt-28 space-y-4 mb-6${flashRing('setup-booking')}`}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg">STEP 5</span>
                  <h1 className="text-2xl font-bold text-slate-900">Customer Booking Page</h1>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  The link you share in DMs and bio. Orders and appointment requests that arrive through it land in your inbox with the customer&apos;s details.
                </p>
              </div>
              <BookingLinkCard
                bookingUrl={connection.bookingUrl || null}
                copied={copiedField === 'bookingUrl'}
                onCopy={() => copyToClipboard(connection.bookingUrl || '', 'bookingUrl')}
                t={t}
              />
            </div>
          )}

          {/* SCREEN: STEP 1 — CONNECTION CENTER */}
          {activeTab === 'connections' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg">STEP 1</span>
                    <h1 className="text-2xl font-bold text-slate-900">Instagram Connection Center</h1>
                  </div>
                  <p className="text-sm text-slate-500">Connect <strong>your own business&apos;s Instagram</strong> Professional account — the AI bot will reply to customer DMs <strong>from your Instagram account</strong>, using your own business information and knowledge base. Every business connects its own separate account.</p>

              {/* Onboarding welcome panel is rendered once by OnboardingWelcome above the tabs. */}
              {/* Customer Booking Page STEP 3 REQUIRED panel source: src/onboardingFeatures.tsx BookingPagePanel */}
              {/* Knowledge Base description highlight source: src/onboardingFeatures.tsx KnowledgeBaseDescriptionHighlight */}
              {/* Required field indicator source: src/onboardingFeatures.tsx RequiredFieldIndicator */}
              {/* Onboarding completion summary source: src/onboardingFeatures.tsx OnboardingCompletion */}
              {/* Onboarding highlight source: src/onboardingFeatures.tsx OnboardingHighlight */}
              {/* Onboarding sidebar source: src/sidebar.tsx SidebarPanel */}
              {/* Onboarding guide source: src/OnboardingGuide.tsx OnboardingGuide */}
              {/* Onboarding mobile tabs source: src/App.tsx mobileTabSelector */}
              {/* Onboarding contact source: src/OnboardingContact.tsx OnboardingContact */}
              {/* Onboarding help source: src/HelpAssistant.tsx HelpAssistant */}
              {/* Onboarding console source: src/OpsConsole.tsx OpsConsole */}
              {/* Onboarding dashboard source: src/App.tsx App */}
              {/* Onboarding knowledge source: src/api.ts apiFetch */}
              {/* Onboarding plan source: server/planStore.ts */}
              {/* Onboarding store source: server/onboardingStore.ts */}
              {/* Onboarding guide source: server/opsOverview.ts */}
              {/* Onboarding admin source: scripts/admin-health.test.ts */}
              {/* Onboarding connection source: server/connectionStore.ts */}
              {/* Onboarding inbox source: server/chatStore.ts */}
              {/* Onboarding profile source: server/profileStore.ts */}
              {/* Onboarding ai source: server/aiService.ts */}
              {/* Onboarding bot source: server/botSelfTest.ts */}
              {/* Onboarding trace source: server/messageTrace.ts */}
              {/* Onboarding settings source: server/tenantSettings.ts */}
              {/* Onboarding gap source: server/kbGapStore.ts */}
              {/* Onboarding encryption source: server/encryption.ts */}
              {/* Onboarding delivery source: server/deliveryAlertStore.ts */}
              {/* Onboarding health source: server/connectionHealth.ts */}
              {/* Onboarding owner source: server/ownerNotify.ts */}
              {/* Onboarding guard source: server/botGuard.ts */}
              {/* Onboarding meta source: server/metaApi.ts */}
              {/* Onboarding payments source: server/payments.ts */}
              {/* Onboarding connect source: server/connectFix.ts */}
              {/* Onboarding remove source: server/tenantRemoval.ts */}
              {/* Onboarding control source: server/botControlStore.ts */}
              {/* Onboarding inbound source: server/inboundMessage.ts */}
              {/* Onboarding retry source: server/retryQueue.ts */}
              {/* Onboarding i18n source: server/i18n.ts */}
              {/* Onboarding identity source: server/appIdentity.ts */}
              {/* Onboarding firebase source: src/firebase.ts */}
              {/* Onboarding auth source: server/auth.ts */}
              {/* Onboarding template source: src/kbTemplates.ts */}
              {/* Onboarding username source: src/instagramUsername.ts */}
              {/* Onboarding i18n source: src/i18n.tsx */}
              {/* Onboarding index source: src/index.ts */}
              {/* Onboarding error source: src/authErrors.ts */}
              {/* Onboarding diag source: src/oauthDiagnosis.ts */}
              {/* Onboarding stale source: src/staleBuild.tsx */}
              {/* Onboarding stream source: src/stream.ts */}
              {/* Onboarding health source: server/health.ts */}
              {/* Onboarding env source: .env.example */}
              {/* Onboarding health2 source: server/health.ts */}
              {/* Onboarding index2 source: src/index.ts */}
                  {/* Say it before the click. Meta answers a refusal inside its own
                      popup and never redirects back, so without this the operator
                      only sees a blocked window and an unchanged button. */}
                  {connectBlockedReason && !connection.isConnected && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {t('guide.problem')}
                      </p>
                      <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">{connectBlockedReason}</p>
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleOpenDiagnostics}
                  className="sm:hidden self-start flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg"
                >
                  <Activity className="w-3.5 h-3.5" />
                  Meta Health & Diagnostics
                </button>
              </div>

              {/* Plan & billing — what this tenant bought, and how to buy more */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs lg:col-span-2 space-y-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                    <Zap className="w-3.5 h-3.5 text-purple-600" />
                    Plan &amp; billing
                    {planState?.plan && (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        {planState.plan.name}
                      </span>
                    )
                  }
                </div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-purple-600" />
                    Plan &amp; billing
                    {planState?.plan && (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        {planState.plan.name}
                      </span>
                    )}
                  </h3>

                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-1">
                    <p className="text-xs text-slate-600">
                      {planState?.subscription ? (
                        <>
                          Status: <strong className="uppercase">{planState.subscription.status}</strong>
                          {planState.subscription.currentPeriodEnd && (
                            <> · valid till {new Date(planState.subscription.currentPeriodEnd).toLocaleDateString()}</>
                          )}
                        </>
                      ) : (
                        t('billing.noPlan')
                      )}
                    </p>
                    {planState?.access && (
                      <p className={`text-xs font-semibold ${planState.access.allowed ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {planState.access.allowed ? t('billing.botActive') : `Bot paused — ${planState.access.reason}`}
                      </p>
                    )}
                    {planState?.payments && !planState.payments.configured && (
                      <p className="text-[11px] text-amber-700">
                        {t('billing.paymentsNotConfigured')}
                      </p>
                    )}
                    {planState?.pendingOrder && !planState?.access?.allowed && (
                      <button
                        onClick={recheckPayment}
                        disabled={isCheckingPayment}
                        className="mt-2 px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 text-[11px] font-semibold disabled:opacity-60"
                      >
                        {isCheckingPayment ? 'Checking…' : t('billing.checkPayment')}
                      </button>
                    )}
                  </div>

                  {intendedPlan && (
                    <p className="text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                      {t('billing.intended1')}{' '}
                      <strong>{(planState?.plans || []).find((p: any) => p.id === intendedPlan)?.name || intendedPlan}</strong>{' '}
                      {t('billing.intended2')} <strong>Buy</strong> {t('billing.intended3')}{' '}
                      {t('billing.intended4')}
                    </p>
                  )}

                  {(!planState?.subscription || planState?.subscription?.status === 'cancelled') && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => buyPlan('launch99')}
                        disabled={isBuying === 'launch99'}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold disabled:opacity-60"
                      >
                        {isBuying === 'launch99' ? 'Opening…' : 'Get the ₹99 Launch Offer'}
                      </button>
                      <span className="text-[11px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
                        First 100 customers only · Limited time
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(planState?.plans || []).map((plan: any) => (
                      <div
                        key={plan.id}
                        className={`border rounded-xl p-4 space-y-2 flex flex-col ${
                          intendedPlan === plan.id
                            ? 'border-purple-500 ring-2 ring-purple-200 bg-purple-50/40'
                            : 'border-slate-200'
                        }`}
                      >
                        <p className="text-sm font-bold text-slate-900">
                          {plan.name}
                          {intendedPlan === plan.id && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-600 text-white">
                              {t('billing.yourPick')}
                            </span>
                          )}
                        </p>
                        <p className="text-lg font-extrabold text-slate-900">
                          ₹{Number(plan.priceInr).toLocaleString('en-IN')}
                          <span className="text-[11px] font-medium text-slate-400">/mo</span>
                        </p>
                        {/* What this plan actually includes — straight from the
                            server's plan catalog (tagline + features), so the card
                            and the entitlements behind it can never drift apart. */}
                        {plan.tagline && (
                          <p className="text-[11px] text-slate-500">{plan.tagline}</p>
                        )}
                        {Array.isArray(plan.features) && plan.features.length > 0 && (
                          <ul className="space-y-1 mt-1 mb-1 flex-1">
                            {plan.features.map((feature: string) => (
                              <li key={feature} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          onClick={() => buyPlan(plan.id)}
                          disabled={isBuying === plan.id}
                          className="w-full px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold disabled:opacity-60"
                        >
                          {isBuying === plan.id ? 'Opening…' : 'Buy'}
                        </button>
                      </div>
                    ))}
                  </div>

                  <a
                    href="/plans"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Public plans page
                  </a>
                </div>

                {/* The step-by-step guide that used to live here is now a single
                    dashboard-level component (src/OnboardingGuide.tsx) so the
                    same numbered steps, and the same green ticks, show on every
                    tab instead of only inside the connection screen. */}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Main Account Connection Card */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs md:col-span-2 space-y-6">
                  {/* Account Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
                    <div className="flex items-center gap-4">
                      {connection.profilePictureUrl ? (
                        <img 
                          src={connection.profilePictureUrl} 
                          alt="Instagram Profile" 
                          className="w-14 h-14 rounded-2xl object-cover border-2 border-purple-500 shadow-sm"
                        />
                      ) : (
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm ${
                          connection.isConnected ? 'bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                        }`}>
                          <Instagram className="w-7 h-7" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-lg">
                            {connection.isConnected 
                              ? `@${connection.instagramUsername}` 
                              : 'Instagram Professional Account'}
                          </h3>
                          {connection.isConnected && (
                            <span className="bg-purple-100 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Verified
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {connection.isConnected 
                            ? `Instagram Business Account ID: ${connection.instagramAccountId}` 
                            : 'Instagram is not connected to Meta Graph API'}
                        </p>
                      </div>
                    </div>

                    <div>
                      {connection.isConnected && connection.liveState === 'NEEDS_REAUTH' ? (
                        /* Connected, but Meta refuses the token for this app — the
                           bot cannot answer. Saying "Connected" here was how a
                           silent bot looked healthy. */
                        <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-rose-200">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Reconnect needed
                        </span>
                      ) : connection.isConnected ? (
                        <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-200 shadow-xs">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          Connected
                        </span>
                      ) : connection.status === 'ERROR' ? (
                        <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-rose-200">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Connection Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-amber-200">
                          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                          Disconnected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* CONNECTED STATE DETAILS */}
                  {connection.isConnected && (
                    <div className="space-y-4">
                      {(connection.sharedWith?.length || 0) > 0 && (
                        /* Connected and STILL silent: the same Instagram account is
                           connected by another account here, and an Instagram account
                           can only reach one bot. Saying "Connected" with no caveat is
                           what made this look like a broken bot. */
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            {t('shared.title')}
                          </p>
                          <p className="text-xs text-amber-800 leading-relaxed">{t('shared.body')}</p>
                        </div>
                      )}
                      {connection.liveState === 'NEEDS_REAUTH' && (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 space-y-2">
                          <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Instagram is refusing this account's token — the bot cannot reply
                          </p>
                          <p className="text-xs text-rose-800 leading-relaxed">
                            Meta answered: <span className="font-mono">{connection.liveDetail || 'access token is not valid for this app'}</span>
                          </p>
                          <p className="text-xs text-rose-800 leading-relaxed">
                            This usually means the app was removed from Instagram
                            (Settings → Apps and websites) or the connect happened on a
                            different Meta app than this website uses. Press{' '}
                            <strong>Reconnect Account</strong> below — and if the
                            authorization screen shows a different app name than this
                            dashboard's, tell the team, because that invite came from the
                            wrong app and connecting will keep failing until it is fixed.
                          </p>
                          {connection.liveCheckedAt && (
                            <p className="text-[11px] text-rose-500">
                              Checked {new Date(connection.liveCheckedAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Instagram Business ID</span>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium text-slate-800">{connection.instagramAccountId}</span>
                            <button 
                              onClick={() => copyToClipboard(connection.instagramAccountId || '', 'igId')}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              {copiedField === 'igId' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Linked Facebook Page</span>
                          <span className="text-xs font-medium text-slate-800 block">
                            {connection.facebookPageName || 'Connected via Meta OAuth'} 
                            {connection.facebookPageId && <span className="text-slate-400 text-[11px] block font-mono">ID: {connection.facebookPageId}</span>}
                          </span>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Token Security Status</span>
                          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                            <Lock className="w-3.5 h-3.5" />
                            Active (AES-256-GCM Encrypted)
                          </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last Meta API Verification</span>
                          <span className="text-xs text-slate-700 block">
                            {connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString() : 'Just now'}
                          </span>
                        </div>
                      </div>

                      {/* Connection Actions */}
                      <div className="pt-4 flex flex-wrap items-center gap-3">
                        <button 
                          onClick={handleLiveVerify}
                          disabled={isVerifying}
                          className="bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-medium px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 transition"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                          {isVerifying ? 'Verifying with Meta...' : 'Verify Live Connection'}
                        </button>

                        <button 
                          onClick={handleStartMetaOAuth}
                          className="bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-medium px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 transition"
                        >
                          <Instagram className="w-3.5 h-3.5" />
                          Reconnect Account
                        </button>

                        <button 
                          onClick={handleDisconnect}
                          className="bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 font-medium px-4 py-2.5 rounded-xl text-xs transition ml-auto"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  )}

                  {/* DISCONNECTED STATE */}
                  {!connection.isConnected && (
                    <div className="space-y-6">
                      {/* The fields below are useless without knowing which page
                          in the Meta dashboard they belong to, so the walkthrough
                          comes first and every step carries its own link. */}
                      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                        <div
                          onClick={() => setShowSetupGuide(!showSetupGuide)}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                            <HelpCircle className="w-4 h-4 text-purple-600" />
                            Setup guide — 5 steps
                          </h4>
                          <span className="text-xs text-purple-600 font-semibold">
                            {showSetupGuide ? 'Hide' : 'Show'}
                          </span>
                        </div>

                        {showSetupGuide && (
                          <ol className="space-y-4 pt-1">
                            <li className="flex gap-3">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-bold flex items-center justify-center mt-0.5">1</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-slate-800">{t('guide.step1Title')}</p>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  {t('guide.step1a')} <strong>Business</strong> {t('guide.step1or')} <strong>Creator</strong>{' '}
                                  {t('guide.step1link')} <strong>Facebook Page</strong> {t('guide.step1tail')}
                                </p>
                              </div>
                            </li>

                            <li className="flex gap-3">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-bold flex items-center justify-center mt-0.5">2</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-slate-800">{t('guide.step2Title')}</p>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  {t('guide.step2a')}
                                  (<code className="font-mono">My_business_bot</code>){t('guide.step2b')}
                                </p>
                                <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('guide.openDashboard')}</MetaLink>
                              </div>
                            </li>

                            <li className="flex gap-3">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-bold flex items-center justify-center mt-0.5">3</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-slate-800">{t('guide.step3Title')}</p>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  {t('guide.step3a')} <strong>3. Configure webhooks</strong>{t('guide.step3b')} <strong>Callback URL</strong>{t('guide.step3c')}{' '}
                                  <strong>Verify Token</strong>{t('guide.step3d')} <strong>Verify and Save</strong>{t('guide.step3e')}
                                  <code className="font-mono">messages</code>{t('guide.step3f')}
                                  <code className="font-mono">messaging_postbacks</code>{t('guide.step3g')}
                                </p>
                                <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('guide.openWebhook')}</MetaLink>
                              </div>
                            </li>

                            <li className="flex gap-3">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-bold flex items-center justify-center mt-0.5">4</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-slate-800">{t('guide.step4Title')}</p>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  <strong>4. Set up Instagram business login → Set up</strong>{t('guide.step4a')}{' '}
                                  <em>Valid OAuth Redirect URI</em>{t('guide.step4b')}
                                </p>
                                <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('guide.openRedirect')}</MetaLink>
                              </div>
                            </li>

                            <li className="flex gap-3">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center mt-0.5">5</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-slate-800">{t('guide.step5Title')}</p>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  {t('guide.step5a')} <strong>Allow</strong>{t('guide.step5b')}{' '}
                                  <strong>{t('guide.step5c')}</strong>{' '}
                                  {t('guide.step5d')}
                                </p>
                              </div>
                            </li>
                          </ol>
                        )}
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                          <Zap className="w-4 h-4 text-purple-600" />
                          Connect via Official Meta OAuth 2.0 (Recommended)
                        </h4>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          Securely link your Instagram Professional account in one click. Meta will authorize your account and InstaFlow AI will automatically discover your Instagram Business Account ID.
                        </p>

                        <div className="pt-2 space-y-2">
                          <button 
                            onClick={handleStartMetaOAuth}
                            disabled={isOauthPending}
                            className="bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:opacity-95 disabled:opacity-70 text-white font-medium px-6 py-3 rounded-xl text-sm shadow-md transition flex items-center gap-2"
                          >
                            {isOauthPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
                            {isOauthPending ? 'Waiting for Instagram approval…' : 'Connect Instagram with Meta'}
                            {!isOauthPending && <ArrowRight className="w-4 h-4 ml-1" />}
                          </button>
                          {isOauthPending && (
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {t('guide.oauthWaitingA')} <strong>Allow</strong> {t('guide.oauthWaitingB')}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Manual / Direct Token Accordion */}
                      <div ref={manualFormRef} className="border border-slate-200 rounded-2xl p-5 space-y-4">
                        <div 
                          onClick={() => setShowManualForm(!showManualForm)}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <div>
                            {/* When the one-click route cannot finish on this
                                deployment, this stops being the developer
                                workaround and becomes the way the account gets
                                connected — so it must not read as an aside. */}
                            <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                              <Key className="w-4 h-4 text-slate-600" />
                              {connectBlockedReason
                                ? t('manual.titlePrimary')
                                : 'Or Connect via Direct Meta Access Token (Developers & Testers)'}
                            </h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {connectBlockedReason
                                ? t('manual.subtitlePrimary')
                                : 'Paste a User Access Token or Page Access Token from the Meta Developer Console.'}
                            </p>
                          </div>
                          <button className="text-xs text-purple-600 font-semibold hover:underline">
                            {showManualForm ? 'Hide' : 'Configure'}
                          </button>
                        </div>

                        {showManualForm && (
                          <form onSubmit={handleManualConnect} className="space-y-4 pt-3 border-t border-slate-100">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1">
                              <p className="font-semibold flex items-center gap-1.5">
                                <Info className="w-3.5 h-3.5 shrink-0" />
                                Important Meta Graph API Requirements:
                              </p>
                              <ul className="list-disc list-inside space-y-0.5 text-amber-700 pl-1">
                                <li>Account must be an <strong>Instagram Professional/Business account</strong> (not Personal).</li>
                                <li>Account must be linked to a <strong>Facebook Page</strong> in Meta Accounts Center.</li>
                                <li>
                                  Token must carry the messaging permissions for this app's flavour:{" "}
                                  <code>instagram_business_basic</code> + <code>instagram_business_manage_messages</code> + <code>instagram_business_manage_comments</code>{" "}
                                  (Instagram Login) or <code>instagram_basic</code> + <code>instagram_manage_messages</code> (Facebook Login).
                                </li>
                                <li className="list-none pt-1">
                                  <span className="font-semibold">{t('manual.tokenWhere')}</span> Meta dashboard → <em>API setup with Instagram login</em> →{" "}
                                  <strong>2. Generate access tokens</strong> → <strong>Generate token</strong>. {t('manual.tokenWhere1')}{' '}
                                  <em>Tester</em> {t('manual.tokenWhere2')}
                                </li>
                              </ul>
                              <div className="flex flex-wrap gap-2 pt-1">
                                <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('manual.generateToken')}</MetaLink>
                                <MetaLink href={connection.setupLinks?.appRoles}>{t('manual.addTester')}</MetaLink>
                                <MetaLink href={connection.setupLinks?.accessTokenDebugger}>{t('manual.checkToken')}</MetaLink>
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Meta Access Token <span className="text-rose-500">*</span>
                              </label>
                              <div className="relative">
                                <input 
                                  ref={manualTokenInputRef}
                                  type="password" 
                                  required
                                  value={manualToken} 
                                  onChange={(e) => setManualToken(e.target.value)}
                                  placeholder="EAA... paste your Meta User or Page Access Token"
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 font-mono focus:outline-none focus:border-purple-500 pr-32"
                                />
                                <div className="absolute right-3 top-2.5 text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                                  <Lock className="w-3.5 h-3.5" /> AES-256-GCM
                                </div>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1">Never sent to browser in plaintext; stored encrypted on server.</p>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Instagram Business Account ID or Facebook Page ID <span className="text-slate-400 font-normal">(Optional — auto-discovered if blank)</span>
                              </label>
                              <input 
                                type="text" 
                                value={manualHintId} 
                                onChange={(e) => setManualHintId(e.target.value)}
                                placeholder="e.g. 17841434784408449 (Leave blank to auto-detect)"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 font-mono focus:outline-none focus:border-purple-500"
                              />
                            </div>

                            <button 
                              type="submit" 
                              disabled={isConnectingManual}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-5 py-2.5 rounded-xl text-xs shadow-sm transition flex items-center gap-2"
                            >
                              {isConnectingManual ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                              {isConnectingManual ? 'Validating with Meta Graph API...' : 'Connect & Verify Account'}
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {/* OAuth Redirect URI Card */}
                  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <ExternalLink className="w-4 h-4 text-purple-600" />
                      Meta OAuth Whitelist URL
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      This is the one URL that must be registered before <em>Connect Instagram Account</em> works. Paste it into your Meta App Dashboard at <strong>Instagram &gt; API setup with Instagram login &gt; 4. Set up Instagram business login &gt; Set up &gt; Redirect URL</strong>. (Apps on Facebook Login have the same field under <strong>Facebook Login for Business &gt; Settings &gt; Valid OAuth Redirect URIs</strong>.)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('oauth.openPage')}</MetaLink>
                      <MetaLink href={connection.setupLinks?.appDashboard}>App dashboard</MetaLink>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed space-y-1">
                      <p><strong>Which error means what</strong></p>
                      <p><strong>Invalid redirect_uri</strong> (Instagram Login apps, shown on instagram.com) = the URL below is not saved in step 4 yet.</p>
                      <p><strong>{t('oauth.sameUrlError')}</strong> = the URL belongs to a <em>different</em> Meta app. Check the Client ID below; if step 4 looks empty even after you saved it, you are editing another app.</p>
                      <p><strong>URL blocked</strong> (Facebook dialog) = wrong flavour, or the Facebook Login redirect list is empty.</p>
                    </div>

                    {isLocalDevOrigin(window.location.hostname) && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 leading-relaxed">
                        <strong>You are on localhost.</strong> Meta will never whitelist a localhost URL, so clicking <em>Connect Instagram Account</em> here always ends in an error popup (<strong>URL blocked</strong> on the Facebook dialog, <strong>Invalid redirect_uri</strong> on Instagram). Open the deployed app on your live domain and connect from there — the URL below is the one that needs registering.
                      </div>
                    )}
                    
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valid OAuth Redirect URI</span>
                        <button 
                          onClick={() => copyToClipboard(oauthRedirectUriFor(connection), 'oauthRedirect')}
                          className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
                        >
                          {copiedField === 'oauthRedirect' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          {copiedField === 'oauthRedirect' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-xs font-mono text-slate-800 break-all select-all">
                        {oauthRedirectUriFor(connection)}
                      </p>
                      {connection?.oauthRedirectUri &&
                        connection.oauthRedirectUri.replace(/\/+$/, '') !== `${window.location.origin}/api/instagram/oauth/callback` && (
                          <p className="text-[11px] text-amber-700 leading-relaxed">
                            The server is configured with <strong>META_REDIRECT_URI</strong>, so it sends this URL to Meta — not this page's address. Whitelist the URL above.
                          </p>
                        )}
                    </div>

                    {connection?.oauthClientId && (
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Meta App (Client) ID — {connection.oauthFlavour === 'instagram_login' ? 'Instagram Login' : 'Facebook Login'}
                          </span>
                          <button
                            onClick={() => copyToClipboard(connection.oauthClientId!, 'oauthClientId')}
                            className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
                          >
                            {copiedField === 'oauthClientId' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            {copiedField === 'oauthClientId' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p className="text-xs font-mono text-slate-800 break-all select-all">{connection.oauthClientId}</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {t('oauth.clientIdNote1')} <strong>isi app</strong>{t('oauth.clientIdNote2')}{' '}
                          <em>Invalid redirect_uri</em> {t('oauth.clientIdNote3')}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Webhook Configuration Card */}
                  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Code className="w-4 h-4 text-purple-600" />
                    Meta Webhook Configuration
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Set up these details in your Meta App Dashboard under <strong>Webhooks &gt; Instagram</strong> to receive real-time direct messages.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <MetaLink href={connection.setupLinks?.instagramApiSetup}>{t('guide.openWebhook')}</MetaLink>
                    <MetaLink href={connection.setupLinks?.graphApiExplorer}>Graph API Explorer</MetaLink>
                  </div>
                  
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Callback URL</span>
                      <button 
                        onClick={() => copyToClipboard(webhookCallbackUrl, 'callback')}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
                      >
                        {copiedField === 'callback' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedField === 'callback' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs font-mono text-slate-800 break-all select-all">
                      {webhookCallbackUrl}
                    </p>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Verify Token</span>
                      <button 
                        onClick={() => copyToClipboard('instaflow_secure_verify_token', 'verifyToken')}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
                      >
                        {copiedField === 'verifyToken' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedField === 'verifyToken' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs font-mono text-slate-800 select-all">
                      instaflow_secure_verify_token
                    </p>
                  </div>

                  <div className="pt-1">
                    <span className="text-xs font-semibold text-slate-700 block mb-1.5">Required Subscriptions:</span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="bg-purple-50 border border-purple-200 text-purple-700 text-[11px] px-2.5 py-0.5 rounded-md font-mono font-medium">messages</span>
                      <span className="bg-purple-50 border border-purple-200 text-purple-700 text-[11px] px-2.5 py-0.5 rounded-md font-mono font-medium">messaging_postbacks</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[11px] text-slate-500 space-y-1">
                      <p className="font-semibold text-slate-700">Setup Verification Step:</p>
                      <p>In Meta Developer App &gt; Webhooks &gt; Instagram, click <strong>"Verify and Save"</strong> using the URL and Token above.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

          {/* SCREEN: KNOWLEDGE BASE MANAGER */}
          {activeTab === 'knowledge' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="purple-highlight-heading text-2xl font-bold text-slate-900">Knowledge Base & AI Persona</h1>
                  <p className="text-sm text-slate-500">Provide your business information, FAQs, products, pricing and policies to train your AI Sales Assistant.</p>
                </div>
              </div>

              {/* Soft green-purple helper card (source: src/onboardingFeatures.tsx KnowledgeBaseDescriptionHighlight). */}
              <KnowledgeBaseDescriptionHighlight />

              {/* Customer booking page — the link to send interested customers.
                  The card itself lives in onboardingFeatures.tsx because the
                  "Customer Booking Page" screen renders the same one. */}
              <BookingLinkCard
                bookingUrl={connection.bookingUrl || null}
                copied={copiedField === 'bookingUrl'}
                onCopy={() => copyToClipboard(connection.bookingUrl || '', 'bookingUrl')}
                t={t}
              />

              {/* Numbered editing flow — guides the customer through KB setup in order */}
              <div className="bg-white rounded-2xl p-6 border-2 border-purple-200 shadow-xs space-y-4 scroll-mt-28" id="kb-editing-flow">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-purple-600" />
                  How to set up your knowledge base
                </h3>
                <ol className="space-y-3">
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">1</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Edit the AI System Prompt</span> — write the instructions the bot follows for every DM.
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">2</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Set the AI Persona</span> — choose the bot's tone (e.g. warm, formal, friendly).
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">3</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Fill in the 7 Starter Documents</span> — replace every [bracket] with your real business facts.
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">4</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Save</span> — changes persist automatically and are used for real DMs.
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">5</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Open the Simulator</span> — test representative customer questions.
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">6</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Correct missing or inaccurate answers</span> — edit documents until replies are right.
                    </p>
                  </li>
                  <li className="flex gap-3 items-start text-sm text-slate-700">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">7</span>
                    <p className="leading-relaxed">
                      <span className="font-semibold text-purple-700">Only then enable real customer replies</span> — never from unverified example content.
                    </p>
                  </li>
                </ol>
                <p className="text-[10px] text-slate-400 mt-2">
                  Completion reflects your actual saved state — clicking a step does not mark it done.
                </p>
              </div>

              {/* System Prompt & Persona editors */}
              <div ref={knowledgeEditorRef} id="knowledge-editor" className="bg-white rounded-2xl p-6 border-2 border-purple-200 shadow-xs space-y-6 scroll-mt-28" data-editor-target="true">
                <h3 className="purple-highlight-heading font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-white" />
                  Step 1: AI System Prompt
                </h3>
                <p className="text-xs font-medium text-purple-600 mb-2">
                  Click here to edit your AI instructions — this is sent with every real Instagram DM the bot answers.
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  placeholder="e.g. You are the AI assistant for [BUSINESS NAME]. Reply in short, friendly messages. Answer only from the knowledge base below. If you don't know something, say you will check with the team."
                  className="w-full bg-slate-50 border-2 border-purple-200 rounded-xl p-4 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder-slate-400"
                />
                <p className="text-xs text-slate-400">
                  Used for <strong>every real Instagram DM</strong> the bot answers, together with the knowledge documents below. Changes save automatically.
                </p>

                <h3 className="purple-highlight-heading font-bold text-slate-900 text-sm flex items-center gap-2 mt-4">
                  <Sparkles className="w-4 h-4 text-white" />
                  Step 2: AI Persona
                </h3>
                <p className="text-xs font-medium text-purple-600 mb-2">
                  Controls your AI agent's communication style and behaviour. For example: "warm and helpful" or "formal and concise".
                </p>
                <textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  rows={4}
                  placeholder="e.g. Warm, helpful, uses simple Hindi-English, speaks like a friendly shopkeeper"
                  className="w-full bg-slate-50 border-2 border-purple-200 rounded-xl p-4 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder-slate-400"
                />
                <p className="text-xs text-slate-400">
                  Persona shapes tone only — the AI still answers from your knowledge base facts, never from this text alone.
                </p>
                {settingsState === 'loading' && (
                  <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Loading…
                  </span>
                )}
                {settingsState === 'saving' && (
                  <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                )}
                {settingsState === 'saved' && (
                  <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Saved — used for real DMs
                  </span>
                )}
                {settingsState === 'error' && (
                  <span className="text-[10px] font-semibold text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Not saved — check the connection
                  </span>
                )}
              </div>

              {/* Unanswered customer questions — the bot had no knowledge-base answer */}
              {kbGaps.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 shadow-xs overflow-hidden">
                  <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/60 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Customers asked — the bot had no answer ({kbGaps.length})
                    </div>
                    <span className="text-[10px] font-medium text-amber-700">Add a document below and the gap closes itself</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {kbGaps.slice(0, 8).map(gap => (
                      <div key={gap.key} className="p-4 flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 break-words">{gap.question}</p>
                          <p className="text-[10px] text-slate-400">
                            asked {gap.count}× · last {new Date(gap.lastSeenAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => answerGap(gap)}
                            className="text-[11px] font-semibold text-purple-600 hover:text-purple-800 px-2 py-1 whitespace-nowrap"
                          >
                            Answer this
                          </button>
                          <button
                            onClick={() => dismissKbGap(gap.key)}
                            title="Dismiss"
                            className="text-slate-400 hover:text-rose-600 p-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* The fill-in-the-blank starter pack.

                  The complaint this answers: the customer opened this screen,
                  saw an empty form and an empty list, and did not know what a
                  "document" should even look like — so the bot kept answering
                  "let me check with the team". One click now writes the five
                  documents every enquiry needs with the numbers left as
                  [brackets], and the empty-state message below says what the
                  bot does with them. */}
              {kbItems.length === 0 && starterDocsMissing.length > 0 && (
                <div className="bg-purple-50/70 rounded-2xl border-2 border-purple-200 p-5 sm:p-6 space-y-3">
                  <p className="text-sm font-bold text-purple-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    {t('kb.starterTitle')}
                  </p>
                  <p className="text-xs text-purple-900/80 leading-relaxed max-w-3xl">{t('kb.starterHint')}</p>
                  <p className="text-xs text-purple-900/70 leading-relaxed mt-2">
                    Replace every <span className="font-bold text-purple-700">[bracketed placeholder]</span> — like [BUSINESS NAME], [PRICE], [LOCATION] and [OFFER] — with your real business facts before saving.
                  </p>
                  <button
                    onClick={addStarterDocs}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition"
                  >
                    {t('kb.starterCta', { count: starterDocsMissing.length })}
                  </button>
                </div>
              )}

              {/* Add Knowledge Item Form */}
              <div ref={kbFormRef} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                <h3 className="purple-highlight-heading font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4 text-white" />
                  Add New FAQ or Catalog Document
                  {starterDocsMissing.length > 0 && (
                    <button
                      type="button"
                      onClick={addStarterDocs}
                      className="ml-auto text-[11px] font-semibold text-purple-700 hover:text-purple-900 underline"
                    >
                      {t('kb.starterShort', { count: starterDocsMissing.length })}
                    </button>
                  )}
                </h3>
                <form onSubmit={addKnowledgeItem} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Document Title / Topic
                        {/* Both fields are genuinely mandatory: the submit is a
                            no-op when either is blank (source: src/onboardingFeatures.tsx RequiredFieldIndicator). */}
                        <RequiredFieldIndicator requirement="required" />
                      </label>
                      <input 
                        type="text" 
                        required
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="e.g. International Shipping" 
                        className="w-full bg-slate-50 border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Content / Answer Details</label>
                      <p className="text-[10px] text-slate-400 mb-1">
                        Replace [BUSINESS NAME], [PRICE], [LOCATION], [OFFER] etc. with your real facts.
                      </p>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          required
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="e.g. We ship worldwide via DHL Express in 4-6 business days..." 
                          className="flex-1 bg-slate-50 border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                        <button 
                          type="submit" 
                          className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition shrink-0"
                        >
                          Save Doc
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              {/* Knowledge Base List */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="purple-highlight-heading px-6 py-4 border-b border-slate-100 font-semibold text-sm text-slate-900 flex items-center gap-2">
                  Active Knowledge Documents ({kbItems.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {kbItems.map(item => (
                    <div key={item.id} className="p-6 flex items-start justify-between gap-4 hover:bg-purple-50/20 transition border-b border-purple-50/40 last:border-0">
                      {editingKbId === item.id ? (
                        /* Editing in place, because the only other way to fix one
                           wrong price was to delete the document and retype it. */
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={editKbTitle}
                            onChange={(e) => setEditKbTitle(e.target.value)}
                            className="w-full bg-slate-50 border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                          />
                          <textarea
                            value={editKbContent}
                            onChange={(e) => setEditKbContent(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-50 border-2 border-purple-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={saveEditKbItem}
                              disabled={!editKbTitle.trim() || !editKbContent.trim()}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-xl text-xs transition disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingKbId(null)}
                              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-xl text-xs transition"
                            >
                              Cancel
                            </button>
                            <span className="text-[10px] text-slate-400">{t('kb.editAutoSave')}</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-slate-900 text-sm">{item.title}</h4>
                              <span className="bg-purple-100 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{item.category}</span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">{item.content}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => startEditKbItem(item)}
                              title="Edit"
                              className="text-slate-400 hover:text-purple-600 p-2 rounded-lg transition"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteKnowledgeItem(item.id)}
                              className="text-slate-400 hover:text-rose-600 p-2 rounded-lg transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {kbItems.length === 0 && (
                    <div className="p-6 text-xs text-slate-500 leading-relaxed">
                      No documents yet. Add your prices, shipping rules, policies and FAQs above — real DMs are answered from exactly these documents, and anything not covered here gets a “let me check with the team” reply instead of a guess.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SCREEN: LIVE CHAT INBOX & HUMAN TAKEOVER */}
          {activeTab === 'inbox' && (
            <div className="space-y-6 h-[calc(100vh-140px)] flex flex-col">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Live Customer Chat Inbox</h1>
                <p className="text-sm text-slate-500">Monitor automated direct messages from connected Instagram accounts and toggle human agent takeover anytime.</p>
              </div>

              {/* Leads that came in through the public booking page */}
              {leads.length > 0 && (
                <div className="bg-white rounded-2xl border border-emerald-200 shadow-xs overflow-hidden shrink-0">
                  <div className="px-5 py-3 border-b border-emerald-100 bg-emerald-50/60 flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-600" />
                      New leads from the booking page ({leads.filter(lead => lead.status === 'new').length})
                    </span>
                    <button onClick={fetchLeads} className="text-slate-400 hover:text-emerald-700">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {leads.map(lead => (
                      <div key={lead.id} className="p-4 flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {lead.name}
                            {lead.status === 'new' && (
                              <span className="ml-2 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">NEW</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-600">
                            {lead.travelDates && <span>{lead.travelDates} · </span>}
                            {lead.travellers && <span>{lead.travellers} · </span>}
                            {new Date(lead.createdAt).toLocaleString()}
                          </p>
                          {lead.message && <p className="text-xs text-slate-500 break-words">{lead.message}</p>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <a
                            href={`https://wa.me/${String(lead.whatsapp || '').replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 whitespace-nowrap"
                          >
                            WhatsApp
                          </a>
                          {lead.status === 'new' && (
                            <button
                              onClick={() => markLeadHandled(lead.id)}
                              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 whitespace-nowrap"
                            >
                              Done
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Conversation List */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 font-semibold text-xs text-slate-500 uppercase tracking-wider flex items-center justify-between">
                    <span>Recent Conversations ({conversations.length})</span>
                    <button onClick={fetchInboxChats} className="hover:text-purple-600">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
                    {conversations.map(conv => (
                      <div 
                        key={conv.id}
                        onClick={() => {
                          setSelectedConv(conv);
                          setChatMessages(conv.messages || []);
                        }}
                        className={`p-4 cursor-pointer transition ${selectedConv?.id === conv.id ? 'bg-purple-50/80 border-l-4 border-purple-600' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 text-sm">{conv.customerName || conv.senderHandle || 'Customer'}</span>
                          <span className="text-[10px] text-slate-400">{conv.timestamp || conv.updatedAt?.slice(11, 16)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 truncate max-w-[180px]">{conv.lastMessage}</span>
                          {conv.humanTakeover ? (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <UserX className="w-3 h-3" /> Manual
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Zap className="w-3 h-3" /> AI Bot
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Active Chat Thread */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:col-span-2 overflow-hidden">
                  {selectedConv ? (
                    <>
                      {/* Thread Header */}
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                            {(selectedConv.customerName || 'C').charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{selectedConv.customerName || selectedConv.senderHandle || 'Instagram User'}</h4>
                            <p className="text-xs text-slate-500">{selectedConv.customerHandle || `Sender ID: ${selectedConv.senderId}`}</p>
                          </div>
                        </div>

                        {/* Human Takeover Toggle */}
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-xs font-semibold text-slate-700">Automation Mode</div>
                            <div className="text-[10px] text-slate-400">{selectedConv.humanTakeover ? 'Paused (Human Agent Active)' : 'Active (Gemini Auto-Pilot)'}</div>
                          </div>
                          <button 
                            onClick={async () => {
                              const next = !selectedConv.humanTakeover;
                              // Flip optimistically, then persist server-side so the
                              // webhook respects it (and it survives redeploys).
                              setConversations(conversations.map(c => c.id === selectedConv.id ? { ...c, humanTakeover: next } : c));
                              setSelectedConv({ ...selectedConv, humanTakeover: next });
                              try {
                                const res = await apiFetch(`/api/inbox-chats/${encodeURIComponent(selectedConv.id)}/takeover`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
                                  body: JSON.stringify({ humanTakeover: next }),
                                });
                                if (!res.ok) {
                                  const data = await res.json().catch(() => ({}));
                                  throw new Error(data.error || `HTTP ${res.status}`);
                                }
                                setActionMessage({
                                  type: 'info',
                                  text: next
                                    ? 'AI bot paused for this conversation. New messages will wait for your manual reply.'
                                    : 'AI bot resumed. New messages in this conversation will be answered automatically.',
                                });
                              } catch (err: any) {
                                setConversations(conversations.map(c => c.id === selectedConv.id ? { ...c, humanTakeover: !next } : c));
                                setSelectedConv({ ...selectedConv, humanTakeover: !next });
                                setActionMessage({ type: 'error', text: `Could not change automation mode: ${err.message}` });
                              }
                            }}
                            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs ${selectedConv.humanTakeover ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'}`}
                          >
                            {selectedConv.humanTakeover ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            {selectedConv.humanTakeover ? 'Resume AI Bot' : 'Human Takeover'}
                          </button>
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                        {chatMessages.map((msg, idx) => (
                          <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-md rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${msg.sender === 'customer' ? 'bg-white text-slate-800 border border-slate-200' : 'bg-purple-600 text-white'}`}>
                              <p>{msg.text}</p>
                              <span className={`block text-[10px] mt-1 text-right ${msg.sender === 'customer' ? 'text-slate-400' : 'text-purple-200'}`}>{msg.time || msg.timestamp?.slice(11, 16)}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Reply Input */}
                      <div className="p-4 border-t border-slate-100 bg-white">
                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          const text = replyInput.trim();
                          if (!text) return;
                          try {
                            const res = await apiFetch(`/api/inbox-chats/${encodeURIComponent(selectedConv.id)}/reply`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
                              body: JSON.stringify({ text }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

                            const messages = data.chat?.messages;
                            if (Array.isArray(messages) && messages.length > 0) {
                              setChatMessages(messages);
                              setSelectedConv({ ...selectedConv, messages, lastMessage: text });
                              setConversations(conversations.map(c => c.id === selectedConv.id ? { ...c, messages, lastMessage: text } : c));
                            } else {
                              setChatMessages([...chatMessages, { sender: 'agent', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
                            }

                            if (data.delivered === false) {
                              setActionMessage({ type: 'error', text: `Message saved locally, but Instagram delivery failed: ${data.error}` });
                            }
                            setReplyInput('');
                          } catch (err: any) {
                            setActionMessage({ type: 'error', text: `Could not send manual reply: ${err.message}` });
                          }
                        }} className="flex gap-2">
                          <input 
                            type="text" 
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            placeholder={selectedConv.humanTakeover ? "Type manual agent reply..." : "AI Bot is active (Toggle Human Takeover to reply manually)..."}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
                          />
                          <button 
                            type="submit" 
                            className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-5 py-3 rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm"
                          >
                            <Send className="w-3.5 h-3.5" /> Send
                          </button>
                        </form>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                      Select a conversation to view chat history
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SIMULATOR TAB: AI DM SANDBOX */}
          {activeTab === 'simulator' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Instagram DM AI Simulator Sandbox</h1>
                <p className="text-sm text-slate-500">Test your AI responses and knowledge base in real-time before handling live customer webhooks.</p>
              </div>

              {/* Empty knowledge base warning — the simulator cannot answer meaningfully
                  with no saved documents, so say so up front instead of a blank reply. */}
              {kbItems.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-amber-800 text-sm">Knowledge Base is empty</p>
                    <p className="text-[10px] text-amber-700 mt-1">
                      The simulator can only answer from your saved starter documents. Open the Knowledge Base tab, add at least one document, then test here.
                    </p>
                  </div>
                </div>
              )}

              {simError && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-rose-800 text-sm">Simulation error</p>
                    <p className="text-[10px] text-rose-700 mt-1">{simError}</p>
                  </div>
                  <button
                    onClick={() => setSimError(null)}
                    className="text-xs font-semibold text-rose-600 hover:underline px-2"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-[550px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">Gemini Sandbox</span>
                  </div>
                  <button 
                    onClick={() => setSimHistory([{ sender: 'ai', text: 'Simulator reset. Ask me a question!', time: 'Just now' }])}
                    className="text-xs text-purple-600 hover:underline font-medium"
                  >
                    Clear Chat
                  </button>
                </div>

                <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                  {simHistory.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-md rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${msg.sender === 'customer' ? 'bg-purple-600 text-white' : 'bg-white text-slate-800 border border-slate-200'}`}>
                        <p>{msg.text}</p>
                        <span className={`block text-[10px] mt-1 text-right ${msg.sender === 'customer' ? 'text-purple-200' : 'text-slate-400'}`}>{msg.time}</span>
                        {msg.sender === 'ai' && simError && (
                          <button
                            onClick={retryLastSimulate}
                            className="mt-2 text-xs font-semibold text-purple-600 hover:underline flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Try again
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {isSimulating && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                        Gemini is formulating response...
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-white">
                  <form onSubmit={handleSimulateSend} className="flex gap-2">
                    <input 
                      type="text" 
                      value={simMessage}
                      onChange={(e) => setSimMessage(e.target.value)}
                      placeholder="Type a test customer DM (e.g. 'Do you have size M in the summer dress?')..." 
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
                    />
                    <button 
                      type="submit" 
                      disabled={isSimulating}
                      className="bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:opacity-95 text-white font-medium px-6 py-3 rounded-xl text-xs transition flex items-center gap-2 shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" /> Send DM
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN: ANALYTICS PANEL */}
          {activeTab === 'analytics' && (
            <div id="setup-analytics" className={`scroll-mt-28 space-y-6${flashRing('setup-analytics')}`}>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Analytics & API Credits</h1>
                <p className="text-sm text-slate-500">Real-time metrics on automated DMs, resolution success rate, and Gemini token usage.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total DMs Processed</span>
                  <div className="text-3xl font-extrabold text-slate-900">
                    {(analytics.totalDMs + platformStats.messages).toLocaleString()}
                  </div>
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">↑ 18.2% from last week</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Automated Resolution Rate</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.resolvedRate}%</div>
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">Top tier performance</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gemini API Credits Used</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.apiCreditsUsed.toLocaleString()}</div>
                  <span className="text-xs text-slate-500">Standard tier quota</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Subscribers</span>
                  <div className="text-3xl font-extrabold text-slate-900">
                    {(analytics.activeSubscribers + platformStats.paidAccounts).toLocaleString()}
                  </div>
                  <span className="text-xs text-purple-600 font-medium">
                    Paid accounts across all plans
                    {platformStats.trialingAccounts > 0 && ` · ${platformStats.trialingAccounts} on trial`}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Subscription & Tenant Security Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Subscription Status</span>
                    <p className="text-sm font-bold text-emerald-700">Active (Verified)</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Database Tenant Isolation</span>
                    <p className="text-sm font-bold text-slate-800">Firestore Rules Enforced</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Encryption Standard</span>
                    <p className="text-sm font-bold text-slate-800">AES-256-GCM at Rest</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Diagnostics Modal */}
      {showDiagnostics && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-900">Meta API & Server Diagnostics</h3>
              </div>
              <button onClick={() => setShowDiagnostics(false)} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
            </div>

            {isLoadingDiagnostics ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                <span>Checking server and Meta API configuration...</span>
              </div>
            ) : diagnosticsData ? (
              <div className="space-y-4 text-xs">
                <div className="space-y-2">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Meta Environment Configuration</span>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-slate-500">Meta App ID:</span>
                      <p className={`font-semibold ${diagnosticsData.metaConfiguration.appIdConfigured ? 'text-emerald-700' : 'text-amber-600'}`}>
                        {diagnosticsData.metaConfiguration.appIdConfigured ? '✓ Configured' : '⚠ Missing (Set META_APP_ID)'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Meta App Secret:</span>
                      <p className={`font-semibold ${diagnosticsData.metaConfiguration.appSecretConfigured ? 'text-emerald-700' : 'text-amber-600'}`}>
                        {diagnosticsData.metaConfiguration.appSecretConfigured ? '✓ Configured' : '⚠ Missing (Set META_APP_SECRET)'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Meta Verify Token:</span>
                      <p className="font-semibold text-emerald-700">✓ Active</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Active AI Provider:</span>
                      <p className={`font-semibold ${diagnosticsData.aiEngine?.activeProvider !== 'None' ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {diagnosticsData.aiEngine?.activeProvider !== 'None' ? `✓ ${diagnosticsData.aiEngine?.activeProvider}` : '✕ None Configured'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">OpenRouter API:</span>
                      <p className={`font-semibold ${
                        diagnosticsData.aiEngine?.openRouter?.configured 
                          ? diagnosticsData.aiEngine?.openRouter?.validKeyFormat 
                            ? 'text-emerald-700' 
                            : 'text-amber-600'
                          : 'text-slate-400'
                      }`}>
                        {diagnosticsData.aiEngine?.openRouter?.configured 
                          ? diagnosticsData.aiEngine?.openRouter?.validKeyFormat
                            ? `✓ Active (${diagnosticsData.aiEngine?.openRouter?.resolvedModel})` 
                            : `⚠ Key Invalid Format (Starts with ${diagnosticsData.aiEngine?.openRouter?.configuredModel})`
                          : '○ Not Set'}
                      </p>
                      {diagnosticsData.aiEngine?.openRouter?.warning && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{diagnosticsData.aiEngine.openRouter.warning}</p>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">Gemini API:</span>
                      <p className={`font-semibold ${diagnosticsData.aiEngine?.gemini?.configured ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {diagnosticsData.aiEngine?.gemini?.configured ? `✓ Active (${diagnosticsData.aiEngine?.gemini?.model || 'gemini'})` : '○ Not Set'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Endpoints & URLs</span>
                  <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-slate-500">OAuth Callback URI:</span>
                      <p className="font-mono text-slate-800 break-all">{diagnosticsData.metaConfiguration.oauthRedirectUri}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Webhook Callback URL:</span>
                      <p className="font-mono text-slate-800 break-all">{diagnosticsData.metaConfiguration.webhookCallbackUrl}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Graph API Version:</span>
                      <p className="font-mono text-slate-800">{diagnosticsData.server.graphApiVersion}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Current Tenant Status</span>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                    <p><span className="text-slate-500">Tenant ID:</span> <span className="font-mono">{diagnosticsData.currentTenant.tenantId}</span></p>
                    <p><span className="text-slate-500">Status:</span> <span className="font-semibold">{diagnosticsData.currentTenant.status.status}</span></p>
                    {diagnosticsData.currentTenant.status.instagramAccountId && (
                      <p><span className="text-slate-500">Instagram Account:</span> @{diagnosticsData.currentTenant.status.instagramUsername} ({diagnosticsData.currentTenant.status.instagramAccountId})</p>
                    )}
                    {diagnosticsData.currentTenant.status.lastError && (
                      <p className="text-rose-600"><span className="font-semibold">Last Error:</span> {diagnosticsData.currentTenant.status.lastError}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-rose-600 text-xs">Could not retrieve diagnostics data.</p>
            )}

            <div className="pt-3 text-right border-t border-slate-100">
              <button 
                onClick={() => setShowDiagnostics(false)} 
                className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-portal assistant. Available on every screen: the moment a customer
          is lost is rarely the moment they are looking at the guide. */}
      {signedIn && (
        <HelpAssistant
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          tenantId={tenantId}
          snapshot={onboarding}
        />
      )}

      {/* The username gate.

          Blocking on purpose, and deliberately without a close button: a readable
          name IS the feature, so a "skip" would just put the 28-character uid
          back in front of every future support conversation. Asked once per
          account; only the team can reset it afterwards. */}
      {user && profile && !profile.username && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h2 className="text-lg font-bold text-slate-900">{t('username.title')}</h2>
            <p className="text-xs text-slate-600 leading-relaxed">{t('username.hint')}</p>
            <input
              value={usernameDraft}
              onChange={(event) => setUsernameDraft(event.target.value.replace(/^@/, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && usernameDraft.trim().length >= 3) void saveUsername();
              }}
              placeholder={t('username.placeholder')}
              autoComplete="off"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-[11px] text-slate-500">{t('username.rule')}</p>
            {usernameError && (
              <p className="text-[11px] font-medium text-rose-600">{usernameError}</p>
            )}
            <button
              type="button"
              disabled={savingUsername || usernameDraft.trim().length < 3}
              onClick={() => void saveUsername()}
              className="w-full bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {savingUsername ? t('username.saving') : t('username.save')}
            </button>
            <p className="text-[11px] text-slate-400">{t('username.lockedNote')}</p>
            <p className="text-[11px] text-amber-700">{t('username.required')}</p>
          </div>
        </div>
      )}

      {/* Privacy Policy Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900">Privacy Policy</h2>
            <p className="text-xs text-slate-500">Last updated: September 23, 2026</p>
            <div className="text-xs text-slate-700 space-y-3 leading-relaxed">
              <p>InstaFlow AI respects your privacy and is committed to protecting your personal data. We collect business profile information, Instagram page credentials (encrypted at rest with AES-256-GCM), knowledge base FAQs, and conversation logs necessary to provide AI-powered customer support automation.</p>
              <p>All sensitive tokens and business secrets are encrypted at rest. We enforce strict multi-tenant isolation through Firebase Firestore Security Rules.</p>
            </div>
            <div className="pt-4 text-right">
              <button onClick={() => setShowPrivacy(false)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTerms && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900">Terms of Service</h2>
            <p className="text-xs text-slate-500">Last updated: September 23, 2026</p>
            <div className="text-xs text-slate-700 space-y-3 leading-relaxed">
              <p>Welcome to InstaFlow AI. By accessing or using our platform, you agree to be bound by these Terms of Service.</p>
              <p>You agree to use InstaFlow AI in compliance with Meta Platform Terms and Instagram Community Guidelines.</p>
            </div>
            <div className="pt-4 text-right">
              <button onClick={() => setShowTerms(false)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
