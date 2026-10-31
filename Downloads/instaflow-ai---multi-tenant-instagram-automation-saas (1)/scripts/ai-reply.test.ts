/**
 * Focused tests for the KB-first reply fix (generic-DM task).
 *
 * Everything runs against OS temp dirs and a STUBBED fetch — no real DATA_DIR,
 * no real AI provider call, no Instagram send. Run:
 *   npx tsx scripts/ai-reply.test.ts   → expect exit 0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

// ── Isolation: point DATA_DIR at a temp dir BEFORE any server module loads ──
const dir = mkdtempSync(path.join(tmpdir(), 'ai-reply-'));
process.env.DATA_DIR = dir;
// Make sure no real provider key leaks into the "provider failed" test.
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPEN_ROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_MODEL;
delete process.env.GEMINI_MODEL;

const { AI_FALLBACK_REPLY, isDuplicateFallbackReply, generateAiReply } = await import('../server/aiService');
const { ANSWERING_RULES, saveTenantAiSettings, getTenantAiContext, DEFAULT_SYSTEM_PROMPT } = await import(
  '../server/tenantSettings'
);
const { extractKbMiss, KB_MISS_MARKER, KB_MISS_INSTRUCTION } = await import('../server/kbGapStore');

// ============================================================ FALLBACK TEXT
// The old canned "Hello! Thank you for reaching out…we received your message"
// is exactly what customers complained about — it must be gone.
check(
  'fallback is no longer the old generic acknowledgement',
  !AI_FALLBACK_REPLY.includes('We received your message') && !AI_FALLBACK_REPLY.includes('will get back to you shortly')
);
check('fallback is a short human-hand-off message', /team|human|trouble/i.test(AI_FALLBACK_REPLY));
check('fallback mentions the customer', AI_FALLBACK_REPLY.startsWith('Thanks for reaching out'));

// ============================================================ DE-DUP (Phase 4)
check('duplicate fallback detected (fallback + same last reply)', isDuplicateFallbackReply(true, AI_FALLBACK_REPLY));
check('no de-dup when AI answered for real', !isDuplicateFallbackReply(false, AI_FALLBACK_REPLY));
check('no de-dup when nothing was sent before', !isDuplicateFallbackReply(true, undefined));
check('no de-dup when previous reply was a real answer', !isDuplicateFallbackReply(true, 'Our hours are 10 AM to 8 PM.'));

// ============================================================ ANSWERING RULES (Phase 3)
for (const [label, needle] of [
  ['greeting rule', 'greeting'],
  ['no-invention rule', 'Never invent'],
  ['KB-miss rule', 'not available'],
  ['language rule', 'language the customer used'],
  ['no-secrets rule', 'API keys'],
  ['no-false-completion rule', 'unless the conversation confirms it'],
  ['no-generic rule', 'same generic greeting'],
] as const) {
  check(`answering rules include the ${label}`, ANSWERING_RULES.includes(needle));
}
check('answering rules never leak the marker to the customer', !ANSWERING_RULES.includes(KB_MISS_MARKER));
check('KB-miss instruction still requires the marker', KB_MISS_INSTRUCTION.includes(KB_MISS_MARKER));
check('default prompt is still KB-first', DEFAULT_SYSTEM_PROMPT.includes('Answer only from the Business Knowledge Base'));

// ============================================================ TENANT ISOLATION (TEST 5)
saveTenantAiSettings('tenantA', {
  systemPrompt: 'You are the assistant for Salon A.',
  knowledgeItems: [{ title: 'Hours', content: 'Salon A is open 10 AM to 8 PM.' }],
});
saveTenantAiSettings('tenantB', {
  systemPrompt: 'You are the assistant for Cafe B.',
  knowledgeItems: [{ title: 'Menu', content: 'Cafe B sells coffee at 150 rupees.' }],
});

const ctxA = getTenantAiContext('tenantA');
const ctxB = getTenantAiContext('tenantB');
check('tenant A KB contains its own facts', (ctxA.knowledgeBase || '').includes('Salon A is open 10 AM to 8 PM'));
check("tenant A KB does not contain tenant B's facts", !(ctxA.knowledgeBase || '').includes('Cafe B'));
check('tenant B KB does not contain tenant A', !(ctxB.knowledgeBase || '').includes('Salon A'));
check('unknown tenant gets the default prompt, empty KB', getTenantAiContext('tenantUnknown').knowledgeBase === undefined);

// ============================================================ WIRE-LEVEL PROMPT (TESTS 1, 2, 7)
// Stub fetch so we can inspect EXACTLY what would be sent to the provider —
// this is the proof that the KB reaches the model, per tenant, with history.
interface Captured { body: any }
const captured: Captured[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: any, init: any) => {
  captured.push({ body: JSON.parse(init.body) });
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'Salon A is open 10 AM to 8 PM.' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}) as any;

process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-key';

// Mirror the webhook's prompt assembly exactly.
const wireResultA = await generateAiReply({
  systemPrompt: [ctxA.systemPrompt, ANSWERING_RULES, KB_MISS_INSTRUCTION].filter(Boolean).join('\n\n'),
  userMessage: 'What are your opening hours?',
  knowledgeBase: ctxA.knowledgeBase,
  conversationHistory: [{ sender: 'customer', text: 'Hi' }, { sender: 'ai', text: 'Hello! How can I help?' }],
});

const reqA = captured[captured.length - 1]?.body;
const systemMsgA = reqA?.messages?.find((m: any) => m.role === 'system')?.content || '';
check('provider request carries the tenant A KB', systemMsgA.includes('Salon A is open 10 AM to 8 PM'));
check("provider request never carries tenant B's KB", !systemMsgA.includes('Cafe B'));
check('provider request carries the answering rules', systemMsgA.includes('Never invent'));
check('provider request carries the KB-miss marker instruction', systemMsgA.includes(KB_MISS_MARKER));
check('provider request carries the current question', reqA?.messages?.some((m: any) => m.role === 'user' && m.content === 'What are your opening hours?'));
check('provider request carries recent conversation context (TEST 7)', reqA?.messages?.some((m: any) => m.role === 'assistant' && m.content === 'Hello! How can I help?'));
check('provider request does not leak the marker to the user turn', !JSON.stringify(reqA?.messages?.filter((m: any) => m.role !== 'system') || []).includes(KB_MISS_MARKER));
check('real generation reports provider openrouter', wireResultA.provider === 'openrouter');
check('real generation passes the reply through unchanged', wireResultA.reply === 'Salon A is open 10 AM to 8 PM.');
check('attempts recorded for diagnostics', Array.isArray(wireResultA.attempts) && wireResultA.attempts[0]?.ok === true);

// Tenant B on the same stub — isolation at the wire level.
await generateAiReply({
  systemPrompt: [ctxB.systemPrompt, ANSWERING_RULES].filter(Boolean).join('\n\n'),
  userMessage: 'How much is coffee?',
  knowledgeBase: ctxB.knowledgeBase,
});
const systemMsgB = captured[captured.length - 1]?.body?.messages?.find((m: any) => m.role === 'system')?.content || '';
check('tenant B prompt carries only tenant B facts', systemMsgB.includes('Cafe B sells coffee at 150 rupees') && !systemMsgB.includes('Salon A'));

// ============================================================ MARKER EXTRACTION
check('marker stripped from a marker-carrying reply', extractKbMiss(`Sorry, I will check.${KB_MISS_MARKER}`).text === 'Sorry, I will check.');
check('marker-only reply becomes empty (webhook then uses fallback)', extractKbMiss(KB_MISS_MARKER).text === '');
check('clean reply passes through', extractKbMiss('We are open 10 to 8').missed === false);

// ============================================================ TEST 6: PROVIDER FAILURE
// Every provider fails (no Gemini key, stubbed OpenRouter returns 500) →
// the canned fallback, tagged 'fallback', no throw, no duplicate-risk text.
globalThis.fetch = (async () => new Response('upstream exploded', { status: 500 })) as any;
const failed = await generateAiReply({
  systemPrompt: ctxA.systemPrompt,
  userMessage: 'Hello?',
  knowledgeBase: ctxA.knowledgeBase,
});
check('provider failure returns the fallback reply', failed.reply === AI_FALLBACK_REPLY);
check('provider failure is tagged fallback', failed.provider === 'fallback');
check('provider failure records the failed attempt (diagnostics)', (failed.attempts || []).some((a) => a.ok === false));
check('provider failure does not throw', true);

// No keys at all → immediate fallback, still no throw.
delete process.env.OPENROUTER_API_KEY;
const noKeys = await generateAiReply({ userMessage: 'Hi' });
check('no-keys path returns the fallback', noKeys.provider === 'fallback' && noKeys.reply === AI_FALLBACK_REPLY);

globalThis.fetch = realFetch;

// ============================================================ SUMMARY
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
process.exit(fail === 0 ? 0 : 1);
