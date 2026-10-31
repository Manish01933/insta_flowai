import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';
import { getContact, maskPhone } from './contactStore';
import type { Lang } from './i18n';
import { dedupeKeyFor, recordEvent } from './onboardingStatusStore';

/**
 * Customer WhatsApp notification outbox — the honest version (Feature 5).
 *
 * The ONLY WhatsApp integration configured on this host today is the owner's
 * personal CallMeBot relay (ownerNotify.ts). That is an ops channel, not a
 * compliant customer WhatsApp Business API, so pointing customer templates at
 * it is forbidden (task rule 9: a permitted integration + customer consent are
 * required before any automated customer message).
 *
 * This module therefore implements the full workflow — templates, consent gate,
 * duplicate prevention, status tracking — and delivers ONLY when a real
 * customer provider is configured via env (WA_CUSTOMER_API_*). Without it every
 * message lands in the outbox as `provider-unconfigured` with a manual-copy
 * text for the owner. Nothing is reported as sent that did not reach a
 * provider, and nothing is reported as delivered without provider evidence.
 */

export type OutboxStatus =
  | 'pending'
  | 'provider-unconfigured'
  | 'queued'
  | 'provider-accepted'
  | 'delivered'
  | 'failed'
  | 'cancelled'
  | 'blocked-consent'
  | 'blocked-duplicate';

export type TemplateId =
  | 'instagram-connected'
  | 'permission-required'
  | 'approval-completed'
  | 'additional-info-required';

export interface OutboxMessage {
  id: string;
  tenantId: string;
  template: TemplateId;
  status: OutboxStatus;
  /** Rendered, consent-checked body the owner can copy/paste manually. */
  text: string;
  toMasked: string | null;
  at: string;
  /** Provider refs ONLY when a provider was actually used (never fabricated). */
  providerRefs: Array<{ at: string; ref: string; state: string }>;
  error?: string;
}

const OUTBOX_BASENAME = 'whatsapp-outbox.json';
/** Bounded storage: newest 1,000 survive; older rows are dropped on persist. */
const MAX_MESSAGES = 1000;
/** The same (tenant, template, context) cannot be sent twice within this window. */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

let fileOverride: string | null = null;
let messages: OutboxMessage[] = [];
let loaded = false;

function fileName(): string {
  return fileOverride || path.join(DATA_DIR, OUTBOX_BASENAME);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(fileName())) return;
    const parsed = JSON.parse(fs.readFileSync(fileName(), 'utf8'));
    messages = Array.isArray(parsed?.messages) ? parsed.messages.slice(-MAX_MESSAGES) : [];
    console.log(`[whatsappOutbox] Loaded ${messages.length} outbox row(s) from ${fileName()}`);
  } catch (err) {
    console.error('[whatsappOutbox] failed to load (starting empty):', err);
  }
}

function persist(): void {
  try {
    const target = fileName();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    messages = messages.slice(-MAX_MESSAGES);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, messages }, null, 0), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[whatsappOutbox] persist failed (rows stay in memory):', err);
  }
}

// ── Templates: the four spec bodies, bidi; per-tenant editable overrides live
// in the draft store, these are the defaults. ──────────────────────────────────

const TEMPLATES: Record<TemplateId, Record<Lang, string>> = {
  'instagram-connected': {
    en: 'Hello {{customer_name}}, your Instagram account has been connected to InstaFlow AI. Our team is reviewing your business information and preparing your Knowledge Base. We will update you when the review is complete.',
    hi: 'Hello {{customer_name}}, aapka Instagram account InstaFlow AI se jud gaya hai. Hamari team aapki business jaankari review karke Knowledge Base taiyaar kar rahi hai. Review poora hone par hum update karenge.',
  },
  'permission-required': {
    en: 'Hello {{customer_name}}, one additional setup step is required before your InstaFlow AI connection can be finalized. Please follow the instructions in your account to complete the required permission or tester-invitation step. Contact our team if you need help.',
    hi: 'Hello {{customer_name}}, aapki InstaFlow AI connection finalize hone se pehle ek setup step baki hai. Aapke account ke instructions se permission ya tester-invitation step complete karein. Madad chahiye to team se baat karein.',
  },
  'approval-completed': {
    en: 'Hello {{customer_name}}, your InstaFlow AI setup has been approved. Please open your dashboard to review your Knowledge Base and complete any remaining configuration.',
    hi: 'Hello {{customer_name}}, aapki InstaFlow AI setup approve ho gayi hai. Apna dashboard kholkar Knowledge Base aur baaki configuration dekhein.',
  },
  'additional-info-required': {
    en: 'Hello {{customer_name}}, our team needs a little more information to complete your setup. Please open your InstaFlow AI dashboard to view the required details.',
    hi: 'Hello {{customer_name}}, aapki setup complete karne ke liye team ko thodi jaankari chahiye. Aapka InstaFlow AI dashboard kholkar zaroori details dekhein.',
  },
};

/** Safe substitution: strip control chars/braces so a name can never inject. */
function safeName(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/[{}\n\r\t]/g, ' ').trim();
  return (text || fallback).slice(0, 80);
}

export function renderTemplate(
  template: TemplateId,
  lang: Lang,
  customerName: string
): string {
  const name = safeName(customerName, 'customer');
  const body = TEMPLATES[template][lang] || TEMPLATES[template].en;
  return body.replaceAll('{{customer_name}}', name);
}

// ── Customer-facing provider configuration ──────────────────────────────────

export function isCustomerWhatsAppProviderConfigured(): boolean {
  return Boolean(
    (process.env.WA_CUSTOMER_API_URL || '').trim() &&
      (process.env.WA_CUSTOMER_API_KEY || '').trim() &&
      (process.env.WA_CUSTOMER_SENDER || '').trim()
  );
}

export function providerStatusDetail(): string {
  return isCustomerWhatsAppProviderConfigured()
    ? 'Customer WhatsApp provider configured (WA_CUSTOMER_API_*) — sends go to the provider.'
    : 'WhatsApp provider not configured. Set WA_CUSTOMER_API_URL + WA_CUSTOMER_API_KEY + WA_CUSTOMER_SENDER to enable automated delivery. Meanwhile messages stay in the outbox with a manual copy for the team.';
}

// ── Queue ───────────────────────────────────────────────────────────────────

export interface QueueResult {
  ok: boolean;
  /** why `ok` is false, in a client-safe wording */
  reason?: string;
  message: OutboxMessage;
}

export interface QueueArgs {
  tenantId: string;
  template: TemplateId;
  customerName: string;
  lang?: Lang;
  /** Stable context identity (e.g. status change) for duplicate prevention. */
  context?: string;
  /** Only OPS may bypass the 60-minute duplicate window (deliberate resend). */
  allowDuplicate?: boolean;
}

/**
 * Build, gate and store one notification. Never throws; the returned status is
 * the truth — `provider-unconfigured` is the normal state today, not an error.
 * Consent is checked FIRST so it can never be masked by a provider message.
 */
export function queueWhatsAppMessage(args: QueueArgs): QueueResult {
  load();
  const now = new Date().toISOString();
  const contact = getContact(args.tenantId);
  const lang = args.lang || contact?.language || 'en';
  const toMasked = contact?.whatsappNumber ? maskPhone(contact.whatsappNumber) : null;

  if (!contact?.consent.given || contact?.optOut) {
    const msg: OutboxMessage = {
      id: dedupeKeyFor(args.tenantId, args.template, now),
      tenantId: args.tenantId,
      template: args.template,
      status: 'blocked-consent',
      text: renderTemplate(args.template, lang, args.customerName),
      toMasked,
      at: now,
      providerRefs: [],
      error: 'Consent not recorded on the contact form, or the customer opted out.',
    };
    messages.push(msg);
    persist();
    recordEvent(args.tenantId, `whatsapp ${args.template} blocked (no consent)`, 'system', 'consent gate');
    return { ok: false, reason: msg.error, message: msg };
  }

  // Duplicate prevention: same tenant + template + context within the window.
  if (!args.allowDuplicate) {
    const withinWindow = messages.filter(
      (m) =>
        m.tenantId === args.tenantId &&
        m.template === args.template &&
        m.status !== 'blocked-duplicate' &&
        Date.now() - Date.parse(m.at) < DEDUPE_WINDOW_MS
    );
    if (!args.context) {
      if (withinWindow.length > 0) {
        const msg: OutboxMessage = {
          id: dedupeKeyFor(args.tenantId, args.template, now),
          tenantId: args.tenantId,
          template: args.template,
          status: 'blocked-duplicate',
          text: withinWindow[withinWindow.length - 1].text,
          toMasked,
          at: now,
          providerRefs: [],
          error: `Duplicate: the same notification was already processed within the last ${DEDUPE_WINDOW_MS / 60_000} minutes.`,
        };
        messages.push(msg);
        persist();
        recordEvent(args.tenantId, `whatsapp ${args.template} blocked as duplicate`, 'system');
        return { ok: false, reason: 'duplicate within the cooldown window', message: msg };
      }
    } else if (withinWindow.some((m) => m.text === renderTemplate(args.template, lang, args.customerName))) {
      const msg: OutboxMessage = {
        id: dedupeKeyFor(args.tenantId, args.template, now),
        tenantId: args.tenantId,
        template: args.template,
        status: 'blocked-duplicate',
        text: renderTemplate(args.template, lang, args.customerName),
        toMasked,
        at: now,
        providerRefs: [],
        error: `Duplicate: the same notification was already processed within the last ${DEDUPE_WINDOW_MS / 60_000} minutes.`,
      };
      messages.push(msg);
      persist();
      recordEvent(args.tenantId, `whatsapp ${args.template} blocked as duplicate`, 'system');
      return { ok: false, reason: 'duplicate within the cooldown window', message: msg };
    }
  }

  const configured = isCustomerWhatsAppProviderConfigured();
  const msg: OutboxMessage = {
    id: dedupeKeyFor(args.tenantId, args.template, now),
    tenantId: args.tenantId,
    template: args.template,
    status: configured ? 'queued' : 'provider-unconfigured',
    text: renderTemplate(args.template, lang, args.customerName),
    toMasked,
    at: now,
    providerRefs: [],
    error: configured ? undefined : providerStatusDetail(),
  };
  messages.push(msg);
  persist();

  recordEvent(
    args.tenantId,
    `whatsapp ${args.template} ${configured ? 'queued for provider' : 'manual-copy ready (provider unconfigured)'}`,
    'system',
    `consent recorded at ${contact?.consent.at || ''}`
  );

  return { ok: true, message: msg };
}

/** Owner-facing list (WhatsApp numbers stay masked; ids and statuses are real). */
export function listOutbox(tenantId?: string): OutboxMessage[] {
  load();
  const rows = tenantId ? messages.filter((m) => m.tenantId === tenantId) : messages;
  return rows.slice(-200);
}

export function getOutboxMessage(id: string): OutboxMessage | null {
  load();
  return messages.find((m) => m.id === id) || null;
}

/** Test hook — repoint at a temp dir and clear memory. */
export function _resetForTests(dir?: string): void {
  loaded = false;
  messages = [];
  fileOverride = dir ? path.join(dir, OUTBOX_BASENAME) : null;
}
