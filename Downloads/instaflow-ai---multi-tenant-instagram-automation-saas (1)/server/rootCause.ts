import type { HealthIncident } from './healthIncidentStore';

/**
 * "Project rukne ka MAIN karan" — one answer, in plain language, for the Ops
 * Console notification banner.
 *
 * Why this exists: the console already had eleven counters, a per-customer
 * health table and a technical incident list — everything an engineer needs and
 * nothing an owner can read at a glance. When the bot stops answering, the
 * owner's real question is singular: *why did it stop?* This module answers
 * exactly that, from the same real facts the health endpoint already computes
 * (never from a guess): which accounts cannot reply right now, why, and which
 * of those reasons covers the most accounts — that winner is the "main karan".
 *
 * Rules that keep it honest:
 *  - Pure function of its inputs; no timers, no I/O, no env. The unit test can
 *    pin every branch.
 *  - Platform conditions (storage write failures, Meta webhook failures) always
 *    win over per-account causes: they break every customer at once, so naming
 *    one account's token as "the reason" would be a lie.
 *  - "Silent bot" (messages arriving, nothing going out) outranks the softer
 *    symptoms because it is the closest thing to "project ruk gaya".
 *  - severity is about fleet impact: `critical` only when NO account in the
 *    fleet can currently reply (or a platform incident is open), `warning` when
 *    some accounts are affected, `ok` when none are.
 */

export type RootCauseCode =
  | 'ok'
  | 'storage'
  | 'webhook'
  | 'token-expired'
  | 'billing'
  | 'paused'
  | 'disconnected'
  | 'ai'
  | 'send-fail'
  | 'silent'
  | 'incident';

export type RootCauseSeverity = 'ok' | 'warning' | 'critical';

/** The per-account facts the health endpoint already computed. */
export interface RootCauseAccount {
  connected: boolean;
  liveState: string;
  botEnabled: boolean;
  botPaused: boolean;
  /** The bot is off because the plan/trial ran out (not an owner pause). */
  needsPlan: boolean;
  /** The row verdict: 'healthy' | 'warning' | 'critical' | 'disconnected' | 'unknown'. */
  overall: string;
}

export interface RootCauseIncident {
  category: string;
  severity: 'critical' | 'warning';
  status: string;
}

export interface RootCause {
  code: RootCauseCode;
  severity: RootCauseSeverity;
  /** Kitne accounts (account causes ke liye) ya kitne incidents (platform causes). */
  affected: number;
  /** Fleet ka size — UI "3/8 accounts" dikhane ke liye. */
  accounts: number;
}

/** Can this account actually answer an inbound DM right now? */
function canReply(account: RootCauseAccount): boolean {
  return (
    account.connected &&
    account.botEnabled &&
    !account.botPaused &&
    account.liveState !== 'NEEDS_REAUTH' &&
    account.overall !== 'critical'
  );
}

/**
 * Account-level causes, counted. One account can appear under more than one
 * cause (disconnected AND plan-expired); the "main karan" is the biggest count,
 * which is exactly how an owner would summarise it out loud.
 */
const ACCOUNT_CAUSES = [
  {
    code: 'token-expired' as const,
    count: (a: RootCauseAccount) => (a.connected && a.liveState === 'NEEDS_REAUTH' ? 1 : 0),
  },
  {
    code: 'billing' as const,
    count: (a: RootCauseAccount) => (!a.botEnabled && !a.botPaused ? 1 : 0),
  },
  {
    code: 'paused' as const,
    count: (a: RootCauseAccount) => (a.botPaused ? 1 : 0),
  },
  {
    code: 'disconnected' as const,
    count: (a: RootCauseAccount) => (!a.connected ? 1 : 0),
  },
  {
    code: 'send-fail' as const,
    // A NEEDS_REAUTH row is also `overall: 'critical'`, but its real cause is
    // the dead token, which the first cause already claims.
    count: (a: RootCauseAccount) =>
      a.connected && a.liveState !== 'NEEDS_REAUTH' && a.overall === 'critical' ? 1 : 0,
  },
] as const;

/** Incident categories that are platform-wide root causes (not one customer). */
const PLATFORM_CAUSES: Array<{ code: RootCauseCode; category: string }> = [
  { code: 'storage', category: 'storage' },
  { code: 'webhook', category: 'webhook' },
];

export function explainRootCause(
  accounts: RootCauseAccount[],
  incidents: RootCauseIncident[],
): RootCause {
  const open = incidents.filter((i) => i.status !== 'resolved');

  // 1. Platform conditions first: they break everybody, so they are the reason.
  for (const platform of PLATFORM_CAUSES) {
    const hits = open.filter((i) => i.category === platform.category);
    if (hits.length) {
      return {
        code: platform.code,
        severity: hits.some((i) => i.severity === 'critical') ? 'critical' : 'warning',
        affected: hits.length,
        accounts: accounts.length,
      };
    }
  }

  // 2. The biggest per-account cause wins — that is the "main karan".
  //    Ties fall to the order in ACCOUNT_CAUSES (cause over symptom).
  let best: { code: RootCauseCode; count: number } | null = null;
  for (const cause of ACCOUNT_CAUSES) {
    const count = accounts.reduce((sum, a) => sum + cause.count(a), 0);
    if (count > 0 && (!best || count > best.count)) best = { code: cause.code, count };
  }
  if (best) {
    const fleetBlocked = accounts.length > 0 && !accounts.some(canReply);
    return {
      code: best.code,
      severity: fleetBlocked ? 'critical' : 'warning',
      affected: best.count,
      accounts: accounts.length,
    };
  }

  // 3. Symptoms recorded as incidents but without a broken account yet.
  const aiFailures = open.filter((i) => i.category === 'ai').length;
  if (aiFailures) return incidentCause('ai', aiFailures, open, accounts.length);
  const silent = open.filter((i) => i.category === 'no-reply').length;
  if (silent) return incidentCause('silent', silent, open, accounts.length);

  // 4. Any other open incident still deserves the notification.
  if (open.length) return incidentCause('incident', open.length, open, accounts.length);

  return { code: 'ok', severity: 'ok', affected: 0, accounts: accounts.length };
}

function incidentCause(
  code: RootCauseCode,
  affected: number,
  open: RootCauseIncident[],
  accounts: number,
): RootCause {
  return {
    code,
    severity: open.some((i) => i.severity === 'critical') ? 'critical' : 'warning',
    affected,
    accounts,
  };
}

/**
 * Human-readable name for a code, for logs and the rescue report (the ops UI
 * translates through src/i18n.tsx instead — this is for terminal output).
 */
export function rootCauseLabel(code: RootCauseCode): string {
  const labels: Record<RootCauseCode, string> = {
    ok: 'sab theek hai',
    storage: 'server data save nahi kar pa raha (storage)',
    webhook: 'Meta se messages aana band (webhook)',
    'token-expired': 'Instagram token expire ho gaya',
    billing: 'plan/trial khatam — bot band',
    paused: 'bot pause kiya gaya hai',
    disconnected: 'Instagram connect nahi hai',
    ai: 'AI jawab nahi de pa raha',
    'send-fail': 'jawab Instagram tak nahi pahunch rahe',
    silent: 'bot chup hai — jawab ja hi nahi rahe',
    incident: 'khula incident hai',
  };
  return labels[code];
}

// Re-exported for server.ts so the health endpoint builds the input without
// importing internals twice.
export type { HealthIncident };
