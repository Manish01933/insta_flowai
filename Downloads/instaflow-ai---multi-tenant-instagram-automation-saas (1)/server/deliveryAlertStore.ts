import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * DMs that arrived for an Instagram account this server does not have connected.
 *
 * Why this exists: the webhook happily accepts a delivery from Meta, finds that
 * the receiving account is not in `connections.json`, and drops it. That is the
 * correct routing decision — answering from another tenant's token would be a
 * cross-tenant leak — but it used to be invisible: the customer saw no reply,
 * and the only trace was one line in the server log. In production a tester's
 * account sat in exactly this state for days ("Hi" arrived, nothing answered).
 *
 * Recording it turns "the bot is broken" into a fact the console can show:
 * *these* accounts are receiving DMs with no connection behind them.
 */
export interface UnroutedDelivery {
  at: string;
  /** `entry.id` — the account that RECEIVED the DM (our side), not the sender. */
  igAccountId: string;
  /** The person who wrote to us. */
  senderId: string;
  /** First 80 characters of what they wrote, so the operator can recognise it. */
  preview: string;
}

export interface UnroutedDeliveryStats {
  /** Count since the store file was created (survives restarts). */
  total: number;
  lastAt: string | null;
  recent: UnroutedDelivery[];
}

const FILE = path.join(DATA_DIR, 'unrouted-deliveries.json');

/** Keep a short list on disk; the interesting question is "which account", not history. */
const MAX_RECENT = 25;
const MAX_PREVIEW_CHARS = 80;

interface AlertsFile {
  version: 1;
  total: number;
  recent: UnroutedDelivery[];
}

let state: AlertsFile | null = null;

function load(): AlertsFile {
  if (state) return state;
  state = { version: 1, total: 0, recent: [] };
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const recent = Array.isArray(parsed?.recent)
        ? parsed.recent
            .filter((entry: any) => entry && typeof entry.igAccountId === 'string')
            .slice(0, MAX_RECENT)
        : [];
      state = {
        version: 1,
        total: Number.isFinite(parsed?.total) ? Number(parsed.total) : recent.length,
        recent,
      };
      console.log(`[deliveryAlerts] Loaded ${state.recent.length} unrouted delivery alert(s) (total ${state.total})`);
    }
  } catch (err) {
    console.error('[deliveryAlerts] Failed to load unrouted deliveries:', err);
  }
  return state;
}

function persist() {
  const current = load();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[deliveryAlerts] Failed to persist unrouted deliveries:', err);
  }
}

/** Record one delivery that could not be routed to a connected account. */
export function recordUnroutedDelivery(entry: {
  igAccountId: string;
  senderId: string;
  text?: string;
}): UnroutedDelivery {
  const current = load();
  const record: UnroutedDelivery = {
    at: new Date().toISOString(),
    igAccountId: String(entry.igAccountId || '').trim(),
    senderId: String(entry.senderId || '').trim(),
    preview: String(entry.text || '').slice(0, MAX_PREVIEW_CHARS),
  };

  current.total += 1;
  current.recent = [record, ...current.recent.filter(
    // Collapse a repeat from the same account so one loud customer cannot push
    // every other account out of the list.
    (existing) => existing.igAccountId !== record.igAccountId
  )].slice(0, MAX_RECENT);
  persist();
  return record;
}

export function getUnroutedDeliveryStats(): UnroutedDeliveryStats {
  const current = load();
  return {
    total: current.total,
    lastAt: current.recent[0]?.at || null,
    recent: current.recent,
  };
}

/**
 * Drop the alerts for one Instagram account — the owner's permanent delete.
 *
 * An alert points at an account that is not connected here, which after a delete
 * is true for a reason nobody can act on: the customer and their account are gone.
 * Leaving the row would put a dead account at the top of the panel forever. The
 * running total is kept, like `clearUnroutedDeliveries`.
 */
export function forgetUnroutedDeliveriesForAccount(igAccountId: string): number {
  const current = load();
  const needle = String(igAccountId || '').trim();
  if (!needle) return 0;
  const before = current.recent.length;
  current.recent = current.recent.filter((entry) => entry.igAccountId !== needle);
  const removed = before - current.recent.length;
  if (removed) persist();
  return removed;
}

/** Owner action: "I have dealt with these" — clears the list, keeps the total. */
export function clearUnroutedDeliveries(): UnroutedDeliveryStats {
  const current = load();
  current.recent = [];
  persist();
  return getUnroutedDeliveryStats();
}
