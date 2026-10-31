/**
 * InstaFlow onboarding feature modules that sit directly above the dashboard tabs.
 *
 * This file owns:
 *  - OnboardingWelcome: top-of-page progress teaser tuned to this repo's
 *    real onboarding state (plan / connection / knowledge / simulator / verify).
 *  - KnowledgeBaseDescriptionHighlight: soft green-purple highlight around the
 *    "Knowledge Base & AI Persona" helper line.
 *  - BookingPagePanel: STEP 3 REQUIRED card built only when /api/booking-config
 *    or equivalent exists; otherwise a placeholder that explains the gap.
 *  - RequiredFieldIndicator: small "Required"/"Optional" chip that keeps form
 *    feedback honest.
 *
 * All state reads go through existing API surfaces. No fake completion is ever
 * rendered.
 */

import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  MessageSquare,
  Loader2,
  ShieldCheck,
  Sparkles,
  Bot,
  CalendarCheck,
  BarChart3,
  Repeat,
  Languages,
  Play,
  Pause,
  Video,
} from 'lucide-react';
import type { OnboardingSnapshot, OnboardingStepId } from './onboarding';
import { ONBOARDING_STEP_ORDER } from './onboarding';
import { ONBOARDING_STEPS_V5, type OnboardingStepV5Key } from './stringIndexes';
import type { Lang } from './i18n';

// ── onboarding step metadata ──────────────────────────────────────────────
// Indexes align with the V5 array in src/stringIndexes.ts:
// [0] connections, [3] simulator, [4] knowledge (business/booking/analytics
// rows are not part of the server's 5-step flow). 'verify' is the live Meta
// token check, which lives inside the Connection Center, so it anchors to [0].
const STEP_BY_ID: Record<OnboardingStepId, typeof ONBOARDING_STEPS_V5[number]> = {
  account: ONBOARDING_STEPS_V5[0],
  instagram: ONBOARDING_STEPS_V5[0],
  knowledge: ONBOARDING_STEPS_V5[4],
  simulator: ONBOARDING_STEPS_V5[3],
  verify: ONBOARDING_STEPS_V5[0],
};

function firstIncompleteStepId(snapshot: OnboardingSnapshot | null): OnboardingStepId | null {
  if (!snapshot) return null;
  for (const step of ONBOARDING_STEP_ORDER) {
    if (!snapshot.steps.find((s) => s.id === step)?.done) return step;
  }
  return null;
}

interface OnboardingWelcomeProps {
  snapshot: OnboardingSnapshot | null;
  isLoading: boolean;
  t: (key: string, vars?: Record<string, string | string | number>) => string;
  onOpenTab: (tab: string) => void;
  targetTabOfStep: (stepId: OnboardingStepId | null) => string | null;
}

export function OnboardingWelcome({
  snapshot,
  isLoading,
  t,
  onOpenTab,
  targetTabOfStep,
}: OnboardingWelcomeProps) {
  if (isLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
          {t('guide.rechecking')}
        </div>
      </div>
    );
  }

  const progress = snapshot?.progress ?? { done: 0, total: ONBOARDING_STEP_ORDER.length, current: null, allDone: false };
  const firstIncomplete = firstIncompleteStepId(snapshot);

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-600" />
            {t('guide.welcomeTitle')}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t('guide.welcomeSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            {t('guide.progress', { done: progress.done, total: progress.total })}
          </span>
          {progress.allDone ? (
            <a
              href="/app"
              className="text-[11px] font-semibold text-white bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('guide.dashboardLink')}
            </a>
          ) : (
            <button
              onClick={() => {
                const tab = firstIncomplete ? targetTabOfStep(firstIncomplete) : null;
                if (tab) onOpenTab(tab);
              }}
              className="text-[11px] font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('guide.continueSetup')}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-purple-500 via-violet-600 to-indigo-600 transition-all duration-500"
          style={{ width: `${(progress.done / progress.total) * 100}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        />
      </div>

      {/* Step checklist */}
      <ol className="mt-4 space-y-2">
        {ONBOARDING_STEP_ORDER.map((id, index) => {
          const meta = STEP_BY_ID[id];
          const step = snapshot?.steps.find((s) => s.id === id);
          const done = step?.done ?? false;
          const isCurrent = id === progress.current;
          const isFirstIncomplete = id === firstIncomplete;

          return (
            <li key={id} className="flex items-start gap-3">
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5 ${
                  done
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-purple-600 text-white ring-2 ring-purple-300'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`text-xs font-semibold ${done ? 'text-slate-500' : 'text-slate-800'}`}>
                      {meta.title}
                    </span>
                    {isFirstIncomplete && !done && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                        {t('guide.nextStep')}
                      </span>
                    )}
                  </div>
                  {done && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 shrink-0">
                      {t('guide.done')}
                    </span>
                  )}
                </div>
                <p className={`text-[11px] mt-0.5 ${done ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {done ? (meta.short ?? '') : (meta.short ?? '')}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── knowledge base description highlight ──────────────────────────────────
interface KnowledgeBaseDescriptionHighlightProps {
  className?: string;
}

export function KnowledgeBaseDescriptionHighlight({ className }: KnowledgeBaseDescriptionHighlightProps) {
  return (
    <div
      className={`rounded-xl border border-purple-200/70 bg-gradient-to-r from-emerald-50/70 via-purple-50/70 to-emerald-50/70 p-3 text-sm text-slate-700 ${className ?? ''}`}
    >
      <div className="flex items-start gap-2.5">
        <Info className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-slate-800">Knowledge Base &amp; AI Persona</p>
          <p className="text-xs text-slate-600 mt-1">
            Provide your business information, FAQs, products, pricing and policies to train your AI Sales Assistant.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Feature highlights (product-value teaser for a new customer) ──────────
// The getting-started guide says WHAT TO DO; these cards say WHAT YOU GET, so a
// customer halfway through setup can already see the point of finishing it.
// Pure copy + icons — no state, no API: these are facts about the product that
// hold for every tenant.

interface FeatureCard {
  icon: React.ReactNode;
  titleKey: string;
  bodyKey: string;
}

const FEATURE_CARDS: FeatureCard[] = [
  { icon: <Bot className="w-4 h-4" />, titleKey: 'highlight.ai.title', bodyKey: 'highlight.ai.body' },
  { icon: <BookOpen className="w-4 h-4" />, titleKey: 'highlight.kb.title', bodyKey: 'highlight.kb.body' },
  { icon: <CalendarCheck className="w-4 h-4" />, titleKey: 'highlight.booking.title', bodyKey: 'highlight.booking.body' },
  { icon: <BarChart3 className="w-4 h-4" />, titleKey: 'highlight.analytics.title', bodyKey: 'highlight.analytics.body' },
  { icon: <Repeat className="w-4 h-4" />, titleKey: 'highlight.safe.title', bodyKey: 'highlight.safe.body' },
  { icon: <Languages className="w-4 h-4" />, titleKey: 'highlight.lang.title', bodyKey: 'highlight.lang.body' },
];

export function FeatureHighlights({ t }: { t: (key: string, vars?: Record<string, string | number>) => string }) {
  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-start gap-2.5 mb-4">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-slate-900">{t('highlight.title')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t('highlight.subtitle')}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {FEATURE_CARDS.map((card) => (
          <div
            key={card.titleKey}
            className="rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50/60 via-white to-emerald-50/60 p-4"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center mb-2">
              {card.icon}
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{t(card.titleKey)}</h3>
            <p className="text-xs text-slate-600 mt-1">{t(card.bodyKey)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Explainer reel / video (customer-friendly demo) ─────────────────────────
// A short, silent "reel" that walks one DM through the product end to end. It
// needs no video file, so it ships today.
//
// Real uploaded video: set EXPLAINER_VIDEO once —
//   • an MP4 path (`/onboarding/demo.mp4`) with the file in `public/`, or
//   • a YouTube embed URL (https://www.youtube.com/embed/…).
// A truthy value swaps the reel for a real player; empty string keeps the reel.
// This is a deliberate code edit, not a placeholder hack: a customer must never
// see a broken <video> element while no file exists yet.
const EXPLAINER_VIDEO: { url: string; poster: string } = { url: '/onboarding/demo-music.webm', poster: '' };

interface ReelStep {
  titleKey: string;
  bubbleKey: string;
  bodyKey: string;
}

const REEL_STEPS: ReelStep[] = [
  { titleKey: 'video.s1.title', bubbleKey: 'video.s1.bubble', bodyKey: 'video.s1.body' },
  { titleKey: 'video.s2.title', bubbleKey: 'video.s2.bubble', bodyKey: 'video.s2.body' },
  { titleKey: 'video.s3.title', bubbleKey: 'video.s3.bubble', bodyKey: 'video.s3.body' },
  { titleKey: 'video.s4.title', bubbleKey: 'video.s4.bubble', bodyKey: 'video.s4.body' },
  { titleKey: 'video.s5.title', bubbleKey: 'video.s5.bubble', bodyKey: 'video.s5.body' },
];

export function OnboardingVideo({ t }: { t: (key: string, vars?: Record<string, string | number>) => string }) {
  const [playing, setPlaying] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % REEL_STEPS.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [playing]);
  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5">
          <Video className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-bold text-slate-900">{t('video.title')}</h2>
            <p className="text-xs text-slate-500 mt-1">{t('video.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPlaying((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? t('video.pause') : t('video.play')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        {/* Left: the reel player — a real <video> of the recorded walkthrough
            (landing → sign in → plan cards → each guide step → live bot). */}
        <div className="rounded-xl bg-gradient-to-b from-slate-900 to-indigo-950 p-4 flex flex-col justify-between overflow-hidden">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-3">
            {t('video.reelTitle')}
          </p>
          {EXPLAINER_VIDEO.url ? (
            EXPLAINER_VIDEO.url.includes('youtube.com/embed') ? (
              <iframe
                src={EXPLAINER_VIDEO.url}
                title={t('video.reelTitle')}
                className="aspect-video w-full rounded-lg"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              // Muted autoplay keeps the browser's autoplay policy happy; the
              // customer unmutes to hear the soft background music track.
              <video className="aspect-video w-full rounded-lg" controls autoPlay muted loop poster={EXPLAINER_VIDEO.poster || undefined}>
                <source src={EXPLAINER_VIDEO.url} type="video/webm" />
              </video>
            )
          ) : (
            <>
              {/* The active step, as a chat-bubble frame (`.reel-step` re-mounts per step so the CSS animates it in). */}
              <div className="reel-step flex flex-col gap-2" key={activeIndex}>
                <div
                  className={`rounded-2xl text-sm font-medium px-3.5 py-2.5 max-w-[85%] shadow-lg ${
                    activeIndex === 0 ? 'bg-white/95 text-slate-900 self-start' : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white self-end'
                  }`}
                >
                  {t(REEL_STEPS[activeIndex].bubbleKey)}
                </div>
                <p className="text-[11px] text-white/70 px-1 mt-1">{t(REEL_STEPS[activeIndex].bodyKey)}</p>
              </div>
              <div className="mt-4 h-1 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 transition-all duration-700 ease-linear"
                  style={{ width: `${((activeIndex + 1) / REEL_STEPS.length) * 100}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Right: walk-through of exactly what each frame shows. */}
        <ol className="space-y-2">
          {REEL_STEPS.map((step, i) => {
            const isActive = i === activeIndex;
            return (
              <li
                key={step.titleKey}
                className={`rounded-lg px-3 py-2 border transition-colors ${
                  isActive
                    ? 'border-purple-300 bg-purple-50'
                    : 'border-transparent bg-slate-50/60'
                }`}
              >
                <p className={`text-xs font-semibold ${isActive ? 'text-purple-700' : 'text-slate-700'}`}>
                  {t(step.titleKey)}
                </p>
                {isActive && <p className="text-[11px] text-slate-600 mt-0.5">{t(step.bodyKey)}</p>}
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-3 text-[11px] text-slate-500">{t('video.reelNote')}</p>
    </div>
  );
}

// ── booking page panel ────────────────────────────────────────────────────
interface BookingPagePanelProps {
  meta: typeof ONBOARDING_STEPS_V5[number] | null;
  configured: boolean;
  isLoading: boolean;
  t: (key: string, vars?: Record<string, string | string | number>) => string;
}

export function BookingPagePanel({ meta, configured, isLoading, t }: BookingPagePanelProps) {
  if (!meta || isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
          {t('guide.loading')}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border p-5 shadow-xs ${
        configured
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-purple-200 bg-gradient-to-br from-emerald-50/70 via-purple-50/70 to-emerald-50/70'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-purple-600" />
            <span className="font-semibold text-slate-900">{meta.title}</span>
          </div>
          <p className="text-xs text-slate-600">{meta.desc}</p>
        </div>
        <div className="shrink-0">
          {configured ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              {t('guide.configured')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-pink-800 bg-pink-50 border border-pink-200 px-2 py-1 rounded-full">
              <Loader2 className="w-3 h-3 animate-pulse" />
              {t('guide.required')}
            </span>
          )}
        </div>
      </div>
      {!configured && (
        <p className="mt-3 text-[11px] text-amber-800 bg-amber-50/70 rounded-lg border border-amber-200/60 p-3">
          {t('guide.bookingRequiredNote')}
        </p>
      )}
    </div>
  );
}

// ── booking link card ─────────────────────────────────────────────────────
interface BookingLinkCardProps {
  bookingUrl: string | null;
  copied: boolean;
  onCopy: () => void;
  t: (key: string, vars?: Record<string, string | string | number>) => string;
}

/**
 * The customer-facing booking link, as the server reports it.
 *
 * Lives in its own component because two screens show it — the Knowledge tab
 * (where it used to sit inline) and the "Customer Booking Page" sidebar item,
 * which until now led to no screen at all.
 */
export function BookingLinkCard({ bookingUrl, copied, onCopy, t }: BookingLinkCardProps) {
  return (
    <div
      className={`rounded-2xl p-6 border shadow-xs space-y-4 ${
        bookingUrl
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-purple-200 bg-gradient-to-br from-emerald-50/80 via-purple-50/80 to-emerald-50/80'
      }`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-purple-600" />
          Customer booking page
        </h3>
        {bookingUrl ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Step 3 · Complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-800 bg-white/80 border border-purple-200 px-2 py-1 rounded-full onboarding-required-pulse">
            Step 3 · <span className="text-rose-600">Required</span>
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        {t('kb.bookingPage1')} <strong>Inbox</strong> {t('kb.bookingPage2')}
      </p>
      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Booking link</span>
          <div className="flex items-center gap-3">
            {bookingUrl && (
              <a
                href={bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
              >
                <ExternalLink className="w-3 h-3" /> Open
              </a>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 font-medium"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="text-xs font-mono text-slate-800 break-all select-all">
          {bookingUrl || 'Connect an Instagram account to get your booking link'}
        </p>
      </div>
      <p className="text-[11px] text-slate-400">{t('kb.bookingHint')}</p>
    </div>
  );
}

// ── required field indicator ──────────────────────────────────────────────
export type FieldRequirement = 'required' | 'optional';

interface RequiredFieldIndicatorProps {
  requirement: FieldRequirement;
  id?: string;
}

export function RequiredFieldIndicator({ requirement, id }: RequiredFieldIndicatorProps) {
  const color = requirement === 'required' ? 'text-amber-700 border-amber-200 bg-amber-50' : 'text-slate-500 border-slate-200 bg-slate-50';
  const text = requirement === 'required' ? 'Required' : 'Optional';

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${color}`}
    >
      <span className={`w-1 h-1 rounded-full ${requirement === 'required' ? 'bg-amber-500' : 'bg-slate-400'}`} />
      {text}
    </span>
  );
}
