/**
 * Tests for product-page DM parsing (server/inboundMessage.ts).
 *
 * The bug being pinned: a DM opened from an Instagram Shops product page
 * arrives with product context and often NO text, and the webhook used to drop
 * every text-less message — so the bot answered profile DMs but not
 * product-page DMs. Everything runs pure, no server boot:
 *   npx tsx scripts/inbound-message.test.ts   → expect exit 0
 */

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

const { parseInboundMessage, productInquiryNote, productContextInstruction } = await import(
  '../server/inboundMessage'
);

// ============================================================ TYPED DMs (profile message box)
const typed = parseInboundMessage({ text: '  bhai price kya hai?  ', mid: 'm1' });
check('typed DM: text is trimmed', typed.text === 'bhai price kya hai?');
check('typed DM: processable', typed.isProcessable === true);
check('typed DM: no product context', typed.hasProductContext === false && typed.productId === null);
check('typed DM: displayText is the customer words', typed.displayText === 'bhai price kya hai?');
check('typed DM: no product instruction', productContextInstruction(typed) === '');

// ============================================================ PRODUCT-PAGE DMs (the bug)
// Meta's documented shape: message.referral.product.id, NO text.
const referralNoText = parseInboundMessage({
  mid: 'm2',
  referral: { product: { id: '998877' } },
});
check('product referral w/o text: processable (was dropped before)', referralNoText.isProcessable === true);
check('product referral w/o text: product id extracted', referralNoText.productId === '998877');
check('product referral w/o text: displayText is the stand-in note', referralNoText.displayText === productInquiryNote('998877'));
check('product referral w/o text: note names the product id', referralNoText.displayText.includes('998877'));
check('product referral w/o text: AI gets a product instruction', productContextInstruction(referralNoText).includes('998877'));

// Referral WITH text (buyer typed along with the product).
const referralWithText = parseInboundMessage({
  mid: 'm3',
  text: 'ye available hai?',
  referral: { product: { id: '998877' } },
});
check('product referral w/ text: customer words win', referralWithText.displayText === 'ye available hai?');
check('product referral w/ text: product id kept', referralWithText.productId === '998877');

// Product card attachment without text.
const card = parseInboundMessage({
  mid: 'm4',
  attachments: [{ type: 'product', payload: { product_id: '554433' } }],
});
check('product card w/o text: processable', card.isProcessable === true);
check('product card w/o text: product id from attachment', card.productId === '554433');

// Share attachment carrying a product payload.
const share = parseInboundMessage({
  mid: 'm5',
  attachments: [{ type: 'share', payload: { product: { id: '112233' } } }],
});
check('share-with-product w/o text: processable', share.isProcessable === true);
check('share-with-product: product id found', share.productId === '112233');

// ig_post attachment carrying a product payload — Meta is replacing the legacy
// 'share' attachment with 'ig_post', so the same shop entry point can flip
// payload type without notice. Must not drop again when it does.
const igPost = parseInboundMessage({
  mid: 'm8',
  attachments: [{ type: 'ig_post', payload: { product_id: '778899' } }],
});
check('ig_post-with-product w/o text: processable', igPost.isProcessable === true);
check('ig_post-with-product: product id found', igPost.productId === '778899');

const igPostObj = parseInboundMessage({
  mid: 'm9',
  attachments: [{ type: 'ig_post', payload: { product: { id: '334455' } } }],
});
check('ig_post with product object: product id found', igPostObj.productId === '334455');

// A plain shared post (ig_post WITHOUT product payload) is not a product
// inquiry — behaviour unchanged.
const plainShare = parseInboundMessage({
  mid: 'm10',
  attachments: [{ type: 'ig_post', payload: { url: 'https://www.instagram.com/p/abc/' } }],
});
check('plain ig_post w/o text: not processable (unchanged behaviour)', plainShare.isProcessable === false);

// Product context with no id at all (some payloads only say "product page").
const idless = parseInboundMessage({ mid: 'm6', referral: { product: {} } });
check('idless product referral: still processable', idless.isProcessable === true);
check('idless product referral: instruction without id', productContextInstruction(idless).includes('a product page'));

// ============================================================ NON-MESSAGES (must still drop)
const sticker = parseInboundMessage({ mid: 'm7', attachments: [{ type: 'image', payload: {} }] });
check('image-only sticker-ish: not processable (unchanged behaviour)', sticker.isProcessable === false);
check('image-only: empty displayText', sticker.displayText === '');

// Sticker in Meta's post-2026 format (type 'sticker'; the old 'image'
// representation is no longer sent) — must still drop.
const stickerNew = parseInboundMessage({ mid: 'm11', attachments: [{ type: 'sticker', payload: {} }] });
check('sticker (new format): not processable (unchanged behaviour)', stickerNew.isProcessable === false);

const empty = parseInboundMessage(undefined);
check('undefined message: not processable', empty.isProcessable === false);

const garbage = parseInboundMessage({ text: '   ' });
check('whitespace-only text: not processable', garbage.isProcessable === false);

const noMessage = parseInboundMessage({});
check('empty object: not processable', noMessage.isProcessable === false);

// ============================================================ SUMMARY
console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
process.exit(fail === 0 ? 0 : 1);
