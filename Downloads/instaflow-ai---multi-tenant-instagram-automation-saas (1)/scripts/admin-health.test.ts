/**
 * Customer health monitoring tests — run against OS temp dirs, never the
 * project's real DATA_DIR/.data, and never touching Instagram or the network
 * (fetch is stubbed; email is unconfigured by default).
 * Run: npx tsx scripts/admin-health.test.ts   → expect exit 0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _setHealthStoreTestDir,
  noteSendFailure,
  noteAiFailure,
  noteSendSuccess,
  noteInbound,
} from '../server/tenantHealthStore';
import {
  _resetIncidentStoreForTests,
  openIncident,
  setIncidentStatus,
  listIncidents,
  resolveIncident,
  getOpenIncidentCount,
  _setIncidentStoreTestDir,
} from '../server/healthIncidentStore';
import {
  handleTenantEvent,
  evaluateSilentBot,
  getAlertChannelStatus,
  sendAlertEmail,
  isEmailAlertConfigured,
  buildAlertText,
} from '../server/adminAlertNotifier';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

const WAIT = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scenario(name: string, fn: () => Promise<void> | void) {
  const dir = mkdtempSync(path.join(tmpdir(), `rq-health-${name}-`));
  _setHealthStoreTestDir(dir);
  _setIncidentStoreTestDir(dir);
  // Fresh env state per scenario (not configured by default).
  delete process.env.ALERT_EMAIL_API_KEY;
  delete process.env.ALERT_EMAIL_FROM;
  delete process.env.ALERT_EMAIL_TO;
  delete process.env.ALERT_EMAIL_API_URL;
  try {
    await fn();
  } catch (err) {
    fail += 1;
    failures.push(`${name} threw`);
    console.error(`FAIL ${name} threw:`, err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await scenario('threshold', async () => {
    // 8. Detection: 3 confirmed failures (below default threshold) → none.
    noteSendFailure('t1', { igAccountId: '17841400000000123', category: 'server-error', detail: '500 oops' });
    noteSendFailure('t1', { category: 'server-error', detail: '500 oops' });
    await handleTenantEvent({ at: new Date().toISOString(), kind: 'send-fail', category: 'server-error', detail: 'third' }, 't1');
    // Wait — the count is 1 at rule-evaluation time in this scenario wiring
    // (each scenario is isolated), so nothing is expected yet.
    check('below threshold → no send-fail incident', listIncidents({ category: 'server-error' }).length === 0);
  });

  await scenario('threshold-reached', async () => {
    noteSendFailure('t1', { igAccountId: '17841400000000123', category: 'server-error', detail: '500' });
    noteSendFailure('t1', { igAccountId: '17841400000000123', category: 'server-error', detail: '500' });
    noteSendFailure('t1', { igAccountId: '17841400000000123', category: 'server-error', detail: '500' });
    const event = { at: new Date().toISOString(), kind: 'send-fail' as const, category: 'server-error', detail: '500', igAccountIdMasked: '17841***123' };
    await handleTenantEvent(event, 't1');
    const incidents = listIncidents({ category: 'server-error' });
    check('threshold reached → incident opened', incidents.length === 1);
    check('incident is warning severity', incidents[0]?.severity === 'warning');
    check('detail carries count 3', (incidents[0]?.detail || '').includes('3 confirmed'));
    check('account id masked in incident', (incidents[0]?.igAccountIdMasked || '').includes('***'));
    await WAIT(1);
    // 9. Dedupe: same condition again bumps, does not duplicate.
    await handleTenantEvent(event, 't1');
    const after = listIncidents({ category: 'server-error' });
    check('same condition bumps count, not a new incident', after.length === 1 && after[0].count === 2);
    // Cooldown: second notify within cooldown → still one notification entry.
    const notifications = after[0].notifications.filter((note) => note.channel === 'email');
    check('cooldown suppresses repeat email row', notifications.length === 1);
  });

  await scenario('auth-failure', async () => {
    const event = { at: new Date().toISOString(), kind: 'send-fail' as const, category: 'auth', detail: 'Error validating access_token: session expired (190)' };
    await handleTenantEvent(event, 't2');
    const incidents = listIncidents({ category: 'auth' });
    check('auth failure → immediate critical incident', incidents.length === 1 && incidents[0].severity === 'critical');
    check('no token text in stored detail', !(incidents[0].detail || '').includes('access_token='));
  });

  await scenario('ambiguous', async () => {
    // 13. Uncertain outcomes never open a reply-failure incident.
    noteSendFailure('t3', { category: 'timeout', detail: 'request timed out', ambiguous: true });
    await handleTenantEvent({ at: new Date().toISOString(), kind: 'send-fail', category: 'timeout', detail: 'timed out', ambiguous: true }, 't3');
    noteAiFailure('t3', { detail: 'openrouter failed' });
    await handleTenantEvent({ at: new Date().toISOString(), kind: 'ai-fail', detail: 'x' }, 't3');
    check('ambiguous send → no send-fail incident', listIncidents({ category: 'timeout' }).length === 0);
  });

  await scenario('lifecycle', async () => {
    // 10. Acknowledge → investigate → resolve; recurrence after resolve.
    const { incident } = openIncident({ key: 'auth|t4', tenantId: 't4', category: 'auth', severity: 'critical', title: 'x', detail: 'y' });
    const acked = setIncidentStatus(incident.id, 'acknowledged', 'owner');
    check('acknowledge recorded', acked?.status === 'acknowledged' && Boolean(acked.acknowledgedAt));
    const investigating = setIncidentStatus(incident.id, 'investigating', 'owner');
    check('investigate recorded', investigating?.status === 'investigating');
    check('resolve sets resolvedAt', Boolean(setIncidentStatus(incident.id, 'resolved', 'owner')?.resolvedAt));
    check('open count drops', getOpenIncidentCount() === 0);
    const again = openIncident({ key: 'auth|t4', tenantId: 't4', category: 'auth', severity: 'critical', title: 'x again', detail: 'recurred' });
    check('recurrence after resolve = NEW incident', again.created);
    check('resolved incident stays in history', listIncidents({ status: 'resolved' }).length === 1);
    const resolved = listIncidents({ status: 'resolved' })[0];
    check('double-resolve refused', resolveIncident(resolved.id, 'owner') === null);
  });

  await scenario('channels', async () => {
    // 12. Email not configured → explicit setup-required, no fake success.
    check('isEmailAlertConfigured false by default', !isEmailAlertConfigured());
    const res = await sendAlertEmail('subject', 'text');
    check('sendAlertEmail reports setup-required', !res.ok && res.setupRequired === true);
    const status = getAlertChannelStatus();
    check('channel status says setup required', !status.email.configured && /ALERT_EMAIL/.test(status.email.detail));
    // Redaction in alert text
    const incident = openIncident({
      key: 'storage|persistence', tenantId: null, category: 'storage', severity: 'critical',
      title: 'storage', detail: 'persist failed access_token=abcsecretXYZ more',
    }).incident;
    const text = buildAlertText(incident, 'Test Customer');
    check('alert text redacts token-shaped strings', !/access_token=abcsecretXYZ/.test(text) && text.includes('<redacted>'));
    check('alert text has no raw account id', !/178414\d{9}/.test(text));
  });

  await scenario('email-configured-uses-fetch', async () => {
    // Email configured → one JSON POST with the right body shape (fetch stub).
    process.env.ALERT_EMAIL_API_KEY = 'test-key';
    process.env.ALERT_EMAIL_FROM = 'alerts@example.com';
    process.env.ALERT_EMAIL_TO = 'owner@example.com';
    const originalFetch = globalThis.fetch;
    let captured: { url: string; headers: Record<string, string>; body: any } | undefined = undefined;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      captured = {
        url,
        headers: Object.fromEntries(Object.entries(init.headers || {})),
        body: JSON.parse(init.body),
      };
      return { ok: true, status: 200, text: async () => '{}' } as any;
    };
    try {
      const res = await sendAlertEmail('Alert subject', 'Alert body');
      // Read `captured` AFTER the call — a snapshot taken before it would
      // always be undefined and every assertion below would silently fail.
      const cap = captured as { url: string; headers: Record<string, string>; body: any } | undefined;
      check('email send ok with stub', res.ok);
      check('POST goes to configured/default endpoint', Boolean(cap && cap.url.startsWith('https://')));
      check('bearer header present', cap ? cap.headers.Authorization === 'Bearer test-key' : false);
      check('body shape {from,to,subject,text}', cap ? cap.body.from === 'alerts@example.com' && cap.body.to === 'owner@example.com' : false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await scenario('silent-bot', async () => {
    // "Replies stopped" — evidence-gated variations.
    const base = {
      tenantId: 't5', customerName: 'C', connected: true, liveState: 'OK', botEnabled: true, humanTakeover: false,
      lastInboundAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastSendOkAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      lastSendFailAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      ambiguousLastAt: null as string | null,
      maxSilenceHours: 6,
    };
    const verdict = evaluateSilentBot(base);
    check('inbound after success + confirmed fail → alert', verdict.alert);
    check('bot intentionally off → no alert', !evaluateSilentBot({ ...base, botEnabled: false }).alert);
    check('human takeover → no alert', !evaluateSilentBot({ ...base, humanTakeover: true }).alert);
    check('not connected → no alert', !evaluateSilentBot({ ...base, connected: false }).alert);
    // Ambiguity: an uncertain outcome after the inbound must not conclude "broken"
    const ambiguous = { ...base, ambiguousLastAt: new Date(Date.now() - 60_000).toISOString() };
    check('uncertain latest outcome → no alert', !evaluateSilentBot(ambiguous).alert);
    check('no inbound at all → no alert', !evaluateSilentBot({ ...base, lastInboundAt: null }).alert);
    check('success after inbound → no alert', !evaluateSilentBot({ ...base, lastSendOkAt: new Date().toISOString() }).alert);
  });

  await scenario('burst-events', async () => {
    // Success/inbound notes land in the store the /api/owner/health endpoint reads.
    noteInbound('t6');
    noteSendSuccess('t6', '17841400000000123');
    const { getTenantHealthFacts } = await import('../server/tenantHealthStore');
    const facts = getTenantHealthFacts('t6');
    check('inbound recorded', Boolean(facts.lastInboundAt));
    check('send-ok recorded', Boolean(facts.lastSendOkAt));
  });

  console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
  console.log(`passed=${pass} failed=${fail}`);
  if (fail > 0) {
    console.error('Failed checks:', failures.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
