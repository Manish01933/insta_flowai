import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Loader2, PencilLine, Sparkles } from 'lucide-react';

/**
 * "Fill Knowledge Base with Portal Assistant" — a short guided interview that
 * turns what the owner actually types into one knowledge-base document.
 *
 * Two rules shape the whole component:
 *  - It never invents a fact. Every line of the draft comes from an answer the
 *    owner typed; a skipped question becomes an explicit "Not provided" line so
 *    the gap is visible instead of being filled in with a guess.
 *  - It never claims a save happened. The parent adds the draft to the saved
 *    document list and its own debounced PUT reports `saved`/`error`; this
 *    component only repeats that server-side state.
 */

type FieldKey = 'businessType' | 'name' | 'offerings' | 'hours' | 'area' | 'policy' | 'faqs';

interface Question {
  key: FieldKey;
  label: string;
  hint: string;
  placeholder: string;
  multiline?: boolean;
  /** Groups the interview into a handful of screens instead of one long form. */
  group: number;
}

const QUESTIONS: Question[] = [
  {
    key: 'businessType',
    label: 'What type of business do you run?',
    hint: 'For example: clothing store, salon, travel agency, coaching class.',
    placeholder: 'Clothing store',
    group: 0,
  },
  {
    key: 'name',
    label: 'What is your business name?',
    hint: 'Exactly as customers know it.',
    placeholder: 'Sharma Fashion House',
    group: 0,
  },
  {
    key: 'offerings',
    label: 'What do you sell, and at what price?',
    hint: 'One product or service per line, with its real price. Leave a line blank if you do not want the bot to quote a price.',
    placeholder: 'Cotton kurta — ₹799\nSilk saree — ₹2,499',
    multiline: true,
    group: 1,
  },
  {
    key: 'hours',
    label: 'What are your opening hours?',
    hint: 'Include days off if any.',
    placeholder: 'Mon–Sat, 10am–8pm. Closed on Sunday.',
    group: 1,
  },
  {
    key: 'area',
    label: 'Where do you deliver or serve?',
    hint: 'City, radius, or "shop only, no delivery".',
    placeholder: 'Delhi NCR, delivery in 3–5 days',
    group: 2,
  },
  {
    key: 'policy',
    label: 'What is your return / refund policy?',
    hint: 'Write it in your own words. If you have none, say so — the bot will then not promise one.',
    placeholder: 'Exchange within 7 days with bill. No refunds on sale items.',
    multiline: true,
    group: 2,
  },
  {
    key: 'faqs',
    label: 'Any questions customers ask again and again?',
    hint: 'One question and its answer per line. Optional.',
    placeholder: 'Do you ship outside India? — No, only within India.',
    multiline: true,
    group: 3,
  },
];

const GROUP_TITLES = ['Business', 'Products & hours', 'Delivery & policy', 'Common questions'];

export interface KbDraftAssistantProps {
  /** Saved document count, from the parent's server-loaded list. */
  documents: number;
  /** Parent's persistence state for the knowledge documents. */
  saveState: 'idle' | 'saving' | 'saved' | 'error' | string;
  /** Adds the reviewed draft as a new document. Parent persists it. */
  onSave: (title: string, content: string) => void;
  /** The parent (the “Open Portal Assistant — Build My Knowledge Base” button
      next to the Active Knowledge Documents line) can force the interview
      open. Without it the customer's own open/close choice wins. */
  forceOpen?: boolean;
  /** Fired once the interview has been forced open, so the parent can clear
      its trigger without the two fighting each other. */
  onForcedOpen?: () => void;
}

export function buildDraft(answers: Record<FieldKey, string>): { title: string; content: string } {
  const name = answers.name.trim();
  const title = name ? `${name} — business details` : 'Business details';
  const line = (label: string, value: string) =>
    `${label}: ${value.trim() ? value.trim() : 'Not provided — add this later.'}`;

  const content = [
    'DRAFT — prepared by the Portal Assistant from what the owner typed. Review every line before saving.',
    '',
    line('Business type', answers.businessType),
    line('Business name', answers.name),
    line('Products / services and prices', answers.offerings),
    line('Opening hours', answers.hours),
    line('Delivery / service area', answers.area),
    line('Return / refund policy', answers.policy),
    line('Frequently asked questions', answers.faqs),
  ].join('\n');

  return { title: title.slice(0, 200), content: content.slice(0, 2000) };
}

export function KbDraftAssistant({ documents, saveState, onSave, forceOpen, onForcedOpen }: KbDraftAssistantProps) {
  // The parent asked for the KB setup interview specifically — open it and
  // tell them so the trigger does not stay live and re-open it on every render.
  useEffect(() => {
    if (forceOpen && !open) {
      setOpen(true);
      setGroup(0);
      onForcedOpen?.();
    }
  }, [forceOpen]);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(0);
  const [answers, setAnswers] = useState<Record<FieldKey, string>>({
    businessType: '',
    name: '',
    offerings: '',
    hours: '',
    area: '',
    policy: '',
    faqs: '',
  });
  const [generated, setGenerated] = useState<{ title: string; content: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedAtCount, setSavedAtCount] = useState<number | null>(null);

  const draft = useMemo(() => (generated ? buildDraft(answers) : null), [generated, answers]);
  const groupQuestions = QUESTIONS.filter((q) => q.group === group);
  const answeredCount = QUESTIONS.filter((q) => answers[q.key].trim().length > 0).length;
  const isLastGroup = group === GROUP_TITLES.length - 1;

  const update = (key: FieldKey, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Editing after generating invalidates the shown draft, so the customer never
    // copies a version that no longer matches what they typed.
    setGenerated(null);
    setSavedAtCount(null);
  };

  const reset = () => {
    setAnswers({ businessType: '', name: '', offerings: '', hours: '', area: '', policy: '', faqs: '' });
    setGenerated(null);
    setGroup(0);
    setCopied(false);
    setSavedAtCount(null);
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.title}\n\n${draft.content}`);
      setCopied(true);
    } catch {
      setCopied(false); // The textarea is selectable, so copying by hand still works.
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7c3aed] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6d28d9]"
        >
          <Sparkles className="h-4 w-4" />
          Fill Knowledge Base with Portal Assistant
        </button>
        <p className="text-[11px] text-[#a1a1b0]">
          Answers a few short questions and builds one document from your words — nothing is saved until you approve it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[#2a2a38] bg-[#101018] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="h-4 w-4 text-[#c4b5fd]" />
            Portal Assistant — knowledge base draft
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#a1a1b0]">
            I will ask for the facts only you know. Skip anything that does not apply — I will mark it as not provided rather than guess.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-[11px] font-semibold text-[#a1a1b0] underline hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {GROUP_TITLES.map((label, index) => (
          <span
            key={label}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              index === group
                ? 'border-[#7c3aed] bg-[#7c3aed]/25 text-[#ddd6fe]'
                : index < group
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[#2a2a38] text-[#8b8b9c]'
            }`}
          >
            {index + 1}. {label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-[#8b8b9c]">{answeredCount}/{QUESTIONS.length} answered</span>
      </div>

      {!draft ? (
        <div className="space-y-4">
          {groupQuestions.map((question) => (
            <label key={question.key} className="block">
              <span className="block text-xs font-semibold text-[#e7e7ef]">{question.label}</span>
              <span className="mt-0.5 block text-[11px] text-[#8b8b9c]">{question.hint}</span>
              {question.multiline ? (
                <textarea
                  value={answers[question.key]}
                  onChange={(e) => update(question.key, e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={question.placeholder}
                  className="mt-1.5 w-full rounded-xl border border-[#2a2a38] bg-[#17171f] px-3 py-2 text-sm text-white placeholder:text-[#5c5c6b] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/30"
                />
              ) : (
                <input
                  value={answers[question.key]}
                  onChange={(e) => update(question.key, e.target.value)}
                  maxLength={200}
                  placeholder={question.placeholder}
                  className="mt-1.5 w-full rounded-xl border border-[#2a2a38] bg-[#17171f] px-3 py-2 text-sm text-white placeholder:text-[#5c5c6b] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/30"
                />
              )}
              <span className="mt-1 block text-[10px] text-[#6b6b7b]">
                Leave this blank to skip it — the draft will say “Not provided”.
              </span>
            </label>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            {group > 0 && (
              <button
                type="button"
                onClick={() => setGroup((g) => Math.max(0, g - 1))}
                className="rounded-lg border border-[#2a2a38] px-3 py-2 text-[11px] font-semibold text-[#c9c9d6] hover:bg-[#17171f]"
              >
                Back
              </button>
            )}
            {!isLastGroup ? (
              <button
                type="button"
                onClick={() => setGroup((g) => Math.min(GROUP_TITLES.length - 1, g + 1))}
                className="rounded-lg bg-[#7c3aed] px-4 py-2 text-[11px] font-semibold text-white hover:bg-[#6d28d9]"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGenerated(buildDraft(answers))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7c3aed] px-4 py-2 text-[11px] font-semibold text-white hover:bg-[#6d28d9]"
              >
                <FileText className="h-3.5 w-3.5" />
                Generate draft
              </button>
            )}
            <span className="text-[10px] text-[#6b6b7b]">
              {answeredCount === 0 ? 'Nothing answered yet — the draft will be empty on purpose.' : 'Only your answers go into the draft.'}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Draft — not saved
            </span>
            <p className="text-[11px] text-[#a1a1b0]">Read every line. Correct anything that is wrong, then copy or save it.</p>
          </div>

          <textarea
            readOnly
            value={draft.content}
            rows={12}
            className="w-full rounded-xl border border-[#2a2a38] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed text-[#e7e7ef]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyDraft()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a38] bg-[#17171f] px-3 py-2 text-[11px] font-semibold text-[#e7e7ef] hover:bg-[#1f1f2a]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy Knowledge Base'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSavedAtCount(documents);
                onSave(draft.title, draft.content);
              }}
              disabled={saveState === 'saving' || savedAtCount !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saveState === 'saving' && savedAtCount !== null ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PencilLine className="h-3.5 w-3.5" />
              )}
              Save to Knowledge Base
            </button>
            <button
              type="button"
              onClick={() => setGenerated(null)}
              className="text-[11px] font-semibold text-[#a1a1b0] underline hover:text-white"
            >
              Edit answers
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] font-semibold text-[#8b8b9c] underline hover:text-white"
            >
              Start over
            </button>
          </div>

          {/* The parent owns persistence. Success is only repeated once its PUT
              succeeded, and the document count comes back from the saved list. */}
          {savedAtCount !== null && saveState === 'saving' && (
            <p className="text-[11px] text-[#c9c9d6]">Saving… waiting for the server to confirm.</p>
          )}
          {savedAtCount !== null && saveState === 'saved' && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              Saved. Active knowledge documents now: {documents}.
            </p>
          )}
          {savedAtCount !== null && saveState === 'error' && (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
              The server did not confirm the save. Nothing was stored — copy the draft and paste it into the editor above, or try Save again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default KbDraftAssistant;
