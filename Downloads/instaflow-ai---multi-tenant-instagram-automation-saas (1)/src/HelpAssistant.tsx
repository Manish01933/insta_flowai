import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { useI18n } from './i18n';
import { askGuide, type GuideTurn, type OnboardingSnapshot } from './onboarding';

/**
 * "Samajh nahi aa raha, kaha jaana hai?" — answered in the portal itself.
 *
 * The guide tells a customer *that* something is missing; this tells them where
 * the thing is, in their own words and their own language, without them having
 * to email support and wait. It is grounded in the account's live snapshot
 * (which step is blocking, whether Instagram is connected, whether Meta rejected
 * the token), so the answer is about *their* account rather than the product in
 * general.
 *
 * Two deliberate limits: it explains the portal and cannot change anything, and
 * it is funded by the platform rather than metered against the customer's plan.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  snapshot: OnboardingSnapshot | null;
}

export function HelpAssistant({ open, onOpenChange, tenantId, snapshot }: Props) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<GuideTurn[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the newest exchange in view — an answer the customer has to hunt for is
  // the same as no answer.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, turns, isThinking]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Switching accounts must not carry one tenant's conversation into another's.
  useEffect(() => {
    setTurns([]);
    setError('');
    setInput('');
  }, [tenantId]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || isThinking) return;

    const withUser: GuideTurn[] = [...turns, { sender: 'you', text: question }];
    setTurns(withUser);
    setInput('');
    setError('');
    setIsThinking(true);

    try {
      const answer = await askGuide(tenantId, question, withUser);
      setTurns([...withUser, { sender: 'guide', text: answer.reply }]);
    } catch (err: any) {
      setError(err?.message || t('help.error'));
    } finally {
      setIsThinking(false);
    }
  };

  const currentStepNumber = snapshot?.progress.current
    ? snapshot.steps.findIndex((s) => s.id === snapshot.progress.current) + 1
    : null;

  const chips = ['help.chip.connect', 'help.chip.kb', 'help.chip.test', 'help.chip.plan'];

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white px-4 py-3 text-xs font-semibold shadow-lg shadow-purple-500/30 hover:brightness-110"
      >
        <Sparkles className="w-4 h-4" />
        <span className="hidden sm:inline">{t('help.open')}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-start gap-2 px-4 py-3 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold">{t('help.title')}</p>
          <p className="text-[10px] text-white/85 mt-0.5">
            {currentStepNumber
              ? t('help.stepHint', { step: currentStepNumber, total: snapshot?.progress.total ?? 5 })
              : t('help.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              onClick={() => {
                setTurns([]);
                setError('');
              }}
              title={t('help.clear')}
              className="text-white/80 hover:text-white p-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => onOpenChange(false)} title={t('help.close')} className="text-white/90 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3 max-h-[22rem] min-h-[10rem] bg-slate-50">
        {turns.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-slate-600 leading-relaxed">{t('help.greeting')}</p>
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={index} className={turn.sender === 'you' ? 'flex justify-end' : 'flex justify-start'}>
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                turn.sender === 'you'
                  ? 'bg-purple-600 text-white rounded-br-sm'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
              }`}
            >
              {turn.text}
            </p>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            {t('help.thinking')}
          </div>
        )}

        {error && (
          <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 leading-relaxed">
            {error}
          </p>
        )}

        {turns.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip}
                onClick={() => send(t(chip))}
                className="text-[10.5px] font-medium text-purple-700 bg-white border border-purple-200 rounded-full px-2.5 py-1 hover:bg-purple-50"
              >
                {t(chip)}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-slate-100 p-2.5 space-y-2"
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('help.placeholder')}
            maxLength={1000}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
          <button
            type="submit"
            disabled={isThinking || !input.trim()}
            className="shrink-0 w-9 h-9 rounded-lg bg-purple-600 text-white flex items-center justify-center disabled:opacity-50"
            title={t('help.send')}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-slate-400 leading-snug px-0.5">{t('help.disclaimer')}</p>
      </form>
    </div>
  );
}

export default HelpAssistant;
