/**
 * Classification for one incoming Instagram DM.
 *
 * Why this exists: a DM opened from an Instagram Shops product detail page
 * usually carries NO text — only product context (`message.referral.product.id`
 * per Meta's webhook docs, or a product attachment). The webhook used to drop
 * every text-less message at its first gate, so product-page inquiries never
 * reached the bot while typed DMs did: the classic "profile pe reply aata hai,
 * product page pe nahi" symptom. Parsing lives here, pure and unit-tested,
 * so the gate in server.ts stays a one-liner.
 *
 * Meta references:
 * https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhooks-events/messages
 */

export interface InboundMessage {
  /** The customer's own words, trimmed; '' when the message carried no text. */
  text: string;
  /** Product id when the message carries product context (referral or card). */
  productId: string | null;
  /** True when the message came from a product page / carries a product card. */
  hasProductContext: boolean;
  /**
   * True when there is anything the bot should answer: typed text and/or
   * product context. False for read receipts, stickers, lone reactions etc. —
   * those are still dropped exactly as before.
   */
  isProcessable: boolean;
  /**
   * What the rest of the pipeline (AI prompt, inbox, traces) sees as the
   * customer's message: the customer's own words when there are any, otherwise
   * a clearly-labelled stand-in for a text-less product inquiry. Never a
   * fabricated customer quote.
   */
  displayText: string;
}

/** The stand-in text used when a product inquiry arrives without any words. */
export function productInquiryNote(productId: string | null): string {
  return productId
    ? `[Product inquiry] Customer opened the chat from your product page (product id: ${productId}) — they have not typed a message yet.`
    : '[Product inquiry] Customer opened the chat from your product page — they have not typed a message yet.';
}

/**
 * True when a webhook attachment carries product context.
 *
 * `'product'` is a product card outright. Post shares carry product payloads on
 * some shop entry points — historically typed `'share'`, now migrating to
 * `'ig_post'` (Meta's changelog: the legacy `share` attachment is being replaced
 * by `ig_post`). Accept all three so a text-less product inquiry never silently
 * drops again when Meta flips a tenant's payload shape.
 */
function isProductAttachment(att: any): boolean {
  const type = String(att?.type || '');
  const payload = att?.payload || {};
  return (
    type === 'product' ||
    ((type === 'share' || type === 'ig_post') && Boolean(payload.product_id || payload.product))
  );
}

function readProductId(messageObj: any): string | null {
  // 1. Meta's documented shape: message.referral.product.id
  const referralProduct = messageObj?.referral?.product;
  if (referralProduct) {
    const id = referralProduct.id ?? referralProduct.product_id;
    if (id !== undefined && id !== null && String(id).length > 0) return String(id);
  }

  // 2. Product cards sent as attachments — type 'product', or a post share
  //    ('share' / 'ig_post') that carries a product payload. Tolerant on
  //    purpose: the exact payload shape varies between Instagram entry points.
  const attachments = Array.isArray(messageObj?.attachments) ? messageObj.attachments : [];
  for (const att of attachments) {
    const payload = att?.payload || {};
    if (!isProductAttachment(att)) continue;
    const id = payload.product_id ?? payload.product?.id ?? payload.id;
    if (id !== undefined && id !== null && String(id).length > 0) return String(id);
  }

  return null;
}

/**
 * Classify one `messaging.message` object from a Meta webhook delivery.
 * Tolerates undefined/garbage input: anything unparseable is "not processable".
 */
export function parseInboundMessage(messageObj: unknown): InboundMessage {
  const obj: any = messageObj && typeof messageObj === 'object' ? messageObj : {};
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  const productId = readProductId(obj);

  // Product context without an id still counts — some payloads only tell us
  // the conversation started from a product page.
  const attachments = Array.isArray(obj.attachments) ? obj.attachments : [];
  const hasProductContext =
    Boolean(productId) ||
    Boolean(obj.referral?.product) ||
    attachments.some(isProductAttachment);

  return {
    text,
    productId,
    hasProductContext,
    isProcessable: text.length > 0 || hasProductContext,
    displayText: text || (hasProductContext ? productInquiryNote(productId) : ''),
  };
}

/**
 * Extra system-prompt line for the AI when the conversation carries product
 * context: the bot should acknowledge the listing and offer to help with it,
 * inventing nothing beyond the Knowledge Base (which the answering rules
 * already enforce).
 */
export function productContextInstruction(inbound: InboundMessage): string {
  if (!inbound.hasProductContext) return '';
  const where = inbound.productId
    ? `a product page (product id: ${inbound.productId})`
    : 'a product page';
  return (
    `The customer started this conversation from ${where}. ` +
    'If they have not asked a question yet, greet them and offer to help with that product ' +
    '(price, availability, delivery) using only facts from the Knowledge Base.'
  );
}
