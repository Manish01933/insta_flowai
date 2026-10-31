import { getSafeStatus, listTenantsForInstagramAccountId } from './connectionStore';
import { getTenantAiContext, getTenantAiSettings, ANSWERING_RULES } from './tenantSettings';
import { generateAiReply } from './aiService';
import { isBotEnabled } from './botControlStore';
import { decideAccess } from './planStore';
import { isPaymentsConfigured } from './payments';

/**
 * "Bot sach me kaam kar raha hai?" — proved without sending anything.
 *
 * Why this exists: the only way to test the bot used to be to send it a real DM,
 * and that is exactly the test that produces the answer people misread. Two
 * connected InstaFlow accounts DMing each other are the loop the guard exists to
 * stop, so the guard refuses — the owner sees silence, and concludes the product is
 * broken. Meanwhile Instagram does not deliver a DM to your own account either, so
 * "message myself" is not a test that can work.
 *
 * So this runs the *real* chain for a synthetic message and reports every stage:
 * bot switch → plan access → Instagram connection → the customer's own prompt and
 * knowledge base → the AI provider. It never calls Meta to send, which is what makes
 * it safe to press twice, and it says so in the result rather than implying a DM
 * went out.
 *
 * It stops where the real webhook would stop: a switched-off bot, a blocked plan or a
 * connection Meta refuses ends the test there, because every stage below it is work the
 * customer's message never reaches.
 *
 * The one thing a dry run cannot show is stated instead of implied: an Instagram account
 * connected to two tenants is routed to only one of them, so the other's bot is silent
 * however healthy it is. That is reported as `sharedWithTenants` rather than left for the
 * owner to rediscover.
 */

export interface BotSelfTestStage {
  key: 'botSwitch' | 'access' | 'connection' | 'knowledge' | 'ai';
  ok: boolean;
  /** Localised by the console; the server only reports facts. */
  detail?: string;
  /** Machine-readable extras for the UI (state names, counts). */
  value?: string | number | null;
}

export interface BotSelfTestResult {
  tenantId: string;
  ok: boolean;
  /** False always: stated explicitly so nobody reads this as a delivered DM. */
  sent: false;
  stages: BotSelfTestStage[];
  /** The answer the customer would have received, when every stage passed. */
  reply?: string;
  provider?: string;
  model?: string;
  elapsedMs: number;
  knowledgeDocuments: number;
  customPrompt: boolean;
  /**
   * Other tenants whose connection is the *same* Instagram account. The webhook routes
   * one Instagram account to one tenant, so with two, one of them silently receives
   * nothing — a routing collision that reads as "this bot is dead".
   *
   * Deliberately NOT a "the guard will refuse your DM" flag: every connected account's
   * DM is refused as a loop, so such a flag would fire for all of them and mean nothing.
   * What the owner needs to know here is whether *this* account is shared.
   */
  sharedWithTenants: string[];
}

export async function runBotSelfTest(input: {
  tenantId: string;
  message?: string;
}): Promise<BotSelfTestResult> {
  const started = Date.now();
  const { tenantId } = input;
  const stages: BotSelfTestStage[] = [];

  // 1. The owner's own switch. A paused account answers nothing, and saying so here
  //    saves the trip through three other stages to find it.
  const bot = isBotEnabled(tenantId);
  stages.push({
    key: 'botSwitch',
    ok: bot.enabled,
    detail: bot.enabled ? undefined : `switched off (source: ${bot.source})`,
    value: bot.source,
  });
  if (!bot.enabled) {
    return finish({ tenantId, stages, started, sharedWithTenants: [] });
  }

  // 2. Billing/plan access. A trial that ran out is the quietest way for a bot to
  //    stop, and it looks exactly like a broken connection from outside.
  // `paymentsConfigured` matters: without it a paying tenant reads as "no plan" and the
  // test would name the wrong culprit.
  const access = decideAccess(tenantId, { paymentsConfigured: isPaymentsConfigured(), lang: 'en' });
  stages.push({
    key: 'access',
    ok: access.allowed,
    detail: access.reason,
    value: access.allowed ? 'allowed' : 'blocked',
  });
  if (!access.allowed) {
    return finish({ tenantId, stages, started, sharedWithTenants: [] });
  }

  // 3. The Instagram connection, and whether Meta currently accepts its token.
  const connection = getSafeStatus(tenantId);
  const liveOk = connection.liveState !== 'NEEDS_REAUTH';
  stages.push({
    key: 'connection',
    ok: Boolean(connection.isConnected) && liveOk,
    detail: connection.isConnected
      ? liveOk
        ? undefined
        : connection.liveDetail || 'Meta refuses this token'
      : 'no Instagram account connected',
    value: connection.instagramUsername ? `@${connection.instagramUsername}` : null,
  });

  // A failed connection is where the real webhook would stop — the DM never arrives —
  // so the stages below are not run. Answering "the AI is fine" about an account nobody
  // can reach would cost a provider call and hide the one fact that matters.
  if (!stages[stages.length - 1].ok) {
    return finish({
      tenantId,
      stages,
      started,
      sharedWithTenants: connection.instagramAccountId
        ? listTenantsForInstagramAccountId(connection.instagramAccountId).filter((id) => id !== tenantId)
        : [],
    });
  }

  // 4. What the bot would answer FROM: this tenant's own prompt and knowledge base.
  const settings = getTenantAiSettings(tenantId);
  const knowledgeDocuments = Array.isArray(settings.knowledgeItems) ? settings.knowledgeItems.length : 0;
  const customPrompt = Boolean(settings.systemPrompt && settings.systemPrompt.trim());
  stages.push({
    key: 'knowledge',
    ok: true,
    detail:
      knowledgeDocuments === 0
        ? 'no knowledge documents — the answer will be generic'
        : undefined,
    value: knowledgeDocuments,
  });

  // The same Instagram account on another tenant means the webhook can only ever route
  // it to one of them. Skipped in the answer, not discovered by silence.
  const sharedWithTenants = connection.instagramAccountId
    ? listTenantsForInstagramAccountId(connection.instagramAccountId).filter((id) => id !== tenantId)
    : [];

  // 5. The AI itself, with the tenant's real context — the whole point of the test.
  const context = getTenantAiContext(tenantId);
  const message =
    (input.message || '').trim() ||
    'Hi! What do you offer, and what does it cost?';

  try {
    const aiResult = await generateAiReply({
      // Mirror the webhook's prompt exactly (tenant prompt + shared answering
      // rules), otherwise the self-test would not predict what a real DM gets.
      systemPrompt: [context.systemPrompt, ANSWERING_RULES].filter(Boolean).join('\n\n'),
      userMessage: message,
      knowledgeBase: context.knowledgeBase,
      conversationHistory: [],
    });
    const degraded = aiResult.provider === 'fallback';
    stages.push({
      key: 'ai',
      ok: !degraded,
      detail: degraded
        ? 'every AI provider failed, so the canned sentence would be sent'
        : undefined,
      value: aiResult.provider,
    });

    return {
      tenantId,
      ok: stages.every((stage) => stage.ok),
      sent: false,
      stages,
      reply: aiResult.reply,
      provider: aiResult.provider,
      model: aiResult.model,
      elapsedMs: Date.now() - started,
      knowledgeDocuments,
      customPrompt,
      sharedWithTenants,
    };
  } catch (err: any) {
    stages.push({ key: 'ai', ok: false, detail: err?.message || 'the AI call threw', value: null });
    return finish({
      tenantId,
      stages,
      started,
      sharedWithTenants,
      knowledgeDocuments,
      customPrompt,
    });
  }
}

function finish(input: {
  tenantId: string;
  stages: BotSelfTestStage[];
  started: number;
  sharedWithTenants: string[];
  knowledgeDocuments?: number;
  customPrompt?: boolean;
}): BotSelfTestResult {
  return {
    tenantId: input.tenantId,
    ok: false,
    sent: false,
    stages: input.stages,
    elapsedMs: Date.now() - input.started,
    knowledgeDocuments: input.knowledgeDocuments ?? 0,
    customPrompt: input.customPrompt ?? false,
    sharedWithTenants: input.sharedWithTenants,
  };
}
