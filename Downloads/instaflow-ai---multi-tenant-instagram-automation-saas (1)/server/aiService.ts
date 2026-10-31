import { GoogleGenAI } from '@google/genai';

// Default OpenRouter model. Since 2026-10-09 this is a *cheap paid* slug rather
// than a ':free' one, and that is deliberate: the free tier is a shared pool that
// rate-limits us (measured 2026-10-09, 3 identical Hinglish calls per model with
// the production key — 'google/gemma-4-31b-it:free' 1/3, with HTTP 429
// "temporarily rate-limited upstream"; 'nvidia/nemotron-3-super-120b-a12b:free'
// 2/3 with one empty completion; 'inclusionai/ling-3.0-flash-sante' **3/3**,
// median 2.1s). A rate-limited default is indistinguishable from a dead bot: the
// call fails, Gemini is tried next, and the customer gets the canned sentence.
//
// Cost of that reliability, so nobody is surprised: ~$0.021 per 1M prompt tokens
// and ~$0.063 per 1M completion tokens — about ₹0.002 per DM reply, ₹2 per
// thousand replies. Set OPENROUTER_MODEL to a ':free' id on the host to trade
// reliability back for zero cost.
//
// Retirement history of this one line, because it is the single setting that can
// kill every DM silently:
//   - 'inclusionai/ling-3.0-flash-fin:free'  retired (2026-09-29) — replaced by
//     'ling-3.0-flash-sante:free', which answered a Hinglish price question
//     correctly at the time;
//   - 'inclusionai/ling-3.0-flash-sante:free' went paid-only (2026-10-09). The
//     API answers it with HTTP 404 "This model is unavailable for free. The paid
//     version is available now - use this slug instead: inclusionai/ling-3.0-flash-sante",
//     so every DM fell through to the canned reply. Verified live before
//     switching to the paid slug.
//   - 'inclusionai/ling-3.0-flash-sante' (the paid slug itself) vanished from
//     OpenRouter's catalogue entirely (2026-10-14, HTTP 404 "No endpoints
//     found") — every DM again fell through to the canned reply, and Gemini
//     ('gemini-flash-latest') was answering HTTP 503 "high demand" at the same
//     time, so the fallback chain collapsed too. Verified live before
//     switching to 'inclusionai/ling-3.0-flash' (200 in 2.2s with a correct
//     Hinglish answer; the whole 'sante'/'fin' family is gone from the
//     catalogue — only 'ling-3.0-flash', 'ling-3.0-flash-vl' and
//     'ling-3.1-flash' remain under 'inclusionai').
//
// Other free ids seen live on 2026-10-09, if a free pool is wanted anyway:
// 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free',
// 'thinkingmachines/inkling:free'. Avoid the reasoning-flavoured ones (e.g.
// 'nvidia/nemotron-3.5-lightning:free') for DM replies: tested live, they open
// the answer with their reasoning trace instead of the reply.
const DEFAULT_OPENROUTER_MODEL = 'inclusionai/ling-3.0-flash';

// Gemini model used for generation. 'gemini-flash-latest' tracks the current
// free-tier flash model, so the key keeps working as older models get retired.
// Override with GEMINI_MODEL (e.g. gemini-3.8-flash, gemini-3.1-flash-lite).
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

// One stable backup model tried when the configured model fails (503/timeout).
// Verified live 2026-10-14: 'gemini-flash-latest' 503 "high demand",
// 'gemini-2.5-flash' OK in 1.5s.
const GEMINI_BACKUP_MODEL = 'gemini-2.5-flash';

/**
 * The single source of truth for the canned reply that goes out when NO AI
 * provider could answer (both OpenRouter and Gemini failed or are unconfigured).
 *
 * It used to be an upbeat "we received your message and will get back to you
 * shortly" — wording indistinguishable from a real answer, which is exactly
 * what made customers think the bot was replying generically. It is now an
 * honest hand-off-to-a-human message so a failed generation never masquerades
 * as a successful answer. Exported so the webhook can (a) reuse the exact same
 * string and (b) recognise it to avoid sending the identical fallback twice in
 * a row to the same conversation.
 */
export const AI_FALLBACK_REPLY =
  'Thanks for reaching out! I\'m having trouble answering automatically right now, ' +
  "so I've passed your message to our team — someone will reply here shortly.";

/**
 * Phase 4: "do not repeatedly send the same fallback to every subsequent
 * message." Returns true when this reply would be the canned fallback AND the
 * last thing this conversation actually received was that same canned
 * fallback — i.e. sending it again would just repeat the apology instead of
 * answering the customer's new question.
 *
 * Pure on purpose: the webhook holds the conversation history, so keeping the
 * decision here makes it unit-testable without booting the server.
 */
export function isDuplicateFallbackReply(
  usedFallback: boolean,
  lastAiReplyText: string | undefined
): boolean {
  return Boolean(usedFallback && lastAiReplyText && lastAiReplyText === AI_FALLBACK_REPLY);
}

export function resolveGeminiModel(rawModel?: string): string {
  const clean = (rawModel || '').trim();
  return clean || DEFAULT_GEMINI_MODEL;
}

/**
 * Model names that OpenRouter has retired. If the host still has one of these
 * in `OPENROUTER_MODEL` (Railway keeps env vars across deploys, so a value set
 * months ago outlives the code that used it), the call fails and the DM quietly
 * falls through to Gemini or to the canned "we received your message" reply.
 * That is exactly the silence we shipped once already, so a stale name is
 * remapped to the current default and shouted about in the logs.
 */
const RETIRED_OPENROUTER_MODELS: Record<string, string> = {
  // Went paid-only on 2026-10-09, then the paid slug itself was removed from
  // the catalogue on 2026-10-14. Both spellings are (or were) sitting in host
  // env vars, so without these entries a deploy would not fix prod.
  'inclusionai/ling-3.0-flash-sante': DEFAULT_OPENROUTER_MODEL,
  'inclusionai/ling-3.0-flash-sante:free': DEFAULT_OPENROUTER_MODEL,
  'inclusionai/ling-3.0-flash-fin': DEFAULT_OPENROUTER_MODEL,
  'inclusionai/ling-3.0-flash-fin:free': DEFAULT_OPENROUTER_MODEL,
  'meta-llama/llama-3.3-70b-instruct:free': DEFAULT_OPENROUTER_MODEL,
};

export function resolveOpenRouterModel(rawModel?: string): string {
  if (!rawModel) return DEFAULT_OPENROUTER_MODEL;
  const clean = rawModel.trim();
  const lower = clean.toLowerCase();

  // Aliases meaning "use whatever free model is cheap and fast".
  // (The old 'meta-llama/llama-3.3-70b-instruct:free' target no longer exists.)
  if (lower === 'free' || lower === 'auto' || lower === 'default') {
    return DEFAULT_OPENROUTER_MODEL;
  }

  // The regex is the safety net for ids in the same dead families that are not
  // listed above yet. It matches (a) the ':free' variants of the ling-3.0-flash
  // family, and (b) the bare 'sante'/'fin' slugs — both families are gone from
  // the catalogue. It deliberately does NOT match bare 'ling-3.0-flash' or
  // 'ling-3.0-flash-vl', which are alive and working.
  const replacement =
    RETIRED_OPENROUTER_MODELS[lower] ||
    (/ling-3\.0-flash-(sante|fin)[a-z0-9-]*|ling-3\.0-flash[a-z0-9-]*:free|llama-3\.3-70b/.test(lower)
      ? DEFAULT_OPENROUTER_MODEL
      : '');
  if (replacement) {
    console.warn(
      `OPENROUTER_MODEL "${clean}" is retired — using "${replacement}" instead. Update OPENROUTER_MODEL on the host to silence this.`
    );
    return replacement;
  }

  return clean;
}

// Read env lazily and cache the client, so a key configured through .env is
// always picked up regardless of module import order.
let geminiClient: GoogleGenAI | null = null;

function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function getOpenRouterApiKey(): string {
  return (process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || '').trim();
}

function getOmniRouteApiKey(): string {
  return (process.env.OMNIROUTE_API_KEY || process.env.OMNI_ROUTE_API_KEY || '').trim();
}

/**
 * OmniRoute (OpenAI-compatible gateway) endpoint. The default mirrors the
 * self-hosted OmniRoute install (`localhost:20128`), which is reachable from a
 * laptop running the dev server but NOT from a hosted deployment (Railway) —
 * there the host must set OMNIROUTE_BASE_URL to a public URL (e.g. the hosted
 * Cheaper Inference gateway) always ending in the same `/v1` style root this
 * code appends `/chat/completions` to.
 */
function getOmniRouteBaseUrl(): string {
  const raw = (process.env.OMNIROUTE_BASE_URL || '').trim().replace(/\/+$/, '');
  return raw || 'http://localhost:20128/v1';
}

function getGeminiClient(): GoogleGenAI | null {
  const key = getGeminiApiKey();
  if (!key) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: key });
  }
  return geminiClient;
}

export interface GenerateReplyOptions {
  systemPrompt?: string;
  userMessage: string;
  knowledgeBase?: string;
  conversationHistory?: Array<{ sender: 'customer' | 'ai' | 'agent'; text: string }>;
  preferredProvider?: 'openrouter' | 'gemini' | 'omniroute' | 'auto';
}

export interface AiAttempt {
  provider: 'openrouter' | 'gemini' | 'omniroute';
  ok: boolean;
  /** Error message with anything credential-shaped redacted; null on success. */
  error?: string;
}

export interface GenerateReplyResult {
  reply: string;
  provider: 'openrouter' | 'gemini' | 'omniroute' | 'fallback';
  model: string;
  creditsUsed: number;
  /**
   * Every provider attempt made for this one reply, in order. Lets the trace
   * store and health counters see OpenRouter and Gemini failures SEPARATELY
   * (Task 2 requirement #4) without changing any reply behaviour. Optional so
   * existing callers that ignore it stay valid.
   */
  attempts?: AiAttempt[];
}

/**
 * How long one provider call may take before we give up on it and let the next
 * provider try.
 *
 * This is not a nicety. Without it a stalled upstream — which the free tiers do
 * under load, and which was observed on 2026-09-29 — hangs the DM handler
 * forever: the Gemini fallback below never runs because no error is ever thrown,
 * the customer waits for a reply that never arrives, and nothing is logged,
 * because a promise that never settles is the one failure mode with no log line.
 * A hung provider has to be turned back into an error to be recoverable.
 */
const AI_REQUEST_TIMEOUT_MS = 9000;

/**
 * Rejects if `promise` has not settled within `ms`.
 *
 * Works for the SDK-based Gemini call too, where there is no AbortSignal to hand
 * in — the goal is only to stop waiting, not to cancel the vendor's work.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calls an OpenAI-compatible chat completion endpoint. Shared by OpenRouter
 * (primary) and OmniRoute (backup) — both speak the same wire format, so the
 * error/empty-content handling below stays identical for either provider.
 */
async function callOpenAiChat(args: {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  userMessage: string;
  history: Array<{ sender: 'customer' | 'ai' | 'agent'; text: string }>;
}): Promise<string> {
  const { label, baseUrl, apiKey, model, systemInstruction, userMessage, history } = args;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemInstruction }
  ];

  for (const h of history) {
    messages.push({
      role: h.sender === 'customer' ? 'user' : 'assistant',
      content: h.text
    });
  }

  messages.push({ role: 'user', content: userMessage });

  const appUrl = process.env.APP_URL || 'https://instaflow.ai';

  // Abort is what actually cuts the socket: without a signal, giving up on the
  // promise would leave the connection open until the vendor times out.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    signal: controller.signal,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': appUrl,
      'X-Title': 'InstaFlow AI',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      // Reasoning models spend part of this budget on hidden reasoning tokens, so keep
      // it generous: a small cap makes the model return empty content (finish_reason
      // "length") and we would fall back for no good reason.
      max_tokens: 1000,
      // We only ever show the final answer to customers, never the reasoning trace.
      reasoning: { exclude: true }
    })
  })
    .catch((err: any) => {
      // The name is the only way to tell our own abort from a network failure.
      if (err?.name === 'AbortError') {
        throw new Error(`${label} timed out after ${AI_REQUEST_TIMEOUT_MS}ms`);
      }
      throw err;
    })
    .finally(() => clearTimeout(abortTimer));

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`${label} API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error(
      `${label} returned empty content (model: ${data?.model || model}, finish_reason: ${choice?.finish_reason || 'unknown'}). ` +
      'The model either exhausted its token budget on reasoning or refused the request.'
    );
  }

  return text.trim();
}

/**
 * Calls OpenRouter's OpenAI-compatible chat completion endpoint.
 */
async function callOpenRouter(
  systemInstruction: string,
  userMessage: string,
  history: Array<{ sender: 'customer' | 'ai' | 'agent'; text: string }> = []
): Promise<string> {
  return callOpenAiChat({
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: getOpenRouterApiKey(),
    model: resolveOpenRouterModel(process.env.OPENROUTER_MODEL),
    systemInstruction,
    userMessage,
    history,
  });
}

/**
 * Calls the OmniRoute gateway (third slot in the failover chain). Both the key
 * AND a model id are required — OmniRoute's own catalogue is different from
 * OpenRouter's, so reusing OPENROUTER_MODEL would guess wrong.
 */
async function callOmniRoute(
  systemInstruction: string,
  userMessage: string,
  history: Array<{ sender: 'customer' | 'ai' | 'agent'; text: string }> = []
): Promise<string> {
  const key = getOmniRouteApiKey();
  if (!key) throw new Error('OmniRoute API key is not configured');
  const model = (process.env.OMNIROUTE_MODEL || '').trim();
  if (!model) throw new Error('OMNIROUTE_MODEL is not set on the host');

  return callOpenAiChat({
    label: 'OmniRoute',
    baseUrl: getOmniRouteBaseUrl(),
    apiKey: key,
    model,
    systemInstruction,
    userMessage,
    history,
  });
}

/**
 * Calls Google Gemini SDK.
 *
 * Tries the configured model first, then one stable backup model. 'gemini-flash-
 * latest' is an alias that Google moves over time, and on 2026-10-14 it was
 * answering HTTP 503 "high demand" while 'gemini-2.5-flash' answered in 1.5s —
 * a single-model fallback chain is exactly how the canned reply sneaks out.
 */
async function callGemini(fullPrompt: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API key is not configured');
  }

  const primary = resolveGeminiModel(process.env.GEMINI_MODEL);
  // De-duped list: the backup is only tried when it is a different model.
  const models = primary === GEMINI_BACKUP_MODEL ? [primary] : [primary, GEMINI_BACKUP_MODEL];
  const failures: string[] = [];

  for (const model of models) {
    try {
      const response = await withTimeout(
        client.models.generateContent({ model, contents: fullPrompt }),
        AI_REQUEST_TIMEOUT_MS,
        `Gemini (${model})`
      );

      if (!response.text) {
        throw new Error('Gemini returned empty text');
      }

      return response.text.trim();
    } catch (err: any) {
      failures.push(`${model}: ${String(err?.message || err)}`);
    }
  }

  throw new Error(`Gemini failed (${failures.join('; ')})`);
}

/**
 * Generates an AI reply using OmniRoute (primary), then Gemini, then the
 * canned fallback.
 *
 * OpenRouter is deliberately NOT in the reply chain any more: the owner runs
 * their own OmniRoute gateway and asked for it as the main provider
 * (2026-10-23). callOpenRouter is kept dormant for the boot-time model check
 * and can be re-chained by adding a try/catch step in a desired slot.
 */
export async function generateAiReply(options: GenerateReplyOptions): Promise<GenerateReplyResult> {
  const {
    systemPrompt = 'You are a professional, helpful, and concise AI customer support specialist for Instagram. Keep replies under 3 sentences.',
    userMessage,
    knowledgeBase,
    conversationHistory = []
  } = options;

  const kbContext = knowledgeBase ? `\n\nBusiness Knowledge Base & FAQs:\n${knowledgeBase}` : '';
  const fullSystemInstruction = `${systemPrompt}${kbContext}`;

  const geminiApiKey = getGeminiApiKey();
  // Filled as each provider is tried; returned even on the canned fallback so
  // the caller can see exactly which providers were attempted and why they
  // failed. Errors are redacted before they leave this function.
  const attempts: AiAttempt[] = [];
  // Gemini must be attempted AT MOST once per reply. Without this, a configured
  // OpenRouter that fails falls into the Gemini try below AND then into step 2's
  // "if OpenRouter is not configured" Gemini try — which does not actually
  // check that OpenRouter was unconfigured. Two full Gemini rounds (each up to
  // the timeout) just to produce the canned reply is exactly the ~18s stall
  // observed on live DMs.
  let geminiTried = false;

  // 1. OmniRoute is the PRIMARY provider (the owner's own gateway took over
  // from OpenRouter on 2026-10-23). A key without a model id still records a
  // failed attempt per reply — deliberate visibility: a misconfigured host
  // shows up in the reply trace instead of silently degrading to Gemini
  // forever.
  if (getOmniRouteApiKey()) {
    try {
      const usedModel = (process.env.OMNIROUTE_MODEL || '').trim();
      console.log(`Generating AI reply via OmniRoute (${getOmniRouteBaseUrl()}, model ${usedModel || 'unset'})...`);
      const reply = await callOmniRoute(fullSystemInstruction, userMessage, conversationHistory);
      attempts.push({ provider: 'omniroute', ok: true });
      return {
        reply,
        provider: 'omniroute',
        model: usedModel,
        creditsUsed: Math.ceil(reply.length / 50) || 1,
        attempts,
      };
    } catch (omniErr: any) {
      attempts.push({ provider: 'omniroute', ok: false, error: String(omniErr?.message || 'unknown') });
      console.warn('OmniRoute request failed:', omniErr.message);
      // Fallback to Gemini if Gemini is also configured
      if (geminiApiKey && getGeminiClient()) {
        geminiTried = true;
        console.log(`Falling back to Gemini (${resolveGeminiModel(process.env.GEMINI_MODEL)})...`);
        try {
          const historyText = conversationHistory.map(m => `${m.sender === 'customer' ? 'Customer' : 'AI'}: ${m.text}`).join('\n');
          const geminiPrompt = `${fullSystemInstruction}\n\nChat History:\n${historyText}\n\nCustomer: "${userMessage}"\n\nAI Reply:`;
          const reply = await callGemini(geminiPrompt);
          attempts.push({ provider: 'gemini', ok: true });
          return {
            reply,
            provider: 'gemini',
            model: resolveGeminiModel(process.env.GEMINI_MODEL),
            creditsUsed: Math.ceil(reply.length / 50) || 1,
            attempts,
          };
        } catch (geminiErr: any) {
          attempts.push({ provider: 'gemini', ok: false, error: String(geminiErr?.message || 'unknown') });
          console.error('Gemini fallback also failed:', geminiErr.message);
        }
      }

    }
  }

  // 2. Gemini is the next (and only remaining) provider — when OmniRoute is
  //    unconfigured, or already failed above (geminiTried). Without the flag
  //    this block would re-run a Gemini attempt that already failed, doubling
  //    the wait before the canned reply.
  if (!geminiTried && geminiApiKey && getGeminiClient()) {
    try {
      console.log(`Generating AI reply via Gemini (${resolveGeminiModel(process.env.GEMINI_MODEL)})...`);
      const historyText = conversationHistory.map(m => `${m.sender === 'customer' ? 'Customer' : 'AI'}: ${m.text}`).join('\n');
      const geminiPrompt = `${fullSystemInstruction}\n\nChat History:\n${historyText}\n\nCustomer: "${userMessage}"\n\nAI Reply:`;
      const reply = await callGemini(geminiPrompt);
      attempts.push({ provider: 'gemini', ok: true });
      return {
        reply,
        provider: 'gemini',
        model: resolveGeminiModel(process.env.GEMINI_MODEL),
        creditsUsed: Math.ceil(reply.length / 50) || 1,
        attempts,
      };
    } catch (geminiErr: any) {
      attempts.push({ provider: 'gemini', ok: false, error: String(geminiErr?.message || 'unknown') });
      console.error('Gemini request failed:', geminiErr.message);
    }
  }

  // 3. Fallback if no API key is active (or every provider above failed).
  return {
    reply: AI_FALLBACK_REPLY,
    provider: 'fallback',
    model: 'standard-support',
    creditsUsed: 1,
    attempts,
  };
}

/**
 * Boot-time sanity check: does the configured model still exist at the provider?
 *
 * A retired model name fails *every* DM, and it fails silently — the request
 * falls through to Gemini and then to the canned "we received your message"
 * reply, which reads like a normal answer in the logs. On 2026-09-29 that is
 * exactly how the bot spent weeks effectively dead without anyone noticing.
 * Fetching the catalogue once at boot turns it into a line in the deploy log,
 * which is somewhere a human actually looks. Fire-and-forget on purpose: the
 * server must never wait for a third party to start serving traffic.
 */
export async function verifyOpenRouterModelAtBoot(): Promise<void> {
  const key = getOpenRouterApiKey();
  if (!key) return;

  const model = resolveOpenRouterModel(process.env.OPENROUTER_MODEL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[ai] Model check skipped: could not list OpenRouter models (HTTP ${res.status}).`);
      return;
    }
    const payload: any = await res.json();
    const ids = new Set<string>((payload?.data || []).map((m: any) => String(m?.id || '')));

    if (ids.has(model)) {
      console.log(`[ai] OpenRouter model "${model}" is available. DMs will be answered by AI.`);
      return;
    }

    console.error(
      `[ai] OPENROUTER_MODEL "${model}" is NOT in OpenRouter's catalogue — every DM will fall back to the canned reply. ` +
      'Fix OPENROUTER_MODEL on the host. Currently free and fast: ' +
      [...ids].filter((id) => id.endsWith(':free')).slice(0, 6).join(', ')
    );
  } catch (err: any) {
    console.warn(`[ai] Model check skipped: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Boot-time check for the OmniRoute backup, same spirit as the OpenRouter one.
 * Extra warning a hosted deploy needs: the default base URL is the
 * self-hosted OmniRoute install (localhost:20128) — reachable on a laptop, but
 * a server on Railway cannot dial into someone's machine, so on the host the
 * OMNIROUTE_BASE_URL env var MUST point at a public endpoint.
 */
export async function verifyOmniRouteModelAtBoot(): Promise<void> {
  if (!getOmniRouteApiKey()) return;
  const model = (process.env.OMNIROUTE_MODEL || '').trim();
  if (!model) {
    console.warn('[ai] OMNIROUTE_API_KEY is set but OMNIROUTE_MODEL is missing — the OmniRoute backup stays disabled. Set OMNIROUTE_MODEL to enable it.');
    return;
  }

  const baseUrl = getOmniRouteBaseUrl();
  let hostname = '';
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    console.warn(`[ai] OmniRoute base URL "${baseUrl}" is not a valid absolute URL — the backup will fail if called.`);
    return;
  }
  if ((hostname === 'localhost' || hostname.startsWith('127.')) && process.env.NODE_ENV === 'production') {
    console.warn(
      `[ai] OmniRoute base URL "${baseUrl}" is a loopback address in a production environment — a hosted server cannot reach this machine. ` +
      'Point OMNIROUTE_BASE_URL at a public endpoint to actually enable the backup.'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${getOmniRouteApiKey()}` },
    });
    const payload: any = await res.json().catch(() => null);
    const ids = new Set<string>((payload?.data || []).map((m: any) => String(m?.id || '')));

    if (ids.size === 0) {
      console.log(`[ai] OmniRoute model check: gateway answered but returned no model list (HTTP ${res.status}) — skipping.`);
      return;
    }
    if (ids.has(model)) {
      console.log(`[ai] OmniRoute backup model "${model}" is available at ${baseUrl}.`);
      return;
    }
    console.warn(
      `[ai] OMNIROUTE_MODEL "${model}" is NOT in the gateway's model list — the backup would fail if called. ` +
      'Available ids (first 6): ' + [...ids].slice(0, 6).join(', ')
    );
  } catch (err: any) {
    console.warn(`[ai] OmniRoute model check skipped (${baseUrl}): ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

export function getAiConfigStatus() {
  const openRouterKey = getOpenRouterApiKey();
  const geminiKey = getGeminiApiKey();
  const omniKey = getOmniRouteApiKey();
  const omniModel = (process.env.OMNIROUTE_MODEL || '').trim();
  // Only meaningful for the "are you still on the unreachable local default?"
  // warning surfaces; the URL itself is host configuration, not a secret.
  const omniBaseUrl = (process.env.OMNIROUTE_BASE_URL || '').trim();
  const omniConfigured = Boolean(omniKey) && Boolean(omniModel);
  const validKeyFormat = openRouterKey.startsWith('sk-or-v1-');

  return {
    openRouter: {
      configured: !!openRouterKey,
      validKeyFormat,
      configuredModel: process.env.OPENROUTER_MODEL || 'Not specified',
      resolvedModel: resolveOpenRouterModel(process.env.OPENROUTER_MODEL),
      warning: openRouterKey && !validKeyFormat 
        ? "Warning: Key format should start with 'sk-or-v1-'. Generate keys at https://openrouter.ai/keys"
        : undefined,
    },
    gemini: {
      configured: !!geminiKey,
      model: resolveGeminiModel(process.env.GEMINI_MODEL),
    },
    omniRoute: {
      // Primary only when BOTH are set; the key alone cannot guess a model id,
      // since OmniRoute's catalogue differs from OpenRouter's.
      configured: omniConfigured,
      usingLoopbackDefault: !omniBaseUrl,
      model: omniModel || 'Not specified (set OMNIROUTE_MODEL)',
    },
    // The provider FIRST in the actual reply chain (OmniRoute -> Gemini).
    // OpenRouter is no longer chained; it stays dormant for the boot check.
    activeProvider: omniConfigured ? 'OmniRoute' : geminiKey ? 'Gemini' : 'None',
    primary: omniConfigured
      ? { provider: 'OmniRoute', model: omniModel, modelConfigured: omniModel }
      : geminiKey
      ? { provider: 'Gemini', model: resolveGeminiModel(process.env.GEMINI_MODEL), modelConfigured: (process.env.GEMINI_MODEL || '').trim() }
      : { provider: 'None', model: '', modelConfigured: '' },
  };
}
