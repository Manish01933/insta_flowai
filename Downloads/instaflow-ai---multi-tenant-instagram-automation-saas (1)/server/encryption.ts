import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_MASTER_SECRET = 'instaflow-ai-secure-master-secret-key-32b!';

let warnedAboutDefaultSecret = false;

// Read lazily so the value is always the current process.env (and so a
// configured ENCRYPTION_MASTER_KEY can never be missed due to import order).
function getMasterSecret(): string {
  const configured = (process.env.ENCRYPTION_MASTER_KEY || '').trim();
  if (configured) {
    if (configured.length < 32) {
      console.warn('ENCRYPTION_MASTER_KEY is shorter than the recommended 32 characters.');
    }
    return configured;
  }

  if (!warnedAboutDefaultSecret) {
    warnedAboutDefaultSecret = true;
    console.warn('ENCRYPTION_MASTER_KEY is not set — using the built-in default key. Set a unique key in production.');
  }
  return DEFAULT_MASTER_SECRET;
}

function getDerivedKey(sessionToken?: string): Buffer {
  const masterSecret = getMasterSecret();
  const secret = sessionToken ? `${masterSecret}:${sessionToken}` : masterSecret;
  return crypto.scryptSync(secret, 'salt-instaflow', 32);
}

export function encryptData(text: string, sessionToken?: string): string {
  const iv = crypto.randomBytes(12);
  const key = getDerivedKey(sessionToken);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptData(encryptedPayload: string, sessionToken?: string): string {
  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const key = getDerivedKey(sessionToken);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err);
    throw new Error('Failed to decrypt data securely.');
  }
}
