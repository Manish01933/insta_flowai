/**
 * Instagram tester invitation workflow tests.
 *
 * All state in OS temp dirs; no real DATA_DIR touched, no provider call,
 * no Instagram message, no WhatsApp send. Run:
 *   npx tsx scripts/testerInvite.test.ts   → expect exit 0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

function okRequest<T extends { ok: boolean; request?: any }>(r: T): any {
  if (!r.ok) throw new Error('expected ok result');
  return r.request;
}

// ── Isolation: point DATA_DIR at a temp dir BEFORE the store loads ──
const dir = mkdtempSync(path.join(tmpdir(), 'tester-invite-'));
process.env.DATA_DIR = dir;

const {
  submitTesterRequest,
  getTesterRequest,
  setTesterRequestStatus,
  setTesterRequestInvitation,
  listTesterRequests,
  getTesterRequestStats,
  normaliseInstagramUsername,
  isValidInstagramUsername,
  validateInvitationUrl,
  recordTesterAccountAdded,
  recordTesterAcceptance,
  recordCustomerConfirmation,
  recordTesterNotification,
  _resetForTests,
} = await import('../server/testerRequestStore');

// ============================================================ NORMALISATION
check('normalises @handle to bare handle', normaliseInstagramUsername('@thenutritionhut') === 'thenutritionhut');
check('normalises instagram.com URL to handle', normaliseInstagramUsername('https://www.instagram.com/thenutritionhut/?igsh=abc') === 'thenutritionhut');
check('rejects empty handle', !isValidInstagramUsername(''));
check('rejects handle longer than 30 chars', !isValidInstagramUsername('a'.repeat(31)));
check('accepts valid handle', isValidInstagramUsername('my_brand.name') === true);

// ============================================================ REQUEST CREATION
_resetForTests();
const r1 = submitTesterRequest('tenant-a', '@thenutritionhut');
check('submitTesterRequest returns ok', r1.ok === true);
const rr1 = okRequest(r1);
check('status is REQUESTED after submit', rr1.status === 'REQUESTED');
check('username normalised', rr1.username === 'thenutritionhut');
check('requestedAt set', typeof rr1.requestedAt === 'string' && rr1.requestedAt.length > 0);
check('updatedAt set', typeof rr1.updatedAt === 'string' && rr1.updatedAt.length > 0);

const r1Again = getTesterRequest('tenant-a');
check('getTesterRequest returns same request', r1Again?.status === 'REQUESTED');
check('getTesterRequest returns username', r1Again?.username === 'thenutritionhut');

// Different handle for same tenant resets to REQUESTED
const r2 = submitTesterRequest('tenant-a', '@differenthandle');
check('different handle resets status to REQUESTED', okRequest(r2).status === 'REQUESTED');
check('different handle updates username', okRequest(r2).username === 'differenthandle');

// Same handle again is idempotent
const r3 = submitTesterRequest('tenant-a', '@differenthandle');
check('same handle is idempotent', okRequest(r3).status === 'REQUESTED' && okRequest(r3).username === 'differenthandle');

// ============================================================ TENANT ISOLATION
_resetForTests();
submitTesterRequest('tenant-a', '@usera');
submitTesterRequest('tenant-b', '@userb');
const reqA = getTesterRequest('tenant-a');
const reqB = getTesterRequest('tenant-b');
check('tenant A sees own request', reqA?.username === 'usera');
check('tenant B sees own request', reqB?.username === 'userb');
check('tenant A does not see tenant B', reqA?.tenantId === 'tenant-a');
check('tenant B does not see tenant A', reqB?.tenantId === 'tenant-b');

// ============================================================ STATUS TRANSITIONS
_resetForTests();
submitTesterRequest('tenant-x', '@userx');

// REQUESTED → READY_TO_INVITE is allowed
const t1 = setTesterRequestStatus('tenant-x', 'READY_TO_INVITE', 'identity confirmed');
check('REQUESTED → READY_TO_INVITE allowed', t1?.status === 'READY_TO_INVITE');
check('audit log recorded', Array.isArray(t1?.auditLog) && t1.auditLog.length > 0);

// REQUESTED → INVITATION_SENT is NOT allowed (skip step)
const t2 = setTesterRequestStatus('tenant-x', 'INVITATION_SENT');
check('REQUESTED → INVITATION_SENT rejected', t2 === null);

// READY_TO_INVITE → INVITATION_SENT requires setTesterRequestInvitation first
const t3 = setTesterRequestStatus('tenant-x', 'INVITATION_SENT');
check('READY_TO_INVITE → INVITATION_SENT rejected without URL', t3 === null);

// The Meta-dashboard step is the prerequisite for sending at all.
check(
  'send refused before the Meta step is recorded',
  setTesterRequestInvitation('tenant-x', 'https://business.facebook.com/invite/abc123', '1234567890') === null
);
const added = recordTesterAccountAdded('tenant-x', 'owner@example.com', 'userx');
check('account added recorded', added.ok === true && added.request.accountAddedAt !== undefined);
check('account added keeps who recorded it', added.ok === true && added.request.accountAddedBy === 'owner@example.com');
check(
  'account added rejects a mismatched handle',
  recordTesterAccountAdded('tenant-x', 'owner@example.com', 'someoneelse').ok === false
);

// Record invitation URL — this also advances status to INVITATION_SENT
const invited = setTesterRequestInvitation('tenant-x', 'https://business.facebook.com/invite/abc123', '1234567890');
check('setTesterRequestInvitation advances to INVITATION_SENT', invited?.status === 'INVITATION_SENT');
check('invitationUrl recorded', invited?.invitationUrl === 'https://business.facebook.com/invite/abc123');
check('metaAppId recorded', invited?.metaAppId === '1234567890');
check('invitedAt set', typeof invited?.invitedAt === 'string');
check('invitationUrl preserved', invited?.invitationUrl === 'https://business.facebook.com/invite/abc123');

// setTesterRequestStatus cannot set INVITATION_SENT directly from READY_TO_INVITE anymore
const t4b = setTesterRequestStatus('tenant-x', 'INVITATION_SENT');
check('INVITATION_SENT → INVITATION_SENT rejected (no-op)', t4b === null);

// INVITATION_SENT → ACCEPTANCE_PENDING
const t5 = setTesterRequestStatus('tenant-x', 'ACCEPTANCE_PENDING');
check('INVITATION_SENT → ACCEPTANCE_PENDING allowed', t5?.status === 'ACCEPTANCE_PENDING');

// ACCEPTANCE_PENDING → ACCEPTED goes through the acceptance route, which always
// records who confirmed it and marks it unverified (no Meta signal exists).
const t6 = recordTesterAcceptance('tenant-x', 'owner', 'owner@example.com');
check('ACCEPTANCE_PENDING → ACCEPTED allowed', t6.ok === true && t6.request.status === 'ACCEPTED');
check('acceptedAt set', t6.ok === true && typeof t6.request.acceptedAt === 'string');
check('acceptance recorded as unverified', t6.ok === true && t6.request.acceptanceVerified === false);
check('acceptance records who confirmed it', t6.ok === true && t6.request.acceptedBy === 'owner');

// The owner's Reopen: an accepted invite can go back to the start of the queue
// (accepted on the wrong account/app), which is what the Ops Reopen button sends.
const t7 = setTesterRequestStatus('tenant-x', 'REQUESTED', 'reopened — wrong app');
check('ACCEPTED → REQUESTED allowed (reopen)', t7?.status === 'REQUESTED');
check('reopen clears invitationUrl', t7?.invitationUrl === undefined);
check('reopen clears metaAppId', t7?.metaAppId === undefined);
check('reopen clears invitedAt', t7?.invitedAt === undefined);
check('reopen clears acceptedAt', t7?.acceptedAt === undefined);
check('reopen clears the acceptance evidence', t7?.acceptanceVerified === undefined && t7?.acceptedBy === undefined);
check('reopen keeps the handle', t7?.username === 'userx');
check('reopen keeps acceptedAt out of the audit gap', Array.isArray(t7?.auditLog) && t7.auditLog.length > 0);

// Same reopen from INVITATION_SENT / ACCEPTANCE_PENDING — the states the queue
// shows the Reopen button in.
const reopenFromSent = (() => {
  _resetForTests();
  submitTesterRequest('tenant-s', '@users');
  setTesterRequestStatus('tenant-s', 'READY_TO_INVITE');
  recordTesterAccountAdded('tenant-s', 'owner@example.com');
  setTesterRequestInvitation('tenant-s', 'https://business.facebook.com/invite/s', 'app-s');
  return setTesterRequestStatus('tenant-s', 'REQUESTED');
})();
check('INVITATION_SENT → REQUESTED allowed (reopen)', reopenFromSent?.status === 'REQUESTED');
check('reopen from sent clears the old URL', reopenFromSent?.invitationUrl === undefined);

const reopenFromPending = (() => {
  _resetForTests();
  submitTesterRequest('tenant-p', '@userp');
  setTesterRequestStatus('tenant-p', 'READY_TO_INVITE');
  recordTesterAccountAdded('tenant-p', 'owner@example.com');
  setTesterRequestInvitation('tenant-p', 'https://business.facebook.com/invite/p', 'app-p');
  setTesterRequestStatus('tenant-p', 'ACCEPTANCE_PENDING');
  return setTesterRequestStatus('tenant-p', 'REQUESTED');
})();
check('ACCEPTANCE_PENDING → REQUESTED allowed (reopen)', reopenFromPending?.status === 'REQUESTED');

// Reopening still cannot skip the invite step: REQUESTED must go through
// READY_TO_INVITE + a recorded URL before it can be INVITATION_SENT again.
const afterReopen = setTesterRequestStatus('tenant-p', 'INVITATION_SENT');
check('reopened row cannot jump to INVITATION_SENT', afterReopen === null);

// ============================================================ LIST + STATS
_resetForTests();
submitTesterRequest('t1', '@a');
submitTesterRequest('t2', '@b');
submitTesterRequest('t3', '@c');
setTesterRequestStatus('t2', 'READY_TO_INVITE');
recordTesterAccountAdded('t2', 'owner@example.com');
setTesterRequestInvitation('t2', 'https://business.facebook.com/invite/t2', 'app2');
setTesterRequestStatus('t3', 'READY_TO_INVITE');
recordTesterAccountAdded('t3', 'owner@example.com');
setTesterRequestInvitation('t3', 'https://business.facebook.com/invite/t3', 'app3');
setTesterRequestStatus('t3', 'ACCEPTANCE_PENDING');
recordTesterAcceptance('t3', 'owner', 'owner@example.com');

const list = listTesterRequests();
check('list returns all 3', list.length === 3);
// REQUESTED first, then others newest first
check('pending (REQUESTED) first', list[0].status === 'REQUESTED');

const stats = getTesterRequestStats();
check('stats total 3', stats.total === 3);
check('stats pending 1', stats.pending === 1);

// ============================================================ EXPIRED / FAILED / CANCELLED CAN RE-REQUEST
_resetForTests();
submitTesterRequest('tenant-r', '@userr');
setTesterRequestStatus('tenant-r', 'EXPIRED');
const re1 = setTesterRequestStatus('tenant-r', 'REQUESTED');
check('EXPIRED → REQUESTED allowed', re1?.status === 'REQUESTED');

_resetForTests();
submitTesterRequest('tenant-f', '@userf');
setTesterRequestStatus('tenant-f', 'FAILED');
const re2 = setTesterRequestStatus('tenant-f', 'REQUESTED');
check('FAILED → REQUESTED allowed', re2?.status === 'REQUESTED');

_resetForTests();
submitTesterRequest('tenant-c', '@userc');
setTesterRequestStatus('tenant-c', 'CANCELLED');
const re3 = setTesterRequestStatus('tenant-c', 'REQUESTED');
check('CANCELLED → REQUESTED allowed', re3?.status === 'REQUESTED');

// ============================================================ NEEDS_IDENTITY_CONFIRMATION
_resetForTests();
submitTesterRequest('tenant-i', '@useri');
setTesterRequestStatus('tenant-i', 'NEEDS_IDENTITY_CONFIRMATION', 'handle unclear');
const ti = getTesterRequest('tenant-i');
check('NEEDS_IDENTITY_CONFIRMATION stored', ti?.status === 'NEEDS_IDENTITY_CONFIRMATION');
check('note preserved', ti?.note === 'handle unclear');

// ============================================================ URL SAFETY
// The portal renders the stored string as a clickable button, so this is an
// allowlist, not a formatting check.
check('accepts a business.facebook.com link', validateInvitationUrl('https://business.facebook.com/invite/abc').ok === true);
check('accepts an instagram.com link', validateInvitationUrl('https://www.instagram.com/accounts/invite/').ok === true);
check('rejects http://', validateInvitationUrl('http://business.facebook.com/invite/abc').ok === false);
check('rejects javascript:', validateInvitationUrl('javascript:alert(1)').ok === false);
check('rejects a non-Meta host', validateInvitationUrl('https://evil.example.com/invite/abc').ok === false);
check('rejects the empty string', validateInvitationUrl('').ok === false);
check('rejects free text', validateInvitationUrl('business.facebook.com/invite/abc').ok === false);
check(
  'normalises an accepted link without changing its host',
  (() => {
    const result = validateInvitationUrl('https://business.facebook.com/invite/abc?x=1');
    return result.ok === true && result.url.startsWith('https://business.facebook.com/invite/abc?x=1');
  })()
);

// ============================================================ SEND GUARDS + NOTIFY + ACCEPTANCE
_resetForTests();
submitTesterRequest('tenant-g', '@userg');
setTesterRequestStatus('tenant-g', 'READY_TO_INVITE');
recordTesterAccountAdded('tenant-g', 'owner@example.com');

// An invalid link is refused even after everything else is in place.
check(
  'store refuses a non-Meta invitation URL',
  setTesterRequestInvitation('tenant-g', 'https://evil.example.com/x', 'app-g') === null
);

const sent = setTesterRequestInvitation('tenant-g', 'https://business.facebook.com/invite/g', 'app-g', undefined, 'owner@example.com');
check('valid invitation recorded', sent?.status === 'INVITATION_SENT');
check('invitation audit keeps the actor', sent?.auditLog?.some((e) => e.action === 'invitation_sent' && e.by === 'owner@example.com') === true);

// Duplicate send is refused: the row is already INVITATION_SENT.
check(
  'duplicate invitation refused',
  setTesterRequestInvitation('tenant-g', 'https://business.facebook.com/invite/g2', 'app-g') === null
);

// Notify result is stored as reported, never upgraded to "delivered".
const notified = recordTesterNotification('tenant-g', {
  status: 'provider-unconfigured',
  at: new Date().toISOString(),
  reason: 'WhatsApp provider not configured.',
  toMasked: '+91 ******1234',
});
check('notify result stored', notified?.notify?.status === 'provider-unconfigured');
check('notify reason stored', notified?.notify?.reason === 'WhatsApp provider not configured.');
check('notify is not relabelled delivered', notified?.notify?.status !== 'delivered');

// The customer's own confirmation moves to ACCEPTANCE_PENDING, not ACCEPTED.
const customerConfirm = recordCustomerConfirmation('tenant-g');
check('customer confirmation → ACCEPTANCE_PENDING', customerConfirm.ok === true && customerConfirm.request.status === 'ACCEPTANCE_PENDING');
check(
  'customer confirmation is audited as customer',
  customerConfirm.ok === true && customerConfirm.request.auditLog?.some((e) => e.action === 'customer_confirmed_accept' && e.by === 'customer') === true
);
check(
  'customer cannot confirm twice',
  recordCustomerConfirmation('tenant-g').ok === false
);

// Acceptance is only recordable from INVITATION_SENT / ACCEPTANCE_PENDING.
const acceptedG = recordTesterAcceptance('tenant-g', 'owner', 'owner@example.com', { note: 'checked in Meta dashboard' });
check('owner records acceptance', acceptedG.ok === true && acceptedG.request.status === 'ACCEPTED');
check('owner acceptance is unverified', acceptedG.ok === true && acceptedG.request.acceptanceVerified === false);
check(
  'acceptance cannot be recorded on a REQUESTED row',
  (() => {
    _resetForTests();
    submitTesterRequest('tenant-q', '@userq');
    return recordTesterAcceptance('tenant-q', 'owner', 'owner@example.com').ok === false;
  })()
);

// A bare status flip can no longer claim ACCEPTED.
check(
  'generic status route cannot set ACCEPTED',
  (() => {
    _resetForTests();
    submitTesterRequest('tenant-z', '@userz');
    setTesterRequestStatus('tenant-z', 'READY_TO_INVITE');
    recordTesterAccountAdded('tenant-z', 'owner@example.com');
    setTesterRequestInvitation('tenant-z', 'https://business.facebook.com/invite/z', 'app-z');
    return setTesterRequestStatus('tenant-z', 'ACCEPTED') === null;
  })()
);

// Reopen clears the delivery result that belonged to the previous invitation.
check(
  'reopen clears the notify result',
  (() => {
    _resetForTests();
    submitTesterRequest('tenant-n', '@usern');
    setTesterRequestStatus('tenant-n', 'READY_TO_INVITE');
    recordTesterAccountAdded('tenant-n', 'owner@example.com');
    setTesterRequestInvitation('tenant-n', 'https://business.facebook.com/invite/n', 'app-n');
    recordTesterNotification('tenant-n', { status: 'queued', at: new Date().toISOString() });
    return setTesterRequestStatus('tenant-n', 'REQUESTED')?.notify === undefined;
  })()
);

// ── Summary ──
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
