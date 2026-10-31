/**
 * Regression test — OPS "customer connection" diagnosis.
 *
 * Covers the failures the owner saw on /ops, each against the REAL store code the
 * console and the owner endpoints call (no stubs, no network):
 *
 *   1. A token that never decrypted must NOT be reported as “Meta refused it”.
 *   2. A token Meta really refuses must still be reported, with Meta's words kept.
 *   3. A never-connected tenant must not be labelled “reconnect needed”.
 *   4. Two tenants on one Instagram account are NOT duplicate records.
 *   5. Diagnosis of one tenant must never read or write another tenant's state.
 *   6. No access token may appear in anything the console receives.
 *
 * Everything runs in a throwaway temp DATA_DIR set BEFORE the stores load, so it can
 * never read or write the live `.data` directory, and it makes no Meta call.
 *
 *   npx tsx scripts/connect-fix-diagnosis.test.ts   → expect exit 0
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

// ── Isolate BEFORE any store import (DATA_DIR is read at module load) ────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-fix-diagnosis-'));
process.env.DATA_DIR = TMP;
// The same public app ids production reports on /healthz, so the classifier is judged
// on the numbers it actually sees in the field. No secrets are needed for that.
process.env.IG_APP_ID = '2315015095917318';
process.env.IG_APP_SECRET = 'test-only-secret';
process.env.META_APP_ID = '1226093629512976';
process.env.META_APP_SECRET = 'test-only-secret';
console.log(`[connect-fix] isolated DATA_DIR: ${TMP}\n`);

const conn = await import('../server/connectionStore');
const fix = await import('../server/connectFix');
const health = await import('../server/connectionHealth');
const attempts = await import('../server/connectAttemptStore');
const tester = await import('../server/testerRequestStore');

/** Same ids production reports on /healthz — the classifier is judged on those. */
const APP_IDS = { instagramAppId: '2315015095917318', facebookAppId: '1226093629512976' };
const READY = { ok: true, code: null, reason: null };
const REDIRECT = 'https://www.thefgt.in/api/auth/instagram/callback';
const RAW_TOKEN = 'IGAA-RAW-SECRET-TOKEN-must-never-leak-0001';

const facts = (tenantId: string) =>
  fix.buildConnectFixFacts({ tenantId, readiness: READY, redirectUri: REDIRECT });

// ============================================ 1. DECRYPT FAILURE ≠ META REFUSAL
console.log('=== 1. Token that never decrypted (the reported bug) ===');

conn.saveConnection('t-decr', { instagramAccountId: 'IG-DECR', instagramUsername: 'decr.shop', accessToken: RAW_TOKEN }, RAW_TOKEN);
check('1.1 a healthy connect starts as liveState UNKNOWN', conn.getSafeStatus('t-decr').liveState === 'UNKNOWN');

// Corrupt the stored ciphertext the way a changed/removed ENCRYPTION_MASTER_KEY does:
// the payload is no longer decryptable with the key this process holds.
const CONNECTIONS_FILE = path.join(TMP, 'connections.json');
const rawFile = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
check('1.2 connection file is the one this test corrupted', Boolean(rawFile['t-decr']));
rawFile['t-decr'].encryptedAccessToken = 'deadbeef:deadbeef:deadbeef:deadbeef';
fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(rawFile, null, 2), 'utf8');
conn.loadConnectionsFromDisk();

check('1.3 decryption of the corrupted token fails (null, no throw)', conn.getDecryptedTokenForTenant('t-decr') === null);
check('1.4 the safe status still has no token on it', !('encryptedAccessToken' in conn.getSafeStatus('t-decr')));

// The real path: checkConnectionHealth returns before any fetch when the token is null.
const decrHealth = await health.checkConnectionHealth('t-decr');
check(
  '1.5 live check reports NEEDS_REAUTH on a decrypt failure',
  decrHealth.state === 'NEEDS_REAUTH',
  decrHealth.state
);
check(
  '1.6 …and says it was decryption, not a Meta verdict',
  /could not be decrypted/i.test(String(decrHealth.detail)),
  decrHealth.detail
);

const decrFacts = facts('t-decr');
check(
  '1.7 facts carry the decrypt detail verbatim',
  /could not be decrypted/i.test(String(decrFacts.liveDetail))
);
check(
  '1.8 classifier names DECRYPT_FAILED (was UNKNOWN → “Meta ne mana kiya”)',
  decrFacts.tokenRefusal?.cause === 'DECRYPT_FAILED',
  String(decrFacts.tokenRefusal?.cause)
);
check(
  '1.9 it is explicitly NOT the old UNKNOWN fallback',
  decrFacts.tokenRefusal?.cause !== 'UNKNOWN'
);
check(
  '1.10 no Meta app id is invented for a call that never happened',
  decrFacts.tokenRefusal?.appId === null && decrFacts.tokenRefusal?.appIdIsOurs === false,
  JSON.stringify(decrFacts.tokenRefusal)
);
check(
  '1.11 blocker stays RECONNECT_NEEDED (reconnect does repair it)',
  decrFacts.blocker === 'RECONNECT_NEEDED',
  decrFacts.blocker
);

// ── 2. A token Meta really refuses still reads as Meta's refusal ────────────
console.log('\n=== 2. Token Meta actually refuses (control) ===');

const META_WORDS = 'The user has not authorized application 2315015095917318';
conn.saveConnection('t-rej', { instagramAccountId: 'IG-REJ', instagramUsername: 'rej.shop', accessToken: 'tok-rej' }, 'tok-rej');
conn.markConnectionLiveCheck('t-rej', {
  state: 'NEEDS_REAUTH',
  detail: META_WORDS,
  checkedAt: new Date().toISOString(),
});
const rejFacts = facts('t-rej');
check(
  '2.1 Meta naming OUR app → NOT_AUTHORIZED_THIS_APP',
  rejFacts.tokenRefusal?.cause === 'NOT_AUTHORIZED_THIS_APP',
  String(rejFacts.tokenRefusal?.cause)
);
check('2.2 the app id Meta named is extracted', rejFacts.tokenRefusal?.appId === '2315015095917318');
check('2.3 …and recognised as this deployment’s app', rejFacts.tokenRefusal?.appIdIsOurs === true);
check('2.4 Meta’s own sentence is preserved as evidence', rejFacts.liveDetail === META_WORDS);
check('2.5 a real refusal is never classified as a decrypt failure', rejFacts.tokenRefusal?.cause !== 'DECRYPT_FAILED');
check(
  '2.6 a token Meta refuses does not rewrite status (account stays Connected)',
  conn.getSafeStatus('t-rej').isConnected === true && conn.getSafeStatus('t-rej').status === 'CONNECTED'
);

// A refusal that names a foreign app must not be read as ours.
check(
  '2.7 a foreign app id is reported as another app',
  fix.classifyTokenRefusal('The user has not authorized application 9999999999', APP_IDS)?.cause ===
    'NOT_AUTHORIZED_OTHER_APP'
);
// Expiry is only ever claimed when Meta's words say so — never for a blank detail.
check(
  '2.8 blank detail ⇒ nothing is classified (no invented cause)',
  fix.classifyTokenRefusal(undefined, APP_IDS) === null && fix.classifyTokenRefusal('   ', APP_IDS) === null
);

// ── 3. Never-connected tenants ──────────────────────────────────────────────
console.log('\n=== 3. Never connected (no connection, no attempt) ===');

const neverFacts = facts('t-never');
check('3.1 no connection is reported as not connected', neverFacts.connected === false);
check('3.2 liveState is UNKNOWN, not NEEDS_REAUTH', neverFacts.liveState === 'UNKNOWN', neverFacts.liveState);
check('3.3 no token refusal is invented', neverFacts.tokenRefusal === null);
check('3.4 blocker is HANDLE_UNKNOWN, never RECONNECT_NEEDED', neverFacts.blocker === 'HANDLE_UNKNOWN', neverFacts.blocker);
check('3.5 there is no attempt to show', neverFacts.lastAttempt === null);

// ── 4. Duplicate-looking rows = one Instagram account, two tenants ──────────
console.log('\n=== 4. “Duplicate” OPS rows ===');

conn.saveConnection('t-share-a', { instagramAccountId: 'IG-SHARE', instagramUsername: 'shared.hut', accessToken: 'tok-share' }, 'tok-a');
conn.saveConnection('t-share-b', { instagramAccountId: 'IG-SHARE', instagramUsername: 'shared.hut', accessToken: 'tok-share' }, 'tok-b');

const holders = conn
  .listConnections()
  .filter((c) => c.instagramAccountId === 'IG-SHARE')
  .map((c) => c.tenantId)
  .sort();
check(
  '4.1 exactly one record per tenant — never a repeated row for the same tenant',
  holders.join() === 't-share-a,t-share-b',
  holders.join()
);
check(
  '4.2 the same tenant never appears twice',
  new Set(holders).size === holders.length
);
const sharedEntries = conn.getSharedInstagramAccounts();
check(
  '4.3 the shared account is ONE entry naming both tenants',
  sharedEntries.length === 1 && sharedEntries[0].tenantIds.slice().sort().join() === 't-share-a,t-share-b',
  JSON.stringify(sharedEntries)
);
const shareAFacts = facts('t-share-a');
const shareBFacts = facts('t-share-b');
check(
  '4.4 each side points at the other as evidence (not as a duplicate)',
  shareAFacts.sharedWith.join() === 't-share-b' && shareBFacts.sharedWith.join() === 't-share-a'
);
check(
  '4.5 exactly one side receives DMs; the other is flagged SHARED_ACCOUNT',
  [shareAFacts.blocker, shareBFacts.blocker].filter((b) => b === 'SHARED_ACCOUNT').length === 1,
  `${shareAFacts.blocker} / ${shareBFacts.blocker}`
);

// ── 5. Tenant isolation ─────────────────────────────────────────────────────
console.log('\n=== 5. Tenant isolation ===');

const snapshot = (tenantId: string) => JSON.stringify(conn.getSafeStatus(tenantId));
const beforeB = snapshot('t-share-b');
facts('t-share-a'); // the console's "Fix" facts build — must be pure
check(
  '5.1 diagnosing one tenant does not mutate another tenant’s record',
  snapshot('t-share-b') === beforeB
);

// A wrong tenant id must never resolve to somebody else's connection.
check('5.2 an unknown tenant resolves to no connection', conn.getSafeStatus('t-ghost').isConnected === false);
check(
  '5.3 …and cannot reach the owner’s token through a stored account id',
  conn.getSafeStatus('t-ghost').instagramAccountId === undefined
);

// The one server-side write the Fix button can make is per-tenant.
attempts.recordConnectAttempt({
  tenantId: 't-iso',
  stage: 'blocked',
  code: 'consent_refused',
  message: 'customer refused at the consent screen',
  username: 'iso.shop',
  source: 'callback',
});
check('5.4 a blocked attempt records no connection of its own', conn.getSafeStatus('t-iso').isConnected === false);
const wrote = fix.ensureHandleRecorded('t-iso');
check('5.5 “Fix” reports whether it actually wrote anything', wrote === true);
check(
  '5.6 …into the queue of THAT tenant only',
  tester.getTesterRequest('t-iso')?.username === 'iso.shop',
  JSON.stringify(tester.getTesterRequest('t-iso'))
);
check('5.7 …and creates nothing for any other tenant', tester.getTesterRequest('t-share-a') === null);
check('5.8 a second press changes nothing (idempotent)', fix.ensureHandleRecorded('t-iso') === false);
check(
  '5.9 “Fix” never disconnects the account it diagnoses',
  conn.getSafeStatus('t-share-a').isConnected && conn.getSafeStatus('t-rej').isConnected
);

// ── 6. “handle nahi mila” while the server already knows the handle ─────────
console.log('\n=== 6. Handle learned by a live check reaches the console ===');

conn.saveConnection('t-nohandle', { instagramAccountId: 'IG-NOHANDLE', instagramUsername: '', accessToken: 'tok-h' }, 'tok-h');
check('6.1 connect without a username leaves it empty', !conn.getSafeStatus('t-nohandle').instagramUsername);
conn.markConnectionLiveCheck('t-nohandle', {
  state: 'OK',
  checkedAt: new Date().toISOString(),
  username: 'learned.handle',
});
const learned = conn.getSafeStatus('t-nohandle');
check('6.2 the live check stored the handle', learned.liveUsername === 'learned.handle');
check(
  '6.3 facts use it instead of showing the account as unknown',
  facts('t-nohandle').handle === 'learned.handle' && facts('t-nohandle').handleSource === 'connection',
  JSON.stringify({ handle: facts('t-nohandle').handle, source: facts('t-nohandle').handleSource })
);

// ── 7. No secrets anywhere in the console payload ──────────────────────────
console.log('\n=== 7. No token or secret leaves the server ===');

for (const tenantId of ['t-decr', 't-rej', 't-share-a', 't-nohandle']) {
  const payload = JSON.stringify(facts(tenantId));
  check(`7.x ${tenantId}: payload carries no raw token`, !payload.includes(RAW_TOKEN) && !/IGAA-RAWSECRET/i.test(payload));
  check(`7.x ${tenantId}: payload carries no ciphertext`, !payload.includes('deadbeef'));
  check(`7.x ${tenantId}: safe status exposes no token field`, !('accessToken' in conn.getSafeStatus(tenantId)));
}

// ── 8. The new cause has copy in both languages ────────────────────────────
console.log('\n=== 8. Console copy exists for every cause the server emits ===');

const i18nSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'i18n.tsx'), 'utf8');
const causes = ['NOT_AUTHORIZED_THIS_APP', 'NOT_AUTHORIZED_OTHER_APP', 'TOKEN_EXPIRED', 'PASSWORD_CHANGED', 'DECRYPT_FAILED', 'UNKNOWN'];
for (const cause of causes) {
  check(`8.x ops.fix.causeName.${cause} has copy`, i18nSrc.includes(`'ops.fix.causeName.${cause}'`));
  check(`8.x ops.fix.causeStep.${cause} has copy`, i18nSrc.includes(`'ops.fix.causeStep.${cause}'`));
}
// The old headline claimed Meta refused a token Meta never saw.
check(
  '8.9 the NEEDS_REAUTH headline no longer asserts Meta refused it',
  !/ops\.live\.NEEDS_REAUTH':\s*\['Meta token mana kar raha hai/.test(i18nSrc)
);

// ============================================================ SUMMARY
console.log(`\n${fail === 0 ? 'ALL CONNECT-DIAGNOSIS CHECKS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch {
  /* temp cleanup is best-effort */
}
process.exit(fail === 0 ? 0 : 1);
