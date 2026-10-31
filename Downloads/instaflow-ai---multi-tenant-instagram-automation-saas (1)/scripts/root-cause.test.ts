/**
 * Unit tests for server/rootCause.ts — the "project rukne ka main karan"
 * reducer behind the ops notification banner.
 *
 * Run: npx tsx scripts/root-cause.test.ts   (exit 1 on any failure)
 *
 * The banner makes a claim to the owner in plain words ("project ruk gaya"), so
 * every branch of the reducer is pinned here: which cause wins when several are
 * true at once, when severity escalates to critical, and that resolved
 * incidents never resurrect a problem.
 */
import {
  explainRootCause,
  type RootCauseAccount,
  type RootCauseIncident,
} from '../server/rootCause';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

const account = (over: Partial<RootCauseAccount> = {}): RootCauseAccount => ({
  connected: true,
  liveState: 'OK',
  botEnabled: true,
  botPaused: false,
  needsPlan: false,
  overall: 'healthy',
  ...over,
});

const incident = (over: Partial<RootCauseIncident> = {}): RootCauseIncident => ({
  category: 'auth',
  severity: 'warning',
  status: 'detected',
  ...over,
});

// ── 1. The happy path ──────────────────────────────────────────────────────
{
  const r = explainRootCause([account(), account()], []);
  check('healthy fleet, no incidents → ok', r.code === 'ok' && r.severity === 'ok' && r.affected === 0);
}
{
  const r = explainRootCause([], []);
  check('no accounts at all → ok (nothing is broken)', r.code === 'ok' && r.severity === 'ok');
}

// ── 2. Per-account causes ──────────────────────────────────────────────────
{
  const r = explainRootCause([account(), account({ liveState: 'NEEDS_REAUTH', overall: 'critical' })], []);
  check('one dead token among healthy → token-expired warning',
    r.code === 'token-expired' && r.severity === 'warning' && r.affected === 1 && r.accounts === 2);
}
{
  const r = explainRootCause(
    [account({ liveState: 'NEEDS_REAUTH', overall: 'critical' }), account({ liveState: 'NEEDS_REAUTH', overall: 'critical' })],
    [],
  );
  check('every token dead → token-expired CRITICAL (fleet cannot reply)',
    r.code === 'token-expired' && r.severity === 'critical');
}
{
  const r = explainRootCause(
    [
      account({ connected: false, overall: 'disconnected' }),
      account({ botEnabled: false, needsPlan: true, overall: 'warning' }),
      account({ botEnabled: false, needsPlan: true, overall: 'warning' }),
    ],
    [],
  );
  check('main karan = the biggest cause (billing 2 > disconnected 1)',
    r.code === 'billing' && r.affected === 2 && r.severity === 'critical');
}
{
  const r = explainRootCause([account({ botPaused: true, overall: 'warning' })], []);
  check('owner-paused bot → paused, not "broken"', r.code === 'paused' && r.severity === 'critical');
}
{
  const r = explainRootCause([account({ botEnabled: false, overall: 'warning' })], []);
  check('bot off without needsPlan flag still counts as billing/access block', r.code === 'billing');
}
{
  const r = explainRootCause([account({ connected: false, overall: 'disconnected' })], []);
  check('never-connected account → disconnected', r.code === 'disconnected' && r.severity === 'critical');
}
{
  const r = explainRootCause([account({ overall: 'critical' })], []);
  check('confirmed send failure (no token problem) → send-fail', r.code === 'send-fail' && r.severity === 'critical');
}
{
  // A NEEDS_REAUTH row is also overall:'critical' — its real cause is the dead
  // token and it must never be double-claimed as send-fail.
  const r = explainRootCause(
    [account({ liveState: 'NEEDS_REAUTH', overall: 'critical' }), account({ overall: 'critical' })],
    [],
  );
  check('token cause beats send-fail at equal count (cause over symptom)',
    r.code === 'token-expired' && r.affected === 1);
}

// ── 3. Platform incidents outrank account causes ───────────────────────────
{
  const r = explainRootCause(
    [account({ liveState: 'NEEDS_REAUTH', overall: 'critical' })],
    [incident({ category: 'storage', severity: 'critical' })],
  );
  check('storage incident outranks a dead token', r.code === 'storage' && r.severity === 'critical');
}
{
  const r = explainRootCause([], [incident({ category: 'webhook', severity: 'critical', status: 'investigating' })]);
  check('open webhook incident → webhook', r.code === 'webhook' && r.severity === 'critical');
}
{
  const r = explainRootCause([], [incident({ category: 'storage', severity: 'critical', status: 'resolved' })]);
  check('resolved incidents are ignored → ok', r.code === 'ok');
}

// ── 4. Incident-only symptoms ──────────────────────────────────────────────
{
  const r = explainRootCause([account()], [incident({ category: 'ai', severity: 'warning' })]);
  check('AI-fail incident with healthy rows → ai', r.code === 'ai' && r.severity === 'warning');
}
{
  const r = explainRootCause([account()], [incident({ category: 'no-reply', severity: 'critical' })]);
  check('silent-bot incident → silent, critical', r.code === 'silent' && r.severity === 'critical');
}
{
  const r = explainRootCause([], [incident({ category: 'unknown-thing' })]);
  check('unknown open incident → generic incident code', r.code === 'incident' && r.severity === 'warning');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  for (const name of failures) console.error(`  FAIL ${name}`);
  process.exit(1);
}
