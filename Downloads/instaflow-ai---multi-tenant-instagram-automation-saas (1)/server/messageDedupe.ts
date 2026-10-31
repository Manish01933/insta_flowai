import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Persistent deduplication store for Meta webhook message IDs.
 *
 * Why this exists: Meta retries a webhook delivery whenever our endpoint is slow
 * or a deploy/restart happens mid-request. An in-memory cache of processed
 * `mid`s is wiped by every Railway redeploy, so the retry looks "new" and the
 * customer receives the SAME AI reply twice. Persisting the IDs next to the
 * connection store (`DATA_DIR`, which is on a mounted volume in production)
 * makes dedupe survive restarts.
 *
 * Entries are pruned after TTL_MS; we only need to remember a message long
 * enough to outlive Meta's retry window (a few minutes at most).
 */
const DEDUPE_FILE = path.join(DATA_DIR, 'processed-messages.json');

const parsedTtl = parseInt(process.env.WEBHOOK_DEDUPE_TTL_MS || '', 10);
const TTL_MS = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 30 * 60 * 1000;

/** Hard cap so a runaway loop can never grow the file without bound. */
const MAX_ENTRIES = 5000;

// mid -> processed-at (epoch ms)
const processed = new Map<string, number>();
let loaded = false;

function prune(now: number = Date.now()) {
  processed.forEach((ts, mid) => {
    if (now - ts > TTL_MS) processed.delete(mid);
  });

  if (processed.size > MAX_ENTRIES) {
    const oldestFirst = Array.from(processed.entries()).sort((a, b) => a[1] - b[1]);
    const excess = oldestFirst.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
      processed.delete(oldestFirst[i][0]);
    }
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, number> = {};
    processed.forEach((ts, mid) => {
      data[mid] = ts;
    });
    const tmpFile = `${DEDUPE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
    fs.renameSync(tmpFile, DEDUPE_FILE);
  } catch (err) {
    console.error('[messageDedupe] Failed to persist processed message IDs:', err);
  }
}

/** Load once, lazily, so this module stays side-effect free on import. */
export function loadProcessedMessageIds() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(DEDUPE_FILE)) return;
    const raw = fs.readFileSync(DEDUPE_FILE, 'utf8');
    const data: Record<string, number> = JSON.parse(raw);
    const now = Date.now();
    let skipped = 0;
    for (const [mid, ts] of Object.entries(data)) {
      if (typeof ts === 'number' && now - ts <= TTL_MS) {
        processed.set(mid, ts);
      } else {
        skipped += 1;
      }
    }
    console.log(
      `[messageDedupe] Loaded ${processed.size} unexpired message ID(s) from ${DEDUPE_FILE}` +
        (skipped ? ` (dropped ${skipped} expired)` : '')
    );
  } catch (err) {
    console.error('[messageDedupe] Failed to load processed message IDs:', err);
  }
}

/** True when this `mid` was already handled (within the retry window). */
export function hasProcessedMessage(mid: string): boolean {
  loadProcessedMessageIds();
  const ts = processed.get(mid);
  if (ts === undefined) return false;
  if (Date.now() - ts > TTL_MS) {
    processed.delete(mid);
    return false;
  }
  return true;
}

/** Record a `mid` as handled and flush it to disk immediately. */
export function markMessageProcessed(mid: string) {
  loadProcessedMessageIds();
  processed.set(mid, Date.now());
  if (processed.size > MAX_ENTRIES) prune();
  persist();
}

/** Periodic housekeeping: drop expired IDs and compact the file. */
export function startMessageDedupeSweeper() {
  const timer = setInterval(() => {
    prune();
    persist();
  }, 10 * 60 * 1000);
  // Never keep the process alive just for housekeeping.
  timer.unref?.();
  return timer;
}

export function getMessageDedupeStats() {
  loadProcessedMessageIds();
  return {
    trackedIds: processed.size,
    ttlSeconds: Math.round(TTL_MS / 1000),
    file: DEDUPE_FILE,
    persistentDirConfigured: Boolean(process.env.DATA_DIR),
  };
}
