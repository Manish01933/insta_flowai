import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';
import { isRuntimeComped } from './compStore';
import { DEFAULT_LANG, message as M, type Lang } from './i18n';
import { isBotEnabled } from './botControlStore';
import { isAccountRemoved } from './accountRemovalStore';

/**
 * Plans and per-tenant subscriptions.
 *
 * Why this exists: InstaFlow is sold as a service, but nothing in the app knew
 * what a customer had bought — the dashboard showed a hardcoded "Pro Plan
 * ($99/mo)" label and the webhook answered for anybody who connected an account.
 * A business owner who signs up on the website needs to pick a plan, pay, and
 * then have the bot actually be theirs.
 *
 * The store is deliberately separate from the Instagram connection: a tenant can
 * exist (signed up, browsing) before they have either.
 */

export interface PlanLimits {
  instagramAccounts: number;
  aiRepliesPerMonth: number;
  knowledgeDocuments: number;
}

export interface Plan {
  id: string;
  name: string;
  /** Monthly price in whole rupees (Razorpay wants paise; converted at checkout). */
  priceInr: number;
  tagline: string;
  features: string[];
  limits: PlanLimits;
  /** Shown as "most popular" on the pricing page. */
  highlight?: boolean;
  /** Internal plans nobody can buy (owner access, comped accounts). */
  hidden?: boolean;
}

export const PLANS: Plan[] = [
  // The self-service Free Plan (Feature 1 Step 2): the tier a customer can
  // activate BEFORE connecting Instagram, with real limits enforced through
  // the existing entitlement system — never a hidden frontend unlock.
  {
    id: 'free',
    name: 'Free',
    priceInr: 0,
    tagline: 'Bot pehle, card nahi — hamesha free',
    features: [
      '1 Instagram account',
      '200 AI replies / month',
      'Knowledge base (20 documents)',
      'Booking page + leads inbox',
    ],
    limits: { instagramAccounts: 1, aiRepliesPerMonth: 200, knowledgeDocuments: 20 },
  },
  {
    id: 'trial',
    name: 'Free Trial',
    priceInr: 0,
    tagline: '5 din, koi card nahi',
    features: [
      '1 Instagram account',
      '200 AI replies',
      'Knowledge base (20 documents)',
      'Booking page + leads inbox',
    ],
    limits: { instagramAccounts: 1, aiRepliesPerMonth: 200, knowledgeDocuments: 20 },
    hidden: true,
  },
  {
    // ₹99 limited-time launch offer. The tagline/CTA copy stays in English on
    // purpose (the owner asked for it): that is how an Indian business owner
    // reads a price. Availability is server-enforced (see isLaunchOfferAvailable)
    // so neither the pricing page nor the checkout can oversell past the cap.
    id: 'launch99',
    name: 'Launch Offer',
    priceInr: 99,
    tagline: 'First 100 customers — limited time',
    features: [
      '1 Instagram account',
      '500 AI replies / month',
      'Knowledge base (50 documents)',
      'Booking page + leads inbox',
      'Unanswered-question alerts',
      // The campaign is part of this plan's offer, so it is listed here rather
      // than only on the landing page. Worded as a *chance* on purpose: the
      // free year is a prize drawn under the campaign rules, and a plan card is
      // exactly where a reader would otherwise take it for a guaranteed year of
      // service.
      'Chance to win 1 year free (campaign prize — not guaranteed)',
    ],
    limits: { instagramAccounts: 1, aiRepliesPerMonth: 500, knowledgeDocuments: 50 },
  },
  {
    id: 'starter',
    name: 'Starter',
    priceInr: 999,
    tagline: 'Ek business, ek page',
    features: [
      '1 Instagram account',
      '500 AI replies / month',
      'Knowledge base (50 documents)',
      'Booking page + leads inbox',
      'Unanswered-question alerts',
    ],
    limits: { instagramAccounts: 1, aiRepliesPerMonth: 500, knowledgeDocuments: 50 },
  },
  {
    id: 'growth',
    name: 'Growth',
    priceInr: 2499,
    tagline: 'Growing page, zyada enquiries',
    features: [
      '3 Instagram accounts',
      '5,000 AI replies / month',
      'Knowledge base (200 documents)',
      'Human takeover inbox',
      'Lead notifications to owner',
    ],
    limits: { instagramAccounts: 3, aiRepliesPerMonth: 5000, knowledgeDocuments: 200 },
    highlight: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    priceInr: 4999,
    tagline: 'Multiple clients, ek dashboard',
    features: [
      '10 Instagram accounts',
      '25,000 AI replies / month',
      'Unlimited knowledge documents',
      'Priority support',
    ],
    limits: { instagramAccounts: 10, aiRepliesPerMonth: 25000, knowledgeDocuments: 1000 },
  },
  {
    id: 'owner',
    name: 'Owner',
    priceInr: 0,
    tagline: 'Internal — full access',
    features: ['Unlimited everything'],
    limits: { instagramAccounts: 100, aiRepliesPerMonth: 1000000, knowledgeDocuments: 1000 },
    hidden: true,
  },
];

export const TRIAL_DAYS = 5;

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled';

export interface Subscription {
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  startedAt: string;
  /** ISO date the paid period ends. Absent = never expires (owner/comped). */
  currentPeriodEnd?: string;
  provider: 'razorpay' | 'manual';
  orderId?: string;
  paymentId?: string;
  amountPaidInr?: number;
  trialUsedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
}

/**
 * The order a tenant most recently tried to pay for.
 *
 * Kept in its own section of subscriptions.json (never as a Subscription row)
 * because a subscription row with a non-trial status is treated as access —
 * merely creating a checkout must never grant a plan.
 */
export interface PendingOrder {
  orderId: string;
  planId: string;
  createdAt: string;
}

const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

const subs = new Map<string, Subscription>();
const pendingOrders = new Map<string, PendingOrder>();
let loaded = false;

export function getPlan(planId: string): Plan | null {
  return PLANS.find((plan) => plan.id === planId) || null;
}

/**
 * The free trial is retired: no new trial can be started, and every trial
 * offering is gone from the public site and the dashboard. Rows that were
 * already granted keep running to their end (see decideAccess) — the retirement
 * only closes the front door, it never takes away time a customer already has.
 */
export const TRIAL_RETIRED_EN =
  'The free trial has been retired. The ₹99 Launch Offer (first 100 customers, limited time) is live instead.';

/**
 * Launch-offer availability. "First 100 customers" counts every non-cancelled
 * launch99 subscription row, so a refund/cancel frees the seat back up.
 * "Limited time" honours LAUNCH_OFFER_ENDS_AT (ISO date) when the host sets one;
 * without it the offer is limited only by the cap.
 */
export const LAUNCH_OFFER_CAP = 100;

export function launchOfferSold(): number {
  loadSubscriptions();
  let sold = 0;
  subs.forEach((sub) => {
    if (sub.planId === 'launch99' && sub.status !== 'cancelled') sold += 1;
  });
  return sold;
}

export function isLaunchOfferAvailable(): boolean {
  const endsAt = process.env.LAUNCH_OFFER_ENDS_AT
    ? Date.parse(process.env.LAUNCH_OFFER_ENDS_AT)
    : NaN;
  if (Number.isFinite(endsAt) && Date.now() > endsAt) return false;
  return launchOfferSold() < LAUNCH_OFFER_CAP;
}

/** Plans a customer can actually buy (the pricing page). */
export function getPurchasablePlans(): Plan[] {
  return PLANS.filter((plan) => !plan.hidden && (plan.id !== 'launch99' || isLaunchOfferAvailable()));
}

function periodEndFromNow(months: number, from: Date = new Date()): string {
  const end = new Date(from);
  end.setMonth(end.getMonth() + months);
  return end.toISOString();
}

/**
 * Bring trials that were handed out under an older trial length in line with the
 * current one.
 *
 * A subscription row carries its own end date, so lowering `TRIAL_DAYS` does not
 * touch trials that already exist — and the dashboard then shows two different
 * numbers for one offer: a "Start 3-day free trial" button next to a trial that
 * runs for seven days. Rows like that are a data artefact, not a promise to keep,
 * so they are shortened to the configured length measured from the moment they
 * were granted.
 *
 * Two rules keep this safe: it only ever *shortens* a trial (never extends one,
 * never touches a paid plan), and it is idempotent — a row that already matches
 * TRIAL_DAYS is left alone, so this does nothing after the first load.
 */
function normalizeTrialLengths(): number {
  const maxMs = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  let shortened = 0;

  subs.forEach((sub) => {
    if (sub.status !== 'trial') return;
    // Measure from the moment the trial was actually granted: `startedAt` can be
    // older than the trial itself when a cancelled row was resumed.
    const grantedAt = Date.parse(sub.trialUsedAt || sub.startedAt || '');
    const endsAt = Date.parse(sub.currentPeriodEnd || '');
    if (!Number.isFinite(grantedAt) || !Number.isFinite(endsAt)) return;
    if (endsAt - grantedAt <= maxMs) return;

    sub.currentPeriodEnd = new Date(grantedAt + maxMs).toISOString();
    sub.updatedAt = new Date().toISOString();
    shortened += 1;
  });

  return shortened;
}

export function loadSubscriptions() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(SUBS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    const data: Record<string, Subscription> = parsed?.subscriptions ?? parsed ?? {};

    let dropped = 0;
    for (const [tenantId, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || !(value as Subscription).planId) {
        dropped += 1;
        continue;
      }
      subs.set(tenantId, { ...(value as Subscription), tenantId });
    }

    const pending: Record<string, PendingOrder> = parsed?.pendingOrders ?? {};
    for (const [tenantId, value] of Object.entries(pending)) {
      if (value?.orderId) pendingOrders.set(tenantId, { ...value, orderId: String(value.orderId) });
    }

    const shortened = normalizeTrialLengths();
    if (shortened) {
      persist();
      console.log(`[plans] Shortened ${shortened} trial(s) to the current ${TRIAL_DAYS}-day setting`);
    }

    console.log(
      `[plans] Loaded ${subs.size} subscription(s) and ${pendingOrders.size} pending order(s) from ${SUBS_FILE}` +
        (dropped ? ` (dropped ${dropped} invalid)` : '')
    );
  } catch (err) {
    console.error('[plans] Failed to load subscriptions:', err);
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, Subscription> = {};
    subs.forEach((sub, tenantId) => {
      data[tenantId] = sub;
    });
    const pending: Record<string, PendingOrder> = {};
    pendingOrders.forEach((order, tenantId) => {
      pending[tenantId] = order;
    });
    const tmpFile = `${SUBS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, subscriptions: data, pendingOrders: pending }), 'utf8');
    fs.renameSync(tmpFile, SUBS_FILE);
  } catch (err) {
    console.error('[plans] Failed to persist subscriptions:', err);
  }
}

/**
 * Tenants that always have access regardless of billing.
 *
 * Set OWNER_TENANT_IDS on the host (comma separated). Used for the app owner's
 * own account and for comped/pilot customers, so enabling billing can never lock
 * the operator out of their own product.
 */
export function getOwnerTenantIds(): string[] {
  return (process.env.OWNER_TENANT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Owner tenant ids — the entries in OWNER_TENANT_IDS that are uids. */
export function getOwnerUids(): string[] {
  return getOwnerTenantIds().filter((id) => !id.includes('@'));
}

/**
 * Comped tenant ids, from `COMP_TENANT_IDS`.
 *
 * These accounts never need a plan, so their bot keeps replying after a trial
 * would have ended (used for demos, hand-sold customers, and the account a Meta
 * reviewer signs into — App Review can outlive a 3-day trial).
 *
 * Deliberately separate from `OWNER_TENANT_IDS`: the owner list also grants
 * cross-tenant read access, and comping a customer (or handing an account to a
 * reviewer) must not be a back door into every other tenant's data.
 *
 * This function is only the **env** half. The other half lives in
 * `DATA_DIR/comped-tenants.json` (`server/compStore.ts`), because marking one
 * account free used to need an env edit *and* a redeploy — see that file.
 */
export function getCompedTenantIds(): string[] {
  return (process.env.COMP_TENANT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Never billed and never expires — env list **or** the runtime list.
 *
 * Read by `decideAccess`, the Ops Console's plan column and the trial gate, so
 * all three agree on what "free forever" means instead of each checking a
 * different source.
 */
export function isCompedTenant(tenantId: string): boolean {
  if (!tenantId) return false;
  if (getCompedTenantIds().includes(tenantId)) return true;
  return isRuntimeComped(tenantId);
}

/**
 * Owner *emails*, from OWNER_EMAILS (and any "@" entry inside
 * OWNER_TENANT_IDS, so one list can hold both).
 *
 * Why emails at all: a tenant id is a Firebase uid — an opaque string nobody can
 * read off their own account. Asking the operator to dig a uid out of the console
 * before they can open the console is a chicken-and-egg problem, so the signing-in
 * address (which the verified token carries) works too.
 */
export function getOwnerEmails(): string[] {
  const fromOwnerIds = getOwnerTenantIds().filter((id) => id.includes('@'));
  const fromEnv = (process.env.OWNER_EMAILS || '').split(',');
  const normalized = [...fromOwnerIds, ...fromEnv]
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)];
}

/**
 * uids whose owner email has been seen on a verified token.
 *
 * An owner identified by email still has to pass the *uid-only* checks elsewhere
 * ("never billed", cross-tenant reads, `/api/owner/tenants`), and those call sites
 * only ever see the tenant id. Verifying the token once is enough to learn the
 * uid, so it is written down here — on the persistent volume in production —
 * instead of making every later request carry an email.
 */
const OWNER_UIDS_FILE = path.join(DATA_DIR, 'owner-uids.json');
let linkedOwnerUids: Map<string, string> | null = null;

function loadLinkedOwnerUids(): Map<string, string> {
  if (linkedOwnerUids) return linkedOwnerUids;
  linkedOwnerUids = new Map<string, string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(OWNER_UIDS_FILE, 'utf8'));
    for (const owner of parsed?.owners || []) {
      if (owner?.uid) linkedOwnerUids.set(String(owner.uid), String(owner.email || ''));
    }
  } catch {
    /* no owner signed in from this host yet */
  }
  return linkedOwnerUids;
}

function linkOwnerUid(uid: string, email: string): void {
  const owners = loadLinkedOwnerUids();
  if (owners.has(uid)) return;
  owners.set(uid, email);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const persisted = [...owners.entries()].map(([ownerUid, ownerEmail]) => ({
      uid: ownerUid,
      email: ownerEmail,
      linkedAt: new Date().toISOString(),
    }));
    fs.writeFileSync(OWNER_UIDS_FILE, JSON.stringify({ version: 1, owners: persisted }), 'utf8');
    console.log(`[plans] Linked owner email ${email} to uid ${uid}`);
  } catch (err) {
    console.error('[plans] Could not remember the owner uid (access still works for this run):', err);
  }
}

export function isOwnerTenant(tenantId: string): boolean {
  if (!tenantId) return false;
  if (getOwnerUids().includes(tenantId)) return true;
  return loadLinkedOwnerUids().has(tenantId);
}

/**
 * Is this *verified* sign-in an owner? Either the uid is listed, or the email
 * from the token is. Prefer this over `isOwnerTenant(uid)` wherever a token has
 * just been verified, because it is the only version that can recognise an
 * owner listed by email.
 */
export function isOwnerIdentity(uid: string, email?: string | null): boolean {
  if (isOwnerTenant(uid)) return true;
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (!getOwnerEmails().includes(normalized)) return false;
  linkOwnerUid(uid, normalized);
  return true;
}

export function saveSubscription(sub: Omit<Subscription, 'updatedAt'>): Subscription {
  loadSubscriptions();
  const saved: Subscription = { ...sub, updatedAt: new Date().toISOString() };
  subs.set(sub.tenantId, saved);
  persist();
  return saved;
}

/** The one-time free trial is retired — replaced by the ₹99 Launch Offer. */
export function startTrial(
  _tenantId: string,
  _days: number = TRIAL_DAYS,
  lang: Lang = DEFAULT_LANG
): Subscription {
  loadSubscriptions();

  // Old rows keep their granted time (decideAccess still honours them); only
  // NEW trials are refused.
  throw new Error(M(lang, 'trial.retired'));
}

/**
 * Owner console: extend a subscription's current period by N days WITHOUT
 * touching its plan/status/row — the fix for "trial khatam ho gaya" that does
 * not require wiping the billing row (`resetSubscriptions`) or a re-purchase.
 * New end = max(now, currentPeriodEnd) + days, so extending early stacks on
 * the remaining time instead of cutting it short.
 */
export interface SubscriptionExtension {
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  previousEnd: string | null;
  newEnd: string;
  days: number;
}

export function extendSubscriptionDays(tenantId: string, days: number): SubscriptionExtension {
  loadSubscriptions();
  const id = String(tenantId || '').trim();
  const n = Math.round(Number(days));
  if (!id) throw new Error('A tenant id is required.');
  if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('Days must be between 1 and 90.');

  const existing = subs.get(id);
  if (!existing) throw new Error('This account has no billing row to extend.');
  if (existing.status === 'cancelled') throw new Error('A cancelled subscription cannot be extended.');
  if (!existing.currentPeriodEnd) {
    throw new Error('This subscription never expires — nothing to extend.');
  }

  const previousEnd = existing.currentPeriodEnd;
  const base = Math.max(Date.now(), new Date(previousEnd).getTime() || Date.now());
  const newEnd = new Date(base + n * 24 * 60 * 60 * 1000).toISOString();
  const saved = saveSubscription({ ...existing, currentPeriodEnd: newEnd });

  return { tenantId: id, planId: saved.planId, status: saved.status, previousEnd, newEnd, days: n };
}

/**
 * Activate the Free Plan for a tenant — the server-verified entitlement behind
 * `POST /api/plan/activate`.
 *
 * Design:
 *  - REuses `saveSubscription` (the one durable entitlement write path) with a
 *    real `free` plan row, `provider: 'manual'`, and NO expiry — an expiry
 *    would silently stop a bot that the customer believes is active forever.
 *  - Idempotent by contract: activating twice returns the SAME activation with
 *    `alreadyActive: true`, so a double-tapped button cannot create two rows.
 *  - Honest about the mixed cases: an existing trial is honoured as-is, and a
 *    `free` row can never DOWNGRADE or overwrite a paid plan.
 */
export interface FreePlanActivation {
  ok: boolean;
  alreadyActive: boolean;
  message: string;
  subscription: Subscription | null;
  limits: PlanLimits | null;
}

export function activateFreePlan(tenantId: string): FreePlanActivation {
  loadSubscriptions();
  const now = new Date().toISOString();
  const freePlan = getPlan('free')!;
  const existing = subs.get(tenantId);

  // Already on the free plan → idempotent success.
  if (existing?.planId === 'free' && (existing.status === 'active' || existing.status === 'trial')) {
    return {
      ok: true,
      alreadyActive: true,
      message: 'free-already-active',
      subscription: existing,
      limits: freePlan.limits,
    };
  }

  // A live paid plan is worth more — never take it away here.
  if (
    existing &&
    ['starter', 'growth', 'agency', 'launch99'].includes(existing.planId)
  ) {
    const paidStillActive =
      existing.status === 'active' ||
      (existing.status === 'cancelled' && existing.currentPeriodEnd && Date.parse(existing.currentPeriodEnd) > Date.now()) ||
      existing.status === 'trial';
    if (paidStillActive) {
      return {
        ok: true,
        alreadyActive: true,
        message: `plus-hi-plan-${existing.planId}`,
        subscription: existing,
        limits: getPlan(existing.planId)!.limits,
      };
    }
  }

  const saved = saveSubscription({
    tenantId,
    planId: 'free',
    status: 'active',
    startedAt: existing?.startedAt || now,
    // No currentPeriodEnd: the free plan never expires.
    provider: 'manual',
    trialUsedAt: existing?.trialUsedAt,
  });

  return { ok: true, alreadyActive: false, message: 'free-activated', subscription: saved, limits: freePlan.limits };
}

/** Grant/refresh a paid plan after a verified payment (or a webhook). */
export function activateSubscription(args: {
  tenantId: string;
  planId: string;
  paymentId?: string;
  orderId?: string;
  amountPaidInr?: number;
  months?: number;
  provider?: 'razorpay' | 'manual';
}): Subscription {
  loadSubscriptions();
  const plan = getPlan(args.planId);
  if (!plan) throw new Error(`Unknown plan: ${args.planId}`);

  const existing = subs.get(args.tenantId);
  const now = new Date();
  const months = args.months ?? 1;

  // Renewing early extends the paid period instead of throwing days away.
  const base =
    existing?.currentPeriodEnd && Date.parse(existing.currentPeriodEnd) > now.getTime()
      ? new Date(existing.currentPeriodEnd)
      : now;

  return saveSubscription({
    tenantId: args.tenantId,
    planId: plan.id,
    status: 'active',
    startedAt: existing?.startedAt || now.toISOString(),
    currentPeriodEnd: periodEndFromNow(months, base),
    provider: args.provider || 'razorpay',
    orderId: args.orderId || existing?.orderId,
    paymentId: args.paymentId || existing?.paymentId,
    amountPaidInr: args.amountPaidInr ?? existing?.amountPaidInr,
    trialUsedAt: existing?.trialUsedAt,
    cancelledAt: undefined,
  });
}

export function cancelSubscription(tenantId: string): Subscription | null {
  loadSubscriptions();
  const existing = subs.get(tenantId);
  if (!existing) return null;
  return saveSubscription({
    ...existing,
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  });
}

/**
 * Erase a tenant's billing record completely.
 *
 * `cancelSubscription` is not enough for a delete: a cancelled row still answers
 * "this account was a customer", still appears in `listSubscriptions()` and in
 * `/healthz` counts, and still carries the `trialUsedAt` that prevents a second
 * trial. The owner's permanent delete has to remove the row itself. Any order the
 * customer abandoned mid-checkout goes with it.
 */
export function deleteSubscriptionForTenant(tenantId: string): boolean {
  loadSubscriptions();
  const hadSubscription = subs.delete(tenantId);
  const hadPendingOrder = pendingOrders.delete(tenantId);
  if (hadSubscription || hadPendingOrder) persist();
  return hadSubscription;
}

/** One billing row a reset removed, described well enough for the audit trail. */
export interface ResetSubscriptionSnapshot {
  tenantId: string;
  planId: string;
  status: string;
  currentPeriodEnd: string | null;
  /** True when the account had already spent its one free trial. */
  trialUsed: boolean;
  amountPaidInr: number | null;
}

/**
 * Erase the billing rows of many tenants in one write.
 *
 * Why this exists beside `deleteSubscriptionForTenant`: the owner needs it for a
 * different reason than a delete, and that reason decides what must *not* happen.
 *
 * A trial that has run out keeps both its row and its `trialUsedAt`. The row is
 * what keeps the account locked: `decideAccess` only lets an account through
 * without a plan when there is no row at all (`billing not enabled yet`), so on a
 * deployment with payments switched off a used-up trial still blocks its bot and
 * still shows "renew it" on the dashboard. There is no route that leaves the
 * account alone and clears that row — the only removal button was the permanent
 * delete, which also erases the connection, the inbox and the knowledge base and
 * writes a tombstone that refuses every future trial.
 *
 * This function is that missing step and nothing more: it removes billing state
 * (the subscription row and any abandoned checkout) and touches nothing else. No
 * tombstone is written, so the account keeps its data **and** can start a fresh
 * trial — which is exactly what "let these accounts begin again" means.
 */
export function resetSubscriptions(tenantIds: string[]): ResetSubscriptionSnapshot[] {
  loadSubscriptions();
  const removed: ResetSubscriptionSnapshot[] = [];
  let changed = false;

  tenantIds.forEach((tenantId) => {
    // An abandoned checkout leaves no subscription row, only a pending order —
    // still billing state, and still this account's to start over from.
    if (pendingOrders.delete(tenantId)) changed = true;

    const existing = subs.get(tenantId);
    if (!existing) return;

    subs.delete(tenantId);
    changed = true;
    removed.push({
      tenantId,
      planId: existing.planId,
      status: existing.status,
      currentPeriodEnd: existing.currentPeriodEnd ?? null,
      trialUsed: Boolean(existing.trialUsedAt),
      amountPaidInr: existing.amountPaidInr ?? null,
    });
  });

  if (changed) persist();
  return removed;
}

/** Remember the order a tenant just opened, so a stuck payment can be re-checked. */
export function rememberPendingOrder(tenantId: string, orderId: string, planId: string) {
  loadSubscriptions();
  pendingOrders.set(tenantId, { orderId, planId, createdAt: new Date().toISOString() });
  persist();
}

export function getPendingOrder(tenantId: string): PendingOrder | null {
  loadSubscriptions();
  return pendingOrders.get(tenantId) || null;
}

export function clearPendingOrder(tenantId: string) {
  loadSubscriptions();
  if (pendingOrders.delete(tenantId)) persist();
}

/** Raw record, or null when the tenant has never had a plan. */
export function findSubscription(tenantId: string): Subscription | null {
  loadSubscriptions();
  return subs.get(tenantId) || null;
}

/**
 * Every subscription, newest first — the owner console's view of who is paying.
 * Tenant data in general is per-account, so nothing else in the app lists rows
 * across tenants; this exists for the owner-only overview (see opsOverview.ts).
 */
export function listSubscriptions(): Subscription[] {
  loadSubscriptions();
  return [...subs.values()].sort(
    (a, b) => Date.parse(b.updatedAt || b.startedAt) - Date.parse(a.updatedAt || a.startedAt)
  );
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  /** True when billing is live and this tenant has no valid plan. */
  needsPlan: boolean;
  /**
   * True when the switch is off because the operator flipped it, not because of
   * billing. The dashboard and the Ops Console both need to tell those apart: a
   * paying customer must never be told to "buy a plan" on a paused account.
   */
  paused?: boolean;
  /** 'tenant' = this account was switched off, 'global' = the brake, 'default'. */
  pausedSource?: 'tenant' | 'global';
}

/**
 * Can this tenant's bot be active?
 *
 * Careful by design: while payments are not configured (no Razorpay keys on the
 * host) this returns allowed — otherwise turning on billing would silently stop
 * bots that were already working. Once payments go live, only a valid plan (or
 * an owner tenant) is allowed.
 */
export function decideAccess(
  tenantId: string,
  opts: { paymentsConfigured: boolean; lang?: Lang }
): AccessDecision {
  // Access reasons are rendered by the dashboard, so they follow the language
  // the request came in with rather than staying Hinglish for an English user.
  const lang = opts.lang || DEFAULT_LANG;

  // The owner's switch is checked before every other rule, owner tenants included:
  // "pause all bots" has to stop the operator's own account too, or the emergency
  // brake would leave one bot happily running. See botControlStore.ts.
  const switchState = isBotEnabled(tenantId);
  if (!switchState.enabled) {
    return {
      allowed: false,
      reason: M(lang, 'access.paused'),
      needsPlan: false,
      paused: true,
      pausedSource: switchState.source === 'global' ? 'global' : 'tenant',
    };
  }

  if (isOwnerTenant(tenantId)) {
    return { allowed: true, reason: 'owner tenant', needsPlan: false, paused: false };
  }

  // A comped account keeps working with no plan and no trial left. Checked
  // before the subscription lookup so it survives an expired trial.
  if (isCompedTenant(tenantId)) {
    return { allowed: true, reason: 'comped account', needsPlan: false, paused: false };
  }

  const sub = findSubscription(tenantId);

  if (!sub) {
    if (!opts.paymentsConfigured) {
      return { allowed: true, reason: 'billing not enabled yet', needsPlan: false };
    }
    return { allowed: false, reason: 'no plan selected', needsPlan: true };
  }

  if (sub.planId === 'owner') {
    return { allowed: true, reason: 'owner plan', needsPlan: false };
  }

  if (sub.status === 'cancelled') {
    // Cancelled keeps working until the period they already paid for ends.
    const end = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : 0;
    if (end > Date.now()) {
      return { allowed: true, reason: 'cancelled, paid period still active', needsPlan: false };
    }
    return { allowed: false, reason: 'subscription cancelled', needsPlan: true };
  }

  // The dashboard renders this string to the customer, so it says which plan is
  // running and how long is left rather than leaking the internal status field.
  const planName = getPlan(sub.planId)?.name || sub.planId;
  const expiresAt = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : 0;

  if (expiresAt && expiresAt <= Date.now()) {
    return { allowed: false, reason: M(lang, 'access.expired', { plan: planName }), needsPlan: true };
  }

  if (sub.status === 'trial') {
    const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
    return {
      allowed: true,
      reason: M(lang, 'access.trial', { days: daysLeft }),
      needsPlan: false,
    };
  }

  // Allow-list rather than deny-list: only a genuinely `active` row opens the
  // bot. `past_due` (or any status added later) must not, or a half-finished
  // payment could end up granting a plan.
  if (sub.status !== 'active') {
    return { allowed: false, reason: M(lang, 'access.pending', { plan: planName }), needsPlan: true };
  }

  return { allowed: true, reason: M(lang, 'access.active', { plan: planName }), needsPlan: false };
}

export function getSubscriptionStats() {
  loadSubscriptions();
  let active = 0;
  let trialing = 0;
  subs.forEach((sub) => {
    if (sub.status === 'active') active += 1;
    if (sub.status === 'trial') trialing += 1;
  });
  return {
    total: subs.size,
    active,
    trialing,
    pendingOrders: pendingOrders.size,
    file: SUBS_FILE,
    ownerTenants: getOwnerTenantIds().length,
  };
}
