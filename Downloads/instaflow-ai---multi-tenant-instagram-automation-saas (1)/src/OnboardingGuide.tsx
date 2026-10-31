import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Instagram,
  Key,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useI18n } from './i18n';
import { ONBOARDING_STEP_ORDER, type OnboardingSnapshot, type OnboardingStepId } from './onboarding';

/**
 * "Getting started" — the numbered path through the portal.
 *
 * The complaint this answers: a brand-new customer signed up and then had to
 * guess which panel to touch first, and had no way of telling a step that was
 * finished from one that had silently failed. So every step here says, inside
 * the step itself, exactly what to press and where; the number badge turns green
 * only when the real thing happened; and the step that is holding everything up
 * is expanded by default with the reason it is still blocking.
 *
 * Numbering is deliberately fixed 1→5 and matches the order the account really
 * goes live in — a bot cannot answer a DM before it has a plan, a connection and
 * something to answer *from*.
 */

export type GuideTab = 'connections' | 'knowledge' | 'simulator';

interface Props {
  snapshot: OnboardingSnapshot | null;
  isLoading: boolean;
  /** Questions the bot could not answer — used as a nudge inside step 3. */
  kbGapCount: number;
  isBuyingPlan: boolean;
  isOauthPending: boolean;
  isVerifying: boolean;
  onRefresh: () => void;
  onOpenTab: (tab: GuideTab) => void;
  /** Opens the real Razorpay checkout for the plan step 1 needs. */
  onBuyPlan: () => void;
  /** Whether the ₹99 Launch Offer is still purchasable (server's answer). */
  offerAvailable: boolean;
  onConnect: () => void;
  onVerify: () => void;
  onHide: (hidden: boolean) => void;
  onOpenHelp: () => void;
  /** Why one-click Meta connect cannot finish here, if it cannot. */
  connectBlockedReason?: string | null;
  /** Reveals the direct-token form, which is the path that does work. */
  onOpenTokenForm: () => void;
  /** Step a sidebar row asked us to show; the guide expands and scrolls to it. */
  focusStep?: OnboardingStepId | null;
  /** Bumped on every sidebar click so clicking the same row twice re-scrolls. */
  focusTick?: number;
}

const STEP_ICONS: Record<OnboardingStepId, React.ReactNode> = {
  account: <Zap className="w-4 h-4" />,
  instagram: <Instagram className="w-4 h-4" />,
  knowledge: <BookOpen className="w-4 h-4" />,
  simulator: <Sparkles className="w-4 h-4" />,
  verify: <ShieldCheck className="w-4 h-4" />,
};

/** A short "here is where it hurts" line, only when the step has something to explain. */
function blockerFor(
  id: OnboardingStepId,
  snapshot: OnboardingSnapshot,
  kbGapCount: number,
  connectBlockedReason: string | null,
  t: (key: string, vars?: Record<string, string | string | number>) => string
): string {
  const signals = snapshot.signals;
  switch (id) {
    case 'account':
      // The server already phrases why access is off in the reader's language.
      return signals.plan.reason || t('guide.step1.todo');
    case 'instagram':
      // A connect flow that cannot finish outranks the generic "not connected
      // yet": it is the difference between "keep going" and "this route is shut".
      if (!signals.instagram.connected && connectBlockedReason) return connectBlockedReason;
      if (signals.instagram.needsReconnect) return t('guide.step2.reconnect');
      if (signals.instagram.lastError) return signals.instagram.lastError;
      return t('guide.step2.todo');
    case 'knowledge':
      if (signals.knowledge.documents === 0) return t('guide.step3.todo');
      return kbGapCount > 0 ? t('guide.kbGaps', { count: kbGapCount }) : t('guide.step3.todo');
    case 'simulator':
      return t('guide.step4.todo');
    case 'verify':
      return t('guide.step5.todo');
    default:
      return '';
  }
}

export function OnboardingGuide({
  snapshot,
  isLoading,
  kbGapCount,
  isBuyingPlan,
  isOauthPending,
  isVerifying,
  onRefresh,
  onOpenTab,
  onBuyPlan,
  offerAvailable,
  onConnect,
  onVerify,
  onHide,
  onOpenHelp,
  connectBlockedReason = null,
  onOpenTokenForm,
  focusStep = null,
  focusTick = 0,
}: Props) {
  const { t } = useI18n();
  // `null` = follow the current step automatically; 'closed' = the customer
  // folded it away themselves. Keeping those apart means the guide keeps
  // pointing at the right step as work gets done, without fighting a manual click.
  const [manual, setManual] = useState<OnboardingStepId | 'closed' | null>(null);

  const done = (id: OnboardingStepId) => Boolean(snapshot?.steps.find((s) => s.id === id)?.done);
  const current = snapshot?.progress.current ?? null;
  const openId = manual === null ? current : manual === 'closed' ? null : manual;

  // A sidebar click says "this step, right here". Expand it (so the what-to-do
  // list is visible, not just the title) and scroll it into view. Both run in
  // the same effect because the row only grows taller after it is expanded —
  // scrolling first would land the customer on the wrong offset.
  useEffect(() => {
    if (!focusStep) return;
    setManual(focusStep);
    // Expanding one step folds the previously open one, which removes real
    // height ABOVE this row. Scrolling in the same frame would use the old
    // offset and land the customer past the step, so wait for that re-render.
    const timer = window.setTimeout(() => {
      document
        .getElementById(`guide-step-${focusStep}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [focusStep, focusTick]);

  // Nothing fetched yet: a skeleton keeps the layout from jumping after load.
  if (!snapshot) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 mb-6">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? t('guide.rechecking') : t('guide.title')}
        </div>
      </div>
    );
  }

  const { progress, signals } = snapshot;

  // All green (or folded away): collapse to one line so the dashboard is not
  // permanently wearing a finished checklist.
  if (progress.allDone || signals.guide.hiddenAt) {
    const hidden = Boolean(signals.guide.hiddenAt);
    return (
      <div
        className={`rounded-2xl border px-5 py-3 mb-6 flex flex-wrap items-center gap-3 ${
          hidden ? 'bg-white border-slate-200' : 'bg-emerald-50 border-emerald-200'
        }`}
      >
        {hidden ? (
          <span className="text-sm text-slate-500">{t('guide.title')}</span>
        ) : (
          <span className="text-sm text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4" />
            {t('guide.allDone', { username: signals.instagram.username || 'your account' })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onHide(!hidden)}
            className="text-[11px] font-semibold text-purple-700 bg-white border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50"
          >
            {hidden ? t('guide.show') : t('guide.hide')}
          </button>
          <button
            onClick={onOpenHelp}
            className="text-[11px] font-semibold text-white bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3" />
            {t('help.open')}
          </button>
        </div>
      </div>
    );
  }

  const renderAction = (id: OnboardingStepId) => {
    switch (id) {
      case 'account':
        // Both branches buy a plan — the price the customer is told is the price
        // checkout will charge, and the offer label only shows while the server
        // still lists the offer as purchasable.
        return (
          <button
            onClick={onBuyPlan}
            disabled={isBuyingPlan}
            className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-semibold disabled:opacity-60"
          >
            {isBuyingPlan
              ? t('guide.step1.starting')
              : offerAvailable
                ? t('guide.step1.action')
                : t('guide.step1.actionBuy')}
          </button>
        );
      case 'instagram':
        // When the Meta route is shut on this deployment, the token form is the
        // action — the other button stays as a last resort rather than the
        // first thing a stuck customer is told to press.
        if (connectBlockedReason) {
          return (
            <>
              <button
                onClick={onOpenTokenForm}
                className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white text-[11px] font-semibold flex items-center gap-1.5"
              >
                <Key className="w-3 h-3" />
                {t('guide.step2.actionToken')}
              </button>
              <button
                onClick={onConnect}
                disabled={isOauthPending}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline disabled:opacity-60"
              >
                {t('guide.step2.tryMetaAnyWay')}
              </button>
            </>
          );
        }
        return (
          <button
            onClick={onConnect}
            disabled={isOauthPending}
            className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white text-[11px] font-semibold disabled:opacity-70 flex items-center gap-1.5"
          >
            {isOauthPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Instagram className="w-3 h-3" />}
            {isOauthPending ? t('guide.step2.waiting') : t('guide.step2.action')}
          </button>
        );
      case 'knowledge':
        return (
          <button
            onClick={() => onOpenTab('knowledge')}
            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold flex items-center gap-1.5"
          >
            <BookOpen className="w-3 h-3" />
            {t('guide.step3.action')}
          </button>
        );
      case 'simulator':
        return (
          <button
            onClick={() => onOpenTab('simulator')}
            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3" />
            {t('guide.step4.action')}
          </button>
        );
      case 'verify':
        return (
          <button
            onClick={onVerify}
            disabled={isVerifying}
            className="px-3.5 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold disabled:opacity-60 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3 h-3 ${isVerifying ? 'animate-spin' : ''}`} />
            {isVerifying ? t('guide.step5.verifying') : t('guide.step5.action')}
          </button>
        );
      default:
        return null;
    }
  };

  const doneText = (id: OnboardingStepId): string => {
    const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
    switch (id) {
      case 'account':
        return t('guide.step1.done', { plan: signals.plan.planName || 'Plan' });
      case 'instagram':
        return t('guide.step2.done', { username: signals.instagram.username || '—' });
      case 'knowledge':
        return t('guide.step3.done', { count: signals.knowledge.documents });
      case 'simulator':
        return t('guide.step4.done', { at: fmt(signals.simulator.testedAt) });
      case 'verify':
        return t('guide.step5.done', { at: fmt(signals.instagram.lastVerifiedAt) });
      default:
        return '';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 mb-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-600" />
            {t('guide.title')}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t('guide.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            {t('guide.progress', { done: progress.done, total: progress.total })}
          </span>
          <button
            onClick={() => onHide(true)}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg border border-slate-200"
          >
            {t('guide.hide')}
          </button>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 transition-all"
          style={{ width: `${(progress.done / progress.total) * 100}%` }}
        />
      </div>

      <ol className="space-y-2.5">
        {ONBOARDING_STEP_ORDER.map((id, index) => {
          const isDone = done(id);
          const isCurrent = id === current;
          const isOpen = openId === id;
          // Flashed briefly when a sidebar row sends the customer here.
          const isFocused = focusStep === id;

          return (
            <li
              key={id}
              id={`guide-step-${id}`}
              data-guide-step={id}
              className={`scroll-mt-28 rounded-xl border transition ${
                isDone
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : isCurrent
                    ? 'border-purple-300 bg-purple-50/40'
                    : 'border-slate-200 bg-white'
              } ${isFocused ? 'ring-2 ring-purple-400 ring-offset-2 border-purple-400' : ''}`}
            >
              <button
                type="button"
                onClick={() => setManual(isOpen ? 'closed' : id)}
                className="w-full flex items-start gap-3 p-3 text-left"
              >
                <span
                  className={`shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5 ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : index + 1}
                </span>

                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${isDone ? 'text-slate-500' : 'text-slate-800'}`}>
                      {t(`guide.step${index + 1}.title`)}
                    </span>
                    {isCurrent && !isDone && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-600 text-white">
                        {t('guide.startHere')}
                      </span>
                    )}
                  </span>
                  <span className={`block text-[11px] mt-0.5 ${isDone ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {isDone ? doneText(id) : t(`guide.step${index + 1}.todo`)}
                  </span>
                </span>

                <span className="shrink-0 flex items-center gap-2 mt-0.5">
                  {isDone && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      {t('guide.done')}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pl-12 space-y-3">
                  {/* Why this step still matters, in the customer's own numbers. */}
                  {!isDone && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {t('guide.problem')}
                      </p>
                      <p className="text-[11px] text-amber-800 mt-1 leading-relaxed break-words">
                        {blockerFor(id, snapshot, kbGapCount, connectBlockedReason, t)}
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {t('guide.whatToDo')}
                    </p>
                    <ol className="mt-1.5 space-y-1">
                      {(id === 'instagram' && connectBlockedReason
                        ? t('guide.step2.bodyBlocked')
                        : t(`guide.step${index + 1}.body`))
                        .split(/\r?\n/)
                        .map((line, i) => (
                          <li key={i} className="text-[11px] text-slate-600 leading-relaxed flex gap-2">
                            <span className="shrink-0 w-4 h-4 rounded-full bg-slate-100 text-slate-600 text-[9px] font-bold flex items-center justify-center mt-0.5">
                              {i + 1}
                            </span>
                            <span>{line}</span>
                          </li>
                        ))}
                    </ol>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {renderAction(id)}
                    {/* The re-check also on the blocking step: this is the step a
                        stuck customer is looking at, and it was the one step with
                        no way to ask "ab dekho, ho gaya ya nahi?". */}
                    {(isDone || isCurrent) && (
                      <button
                        onClick={onRefresh}
                        disabled={isLoading}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                        {isLoading ? t('guide.rechecking') : t('guide.refresh')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* The escape hatch the whole request was about: explain it in words. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
        <p className="text-[11px] text-slate-500">{t('help.subtitle')}</p>
        <button
          onClick={onOpenHelp}
          className="text-[11px] font-semibold text-white bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 px-3.5 py-2 rounded-lg flex items-center gap-1.5"
        >
          <Sparkles className="w-3 h-3" />
          {t('guide.askHelp')}
        </button>
      </div>
    </div>
  );
}

export default OnboardingGuide;
