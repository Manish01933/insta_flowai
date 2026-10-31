import {
  onHealthEvent,
  countSendFailuresWithin,
  countAiFailuresWithin,
  getTenantHealthFacts,
  _resetHealthStoreForTests,
  type HealthEvent,
} from './tenantHealthStore';
import {
  openIncident,
  recordNotification,
  startIncidentSweeper,
  type HealthIncident,
} from './healthIncidentStore';
// Re-exports so server.ts has ONE import surface for health/incidents.
export { openIncident, getOpenIncidentCount, listIncidents, setIncidentStatus } from './healthIncidentStore';
export type { HealthIncident, IncidentStatus } from './healthIncidentStore';
import { isOwnerWhatsAppConfigured, getOwnerWhatsAppLabel, sendOwnerWhatsApp } from './ownerNotify';
import { getProfile } from './profileStore';
import { getChatCountsByTenant } from './chatStore';
import { buildTenantOverview } from './opsOverview';
import type { Lang } from './i18n';

/**
 * Owner alert engine: turns recorded tenant-health events into incidents and
 * delivers them on the channels that are actually configured — the Ops Console
 * dashboard (always), email (needs ALERT_EMAIL_* env vars) and the owner's own
 * WhatsApp relay (reuses ownerNotify.ts, best-effort personal relay).
 *
 * Honesty rules:
 *  - If email is not configured, delivery reports say { channel, ok:false,
 *    error:'setup-required…' } — the console shows "needs setup", nothing
 *    pretends an email went out.
 *  - An alert NEVER contains access tokens, OAuth secrets, encryption keys or
 *    full customer messages. Details come from classifyError, which is already
 *    redacted; this module redacts again before building the text.
 *  - Uncertain send outcomes (timeout / network throw — the message may have
 *    reached Meta) do NOT open reply-failure incidents: the evidence does not
 *    support "the reply failed". They stay counted in the health store
 *    (ambiguous flag) for the owner to see.
 *  - Thresholds, window length and the cooldown are env-configurable so the
 *    owner can tune noise without touching code.
 */

// Escalation thresholds (env-tunable, clamped).
function intEnv(name: string, def: number, min: number, max: number): number {
  const raw = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(raw)) return def;
  return Math.min(max, Math.max(min, raw));
}

export const ALERT_DEFAULTS = {
  sendFailThreshold: intEnv('ALERT_SEND_FAIL_THRESHOLD', 3, 2, 100),
  aiFailThreshold: intEnv('ALERT_AI_FAIL_THRESHOLD', 3, 2, 100),
  windowMinutes: intEnv('ALERT_WINDOW_MINUTES', 30, 5, 1440),
  cooldownMinutes: intEnv('ALERT_COOLDOWN_MINUTES', 60, 5, 10080),
};

const EMAIL_API_URL_DEFAULT = 'https://api.resend.com/emails';

function emailFrom(): string { return (process.env.ALERT_EMAIL_FROM || '').trim(); }
function emailTo(): string { return (process.env.ALERT_EMAIL_TO || '').trim(); }
function emailApiKey(): string { return (process.env.ALERT_EMAIL_API_KEY || '').trim(); }
function emailApiUrl(): string {
  return (process.env.ALERT_EMAIL_API_URL || '').trim() || EMAIL_API_URL_DEFAULT;
}

/**
 * Whether admin email alerts can actually be sent. False is NOT an error — the
 * console and /healthz report it as setup-required so a missing key is visible
 * instead of alerts silently not existing.
 */
export function isEmailAlertConfigured(): boolean {
  return Boolean(emailApiKey() && emailTo() && emailFrom());
}

export interface AlertChannelStatus {
  email: { configured: boolean; detail: string };
  whatsapp: { configured: boolean; detail: string };
  providerHint: string;
}

export function getAlertChannelStatus(): AlertChannelStatus {
  const to = emailTo();
  return {
    email: {
      configured: isEmailAlertConfigured(),
      detail: isEmailAlertConfigured()
        ? `${to.slice(0, 2)}***@${to.includes('@') ? to.split('@')[1] : '***'}`
        : 'Set ALERT_EMAIL_API_KEY + ALERT_EMAIL_FROM + ALERT_EMAIL_TO on the host to enable email alerts.',
    },
    whatsapp: {
      configured: isOwnerWhatsAppConfigured(),
      detail: isOwnerWhatsAppConfigured()
        ? getOwnerWhatsAppLabel()
        : 'Not configured (COMPLAINT_WHATSAPP_TO / CALLMEBOT_API_KEY).',
    },
    providerHint:
      'Email adapter sends one JSON POST {from,to,subject,text} to ALERT_EMAIL_API_URL ' +
      '(default works with Resend). Any REST provider with that body shape works — no SDK, no customer data.',
  };
}

export type SendResult = { ok: true } | { ok: false; error: string; setupRequired?: boolean };

/** One JSON POST. Never throws. Explicitly reports setup-required when unconfigured. */
export async function sendAlertEmail(subject: string, text: string): Promise<SendResult> {
  if (!isEmailAlertConfigured()) {
    return {
      ok: false,
      error: 'setup-required: ALERT_EMAIL_* not configured on this host',
      setupRequired: true,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(emailApiUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emailApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: emailTo(),
        subject: String(subject).slice(0, 200),
        text: String(text).slice(0, 4000),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ok: false, error: `alert email HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'alert email timed out' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Incident creation rules (real event → incident)
// ---------------------------------------------------------------------------

function redact(raw: unknown): string {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/(access_token|client_secret|api_?key|token|password)=?[^&\s"',}]+/gi, '$1=<redacted>')
    .slice(0, 300);
}

function cooldownMs(): number {
  return ALERT_DEFAULTS.cooldownMinutes * 60 * 1000;
}

function nameOf(tenantId: string): string {
  try {
    return getProfile(tenantId)?.username || tenantId.slice(0, 10);
  } catch {
    return tenantId.slice(0, 10);
  }
}

/** Handle one health-store event: threshold rules open/bump incidents and notify. */
export async function handleTenantEvent(event: HealthEvent, tenantId: string): Promise<void> {
  const platform = tenantId === '__platform__';
  const windowMs = ALERT_DEFAULTS.windowMinutes * 60 * 1000;

  // Storage failures are platform conditions — never a customer's fault.
  if (event.kind === 'storage-fail') {
    const { incident, shouldNotify } = openIncident({
      key: 'storage|persistence',
      tenantId: null,
      category: 'storage',
      severity: 'critical',
      title: 'Persistent storage write failure',
      detail: redact(event.detail || 'JSON file write failed'),
      cooldownMs: cooldownMs(),
    });
    if (shouldNotify) await deliver(incident, 'Platform');
    return;
  }

  // Reply failures: only CONFIRMED failures (429/5xx) escalate; ambiguous
  // outcomes stay invisible to incident rules (no resend, no false alarm).
  if (event.kind === 'send-fail' && !event.ambiguous && !platform) {
    if (event.category === 'auth') {
      const { incident, shouldNotify } = openIncident({
        key: `auth|${tenantId}`,
        tenantId,
        igAccountIdMasked: event.igAccountIdMasked || null,
        category: 'auth',
        severity: 'critical',
        title: 'Instagram authorization rejected',
        detail:
          'Meta refused the stored token (expired/revoked). The customer must reconnect — no automatic reconnection.',
        cooldownMs: cooldownMs(),
      });
      if (shouldNotify) await deliver(incident, nameOf(tenantId));
      return;
    }
    const count = countSendFailuresWithin(tenantId, windowMs);
    if (count >= ALERT_DEFAULTS.sendFailThreshold) {
      const { incident, shouldNotify } = openIncident({
        key: `send-fail|${tenantId}|${event.category || 'unknown'}`,
        tenantId,
        igAccountIdMasked: event.igAccountIdMasked || null,
        category: event.category || 'unknown',
        severity: 'warning',
        title: 'Repeated Instagram reply failures',
        detail: `${count} confirmed send failure(s) in ${ALERT_DEFAULTS.windowMinutes} min (category ${event.category || 'unknown'}). ${redact(event.detail)}`,
        cooldownMs: cooldownMs(),
      });
      if (shouldNotify) await deliver(incident, nameOf(tenantId));
    }
    return;
  }

  // AI provider failures above threshold.
  if (event.kind === 'ai-fail' && !platform) {
    const count = countAiFailuresWithin(tenantId, windowMs);
    if (count >= ALERT_DEFAULTS.aiFailThreshold) {
      const { incident, shouldNotify } = openIncident({
        key: `ai-fail|${tenantId}`,
        tenantId,
        category: 'ai',
        severity: 'warning',
        title: 'AI provider failures',
        detail: `${count} AI failure(s) in ${ALERT_DEFAULTS.windowMinutes} min. ${redact(event.detail)}`,
        cooldownMs: cooldownMs(),
      });
      if (shouldNotify) await deliver(incident, nameOf(tenantId));
    }
    return;
  }

  // Webhook processing failures (unrouted deliveries, exceptions).
  if (event.kind === 'webhook-fail') {
    const { incident, shouldNotify } = openIncident({
      key: `webhook|${platform ? 'platform' : tenantId}`,
      tenantId: platform ? null : tenantId,
      category: 'webhook',
      severity: 'warning',
      title: platform ? 'Webhook processing failure' : 'DMs received with no routed account',
      detail: redact(event.detail || event.kind),
      cooldownMs: cooldownMs(),
    });
    if (shouldNotify) await deliver(incident, platform ? 'Platform' : nameOf(tenantId));
  }
}

/** Build the owner-facing alert text. Short, structured, redacted, actionable. */
export function buildAlertText(incident: HealthIncident, customerName: string): string {
  // Redact at RENDER time too: an incident opened from a path that did not
  // redact its detail must still never leak a secret into email/WhatsApp.
  const when = new Date(incident.lastSeenAt).toISOString();
  const detail = redact(incident.detail);
  const actions: Record<string, string> = {
    auth: 'Ask the customer to reconnect Instagram from their dashboard (never auto-reconnect).',
    storage: 'Check the host volume / DATA_DIR mount; verify disk space and process health.',
    webhook: 'Check webhook delivery logs and the connected-account mapping.',
    ai: 'Check OPENROUTER/GEMINI/OMNIROUTE keys and model status; raise the threshold if this is expected.',
  };
  const nextAction =
    actions[incident.category] ||
    'Open the Ops Console, filter by this customer, and inspect the recent error categories.';
  return [
    `[InstaFlow AI] ${incident.severity.toUpperCase()} · ${incident.title}`,
    `Customer: ${customerName}${incident.igAccountIdMasked ? ` · account ${incident.igAccountIdMasked}` : ''}`,
    `Detected: ${when} (UTC) — category: ${incident.category} · occurrence #${incident.count}`,
    `Detail: ${detail}`,
    `Incident: ${incident.id} (${incident.status})`,
    `Next: ${nextAction}`,
    `Console: ${process.env.APP_URL || '(set APP_URL)'}/ops`,
  ].join('\n');
}

/** Deliver on the channels that are actually configured; record the truth. */
export async function deliver(incident: HealthIncident, customerName: string): Promise<void> {
  const text = buildAlertText(incident, customerName);
  const at = new Date().toISOString();

  // The dashboard channel is always the truth: the incident row itself.
  recordNotification(incident.id, { channel: 'dashboard', at, ok: true });

  const email = await sendAlertEmail(`[InstaFlow AI] ${incident.title} — ${customerName}`, text);
  recordNotification(incident.id, {
    channel: 'email',
    at,
    ok: email.ok,
    error: email.ok ? undefined : email.error,
  });

  if (!process.env.ALERT_WHATSAPP_DISABLE || process.env.ALERT_WHATSAPP_DISABLE === 'false') {
    const whatsapp = await sendOwnerWhatsApp(text);
    recordNotification(incident.id, {
      channel: 'whatsapp',
      at,
      ok: whatsapp.ok,
      error: whatsapp.ok ? undefined : whatsapp.error,
    });
  }

  if (!email.ok) {
    console.warn(`[alerts] email alert not sent: ${email.error}`);
  }
}

// ---------------------------------------------------------------------------
// "Replies stopped despite incoming events" — evidence-gated, never a guess
// ---------------------------------------------------------------------------

export interface SilentBotSnapshot {
  tenantId: string;
  customerName: string;
  connected: boolean;
  liveState: string;
  botEnabled: boolean;
  humanTakeover: boolean;
  lastInboundAt: string | null;
  lastSendOkAt: string | null;
  lastSendFailAt: string | null;
  ambiguousLastAt: string | null;
  maxSilenceHours: number;
}

export interface SilentVerdict {
  alert: boolean;
  reason: string;
}

/**
 * The evidence that supports "replies stopped": a real inbound DM arrived AFTER
 * the last successful send, the bot is supposed to be on (connected, enabled,
 * no takeover), and a CONFIRMED failure — never mere uncertainty — is present.
 * An account that simply received no DMs is healthy, not silent.
 */
export function evaluateSilentBot(snapshot: SilentBotSnapshot): SilentVerdict {
  const not = (why: string): SilentVerdict => ({ alert: false, reason: why });
  if (!snapshot.connected) return not('not connected');
  if (snapshot.liveState === 'NEEDS_REAUTH') return not('auth incident already covers it');
  if (!snapshot.botEnabled) return not('bot intentionally off');
  if (snapshot.humanTakeover) return not('human takeover active');
  const inbound = snapshot.lastInboundAt ? Date.parse(snapshot.lastInboundAt) : NaN;
  if (!Number.isFinite(inbound)) return not('no inbound evidence');
  const okAt = snapshot.lastSendOkAt ? Date.parse(snapshot.lastSendOkAt) : NaN;
  const failAt = snapshot.lastSendFailAt ? Date.parse(snapshot.lastSendFailAt) : NaN;
  const ambiguousAt = snapshot.ambiguousLastAt ? Date.parse(snapshot.ambiguousLastAt) : NaN;
  if (Number.isFinite(okAt) && okAt >= inbound) return not('reply went out after latest inbound');
  if (!Number.isFinite(failAt)) return not('no confirmed failure recorded');
  if (failAt <= inbound) return not('failure predates the latest inbound');
  // Ambiguity: if the ONLY outcome after the inbound was uncertain, the evidence
  // does NOT support "broken" — the owner sees the ambiguous counter instead.
  if (Number.isFinite(ambiguousAt) && (!Number.isFinite(failAt) || ambiguousAt > failAt)) {
    return not('latest send outcome is uncertain (ambiguous)');
  }
  if (Date.now() - Math.max(failAt, inbound) > Math.max(1, snapshot.maxSilenceHours) * 3600_000) {
    return not('condition stale (would be old news)');
  }
  if (Date.now() - inbound > Math.max(1, snapshot.maxSilenceHours) * 3600_000) {
    return not('inbound too old to conclude silence');
  }
  return {
    alert: true,
    reason: 'inbound after last success, confirmed failure present, bot expected on',
  };
}

/** Wire the engine: register the event listener + start the incident sweeper. */
export function startAlertEngine(): void {
  onHealthEvent((event, tenantId) => {
    void handleTenantEvent(event, tenantId).catch((err) => {
      console.error('[alerts] incident rule failed:', err);
    });
  });
  startIncidentSweeper();
}


/**
 * "Replies stopped" watcher: every 15 minutes (housekeeping, unref'd) it
 * re-evaluates every tenant with REAL recorded facts and opens a no-reply
 * incident only when the evidence supports it (see evaluateSilentBot).
 * It is deliberately expensive-safe: buildTenantOverview is O(tenants) over
 * small data — no full-history scans, no extra polling from the browser.
 */
export function startNoReplyWatcher(maxSilenceHours?: number): void {
  const hours = maxSilenceHours ?? intEnv('ALERT_SILENCE_MAX_HOURS', 6, 1, 168);
  const run = async (): Promise<void> => {
    const overview = buildTenantOverview('en' as Lang);
    const chatCounts = getChatCountsByTenant();
    for (const row of overview.rows) {
      const facts = getTenantHealthFacts(row.tenantId);
      const ambiguousLastAt =
        facts.events.find((event) => event.kind === 'send-fail' && event.ambiguous)?.at || null;
      const verdict = evaluateSilentBot({
        tenantId: row.tenantId,
        customerName: row.username || row.instagram.username || row.tenantId.slice(0, 10),
        connected: row.instagram.connected,
        liveState: row.instagram.liveState,
        botEnabled: row.bot.allowed && !row.bot.paused,
        humanTakeover: (chatCounts[row.tenantId]?.takeovers || 0) > 0,
        lastInboundAt: facts.lastInboundAt,
        lastSendOkAt: facts.lastSendOkAt,
        lastSendFailAt: facts.lastSendFailAt,
        ambiguousLastAt,
        maxSilenceHours: hours,
      });
      if (!verdict.alert) continue;
      const { incident, shouldNotify } = openIncident({
        key: `no-reply|${row.tenantId}`,
        tenantId: row.tenantId,
        igAccountIdMasked: row.instagram.accountId ? row.instagram.accountId.slice(0, 5) + '***' : null,
        category: 'no-reply',
        severity: 'warning',
        title: 'Bot received DMs but no reply went out',
        detail:
          `Last inbound ${facts.lastInboundAt}; last confirmed failure ${facts.lastSendFailAt} ` +
          `(category ${facts.lastSendFailCategory}). ${verdict.reason}.`,
        cooldownMs: cooldownMs(),
      });
      if (shouldNotify) await deliver(incident, row.username || row.tenantId.slice(0, 10));
    }
  };
  void run().catch((err) => console.error('[alerts] no-reply sweep failed:', err));
  setInterval(() => {
    run().catch((err) => console.error('[alerts] no-reply sweep failed:', err));
  }, 15 * 60_000).unref();
}

/** Test hooks. */
export function resetAlertsForTests(): void {
  _resetHealthStoreForTests();
}

export { maskId } from './tenantHealthStore';
