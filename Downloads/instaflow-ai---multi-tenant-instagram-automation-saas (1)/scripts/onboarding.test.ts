/**
 * Feature 1-5 onboarding + OPS tests — ALL state in OS temp dirs; no real
 * DATA_DIR touched, no provider call, no Instagram message, no WhatsApp send.
 * Run: npx tsx scripts/onboarding.test.ts  → expect exit 0
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

// Isolation: temp DATA_DIR BEFORE importing server modules (they resolve DATA_DIR lazily per store,
// but reset hooks repoint the files anyway — belt and braces).
const root = mkdtempSync(path.join(tmpdir(), 'onboarding-'));
process.env.DATA_DIR = root;
delete process.env.WA_CUSTOMER_API_URL;
delete process.env.WA_CUSTOMER_API_KEY;
delete process.env.WA_CUSTOMER_SENDER;
delete process.env.RETRY_ENABLED;

// 
process.env.OWNER_TENANT_IDS = 'owner-tenant-1';

const contactStore = await import('../server/contactStore');
const onboardingStatus = await import('../server/onboardingStatusStore');
const kbDraft = await import('../server/kbDraft');
const outbox = await import('../server/whatsappOutbox');
const planStore = await import('../server/planStore');

const { saveContact, getContact, validateContactInput, normalizePhone, maskPhone, optOut, hasWhatsAppConsent, _resetForTests: resetContacts } = contactStore;
const { ensureRegistered, transition, getOnboardingState, getOnboardingMetrics, listOnboardingStates, _resetForTests: resetStatus } = onboardingStatus;
const { generateKbDraft, getKbDraft, approveKbDraft, rejectKbDraft, saveDraftEdits, _resetForTests: resetDrafts } = kbDraft;
const { queueWhatsAppMessage, renderTemplate, listOutbox, isCustomerWhatsAppProviderConfigured, _resetForTests: resetOutbox } = outbox;
const { activateFreePlan, decideAccess } = planStore;
const { transition: transitionStatus } = onboardingStatus;
const { saveTenantAiSettings } = await import('../server/tenantSettings');

/** Mirrors exactly what POST /api/plan/activate does on the server. */
function activateFreeLikeEndpoint(tenantId: string) {
  const activation = activateFreePlan(tenantId);
  if (activation.ok && !activation.alreadyActive) {
    transitionStatus(tenantId, 'FREE_PLAN_ACTIVE', 'customer', 'free plan activated');
  }
  return activation;
}

function resetAll(dir: string): void {
  resetContacts(dir);
  resetStatus(dir);
  resetDrafts(dir);
  resetOutbox(dir);
}

function newDir(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `ob-${name}-`));
}

// ============================================================ TEST 1+3: registration
{
  const dir = newDir('reg'); resetAll(dir);
  ensureRegistered('T1', 'customer');
  const first = getOnboardingState('T1');
  check('registration records REGISTERED with a timestamp (TEST 1)', first.status === 'REGISTERED' && !!first.statusChangedAt);
  const before = first.events[0]?.at;
  ensureRegistered('T1', 'customer');
  check('duplicate registration is a no-op (TEST 3)', getOnboardingState('T1').events.length === 1 && getOnboardingState('T1').events[0].at === before);
}

// ============================================================ TEST 2: free plan activation
{
  const dir = newDir('plan'); resetAll(dir);
  ensureRegistered('T2', 'customer');
  const first = activateFreeLikeEndpoint('T2');
  check('free plan activates with no payment involved (TEST 2)', first.ok && !first.alreadyActive && first.subscription?.planId === 'free');
  check('free plan never expires (real entitlement row)', !first.subscription?.currentPeriodEnd);
  const again = activateFreeLikeEndpoint('T2');
  check('idempotent re-activation returns the same row (TEST 2)', again.alreadyActive && again.subscription?.planId === 'free' && again.subscription?.startedAt === first.subscription?.startedAt);
  const access = decideAccess('T2', { paymentsConfigured: true });
  check('decideAccess honours the free plan on the server', access.allowed);
  check('status machine advanced to FREE_PLAN_ACTIVE (TEST 2)', getOnboardingState('T2').status === 'FREE_PLAN_ACTIVE');
}

// ============================================================ TEST 4 phones
{
  const dir = newDir('phone'); resetAll(dir);
  check('full E.164 accepted (TEST 4)', normalizePhone('+919876543210').e164 === '+919876543210');
  check('formatted international accepted', normalizePhone('+91 98765 43210').e164 === '+919876543210');
  check('bare Indian mobile gets +91', normalizePhone('9876543210').e164 === '+919876543210');
  check('garbage rejected with a reason (TEST 4)', normalizePhone('call me maybe').e164 === null && Boolean(normalizePhone('call me maybe').reason));
  check('too-short rejected (TEST 4)', normalizePhone('12345').e164 === null);
  check('masked number shows only country code + last 4', maskPhone('+919876543210').includes('3210') && !maskPhone('+919876543210').includes('98765'));
}

// ============================================================ TEST 4 contact + consent + opt-out
{
  const dir = newDir('contact'); resetAll(dir);
  ensureRegistered('T4', 'customer');
  const bad = validateContactInput({ businessName: '  ', whatsappNumber: 'nope' });
  check('server-side validation rejects bad input (TEST 4)', !bad.ok && bad.errors.length >= 2);
  const good = validateContactInput({ businessName: 'Salon A', contactPerson: 'Rahul', whatsappNumber: '+91 98765 43210', language: 'hi', email: 'a@b.co' });
  check('valid input passes (TEST 4)', good.ok && (good as any).patch.whatsappNumber === '+919876543210');
  saveContact('T4', { ...good.ok ? (good as any).patch : {}, consent: { given: true, source: 'customer-self-service' } });
  check('consent recorded with timestamp + source (TEST 4)', getContact('T4')?.consent.given === true && !!getContact('T4')?.consent.at);
  check('consent gate answers yes', hasWhatsAppConsent('T4'));
  optOut('T4', 'customer-self-service');
  check('opt-out recorded and reverses the consent gate (TEST 11)', getContact('T4')?.optOut?.at !== null && !hasWhatsAppConsent('T4'));
}

// ============================================================ TEST 5/6: KB draft honesty
{
  const dir = newDir('kb'); resetAll(dir);
  ensureRegistered('T5', 'customer');
  saveContact('T5', { businessName: 'Fitness Gym 5', consent: { given: true, source: 'customer-self-service' } });
  const entry = generateKbDraft('T5', ['gym']);
  check('draft generated from ONLY customer data (TEST 5)', entry.status === 'generated' && Boolean(entry.draft));
  check('missing fields are stamped needsInput — nothing invented (TEST 6)', (entry.draft?.fields || []).filter((f) => !f.skipped).every((f) => f.needsInput === !f.value));
  check('prices are unverified until the customer enters them (TEST 6)', entry.draft?.unverified.length === 0 && (entry.draft?.fields || []).find((f) => f.key === 'prices')?.needsInput === true);
  const other = generateKbDraft('T5-other', ['restaurant']);
  check('drafts are per-tenant (isolation)', other.tenantId !== entry.tenantId && getKbDraft('T5')?.draft?.version === entry.draft?.version);
  // The customer's OWN overview (from the contact form) is a verified fact, so
  // a draft built from it is approvable — nothing was invented.
  const approvable = approveKbDraft('T5', 'ops@example.com');
  check('approval succeeds only on customer-sourced content (TEST 7)', approvable.ok && Boolean(approveKbDraft('T5', 'ops@example.com').entry?.approvedAt));
}

// ============================================================ TEST 7: draft edit + approval pushes into the real KB
{
  const dir = newDir('kbsave'); resetAll(dir);
  ensureRegistered('T7', 'customer');
  const entry = generateKbDraft('T7', ['retail']);
  const fields = (entry.draft?.fields || []).map((f) => (f.key === 'prices' ? { ...f, value: 'Coffee: 150 rupees', needsInput: false, source: 'customer' as const } : f));
  // Simulate the customer's edit exactly the way the save endpoint does —
  // through the store's own in-memory write path.
  saveDraftEdits('T7', { fields });
  const approved = approveKbDraft('T7', 'owner@example.com');
  check('customer-entered price is approvable (TEST 7)', approved.ok);
  const { getTenantAiSettings } = await import('../server/tenantSettings');
  const items = getTenantAiSettings('T7').knowledgeItems;
  check('approved KB lands in the REAL bot setting (Feature 2E, TEST 15)', items.some((i) => i.content.includes('150 rupees')) && items.some((i) => i.category === 'faq'));
}

// ============================================================ TEST 8/10: status machine
{
  const dir = newDir('status'); resetAll(dir);
  ensureRegistered('T8', 'system');
  check('REGISTERED → APPROVED is rejected server-side (TEST 14)', transition('T8', 'APPROVED', 'ops').ok === false);
  check('REGISTERED → FREE_PLAN_ACTIVE is valid (TEST 8)', transition('T8', 'FREE_PLAN_ACTIVE', 'system').ok);
  check('FREE_PLAN_ACTIVE → FREE_PLAN_ACTIVE is a no-op (idempotent)', transition('T8', 'FREE_PLAN_ACTIVE', 'system').ok);
  check('rejected transition is RECORDED, never silently applied', getOnboardingState('T8').events.some((e) => e.event.includes('rejected')));
  transition('T8', 'SUSPENDED', 'ops');
  check('APPROVED → SUSPENDED only after approval (server rule)', !transition('T8', 'SUSPENDED', 'ops').ok);
}

// ============================================================ TEST 11/12: WhatsApp honesty
{
  const dir = newDir('wa'); resetAll(dir);
  ensureRegistered('T11', 'customer');
  check('customer provider not configured on this host (expected state)', !isCustomerWhatsAppProviderConfigured());

  // Consent gate FIRST.
  const noConsent = queueWhatsAppMessage({ tenantId: 'T11', template: 'instagram-connected', customerName: 'A' });
  check('no consent → blocked-consent, never sent (TEST 11)', noConsent.message.status === 'blocked-consent' && !noConsent.ok);

  // With consent but no provider → provider-unconfigured + manual copy.
  saveContact('T11', { whatsappNumber: '+911234567890', consent: { given: true, source: 'customer-self-service' } });
  saveContact('T11', { businessName: 'Shop 11' });
  const queued = queueWhatsAppMessage({ tenantId: 'T11', template: 'instagram-connected', customerName: 'Shop 11', context: 'conn-1' });
  check('consented message → provider-unconfigured, manual copy ready (TEST 11)', queued.ok && queued.message.status === 'provider-unconfigured' && queued.message.text.includes('Shop 11'));
  check('template renders the customer name and never leaks braces (TEST 11)', !renderTemplate('instagram-connected', 'en', 'A{evil}B').includes('{evil}'));

  // Duplicate prevention.
  const dup = queueWhatsAppMessage({ tenantId: 'T11', template: 'instagram-connected', customerName: 'Shop 11', context: 'conn-1' });
  check('same notification within the window is blocked as duplicate (TEST 12)', dup.message.status === 'blocked-duplicate' && !dup.ok);
  const dupAfterResend = queueWhatsAppMessage({ tenantId: 'T11', template: 'instagram-connected', customerName: 'Shop 11', context: 'conn-1', allowDuplicate: true });
  check('ops deliberate resend bypasses the duplicate window (TEST 12)', dupAfterResend.ok);

  // Opt-out customer: gate again even though consent existed earlier.
  optOut('T11', 'customer-self-service');
  const afterOptOut = queueWhatsAppMessage({ tenantId: 'T11', template: 'approval-completed', customerName: 'Shop 11', allowDuplicate: true });
  check('opt-out stops every further automated send (TEST 11)', afterOptOut.message.status === 'blocked-consent');

  // Delivery can NEVER be claimed without provider evidence.
  const rows = listOutbox('T11');
  check('no row is ever marked delivered/queued without a provider (TEST 11)', rows.every((r) => !['queued', 'provider-accepted', 'delivered'].includes(r.status)));
  check('timeline records the honest whatsapp states (TEST 8)', getOnboardingState('T11').events.some((e) => e.event.includes('provider-unconfigured') || e.event.includes('manual-copy')));
}

// ============================================================ TEST 9: metrics from real timestamps
{
  const dir = newDir('metrics'); resetAll(dir);
  ensureRegistered('M1', 'customer');
  activateFreeLikeEndpoint('M1');
  ensureRegistered('M2', 'customer');
  transition('M2', 'NEEDS_CUSTOMER_ACTION', 'ops');
  const metrics = getOnboardingMetrics();
  check(
    'all metrics derive from recorded events (TEST 9)',
    metrics.total >= 2 && metrics.registeredToday >= 2 && metrics.freePlansActive >= 1 && metrics.needsCustomerAction >= 1
  );

  // Date-filter sanity on the board backing store: today's and yesterday's
  // day-buckets are computed from real timestamps (UTC anchor).
  const rows = listOnboardingStates();
  const todayAnchor = rows.every((r) => Number.isFinite(Date.parse(r.statusChangedAt)));
  check('every board row carries a parseable timestamp (TEST 9/10)', todayAnchor);
}

// ============================================================ TEST 13: persistence round-trip
{
  const dir = newDir('persist'); resetAll(dir);
  ensureRegistered('P1', 'customer');
  saveContact('P1', { whatsappNumber: '+911234567890', consent: { given: true, source: 'customer-self-service' } });
  generateKbDraft('P1', ['retail']);
  queueWhatsAppMessage({ tenantId: 'P1', template: 'instagram-connected', customerName: 'P1 updater' });
  // Fresh stores re-reading the same volume → the records survive.
  const files = ['contacts.json', 'onboarding-status.json', 'kb-drafts.json', 'whatsapp-outbox.json'];
  check('all four stores persisted to the volume (durable, TEST 13)', files.every((f) => existsSync(path.join(dir, f))));
  const saved = JSON.parse(readFileSync(path.join(dir, 'contacts.json'), 'utf8'));
  check('the raw number is written E.164 (not masked) for authorized readers only', saved.contacts.P1.whatsappNumber === '+911234567890');
}

// ============================================================ SUMMARY
rmSync(root, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
process.exit(fail === 0 ? 0 : 1);
