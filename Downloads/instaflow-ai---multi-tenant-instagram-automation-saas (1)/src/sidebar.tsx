/**
 * InstaFlow onboarding navigation panel.
 *
 * Renders the sidebar heading + numbered STEP navigation used across the
 * main dashboard. Step numbers, labels and progress live here, but the real
 * step truth (plan, connection, knowledge base, simulator, verified) is
 * computed on the server and pushed down through `OnboardingSnapshot`, so the
 * UI can only show a step as done when the real thing happened.
 */

import React, { useMemo } from 'react';
import {
  BookOpen,
  BarChart3,
  Instagram,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { OnboardingSnapshot, OnboardingStepId } from './onboarding';
import { ONBOARDING_STEP_ORDER } from './onboarding';
import type { OnboardingStepV5Key } from './stringIndexes';

// Sidebar step mapping for v5 numbered onboarding flow.
// Keep in sync with ONBOARDING_STEPS_V5 in src/stringIndexes.ts.
const V5_SIDEBAR_STEPS: Array<{
  key: OnboardingStepV5Key;
  id: OnboardingStepId | null;
  label: string;
  /** Optional one-line helper under the label (kept short on purpose). */
  sublabel?: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'connections',
    id: 'instagram',
    label: 'Connection Center',
    sublabel: 'Connect the Instagram account the bot replies from.',
    icon: <Instagram className="w-4 h-4" />,
  },
  {
    key: 'business',
    id: null,
    label: 'Contact & WhatsApp Consent',
    sublabel: 'Business details and WhatsApp permission.',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    key: 'simulator',
    id: 'simulator',
    label: 'AI Sales Agent Setup',
    sublabel: 'Test the bot before real customers see it.',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    key: 'knowledge',
    id: 'knowledge',
    label: 'Knowledge Base & AI Persona',
    sublabel: 'Open this tab and add FAQs, products, pricing and policies — the bot answers real DMs from what you write here.',
    icon: <BookOpen className="w-4 h-4" />,
  },
  {
    key: 'booking',
    id: null,
    label: 'Customer Booking Page',
    sublabel: 'Public link that captures leads for you.',
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    key: 'analytics',
    id: null,
    label: 'Account Analytics',
    sublabel: 'DMs handled, credits used and plan status.',
    icon: <BarChart3 className="w-4 h-4" />,
  },
];

interface SidebarPanelProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  connectionConnected: boolean;
  onboardingSnapshot: OnboardingSnapshot | null;
  unreadCount: number;
  isOwner: boolean;
  analyticsUrl: string;
}

function stepProgress(snapshot: OnboardingSnapshot | null, stepId: OnboardingStepId | null) {
  if (!snapshot || !stepId) return null;
  const found = snapshot.steps.find((s) => s.id === stepId);
  if (!found) return null;
  return found.done;
}

function badgeVariant(stepDone: boolean | null, isActive: boolean) {
  if (stepDone) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (isActive) return 'bg-purple-600 text-white border-purple-600';
  return 'bg-white text-slate-500 border-slate-200';
}

function badgeLabel(stepDone: boolean | null) {
  if (stepDone) return 'Done';
  return '';
}

export function SidebarPanel({
  activeTab,
  onSelectTab,
  connectionConnected,
  onboardingSnapshot,
  unreadCount,
  isOwner,
  analyticsUrl,
}: SidebarPanelProps) {
  const steps = useMemo(
    () =>
      V5_SIDEBAR_STEPS.map((step, index) => {
        const progress = step.id ? stepProgress(onboardingSnapshot, step.id) : null;
        // Active state: match by activeTab string, not by onboarding id
        const isActive = activeTab === step.key;
        return { ...step, idx: index + 1, progress };
      }),
    [onboardingSnapshot, activeTab]
  );

  return (
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-white p-4 hidden lg:flex flex-col gap-2 overflow-y-auto">
      {/* MANAGEMENT heading — premium purple→green gradient, animated accent bar (single element, honors prefers-reduced-motion). */}
      <div className="relative mb-4">
        <div className="pointer-events-none absolute -left-[0.15rem] top-0 bottom-0 w-[0.35rem] rounded-full onboarding-gradient-accent" />
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-r from-purple-600/10 via-emerald-50/40 to-emerald-50/80 blur-sm" />

        <div className="relative flex items-center gap-2.5 px-3 py-2.5">
          <div className="relative">
            <span className="relative z-10 inline-flex items-center justify-center w-[2.4rem] h-[2.4rem] rounded-xl bg-gradient-to-br from-purple-700 via-purple-600 to-emerald-600 text-white text-sm font-bold shadow-sm ring-1 ring-white/70">
              M
            </span>
            {/* Gentle halo behind the badge: static (no continuous animation), so it never fights clicks or scroll. */}
            <span
              className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-purple-500/30 blur-[1.25rem] pointer-events-none"
              aria-hidden="true"
            />
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-800">Management</span>
        </div>
      </div>

      {/* Divider after heading. */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-3" />

      {/* Numbered onboarding steps. */}
      {steps.map((step) => {
        const tab = step.key;
        const isConnectedStep = tab === 'connections';
        // The server-computed current step (next incomplete one) is the only
        // item allowed to pulse — never every sidebar row at once.
        const isCurrentStep = Boolean(
          step.id && onboardingSnapshot?.progress.current === step.id
        );
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelectTab(tab)}
            aria-current={activeTab === tab ? 'page' : undefined}
            title={step.label}
            className={`group relative flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              activeTab === tab
                ? 'bg-purple-50 text-purple-800 shadow-sm ring-1 ring-purple-200'
                : 'text-slate-600 hover:bg-slate-50'
            } ${isCurrentStep ? 'onboarding-current-pulse' : ''}`}
          >
            {/* Number badge. */}
            <span
              className={`shrink-0 w-[1.75rem] h-[1.75rem] rounded-full text-[11px] font-bold flex items-center justify-center border ${
                activeTab === tab
                  ? 'bg-purple-600 text-white border-purple-600'
                  : step.progress === true
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    : badgeVariant(step.progress, false)
              }`}
            >
              {step.progress === true ? '✓' : step.idx}
            </span>

            {/* Label + optional status. Labels wrap cleanly onto two lines
                instead of being cut off mid-word — the sidebar is the only
                navigation on desktop, so a half-read label is a lost step. */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-[13px] font-medium leading-snug break-words leading-[1.12]">{step.label}</span>
                {isCurrentStep && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                    Next
                  </span>
                )}
                {step.progress === true && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    Done
                  </span>
                )}
              </div>
              {step.sublabel && (
                <p className="mt-0.5 text-[10px] text-slate-500 leading-snug">{step.sublabel}</p>
              )}
              {isConnectedStep && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                      connectionConnected
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        connectionConnected ? 'bg-emerald-500' : 'bg-amber-400'
                      }`}
                    />
                    {connectionConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              )}
            </div>

            {/* Active indicator. */}
            {activeTab === tab && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-6 bg-purple-600 rounded-l" />
            )}
          </button>
        );
      })}

      {/* Footer: unread + owner shortcut. */}
      <div className="mt-auto pt-4 border-t border-slate-100 space-y-2">
        <button
          type="button"
          onClick={() => onSelectTab('inbox')}
          className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-slate-600 transition hover:bg-slate-50 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <MessageSquare className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-sm font-medium flex-1">Live Chat Inbox</span>
          <span className="shrink-0 bg-pink-100 text-pink-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
            {unreadCount}
          </span>
        </button>

        {isOwner && (
          <a
            href={analyticsUrl}
            title="View all account analytics"
            className="flex items-center gap-2 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 transition hover:bg-purple-100 w-full text-left"
          >
            <ShieldCheck className="w-4 h-4" />
            Ops Console
          </a>
        )}
      </div>
    </aside>
  );
}
