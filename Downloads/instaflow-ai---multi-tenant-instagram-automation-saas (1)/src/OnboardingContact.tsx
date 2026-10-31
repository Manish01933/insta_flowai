import React, { useCallback, useEffect, useState } from 'react';
import { useI18n, type Lang } from './i18n';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
import {
  activateOnboardingFreePlan,
  fetchLifecycleStatus,
  fetchOnboardingContact,
  saveOnboardingContact,
  optOutOnboardingWhatsApp,
  type ContactValidationError,
  type ContactView,
  type LifecycleView,
} from './onboarding';

/**
 * Self-service onboarding panel (Feature 1 Steps 2/4/5 + Feature 4 status).
 *
 * Self-contained on purpose: it touches only the new onboarding endpoints and
 * never the connection form, so the working OAuth flow cannot regress.
 * The truth rendered here is the server's — a "connected" state is shown only
 * when GET /api/onboarding/status reports a real connection, never because a
 * button was pressed.
 */

const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi / हिंदी' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function OnboardingContact({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const [contact, setContact] = useState<ContactView | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleView | null>(null);
  const [freePlanState, setFreePlanState] = useState<'idle' | 'activating' | 'done' | 'error'>('idle');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errors, setErrors] = useState<string[]>([]);

  // Form fields (pre-filled from the saved record → resumable onboarding).
  const [contactPerson, setContactPerson] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [preferredLang, setPreferredLang] = useState<Lang>(lang as Lang);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);

  const refresh = useCallback(async () => {
    const [saved, life] = await Promise.all([
      fetchOnboardingContact().catch(() => null),
      fetchLifecycleStatus().catch(() => null),
    ]);
    setContact(saved);
    setLifecycle(life);
    if (saved) {
      setContactPerson(saved.contactPerson || '');
      // The stored number is masked; never pre-fill it as if editable data.
      setPhoneNumber('');
      if (saved.language === 'en' || saved.language === 'hi') setPreferredLang(saved.language);
      setEmail(saved.email || '');
      setConsent(Boolean(saved.consent.given) && !saved.optOut);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveState('saving');
    setErrors([]);
    // Contact person is MANDATORY: follows the same pattern as WhatsApp below.
    if (!contactPerson.trim()) {
      setErrors([t('onboarding.form.contactPersonRequired')]);
      setSaveState('error');
      return;
    }
    // The WhatsApp number is MANDATORY: it is the only channel the team uses to
    // send onboarding/status messages and videos. A number already on record is
    // enough — the field can stay blank on later edits.
    if (!phoneNumber.trim() && !contact?.whatsappNumber) {
      setErrors([t('onboarding.form.whatsappRequired')]);
      setSaveState('error');
      return;
    }
    try {
      const saved = await saveOnboardingContact({
        contactPerson: contactPerson.trim(),
        whatsappNumber: phoneNumber.trim(),
        language: preferredLang,
        email: email.trim() || undefined,
        consent,
      });
      setContact(saved);
      setPhoneNumber(''); // masked form returned; keep the field clean
      setSaveState('saved');
      void fetchLifecycleStatus().then(setLifecycle).catch(() => undefined);
    } catch (err: any) {
      setErrors(err?.errors && Array.isArray(err.errors) ? err.errors : [String(err?.message || 'Could not save.')]);
      setSaveState('error');
    }
  };

  const activateFree = async () => {
    setFreePlanState('activating');
    try {
      await activateOnboardingFreePlan();
      setFreePlanState('done');
      void fetchLifecycleStatus().then(setLifecycle).catch(() => undefined);
    } catch {
      setFreePlanState('error');
    }
  };

  const connected = Boolean(lifecycle?.connected);
  const statusRow: string | null = lifecycle?.status ?? null;

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-xs ${compact ? 'p-4' : 'p-5 mb-6'}`}>
      {/* Lifecycle status line — the server's word, not the UI's hope. */}
      {statusRow && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('onboarding.statusLabel')}</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              lifecycle?.approved
                ? 'bg-emerald-100 text-emerald-800'
                : connected
                ? 'bg-sky-100 text-sky-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {t(`onboarding.status.${statusRow}`)}
          </span>
          {lifecycle?.approved && lifecycle.approved && (
            <span className="text-[11px] text-slate-500">{t('onboarding.approvedLine')}</span>
          )}
        </div>
      )}

      {/* Step 5 message: ONLY on a genuinely successful authorization. */}
      {connected && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 mb-4">
          <p>{t('onboarding.connected.success')}</p>
          <p className="mt-1 text-xs text-emerald-700">{t('onboarding.connected.pendingReview')}</p>
        </div>
      )}

      {/* Step 2: the free plan — activation BEFORE the Instagram connection. */}
      {!connected && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4">
          <p className="text-xs text-slate-700 mb-2">{t('onboarding.freePlan.line1')}</p>
          <button
            type="button"
            onClick={activateFree}
            disabled={freePlanState === 'activating' || freePlanState === 'done'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              freePlanState === 'done'
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60'
            }`}
          >
            {freePlanState === 'done' ? t('onboarding.freePlan.done') : t('onboarding.freePlan.activate')}
          </button>
          {freePlanState === 'error' && <p className="text-xs text-rose-700 mt-2">{t('onboarding.freePlan.error')}</p>}
        </div>
      )}

      {/* Step 4: Instagram account + contact details (resumable — fields pre-fill from the record). */}
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Instagram account connection/status section — replaces the manual Business Name field.
            The real Instagram username + Business Account ID come from Meta after a successful
            connection, so the admin can identify the correct account for manual invitation. */}
        <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white px-4 py-3 mb-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('onboarding.form.instagram.section')}</span>
            {connected && (
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                {t('onboarding.form.instagram.connected')}
              </span>
            )}
          </div>
          {connected && contact?.instagramUsername ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-900">@{escapeHtml(contact.instagramUsername)}</span>
                {contact.instagramAccountId && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                    <span>ID: {contact.instagramAccountId}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(String(contact.instagramAccountId ?? ''));
                      }}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {t('onboarding.form.instagram.realAccount')} — {t('onboarding.form.instagram.adminMatch')}.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                {t('onboarding.form.instagram.notConnected')}
              </p>
              <button
                type="button"
                onClick={() => {
                  // Switch to the connections tab so the customer can connect Instagram.
                  window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'connections' }));
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
              >
                {t('onboarding.form.instagram.connectBtn')}
              </button>
            </div>
          )}
        </div>
        <label className="text-xs font-medium text-slate-700">
          {t('onboarding.form.contactPerson')}
          <input
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          {t('onboarding.form.whatsapp')}
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+91 98765 43210"
            required
            inputMode="tel"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          {contact?.whatsappNumber && !phoneNumber && (
            <span className="mt-0.5 block text-[10px] text-slate-400">{t('onboarding.form.savedNumber', { num: contact.whatsappNumber })}</span>
          )}
        </label>
        <label className="text-xs font-medium text-slate-700">
          {t('onboarding.form.language')}
          <select
            value={preferredLang}
            onChange={(e) => setPreferredLang(e.target.value as Lang)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          {t('onboarding.form.email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </label>
        <div className="flex items-end">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400"
            />
            <span>{t('onboarding.form.consent')}</span>
          </label>
        </div>

        {errors.length > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <ul className="list-disc pl-4">
              {errors.map((e, i) => (
                <li key={i}>{t('onboarding.form.errorItem', { msg: e })}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saveState === 'saving'}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
          >
            {saveState === 'saving' ? t('onboarding.form.saving') : t('onboarding.form.save')}
          </button>
          {saveState === 'saved' && <span className="text-xs text-emerald-700">{t('onboarding.form.saved')}</span>}
          {contact?.optOut && <span className="text-xs text-slate-500">{t('onboarding.form.optedOut')}</span>}
          {contact && !contact.optOut && (
            <button
              type="button"
              onClick={() => {
                void optOutOnboardingWhatsApp().then(refresh);
              }}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              {t('onboarding.form.optOut')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default OnboardingContact;
