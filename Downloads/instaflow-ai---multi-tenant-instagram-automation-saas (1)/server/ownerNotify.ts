/**
 * Pushes a notification to the business owner's own WhatsApp.
 *
 * Why this file exists: customers need a way to complain that does not publish
 * the owner's personal mobile number. The public complaint form therefore posts
 * to our own server, and this module is the only place that knows where the
 * message goes — the number lives in `COMPLAINT_WHATSAPP_TO` on the host and is
 * never sent to a browser.
 *
 * The relay is CallMeBot's HTTP API: one GET, no SDK, no monthly cost. It is a
 * personal-use service, so it is rate limited and best-effort by design — the
 * caller always stores the complaint first, and a delivery failure is recorded
 * next to it instead of being lost. Swapping in an official provider later means
 * changing only this file.
 */

const DEFAULT_ENDPOINT = 'https://api.callmebot.com/whatsapp.php';
const NOTIFY_TIMEOUT_MS = 10_000;

/** The number that receives complaints. Digits plus a leading `+` only. */
function ownerWhatsAppTarget(): string {
  const raw = (process.env.COMPLAINT_WHATSAPP_TO || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

function relayApiKey(): string {
  return (process.env.CALLMEBOT_API_KEY || '').trim();
}

function relayEndpoint(): string {
  return (process.env.CALLMEBOT_ENDPOINT || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
}

/**
 * Whether complaints can actually be delivered over WhatsApp. The public form
 * still works when this is false — the complaint is stored so it cannot be lost
 * — but `/healthz` reports it so a silent misconfiguration is visible.
 */
export function isOwnerWhatsAppConfigured(): boolean {
  return Boolean(ownerWhatsAppTarget() && relayApiKey());
}

export type OwnerNotifyResult = { ok: true } | { ok: false; error: string };

/**
 * Send one plain-text WhatsApp message to the owner. Never throws: a network
 * problem, a bad key or a rate limit comes back as `{ ok: false }` so the caller
 * can record it next to the complaint and move on.
 */
export async function sendOwnerWhatsApp(text: string): Promise<OwnerNotifyResult> {
  const phone = ownerWhatsAppTarget();
  const apikey = relayApiKey();

  if (!phone || !apikey) {
    return { ok: false, error: 'WhatsApp notifications are not configured on this host.' };
  }

  const body = String(text || '').slice(0, 1200);
  if (!body.trim()) return { ok: false, error: 'Nothing to send.' };

  const url =
    `${relayEndpoint()}?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(body)}` +
    `&apikey=${encodeURIComponent(apikey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const raw = await res.text();

    // The relay echoes the message we just sent back inside its response, so the
    // page contains whatever the customer wrote. A customer who mentions "error"
    // in their complaint must not be recorded as a failed delivery, and the
    // refusal sentence comes *after* that echo — which is longer than any fixed
    // window. So only the last block of the page, the relay's own verdict, is
    // inspected; the echo is never matched against.
    const blocks = raw.split(/<p[^>]*>/i);
    const verdict = (blocks[blocks.length - 1] || raw)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    if (!res.ok) {
      return { ok: false, error: `relay HTTP ${res.status}${verdict ? `: ${verdict}` : ''}` };
    }
    // The relay answers 2xx even when it refuses — a bad key comes back as HTTP
    // 203 with `<b>APIKey is invalid.</b>` — so the status code says nothing.
    if (/APIKey is invalid|not sent|not allowed|too many|maximum|quota|daily limit|expired|deactivated|error/i.test(verdict)) {
      return { ok: false, error: `relay refused: ${verdict || 'unknown reason'}` };
    }
    return { ok: true };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'relay timed out' : String(err?.message || err);
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A short line describing the relay for the owner-facing ops views, e.g.
 * `+91********33` — enough to confirm the right number is wired without putting
 * it back on screen.
 */
export function getOwnerWhatsAppLabel(): string {
  const phone = ownerWhatsAppTarget();
  if (!phone) return '';
  return `${phone.slice(0, 3)}******${phone.slice(-4)}`;
}
