/**
 * Task 3 focused tests for server/retryQueue.ts — run via the project's own
 * `tsx` devDependency, all state inside OS temp dirs. Real DATA_DIR and /data
 * are NEVER touched. Run: npx tsx scripts/retry-queue.test.ts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  offerFailedSend,
  processDueRetryJobs,
  getRetryQueueStats,
  loadRetryQueue,
  setRetryEnabledForTests,
  setRetryGuards,
  _resetForTests,
  type RetryGuards,
} from '../server/retryQueue';
import { isRetryableCategory } from '../server/messageTrace';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

function fakeArgs(errText: string | undefined, over: any = {}): any {
  return {
    tenantId: 'T1', instagramAccountId: 'IG1', recipientId: 'R1', senderId: 'R1',
    replyText: 'hello', rawError: errText, mid: 'M1', ...over,
  };
}

/** Fresh isolated scenario: new temp dir + clean in-memory state. Returns collectible runner. */
const scenarioRunners: Array<() => Promise<void>> = [];
function scenario(name: string, fn: (dir: string) => void | Promise<void>): void {
  scenarioRunners.push(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), `rq-${name}-`));
    _resetForTests(dir);
    try {
      await fn(dir);
    } catch (err: any) {
      fail += 1; failures.push(`${name} threw`);
      console.error(`FAIL ${name} threw:`, err?.message || err);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Awaits all pending async writes before assertions in a scenario.
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 120));
}

// ============================================================ TESTS
// 1. Successful sends never enqueue (positive-path hook is in server.ts; here
//    the queue-side contract: no offer on success).
scenario('success-no-enqueue', async () => {
  const r = offerFailedSend(fakeArgs(undefined));
  check('success offers nothing (undefined error is not classified/enqueued)', r.enqueued === false);
});

// 2. Network failure (transient) enqueues when enabled.
scenario('network-failure-enqueues', async () => {
  setRetryEnabledForTests(true);
  const r = offerFailedSend(fakeArgs('rate limit exceeded (code 429)'));
  check('429 enqueued', r.enqueued === true && r.reason === 'queued');
  await settle();
  const s = getRetryQueueStats();
  check('depth 1 after enqueue', s.depth === 1);
  check('capacity reported', s.capacity === 50);
});

// 3. Ambiguous outcomes never enqueue.
scenario('ambiguous-not-enqueued', async () => {
  setRetryEnabledForTests(true);
  const t = offerFailedSend(fakeArgs('request timed out'));
  const n = offerFailedSend(fakeArgs('fetch failed: ECONNRESET'));
  check('timeout ambiguous (not enqueued)', t.enqueued === false && t.reason === 'ambiguous');
  check('network ambiguous (not enqueued)', n.enqueued === false && n.reason === 'ambiguous');
  const s = getRetryQueueStats();
  check('ambiguous counter = 2', s.ambiguousSends === 2);
  setRetryEnabledForTests(false);
});

// 4. Permanent auth/permission failures never enqueue.
scenario('permanent-not-enqueued', async () => {
  setRetryEnabledForTests(true);
  const a = offerFailedSend(fakeArgs('Error validating access_token: session expired (190)'));
  const p = offerFailedSend(fakeArgs('(#10) Permission denied'));
  check('auth permanent refused', a.enqueued === false);
  check('permission permanent refused', p.enqueued === false);
  const s = getRetryQueueStats();
  check('no token in reason text', !JSON.stringify(s).includes('access_token='));
  setRetryEnabledForTests(false);
});

// 5. Queue capacity: 51st job refused, queueDrops counted, existing intact.
scenario('capacity-full', async () => {
  setRetryEnabledForTests(true);
  for (let i = 0; i < 50; i++) offerFailedSend(fakeArgs('500 internal server error', { mid: `M${i}` }));
  await settle();
  const before = getRetryQueueStats();
  check('50 accepted', before.depth === 50);
  const r51 = offerFailedSend(fakeArgs('500 internal server error', { mid: 'M51' }));
  check('51st refused', r51.enqueued === false && r51.reason === 'capacity-full');
  const after = getRetryQueueStats();
  check('queueDrops counted', after.queueDrops === 1);
  check('existing 50 kept', after.depth === 50);
  setRetryEnabledForTests(false);
});

// 6. Concurrent writes leave a valid file (serialized chain).
scenario('concurrent-writes-valid-file', async (dir) => {
  setRetryEnabledForTests(true);
  const offers: any[] = [];
  for (let i = 0; i < 25; i++) {
    offers.push(Promise.resolve(offerFailedSend(fakeArgs('rate limit (429)', { mid: `C${i}` }))));
  }
  await Promise.all(offers);
  await settle();
  const file = readFileSync(path.join(dir, 'retry-queue.json'), 'utf8');
  const parsed = JSON.parse(file);
  check('concurrent file valid JSON', Array.isArray(parsed.jobs));
  check('all 25 present', parsed.jobs.length === 25);
  check('no .tmp leftover', !existsSync(path.join(dir, 'retry-queue.json.tmp')));
  setRetryEnabledForTests(false);
});

// 7. Corrupt queue file: renamed aside, fresh start, loud warning.
scenario('corrupt-file-recovery', async (dir) => {
  setRetryEnabledForTests(true);
  // First fill + flush a valid file via offers, then corrupt it and reload.
  for (let i = 0; i < 3; i++) offerFailedSend(fakeArgs('rate limit (429)', { mid: `K${i}` }));
  await settle();
  const corrupt = '{"version":1,"jobs":[{"jobId":"torn"';
  writeFileSync(path.join(dir, 'retry-queue.json'), corrupt, 'utf8');
  // Force a fresh load by simulating restart: reset memory ONLY, keep dir.
  _resetForTests(dir);
  const s1 = loadRetryQueue();
  const s = getRetryQueueStats();
  check('corrupt: recovery counted', s.recoveryFailures >= 1);
  check('corrupt: fresh empty start', s.depth === 0);
  const asideFile = readdirSync(dir).some((f) => f.startsWith('queue-corrupt-'));
  check('corrupt: evidence file kept', asideFile);
  setRetryEnabledForTests(false);
});



// 8. Restart recovery: file-written jobs survive a fresh load in a new process.
scenario('restart-recovery', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('503 service unavailable', { mid: 'RR1' }));
  await settle();
  // Simulated restart: lose memory, keep the file.
  _resetForTests(dir);
  const s = getRetryQueueStats();
  check('restart: job recovered', s.depth === 1);
  // Then processed via sweeper once enabled and due.
  let sends = 0;
  const res = await processDueRetryJobs(async () => {
    sends += 1;
    // First pass: job is NOT due yet (nextAttemptAt = now + base delay).
    return { success: true };
  });
  check('restart: not immediately due', res.processed === 0 && sends === 0);
  setRetryEnabledForTests(false);
});

// 9. Disabled mode: offer/ sweeper complete no-ops.
scenario('disabled-mode', async () => {
  setRetryEnabledForTests(false);
  const r = offerFailedSend(fakeArgs('429 rate limit'));
  check('disabled: enqueue refused', r.enqueued === false && r.reason === 'disabled');
  const res = await processDueRetryJobs(async () => ({ success: true }));
  check('disabled: sweeper no-op', res.processed === 0);
  const s = getRetryQueueStats();
  check('disabled: stats report disabled', s.enabled === false);
});

// ============================================================ B1 GUARD TESTS

/** Guard set driven by mutable flags — each scenario flips state AFTER enqueue. */
function makeGuards(over: Partial<RetryGuards> = {}): RetryGuards & { state: any } {
  const state = { botEnabled: true, humanTakeover: false, burstCap: false, ownsAccount: true };
  return {
    state,
    botEnabled: () => state.botEnabled,
    humanTakeover: () => state.humanTakeover,
    burstCap: () => state.burstCap,
    ownsAccount: () => state.ownsAccount,
    ...over,
  };
}

/** Force the single job due now (locks the normal first-attempt delay away). */
async function forceJobDue(dir: string): Promise<void> {
  const file = JSON.parse(readFileSync(path.join(dir, 'retry-queue.json'), 'utf8'));
  file.jobs[0].nextAttemptAt = Date.now() - 1;
  writeFileSync(path.join(dir, 'retry-queue.json'), JSON.stringify(file), 'utf8');
  _resetForTests(dir);
}

// A. Bot disabled AFTER enqueue: job deferred, NOT sent, and NOT looping.
scenario('B1-A-bot-disabled-after-enqueue', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'B1A' }));
  await settle();
  const guards = makeGuards();
  guards.state.botEnabled = false;               // disabled AFTER enqueue
  setRetryGuards(guards);
  await forceJobDue(dir);
  let sent = 0;
  const res = await processDueRetryJobs(async () => { sent += 1; return { success: true }; });
  check('A: nothing sent', sent === 0 && res.processed === 0 && res.delivered === 0);
  check('A: job kept (deferred, not dropped)', getRetryQueueStats().depth === 1);
  // Immediate re-run: still blocked, still exactly one job, no loop growth.
  const res2 = await processDueRetryJobs(async () => { sent += 1; return { success: true }; });
  check('A: no loop on repeated passes', sent === 0 && res2.processed === 0 && getRetryQueueStats().depth === 1);
  setRetryGuards(null);
  setRetryEnabledForTests(false);
});

// B. Human takeover AFTER enqueue: job removed, never sent.
scenario('B1-B-takeover-after-enqueue', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'B1B' }));
  await settle();
  const guards = makeGuards();
  guards.state.humanTakeover = true;             // takeover AFTER enqueue
  setRetryGuards(guards);
  await forceJobDue(dir);
  let sent = 0;
  const res = await processDueRetryJobs(async () => { sent += 1; return { success: true }; });
  check('B: nothing sent', sent === 0 && res.delivered === 0);
  check('B: job removed (human owns thread)', getRetryQueueStats().depth === 0);
  setRetryGuards(null);
  setRetryEnabledForTests(false);
});

// C. Burst cap tripped AFTER enqueue: nothing sent, job deferred, does not expire.
scenario('B1-C-burst-cap-after-enqueue', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'B1C' }));
  await settle();
  const guards = makeGuards();
  guards.state.burstCap = true;                  // cap tripped AFTER enqueue
  setRetryGuards(guards);
  await forceJobDue(dir);
  let sent = 0;
  const res = await processDueRetryJobs(async () => { sent += 1; return { success: true }; });
  check('C: nothing sent', sent === 0 && res.delivered === 0);
  check('C: job kept (deferred until window rolls off)', getRetryQueueStats().depth === 1);
  // Then the cap clears: same guards, burst off → permitted send succeeds.
  guards.state.burstCap = false;
  await forceJobDue(dir);
  const res2 = await processDueRetryJobs(async () => ({ success: true }));
  check('C: sends once cap clears', res2.delivered === 1 && getRetryQueueStats().depth === 0);
  setRetryGuards(null);
  setRetryEnabledForTests(false);
});

// D. Normal permitted retry still succeeds with guards ACTIVE and all-passing.
scenario('B1-D-permitted-retry-succeeds', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'B1D' }));
  await settle();
  setRetryGuards(makeGuards());                  // all guards pass
  await forceJobDue(dir);
  const res = await processDueRetryJobs(async ({ replyText }) => {
    check('D: exact failed text retried verbatim', replyText === 'hello');
    return { success: true };
  });
  check('D: delivered with guards active', res.delivered === 1 && getRetryQueueStats().depth === 0);
  setRetryGuards(null);
  setRetryEnabledForTests(false);
});

// E. Ownership mismatch: job's tenant no longer owns the account → removed, no send.
scenario('B1-E-ownership-mismatch-removed', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'B1E' }));
  await settle();
  const guards = makeGuards();
  guards.state.ownsAccount = false;              // account reconnected to another tenant
  setRetryGuards(guards);
  await forceJobDue(dir);
  let sent = 0;
  let sawTenant: string | undefined;
  const res = await processDueRetryJobs(async ({ tenantId }) => {
    sawTenant = tenantId;
    sent += 1;
    return { success: true };
  });
  check('E: never sent', sent === 0 && res.delivered === 0 && sawTenant === undefined);
  check('E: job removed immediately (no loop)', getRetryQueueStats().depth === 0);
  setRetryGuards(null);
  setRetryEnabledForTests(false);
});

// 10a. Full retry loop end-to-end (in-process): enqueue→sweep→deliver→file emptied.
scenario('retry-delivers', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limit', { mid: 'RD1' }));
  await settle();
  // Force the job due NOW for a single-pass delivery: same simulate-restart path.
  const file = JSON.parse(readFileSync(path.join(dir, 'retry-queue.json'), 'utf8'));
  file.jobs[0].nextAttemptAt = Date.now() - 1;
  writeFileSync(path.join(dir, 'retry-queue.json'), JSON.stringify(file), 'utf8');
  _resetForTests(dir);
  let sent = 0;
  const res = await processDueRetryJobs(async ({ replyText }: any) => {
    sent += 1;
    return { success: true };
  });
  check('retry: delivered once', res.processed === 1 && res.delivered === 1 && sent === 1);
  await settle();
  const after = getRetryQueueStats();
  check('retry: queue emptied after delivery', after.depth === 0);
  check('retry: delivered counter set', after.delivered === 1);
  setRetryEnabledForTests(false);
});

// 10. Tenant isolation: different tenants are distinct jobs, no cross-leak.
scenario('tenant-isolation', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429 rate limited', { tenantId: 'TA', mid: 'MT1' }));
  offerFailedSend(fakeArgs('429 rate limited', { tenantId: 'TB', mid: 'MT1' }));
  await settle();
  const file = JSON.parse(readFileSync(path.join(dir, 'retry-queue.json'), 'utf8'));
  check('two tenants two jobs', file.jobs.length === 2);
  check('tenant ids distinct', file.jobs[0].tenantId !== file.jobs[1].tenantId);
  check('no plaintext token fields', !JSON.stringify(file).includes('accessToken') && !JSON.stringify(file).includes('token:'));
  setRetryEnabledForTests(false);
});

// 11. Retryable classification contract: 429/5xx retryable, 4xx not.
scenario('classification-contract', async () => {
  check('429 retryable', isRetryableCategory('rate-limit'));
  check('500 retryable', isRetryableCategory('server-error'));
  check('timeout retryable-labelled', isRetryableCategory('timeout'));
  check('auth NOT retryable', !isRetryableCategory('auth'));
  check('permission NOT retryable', !isRetryableCategory('permission'));
});

// 12. Expired job purged on load.
scenario('expiry-on-load', async (dir) => {
  setRetryEnabledForTests(true);
  offerFailedSend(fakeArgs('429', { mid: 'EXP1' }));
  await settle();
  const file = JSON.parse(readFileSync(path.join(dir, 'retry-queue.json'), 'utf8'));
  file.jobs[0].createdAt = Date.now() - 5 * 60 * 60 * 1000; // past 4h TTL
  writeFileSync(path.join(dir, 'retry-queue.json'), JSON.stringify(file), 'utf8');
  _resetForTests(dir);
  const s = getRetryQueueStats();
  check('expired purged', s.depth === 0);
  check('expired counted', s.expiredJobs === 1);
  setRetryEnabledForTests(false);
});

// 13. Health counters: delivered/dropped/ambiguous recoverable from stats.
scenario('stats-shape', async () => {
  setRetryEnabledForTests(true);
  const s = getRetryQueueStats();
  check('stats has delivered', typeof s.delivered === 'number');
  check('stats has queueDrops', typeof s.queueDrops === 'number');
  check('stats has ambiguousSends', typeof s.ambiguousSends === 'number');
  check('stats has recoveryFailures', typeof s.recoveryFailures === 'number');
  setRetryEnabledForTests(false);
});

// Sequential runner: every scenario awaits the previous so module state and
// temp dirs stay isolated (the earlier fire-and-forget version raced).
async function runAll(): Promise<void> {
  for (const run of scenarioRunners) {
    await run();
  }
}

runAll()
  .then(() => {
    console.log(`${fail === 0 ? 'ALL TESTS PASSED' : 'TESTS FAILED'}`);
    console.log(`passed=${pass} failed=${fail}${failures.length ? ` (${failures.join(', ')})` : ''}`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('runner crashed:', err);
    process.exit(1);
  });
