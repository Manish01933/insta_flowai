/**
 * Hands-on functional test — the three owner "customer error fix" actions:
 *   A. Retry queue        → "customer bole reply nahi aaya"  (stuck / failed sends)
 *   B. Trial extend       → "trial khatam ho gaya"           (period pushed, row kept)
 *   C. Shared routing     → 2 tenants on 1 Instagram account (KNOWN_ISSUES A4)
 *
 * Unlike scripts/retry-queue.test.ts (unit level), this drives the REAL store
 * code the owner endpoints call — `offerFailedSend → listRetryJobs →
 * promoteRetryJob → processDueRetryJobs`, `extendSubscriptionDays`,
 * `saveConnection → resolveSharedAccountRouting → disconnectAccount` — end to
 * end, the exact sequence the Ops Console buttons produce.
 *
 * Everything runs in a throwaway temp DATA_DIR set BEFORE the stores load, so
 * this can never read or write the live `.data` directory.
 *
 *   npx tsx scripts/hands-on-fix-actions.test.ts   → expect exit 0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function throwsMessage(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (err: any) {
    return String(err?.message || err);
  }
}

// ── Isolate BEFORE any store import (DATA_DIR is read at module load) ────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-on-fix-actions-'));
process.env.DATA_DIR = TMP;
console.log(`[hands-on] isolated DATA_DIR: ${TMP}\n`);

const rq = await import('../server/retryQueue');
const plan = await import('../server/planStore');
const conn = await import('../server/connectionStore');

rq.setRetryEnabledForTests(true);
rq.setRetryGuards(null);
rq._resetForTests(path.join(TMP, 'retry-queue'));

// ============================================================ A. RETRY QUEUE
console.log('=== A. Retry queue — "reply nahi aaya" fix ===');
const baseJob = {
  tenantId: 't-retry',
  instagramAccountId: 'IG-RETRY',
  recipientId: 'recipient-9876',
  senderId: 'IG-SENDER',
  replyText: 'Haan sir, price ₹999 hai.',
};

const o1 = rq.offerFailedSend({ ...baseJob, mid: 'M1', rawError: '500 internal server error' });
check('A1 failed send (500) is queued for retry', o1.enqueued && o1.reason === 'queued', JSON.stringify(o1));

let rows = rq.listRetryJobs();
check('A2 list shows exactly the queued job', rows.length === 1);
check('A3 recipient is masked (only last 4)', rows[0]?.recipientMasked === '…9876', rows[0]?.recipientMasked);
check('A4 reply text + tenant visible to the owner', rows[0]?.replyText === baseJob.replyText && rows[0]?.tenantId === 't-retry');
check('A5 fresh job starts at 0 attempts', rows[0]?.attempts === 0 && (rows[0]?.maxAttempts ?? 0) >= 1);

const dup = rq.offerFailedSend({ ...baseJob, mid: 'M1', rawError: '500 internal server error' });
check('A6 identical failed reply is never queued twice', !dup.enqueued && dup.reason === 'duplicate', JSON.stringify(dup));

const perm = rq.offerFailedSend({ ...baseJob, mid: 'M2', rawError: '(#10) Permission denied' });
check('A7 permanent errors are NOT queued', !perm.enqueued && perm.reason.startsWith('permanent-'), JSON.stringify(perm));

const amb = rq.offerFailedSend({ ...baseJob, mid: 'M3', rawError: 'request timed out' });
check('A8 ambiguous timeout is held back (no blind resend)', !amb.enqueued && amb.reason === 'ambiguous', JSON.stringify(amb));

// "Retry now" button = promote + run through the sweeper's own sender.
check('A9 promote (Retry now) makes the job due', rq.promoteRetryJob(rows[0].jobId) === true);
const run1 = await rq.processDueRetryJobs(async () => ({ success: false, error: '500 internal server error' }));
check('A10 a failing retry is counted and re-scheduled', run1.processed === 1 && run1.delivered === 0 && run1.failures === 1, JSON.stringify(run1));
rows = rq.listRetryJobs();
check('A11 job survives with attempt + last error recorded', rows.length === 1 && rows[0].attempts === 1 && Boolean(rows[0].lastErrorCategory), JSON.stringify({ attempts: rows[0]?.attempts, category: rows[0]?.lastErrorCategory }));

check('A12 promote again for the successful retry', rq.promoteRetryJob(rows[0].jobId) === true);
const sentTexts: string[] = [];
const run2 = await rq.processDueRetryJobs(async (args) => {
  sentTexts.push(args.replyText);
  return { success: true };
});
check('A13 delivered through the real sender contract', run2.delivered === 1 && run2.failures === 0 && sentTexts[0] === baseJob.replyText, JSON.stringify(run2));
check('A14 queue is empty after delivery', rq.listRetryJobs().length === 0);

// "Retry all now" button = promote every job, then one process pass.
rq.offerFailedSend({ ...baseJob, mid: 'M10', rawError: 'rate limit exceeded (code 429)' });
rq.offerFailedSend({ ...baseJob, mid: 'M11', rawError: '500 internal server error' });
check('A15 two queued jobs before retry-all', rq.listRetryJobs().length === 2);
for (const job of rq.listRetryJobs()) rq.promoteRetryJob(job.jobId);
const runAll = await rq.processDueRetryJobs(async () => ({ success: true }));
check('A16 retry-all flushes the whole queue', runAll.processed === 2 && runAll.delivered === 2 && rq.listRetryJobs().length === 0, JSON.stringify(runAll));

// "Discard" button.
rq.offerFailedSend({ ...baseJob, mid: 'M12', rawError: '500 internal server error' });
const discardId = rq.listRetryJobs()[0].jobId;
check('A17 discard removes the job (customer answered by hand)', rq.discardRetryJob(discardId) === true && rq.listRetryJobs().length === 0);
check('A18 discarding again is a clean no-op', rq.discardRetryJob(discardId) === false);

const stats = rq.getRetryQueueStats();
check('A19 stats feed the console (delivered counted)', (stats.delivered ?? 0) >= 3 && stats.depth === 0, JSON.stringify({ delivered: stats.delivered, depth: stats.depth }));

// ============================================================ B. TRIAL EXTEND
console.log('\n=== B. Trial extend — "trial khatam ho gaya" fix ===');
plan.startTrial('t-trial', 3);
const ext1 = plan.extendSubscriptionDays('t-trial', 7);
check('B1 extend reports previous + new end and days', Boolean(ext1.previousEnd) && Boolean(ext1.newEnd) && ext1.days === 7, JSON.stringify(ext1));
check('B2 plan + status preserved (row not wiped)', ext1.planId === 'trial' && ext1.status === 'trial');
check('B3 new end is previous end + 7 days', Math.abs(Date.parse(ext1.newEnd) - Date.parse(ext1.previousEnd as string) - 7 * 86_400_000) < 120_000, `${ext1.previousEnd} -> ${ext1.newEnd}`);

const ext2 = plan.extendSubscriptionDays('t-trial', 7);
check('B4 extending early stacks on the remaining time', ext2.previousEnd === ext1.newEnd, `${ext2.previousEnd} vs ${ext1.newEnd}`);

const subsRaw = fs.readFileSync(path.join(TMP, 'subscriptions.json'), 'utf8');
check('B5 row persisted to disk with the new end', subsRaw.includes('t-trial') && subsRaw.includes(ext2.newEnd));
check('B6 trial history kept on the row (trialUsedAt intact)', subsRaw.includes('trialUsedAt'));

const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
plan.saveSubscription({ tenantId: 't-expired', planId: 'trial', status: 'trial', startedAt: past, currentPeriodEnd: past, provider: 'manual', trialUsedAt: past });
const ext3 = plan.extendSubscriptionDays('t-expired', 7);
const ext3End = Date.parse(ext3.newEnd);
check('B7 expired period extends from NOW, not from the old end', ext3End > Date.now() + 6.9 * 86_400_000 && ext3End < Date.now() + 7.1 * 86_400_000, ext3.newEnd);

check('B8 0 days refused', throwsMessage(() => plan.extendSubscriptionDays('t-trial', 0)).includes('between 1 and 90'));
check('B9 91 days refused', throwsMessage(() => plan.extendSubscriptionDays('t-trial', 91)).includes('between 1 and 90'));
check('B10 unknown tenant refused', throwsMessage(() => plan.extendSubscriptionDays('t-ghost', 7)).includes('no billing row'));

plan.saveSubscription({ tenantId: 't-cancel', planId: 'starter', status: 'cancelled', startedAt: past, currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(), provider: 'manual', cancelledAt: past });
check('B11 cancelled subscription refused', throwsMessage(() => plan.extendSubscriptionDays('t-cancel', 7)).includes('cancelled'));

plan.saveSubscription({ tenantId: 't-free', planId: 'free', status: 'active', startedAt: past, provider: 'manual' });
check('B12 never-expiring row refused (nothing to extend)', throwsMessage(() => plan.extendSubscriptionDays('t-free', 7)).includes('never expires'));

// ============================================================ C. SHARED ROUTING
console.log('\n=== C. Shared-account routing — 2 tenants, 1 IG account (A4) ===');
const detailsA = { instagramAccountId: 'IG-SHOP', instagramUsername: 'shop.one', accessToken: 'tok-A' };
conn.saveConnection('t-a', detailsA, 'raw-token-A');
check('C1 single holder: nothing shared yet', conn.getSharedInstagramAccounts().length === 0);
check('C2 DM routing points at the only holder', conn.listTenantsForInstagramAccountId('IG-SHOP').join() === 't-a');

conn.saveConnection('t-b', { ...detailsA, accessToken: 'tok-B' }, 'raw-token-B');
const shared1 = conn.getSharedInstagramAccounts();
check('C3 second tenant shows up as a shared account', shared1.length === 1 && shared1[0].tenantIds.slice().sort().join() === 't-a,t-b', JSON.stringify(shared1));
check('C4 before the decision: last-save-wins (the silent bug)', shared1[0].routedTo === 't-b', shared1[0].routedTo ?? '(none)');

const decision = conn.resolveSharedAccountRouting('IG-SHOP', 't-a');
check('C5 owner decision reports before -> after', decision.before === 't-b' && decision.after === 't-a', JSON.stringify(decision));
check('C6 DMs now route to the chosen tenant', conn.getSharedInstagramAccounts()[0].routedTo === 't-a');

const routingRaw = fs.readFileSync(path.join(TMP, 'connection-routing.json'), 'utf8');
check('C7 decision persisted across restarts', routingRaw.includes('IG-SHOP') && routingRaw.includes('t-a'));

conn.saveConnection('t-b', { ...detailsA, accessToken: 'tok-B2' }, 'raw-token-B2');
check('C8 reconnect cannot steal the routing back (owner decision wins)', conn.getSharedInstagramAccounts()[0].routedTo === 't-a');

check('C9 unknown account refused', throwsMessage(() => conn.resolveSharedAccountRouting('IG-GHOST', 't-a')).includes('No tenant holds'));
check('C10 non-holder tenant refused (a wrong click is safe)', throwsMessage(() => conn.resolveSharedAccountRouting('IG-SHOP', 't-ghost')).includes('does not hold'));

conn.disconnectAccount('t-a');
check('C11 after disconnect only one holder remains, no longer shared', conn.getSharedInstagramAccounts().length === 0 && conn.listTenantsForInstagramAccountId('IG-SHOP').join() === 't-b');

// ============================================================ SUMMARY
console.log(`\n${fail === 0 ? 'ALL HANDS-ON CHECKS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch {
  /* temp cleanup is best-effort */
}
process.exit(fail === 0 ? 0 : 1);
