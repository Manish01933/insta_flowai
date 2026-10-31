import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Gift,
  Instagram,
  TimerOff,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiFetch } from './api';
import { useI18n } from './i18n';

/**
 * OPS Onboarding board (Feature 3 + Feature 4, owner-only).
 *
 * Everything shown comes from GET /api/owner/onboarding — real recorded
 * timestamps and server-validated statuses; nothing simulated. Actions go
 * through POST /api/owner/onboarding/actions; the button re-enables only when
 * the backend answers, so "pending → success" can never be faked by the UI.
 * WhatsApp numbers are rendered MASKED in the list (the detail endpoint, which
 * the owner is authorized to see, carries the raw value — not loaded here to
 * keep the board light).
 */

interface Metrics {
  total: number;
  registeredToday: number;
  registeredYesterday: number;
  freePlansActive: number;
  instagramConnected: number;
  awaitingReview: number;
  approved: number;
  needsCustomerAction: number;
  stalled: number;
}

interface Row {
  tenantId: string;
  customerName: string | null;
  status: string;
  statusChangedAt: string;
  registeredAt: string | null;
  approvedAt: string | null;
  contact: {
    businessName: string | null;
    contactPerson: string | null;
    whatsappNumber: string | null;
    language: string | null;
    consentGiven: boolean;
    consentAt: string | null;
    optedOut: boolean;
  };
  kb: { status: string; version: number; pendingInput: number; approvedBy: string | null; approvedAt: string | null } | null;
}

type CallState = 'idle' | 'busy' | 'error';
type ActionName =
  | 'request-info'
  | 'mark-review-pending'
  | 'regenerate-draft'
  | 'approve-kb'
  | 'request-kb-changes'
  | 'approve-customer'
  | 'mark-reconnect-needed';
type TemplateId = 'instagram-connected' | 'permission-required' | 'approval-completed' | 'additional-info-required';

const ACTIONS: Array<{ id: ActionName; labelKey: string; danger?: boolean }> = [
  { id: 'request-info', labelKey: 'ops.onboarding.action.requestInfo' },
  { id: 'mark-review-pending', labelKey: 'ops.onboarding.action.review' },
  { id: 'regenerate-draft', labelKey: 'ops.onboarding.action.regenerate' },
  { id: 'approve-kb', labelKey: 'ops.onboarding.action.approveKb' },
  { id: 'approve-customer', labelKey: 'ops.onboarding.action.approveCustomer' },
  { id: 'mark-reconnect-needed', labelKey: 'ops.onboarding.action.reconnect' },
];

export default function OpsOnboarding() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [provider, setProvider] = useState<{ configured: boolean; detail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CallState>('idle');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resultLine, setResultLine] = useState<string | null>(null);
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  // Owner's full WhatsApp number per opened row — the detail endpoint is the
  // authorized source; the list itself keeps showing the masked one until
  // the owner expands the customer.
  const [detailPhone, setDetailPhone] = useState<Record<string, string | null>>({});
  const [copiedPhoneTenant, setCopiedPhoneTenant] = useState<string | null>(null);
  // Registration-date filter (the owner's "aaj kitne customer aaye?" answer).
  // Values are offsets from today; a custom range uses the two date inputs.
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Filtering happens on the REAL `registeredAt` timestamps (midnight to
  // midnight), never on display strings, so the board agrees with the metrics.
  const filteredRows = (() => {
    const dayStart = (d: Date) =>
      new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).getTime();
    const now = new Date();
    const startOfToday = dayStart(now);
    const startOfYesterday = startOfToday - 86_400_000;
    const fromTs = customFrom ? dayStart(new Date(customFrom)) : null;
    const toTs = customTo ? dayStart(new Date(customTo)) + 86_370_000 : null; // include the whole "to" day
    return rows.filter((row) => {
      if (!row.registeredAt) return dateFilter === 'all';
      const ts = Date.parse(row.registeredAt);
      if (!Number.isFinite(ts)) return dateFilter === 'all';
      switch (dateFilter) {
        case 'today': return ts >= startOfToday;
        case 'yesterday': return ts >= startOfYesterday && ts < startOfToday;
        case '7d': return ts >= startOfToday - 7 * 86_400_000;
        case '30d': return ts >= startOfToday - 30 * 86_400_000;
        case 'custom': return fromTs !== null && toTs !== null && ts >= fromTs && ts <= toTs;
        default: return true;
      }
    });
  })();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/owner/onboarding');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (res.status === 403) {
          setError(t('ops.forbidden'));
        } else {
          setError(String(data?.error || 'Load failed.'));
        }
        return;
      }
      setMetrics(data.metrics as Metrics);
      setRows((data.rows || []) as Row[]);
      setProvider(data.whatsapp || null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Expanding a row loads its FULL contact once (owner-authorized) so the
  // owner can copy the raw number into WhatsApp without any masking.
  const toggleDetail = async (tenantId: string) => {
    const nextOpen = openTenant === tenantId ? null : tenantId;
    setOpenTenant(nextOpen);
    if (nextOpen && !(nextOpen in detailPhone)) {
      try {
        const res = await apiFetch(`/api/owner/onboarding/detail/${encodeURIComponent(tenantId)}`);
        const data = await res.json().catch(() => null);
        const raw = String(data?.contact?.whatsappNumber || '') || null;
        setDetailPhone((prev) => ({ ...prev, [tenantId]: raw }));
      } catch {
        setDetailPhone((prev) => ({ ...prev, [tenantId]: null }));
      }
    }
  };

  const copyFullPhone = async (tenantId: string, phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhoneTenant(tenantId);
      window.setTimeout(() => setCopiedPhoneTenant(null), 1500);
    } catch {
      // Clipboard blocked — the number stays visible for a manual copy.
    }
  };

  const runAction = async (tenantId: string, action: ActionName | TemplateId) => {
    setBusy('busy');
    setBusyKey(`${tenantId}:${action}`);
    setResultLine(null);
    try {
      const res = await apiFetch('/api/owner/onboarding/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action, reason: 'From OPS board', allowDuplicate: true }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && data?.success;
      setResultLine(
        ok
          ? data.status || data.kbStatus || data.approvedAt || 'done'
          : String(data?.error || `Failed (${res.status})`)
      );
      await load();
    } catch (err: any) {
      setResultLine(String(err?.message || 'Request failed.'));
    } finally {
      setBusy('idle');
      setBusyKey(null);
    }
  };

  const mask = (value: string | null): string => value || '—';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('ops.onboarding.title')}</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
        >
          {t('ops.refresh')}
        </button>
      </div>

      {loading && <p className="text-xs text-slate-400">{t('ops.loading')}</p>}
      {!loading && error && <p className="text-xs text-rose-700">{error}</p>}

      {!loading && !error && metrics && (
        <>
          {/* Real counters only — computed on the server from recorded events.
              Each main point gets its own accent (left bar + tint + icon) so the
              eight counters are distinguishable at a glance. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
            {(
              [
                ['ops.onboarding.metrics.total', metrics.total, Users, 'border-l-indigo-500 bg-indigo-50/60', 'text-indigo-700'],
                ['ops.onboarding.metrics.today', metrics.registeredToday, TrendingUp, 'border-l-sky-500 bg-sky-50/60', 'text-sky-700'],
                ['ops.onboarding.metrics.freePlans', metrics.freePlansActive, Gift, 'border-l-teal-500 bg-teal-50/60', 'text-teal-700'],
                ['ops.onboarding.metrics.connected', metrics.instagramConnected, Instagram, 'border-l-fuchsia-500 bg-fuchsia-50/60', 'text-fuchsia-700'],
                ['ops.onboarding.metrics.awaitingReview', metrics.awaitingReview, Clock, 'border-l-amber-500 bg-amber-50/60', 'text-amber-700'],
                ['ops.onboarding.metrics.approved', metrics.approved, BadgeCheck, 'border-l-emerald-500 bg-emerald-50/60', 'text-emerald-700'],
                ['ops.onboarding.metrics.needsAction', metrics.needsCustomerAction, AlertCircle, 'border-l-rose-500 bg-rose-50/60', 'text-rose-700'],
                ['ops.onboarding.metrics.stalled', metrics.stalled, TimerOff, 'border-l-red-500 bg-red-50/60', 'text-red-700'],
              ] as Array<[string, number, React.ComponentType<{ className?: string }>, string, string]>
            ).map(([key, value, Icon, accent, tone]) => (
              <div key={key} className={`rounded-xl border border-slate-200 border-l-4 ${accent} px-3 py-2`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t(key)}</p>
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} aria-hidden="true" />
                </div>
                <p className={`text-base font-bold ${tone}`}>{value}</p>
              </div>
            ))}
          </div>

          {provider && (
            <p className={`mb-3 text-[11px] ${provider.configured ? 'text-emerald-700' : 'text-amber-700'}`}>
              {t('ops.onboarding.whatsappProvider', {
                state: provider.configured ? t('ops.onboarding.providerOn') : t('ops.onboarding.providerOff'),
              })}
            </p>
          )}

          {resultLine && <p className="mb-2 text-[11px] text-slate-600">↳ {resultLine}</p>}

          {/* Date dropdown: aaj / kal / 7 din / 30 din / custom range —
              hamesha registration date par. */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
            >
              <option value="all">{t('ops.onboarding.date.all')}</option>
              <option value="today">{t('ops.onboarding.date.today')}</option>
              <option value="yesterday">{t('ops.onboarding.date.yesterday')}</option>
              <option value="7d">{t('ops.onboarding.date.last7')}</option>
              <option value="30d">{t('ops.onboarding.date.last30')}</option>
              <option value="custom">{t('ops.onboarding.date.custom')}</option>
            </select>
            {dateFilter === 'custom' && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                />
              </>
            )}
            <span className="text-[11px] text-slate-400">
              {t('ops.onboarding.date.showing', { count: String(filteredRows.length), total: String(rows.length) })}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-slate-400">{t('ops.onboarding.empty')}</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-xs text-slate-400">{t('ops.onboarding.date.noMatch')}</p>
          ) : (
            <div className="space-y-2">
              {filteredRows.map((row) => {
                // NAYA: last 7 din ke naye customers ko special highlight —
                // real registration timestamp se, display string se nahi.
                const regTs = row.registeredAt ? Date.parse(row.registeredAt) : NaN;
                const isNew = Number.isFinite(regTs) && Date.now() - regTs < 7 * 86_400_000;
                return (
                <div key={row.tenantId} className={`rounded-xl ${isNew ? 'border-2 border-emerald-400 bg-emerald-50/70' : 'border border-slate-200'}`}>
                  <button
                    type="button"
                    onClick={() => void toggleDetail(row.tenantId)}
                    className="w-full text-left px-3 py-2 flex flex-wrap items-center gap-2"
                  >
                    {isNew && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-emerald-600 text-white">
                        NAYA
                      </span>
                    )}
                    <span className="text-xs font-semibold text-slate-800">
                      {row.customerName || row.tenantId.slice(0, 12)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        row.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.status === 'NEEDS_CUSTOMER_ACTION' || row.status === 'CONNECTION_FAILED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {row.status}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {t('ops.onboarding.addedOn', {
                        date: row.registeredAt ? new Date(row.registeredAt).toLocaleDateString() : '—',
                      })}
                    </span>
                    <span className="text-[10px] text-slate-400">WA {mask(row.contact.whatsappNumber)}</span>
                    {!row.contact.consentGiven && <span className="text-[10px] text-amber-600">{t('ops.onboarding.noConsent')}</span>}
                    {row.contact.optedOut && <span className="text-[10px] text-rose-600">{t('ops.onboarding.optedOut')}</span>}
                    {row.kb && <span className="text-[10px] text-slate-500">KB {row.kb.status} v{row.kb.version}</span>}
                  </button>

                  {openTenant === row.tenantId && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-100">
                      {/* Owner sees / copies the FULL customer WhatsApp number here. */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-700">WhatsApp (full):</span>
                        <span className="text-[11px] text-slate-900 font-bold">
                          {detailPhone[row.tenantId] ?? mask(row.contact.whatsappNumber)}
                        </span>
                        {detailPhone[row.tenantId] && (
                          <button
                            type="button"
                            onClick={() => void copyFullPhone(row.tenantId, detailPhone[row.tenantId] as string)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {copiedPhoneTenant === row.tenantId ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" /> Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" /> Copy
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="mb-2 text-[10px] text-slate-500 leading-relaxed">
                        <p>{t('ops.onboarding.registered', { at: row.registeredAt ? new Date(row.registeredAt).toLocaleString() : '—' })}</p>
                        <p>{t('ops.onboarding.statusChanged', { at: new Date(row.statusChangedAt).toLocaleString() })}</p>
                        {row.approvedAt && <p>{t('ops.onboarding.approved', { at: new Date(row.approvedAt).toLocaleString() })}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ACTIONS.map(({ id, labelKey }) => (
                          <button
                            key={id}
                            type="button"
                            disabled={busy === 'busy'}
                            onClick={() => void runAction(row.tenantId, id)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                          >
                            {busyKey === `${row.tenantId}:${id}` ? t('ops.loading') : t(labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
