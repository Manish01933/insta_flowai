import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, LifeBuoy } from 'lucide-react';
import { useI18n } from './i18n';
import { apiFetch } from './api';

/**
 * The owner's "project notification": ONE plain-language sentence saying why
 * the project stopped / is struggling, right at the top of the Ops Console.
 *
 * Why a banner of its own: the console already had eleven counters and a
 * technical incident list — great for an engineer, unreadable at a glance when
 * the bot goes quiet at 11pm. The server reduces all of that to a single
 * `rootCause` code (server/rootCause.ts); this component's only job is to make
 * that code unmissable and to say, in the simplest words, what to do next.
 *
 * Deliberate choices:
 *  - Own fetch + 60 s auto-refresh (the endpoint is bounded and cheap), so the
 *    banner works no matter where the console renders it — and never depends on
 *    another component's loading order.
 *  - An older server without `rootCause` renders nothing (never a wrong claim).
 *  - The "what to do" line always points at a real next action: the Connect
 *    fix dialog, the billing section, or `rescue.cmd` on the owner's machine.
 */

interface RootCause {
  code: string;
  severity: 'ok' | 'warning' | 'critical';
  affected: number;
  accounts: number;
}

const severityStyle: Record<RootCause['severity'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  critical: 'border-rose-300 bg-rose-50 text-rose-900',
};

const severityChip: Record<RootCause['severity'], string> = {
  ok: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  critical: 'bg-rose-600 text-white',
};

export default function RootCauseBanner() {
  const { t } = useI18n();
  const [rootCause, setRootCause] = useState<RootCause | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/owner/health');
      const payload = (await res.json()) as { success?: boolean; rootCause?: RootCause };
      if (res.ok && payload.success !== false && payload.rootCause) {
        setRootCause(payload.rootCause);
      }
    } catch {
      // The HealthPanel below already surfaces fetch errors; the notification
      // must never add its own noise on top of a failing server.
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 60_000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  if (!rootCause) return null;

  return (
    <section
      aria-label={t('ops.root.title')}
      className={`rounded-2xl border px-4 py-3 ${severityStyle[rootCause.severity]}`}
    >
      <div className="flex items-start gap-3">
        <BellRing className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${severityChip[rootCause.severity]}`}>
              {rootCause.severity === 'ok'
                ? t('ops.root.chipOk')
                : rootCause.severity === 'critical'
                  ? t('ops.root.chipCritical')
                  : t('ops.root.chipWarning')}
            </span>
            <span className="text-[11px] font-semibold opacity-80">{t('ops.root.title')}</span>
            {rootCause.severity !== 'ok' && rootCause.accounts > 0 && (
              <span className="text-[11px] opacity-70">
                {t('ops.root.affected', {
                  n: String(rootCause.affected),
                  total: String(rootCause.accounts),
                })}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm font-bold leading-snug">
            {t(`ops.root.${rootCause.code}.title`, { n: String(rootCause.affected) })}
          </p>
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            {t(`ops.root.${rootCause.code}.fix`)}
          </p>

          {rootCause.severity !== 'ok' && (
            <p className="mt-2 text-[11px] leading-relaxed opacity-80 inline-flex items-start gap-1.5">
              <LifeBuoy className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>{t('ops.root.rescueHint')}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
