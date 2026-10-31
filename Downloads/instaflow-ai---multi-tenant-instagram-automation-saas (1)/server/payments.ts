import crypto from 'crypto';

/**
 * Razorpay helpers — plain HTTPS calls instead of an SDK.
 *
 * Razorpay is the practical choice for Indian customers (UPI, cards, netbanking
 * in one checkout), and their REST API is three endpoints, so pulling in a
 * dependency would add supply-chain surface for no benefit. Signature
 * verification is HMAC-SHA256, which we already do for Meta webhooks.
 *
 * Two different secrets are involved and they are not interchangeable:
 *   - key secret      → verifies the checkout callback (`order_id|payment_id`)
 *   - webhook secret  → verifies server-to-server webhooks (raw body)
 * Both are checked; whichever arrives first activates the plan, and the other
 * becomes a no-op because activation is idempotent.
 */

const KEY_ID = (process.env.RAZORPAY_KEY_ID || '').trim();
const KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();
const WEBHOOK_SECRET = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

const API_BASE = 'https://api.razorpay.com/v1';

export function isPaymentsConfigured(): boolean {
  return Boolean(KEY_ID && KEY_SECRET);
}

export function getPublicPaymentConfig() {
  return {
    provider: 'razorpay' as const,
    configured: isPaymentsConfigured(),
    // The key id is public by design — the checkout widget needs it. Never the secret.
    keyId: KEY_ID || null,
    webhookConfigured: Boolean(WEBHOOK_SECRET),
  };
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

/** Create an order for `amountInr` whole rupees. Notes ride back on the webhook. */
export async function createOrder(args: {
  amountInr: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<{ ok: true; order: RazorpayOrder } | { ok: false; error: string }> {
  if (!isPaymentsConfigured()) {
    return { ok: false, error: 'Payments are not configured on the server yet.' };
  }

  const amountPaise = Math.round(args.amountInr * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    return { ok: false, error: 'Invalid amount.' };
  }

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: args.receipt.slice(0, 40),
        notes: args.notes,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error?.description || `Razorpay rejected the order (HTTP ${res.status}).` };
    }
    return { ok: true, order: data as RazorpayOrder };
  } catch (err: any) {
    return { ok: false, error: `Could not reach Razorpay: ${err.message}` };
  }
}

/**
 * Verify the browser checkout callback. Razorpay signs `order_id|payment_id`
 * with the key secret.
 */
export function verifyCheckoutSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!isPaymentsConfigured()) return false;
  if (!args.orderId || !args.paymentId || !args.signature) return false;

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest('hex');

  return timingSafeEqualHex(expected, args.signature);
}

/** Verify a server-to-server webhook signature (HMAC over the raw body). */
export function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !rawBody || !signature) return false;

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(expected: string, provided: string): boolean {
  const a = Buffer.from(String(expected), 'hex');
  const b = Buffer.from(String(provided), 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Capture an authorised payment.
 *
 * Razorpay accounts can be set to manual capture, in which case the customer's
 * money is only *held*: `payment.authorized` fires, the bank shows a debit, and
 * nothing is taken until we capture. That is the single most confusing failure a
 * customer can hit ("paisa kat gaya, plan nahi mila"), so we capture it ourselves
 * the moment we see an authorised payment.
 */
export async function capturePayment(
  paymentId: string,
  amountPaise: number
): Promise<{ ok: true; payment: any } | { ok: false; error: string }> {
  if (!isPaymentsConfigured()) return { ok: false, error: 'Payments are not configured.' };

  try {
    const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error?.description || `Razorpay capture failed (HTTP ${res.status}).` };
    }
    return { ok: true, payment: data };
  } catch (err: any) {
    return { ok: false, error: `Could not reach Razorpay: ${err.message}` };
  }
}

/**
 * Every payment attempt against an order, so a customer who paid but never got
 * their plan can be reconciled without human help.
 */
export async function fetchOrderPayments(orderId: string): Promise<{ ok: true; payments: any[] } | { ok: false; error: string }> {
  if (!isPaymentsConfigured()) return { ok: false, error: 'Payments are not configured.' };

  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/payments`, {
      headers: { Authorization: authHeader() },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error?.description || `Razorpay order lookup failed (HTTP ${res.status}).` };
    }
    return { ok: true, payments: Array.isArray(data?.items) ? data.items : [] };
  } catch (err: any) {
    return { ok: false, error: `Could not reach Razorpay: ${err.message}` };
  }
}

/** Why a payment did not go through, in words a customer can act on. */
export function describePaymentFailure(payment: any): string {
  const reason = String(payment?.error_reason || '');
  const description = String(payment?.error_description || '');

  if (reason === 'payment_risk_check_failed') {
    return (
      'Razorpay ne is payment ko risk check me block kar diya (website registered nahi hai). ' +
      'Paisa hold hua hai to 3-7 working days me wapas aa jayega. Razorpay dashboard me apni website register karke dobara try karo.'
    );
  }
  if (description) return `Payment fail ho gaya: ${description}`;
  return `Payment complete nahi hua (status: ${payment?.status || 'unknown'}). Dobara try karo.`;
}

/** Fetch a payment so activation never trusts client-supplied amounts. */
export async function fetchPayment(
  paymentId: string
): Promise<{ ok: true; payment: any } | { ok: false; error: string }> {
  if (!isPaymentsConfigured()) return { ok: false, error: 'Payments are not configured.' };

  try {
    const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: authHeader() },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data?.error?.description || `Razorpay lookup failed (HTTP ${res.status}).` };
    }
    return { ok: true, payment: data };
  } catch (err: any) {
    return { ok: false, error: `Could not reach Razorpay: ${err.message}` };
  }
}
