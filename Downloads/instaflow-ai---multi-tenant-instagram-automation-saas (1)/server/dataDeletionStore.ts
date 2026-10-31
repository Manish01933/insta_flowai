import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, isPersistentDataDirConfigured } from './connectionStore';

/**
 * Meta's Data Deletion Request callback.
 *
 * Meta POSTs `signed_request=<sig>.<payload>` to the URL configured in
 * App Settings → Basic → User data deletion. We must verify that signature,
 * delete what we hold for that user, and hand back a `confirmation_code` plus a
 * `url` where the person (and Meta's reviewer) can see the outcome. The previous
 * version answered with a code it never stored and pointed at a status page that
 * did not exist, which is worse than nothing: it looks compliant and is not.
 *
 * The signed payload looks like:
 *   { algorithm: 'HMAC-SHA256', issued_at: 1690000000, user_id: '17841434784408449' }
 */

const FILE = path.join(DATA_DIR, 'data-deletion-requests.json');
const MAX_RECORDS = 200;

export interface DataDeletionRecord {
  code: string;
  requestedAt: string;
  /** The id Meta signed — an Instagram-scoped or Facebook-scoped user id. */
  userId: string;
  /** Tenant we could match that id to, if any. */
  tenantId: string | null;
  instagramUsername?: string;
  deleted: {
    connection: boolean;
    chats: number;
    leads: number;
    aiSettings: boolean;
  };
  /** Which secret verified the signature: 'META_APP_SECRET' or 'IG_APP_SECRET'. */
  verifiedWith?: string;
}

let loaded = false;
const records = new Map<string, DataDeletionRecord>();

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('[dataDeletion] Failed to create data directory:', err);
  }
}

function persist() {
  try {
    ensureDataDir();
    const entries = Array.from(records.values())
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
      .slice(0, MAX_RECORDS);
    const tmpFile = `${FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, requests: entries }, null, 2), 'utf8');
    fs.renameSync(tmpFile, FILE);
  } catch (err) {
    console.error('[dataDeletion] Failed to persist deletion requests:', err);
  }
}

export function loadDataDeletionRequests(): void {
  if (loaded) return;
  loaded = true;

  if (!isPersistentDataDirConfigured && process.env.NODE_ENV === 'production') {
    console.warn(
      '[dataDeletion] DATA_DIR is not set; deletion confirmations would be lost on redeploy.'
    );
  }

  try {
    if (!fs.existsSync(FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const list: DataDeletionRecord[] = Array.isArray(parsed?.requests) ? parsed.requests : [];
    for (const record of list) {
      if (record?.code && record?.requestedAt) records.set(record.code, record);
    }
    console.log(`[dataDeletion] Loaded ${records.size} deletion request(s) from ${FILE}`);
  } catch (err) {
    console.error('[dataDeletion] Failed to load deletion requests:', err);
  }
}

/**
 * Meta sends `<base64url(signature)>.<base64url(payload)>`, the signature being
 * HMAC-SHA256 over the *encoded payload string* (not the decoded JSON) keyed by
 * the app secret. Instagram-Login apps are signed with the Instagram app secret,
 * which is why both are tried by the caller.
 */
export function parseSignedRequest(signedRequest: string, secret: string): any | null {
  if (!signedRequest || !secret) return null;

  const parts = String(signedRequest).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const decode = (value: string) =>
    Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  try {
    const expected = crypto.createHmac('sha256', secret).update(parts[1]).digest();
    const actual = decode(parts[0]);
    if (expected.length !== actual.length) return null;
    if (!crypto.timingSafeEqual(expected, actual)) return null;

    const payload = JSON.parse(decode(parts[1]).toString('utf8'));
    if (String(payload?.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
    return payload;
  } catch {
    return null;
  }
}

export function newConfirmationCode(): string {
  return `del_${crypto.randomBytes(6).toString('hex')}`;
}

export function recordDataDeletion(record: DataDeletionRecord): DataDeletionRecord {
  loadDataDeletionRequests();
  records.set(record.code, record);
  persist();
  return record;
}

export function getDataDeletionRequest(code: string): DataDeletionRecord | null {
  loadDataDeletionRequests();
  if (!code) return null;
  return records.get(code) || null;
}

export function getDataDeletionStats() {
  loadDataDeletionRequests();
  const all = Array.from(records.values());
  return {
    requests: all.length,
    latestAt: all.length
      ? all.map((r) => r.requestedAt).sort().slice(-1)[0]
      : null,
    file: FILE,
    persistentDirConfigured: isPersistentDataDirConfigured,
  };
}
