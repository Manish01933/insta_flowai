import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { apiFetch } from './api';

/**
 * The owner's "System Health" panel: per-customer lifecycle health built ONLY
 * from recorded events (server/tenantHealthStore.ts), plus the incident
 * lifecycle (Detected → Acknowledged → Investigating → Resolved) and the
 * honest alert-channel setup state.
 *
 * Deliberate choices:
 *  - Own fetch + 60 s auto-refresh (bounded, cheap endpoint) + manual refresh.
 *  - Incident actions POST back to the same owner-gated endpoint; the acting
 *    viewer is the signed-in owner (no extra headers needed).
 *  - Never claims delivery that did not happen: an unconfigured email channel
 *    renders the setup-required sentence, not a fake "sent".
 */

interface HealthRow {
  tenantId: string;
  customerName: string | null;
  instagramAccountIdMasked: string | null;
  connected: boolean;
  liveState: string;
  botEnabled: boolean;
  botPaused: boolean;
  lastInboundAt: string | null;
  lastSendOkAt: string | null;
  lastSendFailAt: string | null;
  lastSendFailCategory: string | null;
  lastErrorAt: string | null;
  lastErrorCategory: string | null;
  lastErrorDetail: string | null;
  ambiguousLastAt: string | null;
  overall: 'healthy' | 'warning' | 'critical' | 'disconnected' | 'unknown';
}

interface Incident {
  id: string;
  tenantId: string | null;
  igAccountIdMasked: string | null;
  category: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  status: 'detected' | 'acknowledged' | 'investigating' | 'resolved';
  detectedAt: string;
  lastSeenAt: string;
  count: number;
  notifications: Array<{ channel: string; at: string; ok: boolean; error?: string }>;
}

interface Channels {
  email: { configured: boolean; detail: string };
  whatsapp: { configured: boolean; detail: string };
  providerHint: string;
}

interface HealthPayload {
  generatedAt: string;
  rows: HealthRow[];
  incidents: Incident[];
  incidentSummary: { open: number };
  thresholds: { sendFailThreshold: number; aiFailThreshold: number; windowMinutes: number; cooldownMinutes: number };
  channels: Channels;
}

const statusTone: Record<HealthRow['overall'], string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  disconnected: 'bg-slate-100 text-slate-600 border-slate-200',
  unknown: 'bg-slate-50 text-slate-500 border-slate-200',
};

const statusKey: Record<HealthRow['overall'], string> = {
  healthy: 'ops.health.status.healthy',
  warning: 'ops.health.status.warning',
  critical: 'ops.health.status.critical',
  disconnected: 'ops.health.status.disconnected',
  unknown: 'ops.health.status.unknown',
};

const incStatusTone: Record<Incident['status'], string> = {
  detected: 'bg-rose-50 text-rose-700 border-rose-200',
  acknowledged: 'bg-amber-50 text-amber-700 border-amber-200',
  investigating: 'bg-sky-50 text-sky-700 border-sky-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function HealthPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/owner/health');
      const payload = (await res.json()) as HealthPayload & { success?: boolean; error?: string };
      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setData(payload);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'unknown error');
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 60_000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const act = useCallback(
    async (id: string, status: 'acknowledged' | 'investigating' | 'resolved') => {
      setBusy(id);
      try {
        const res = await apiFetch('/api/owner/health/incident', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `HTTP ${res.status}`);
        }
        await load();
      } catch (err: any) {
        setError(err?.message || 'unknown error');
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const fmt = useCallback((iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—'), []);

  const orderedIncidents = useMemo(() => {
    if (!data) return [];
    const rank: Record<Incident['status'], number> = { detected: 0, acknowledged: 1, investigating: 2, resolved: 3 };
    return [...data.incidents].sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
    });
  }, [data]);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('ops.health.title')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('ops.health.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          {t('ops.refresh')}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{t('ops.failed', { msg: error })}</p>}

      {data && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span
            className={`px-2 py-0.5 rounded-full border font-semibold ${
              data.channels.email.configured
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            title={data.channels.email.detail}
          >
            {data.channels.email.configured ? t('ops.health.emailOk') : t('ops.health.emailSetup')}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full border font-semibold ${
              data.channels.whatsapp.configured
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}
            title={data.channels.whatsapp.detail}
          >
            {data.channels.whatsapp.configured ? t('ops.health.whatsappOk') : t('ops.health.whatsappOff')}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
            {t('ops.health.escalation', {
              sendFail: String(data.thresholds.sendFailThreshold),
              aiFail: String(data.thresholds.aiFailThreshold),
              window: String(data.thresholds.windowMinutes),
              cooldown: String(data.thresholds.cooldownMinutes),
            })}
          </span>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colCustomer')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colOverall')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colLastInbound')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colLastSendOk')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colLastFail')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('ops.health.colErrCategory')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((row) => (
              <tr key={row.tenantId} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{row.customerName || row.tenantId}</div>
                  <code className="text-[10px] text-slate-500">{row.tenantId}</code>
                  {row.instagramAccountIdMasked && (
                    <div className="text-[10px] text-slate-400">IG {row.instagramAccountIdMasked}</div>
                  )}
                  {row.botPaused && (
                    <div className="text-[10px] text-amber-700">{t('ops.health.pausedByOwner')}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border ${statusTone[row.overall]}`}
                  >
                    {t(statusKey[row.overall])}
                  </span>
                  {row.ambiguousLastAt && (
                    <p className="text-[10px] text-slate-500 mt-1 max-w-[220px]">{t('ops.health.ambiguousNote')}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{fmt(row.lastInboundAt)}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{fmt(row.lastSendOkAt)}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{fmt(row.lastSendFailAt)}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">
                  {row.lastErrorCategory || '—'}
                  {row.lastErrorDetail && (
                    <p className="text-[10px] text-slate-500 mt-0.5 max-w-[260px] break-words">{row.lastErrorDetail}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">{t('ops.empty')}</p>
        )}
      </div>

      <h3 className="mt-5 text-sm font-bold text-slate-800">{t('ops.health.incidentsTitle')}</h3>
      {orderedIncidents.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">{t('ops.health.incidentsEmpty')}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {orderedIncidents.map((incident) => (
            <li key={incident.id} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                    incident.severity === 'critical'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}
                >
                  {incident.severity === 'critical'
                    ? t('ops.health.incident.sevCritical')
                    : t('ops.health.incident.sevWarning')}
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${incStatusTone[incident.status]}`}>
                  {t(`ops.health.incident.status.${incident.status}`)}
                </span>
                <span className="text-sm font-semibold text-slate-800">{incident.title}</span>
                <span className="text-[10px] text-slate-500">
                  {incident.tenantId ? incident.tenantId.slice(0, 10) : 'platform'} ·{' '}
                  {t('ops.health.incident.occurrences', { count: String(incident.count) })} ·{' '}
                  {t('ops.health.incident.first', {
                    n: String(incident.count),
                    at: fmt(incident.detectedAt),
                  })}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600 break-words">{incident.detail}</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
                <span>
                  {t('ops.health.incident.notified')}{' '}
                  {incident.notifications.map((note, index) => (
                    <span
                      key={`${incident.id}-${note.channel}-${index}`}
                      title={note.error || undefined}
                      className={`mr-1 ${
                        note.ok ? 'text-emerald-600' : 'text-rose-500'
                      }`}
                    >
                      {note.channel}
                      {note.ok ? '✓' : '✗'}
                    </span>
                  ))}
                </span>
              </div>
              {incident.status !== 'resolved' && (
                <div className="mt-2 flex gap-2">
                  {incident.status === 'detected' && (
                    <button
                      type="button"
                      disabled={busy === incident.id}
                      onClick={() => void act(incident.id, 'acknowledged')}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      {t('ops.health.incident.acknowledge')}
                    </button>
                  )}
                  {(incident.status === 'detected' || incident.status === 'acknowledged') && (
                    <button
                      type="button"
                      disabled={busy === incident.id}
                      onClick={() => void act(incident.id, 'investigating')}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-sky-300 text-sky-700 hover:bg-sky-50"
                    >
                      {t('ops.health.incident.investigate')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === incident.id}
                    onClick={() => void act(incident.id, 'resolved')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  >
                    {t('ops.health.incident.resolve')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
