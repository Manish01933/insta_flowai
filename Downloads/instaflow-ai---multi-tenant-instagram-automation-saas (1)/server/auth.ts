import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Verifies Firebase ID tokens without firebase-admin.
 *
 * Why not firebase-admin: it needs a service-account JSON on the host, adds a
 * large dependency, and does far more than this file needs. A Firebase ID token
 * is a plain RS256 JWT signed by Google, and Google publishes the signing
 * certificates at a stable URL — so verification is: check the claims, then
 * check the signature against the matching certificate. The only "secret" is the
 * project id, which is already public (it ships in the browser bundle).
 *
 * What this buys us: a tenant id can no longer be *claimed* with a header. The
 * tenant is whoever proves they hold a token for that uid, which is the whole
 * basis of multi-tenant isolation.
 */

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache: { keys: Record<string, string>; expiresAt: number } | null = null;

/** The Firebase project whose tokens we accept. */
export function firebaseProjectId(): string {
  const fromEnv = (process.env.FIREBASE_PROJECT_ID || '').trim();
  if (fromEnv) return fromEnv;

  // Fall back to the same config file the browser bundle is built from, so the
  // two can never disagree about which project this app belongs to.
  for (const candidate of [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.join(process.cwd(), '..', 'firebase-applet-config.json'),
  ]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed?.projectId) return String(parsed.projectId);
    } catch {
      /* try the next candidate */
    }
  }
  return '';
}

async function googleCertificates(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && certCache && certCache.expiresAt > Date.now()) return certCache.keys;

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Google certificate fetch failed: HTTP ${res.status}`);
  const keys = (await res.json()) as Record<string, string>;

  // Google sends the rotation window in Cache-Control; default to an hour.
  const maxAge = Number(/max-age=(\d+)/i.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  certCache = { keys, expiresAt: Date.now() + Math.max(300, maxAge) * 1000 };
  return keys;
}

const fromBase64Url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface VerifiedUser {
  uid: string;
  email?: string;
}

/**
 * Returns the signed-in user, or null when the token is forged, expired, meant
 * for another project, or simply not a token. Callers must treat null as
 * "not signed in" — never as "maybe".
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedUser | null> {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(fromBase64Url(rawHeader).toString('utf8'));
    payload = JSON.parse(fromBase64Url(rawPayload).toString('utf8'));
  } catch {
    return null;
  }

  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const projectId = firebaseProjectId();
  if (!projectId) {
    console.error('[auth] FIREBASE_PROJECT_ID is not set and firebase-applet-config.json was not readable — cannot verify tokens');
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null;
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) return null;

  const signed = Buffer.from(`${rawHeader}.${rawPayload}`);
  const signature = fromBase64Url(rawSignature);

  try {
    let cert = (await googleCertificates())[header.kid];
    // An unknown kid usually means Google rotated the keys since we cached them.
    if (!cert) cert = (await googleCertificates(true))[header.kid];
    if (!cert) return null;

    const valid = crypto.verify('RSA-SHA256', signed, crypto.createPublicKey(cert), signature);
    if (!valid) return null;
  } catch (err: any) {
    console.error('[auth] token signature check failed:', err?.message || err);
    return null;
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}
