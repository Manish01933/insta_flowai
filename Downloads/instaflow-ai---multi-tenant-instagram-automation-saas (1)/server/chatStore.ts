import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Durable store for the dashboard's "Live Customer Chat Inbox" and the
 * per-conversation human-takeover flag.
 *
 * Why this exists: the inbox used to live in an in-memory `Map` inside
 * server.ts, which meant every DM a customer sent vanished on the next
 * deploy/restart — exactly the same class of bug we fixed for webhook
 * dedupe (see server/messageDedupe.ts). The file lives in `DATA_DIR`, which
 * is a mounted persistent volume in production, so history and the
 * "human agent is handling this conversation" state survive redeploys.
 */

export interface ChatLogMessage {
  sender: 'customer' | 'ai' | 'agent';
  text: string;
  timestamp: string;
}

export interface ChatLogItem {
  /** `<instagramAccountId>:<senderId>` — stable key for a conversation. */
  id: string;
  tenantId: string;
  instagramAccountId: string;
  senderId: string;
  senderHandle?: string;
  customerName?: string;
  messages: ChatLogMessage[];
  lastMessage: string;
  humanTakeover: boolean;
  unread: boolean;
  updatedAt: string;
}

const CHATS_FILE = path.join(DATA_DIR, 'inbox-chats.json');

/** Hard caps so a chatty account can never grow the file without bound. */
const MAX_CHATS = 500;
const MAX_MESSAGES_PER_CHAT = 200;

const parsedRetentionDays = parseInt(process.env.CHAT_RETENTION_DAYS || '', 10);
const RETENTION_DAYS =
  Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0 ? parsedRetentionDays : 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const chats = new Map<string, ChatLogItem>();
let loaded = false;

export function buildChatId(instagramAccountId: string, senderId: string): string {
  return `${instagramAccountId}:${senderId}`;
}

function timestampOf(chat: ChatLogItem): number {
  const ts = Date.parse(chat.updatedAt);
  return Number.isFinite(ts) ? ts : 0;
}

function prune(now: number = Date.now()) {
  chats.forEach((chat, id) => {
    const stale = now - timestampOf(chat) > RETENTION_MS;
    if (stale) chats.delete(id);
  });

  if (chats.size > MAX_CHATS) {
    const newestFirst = Array.from(chats.values()).sort((a, b) => timestampOf(b) - timestampOf(a));
    for (const chat of newestFirst.slice(MAX_CHATS)) {
      chats.delete(chat.id);
    }
  }
}

/** Atomic write (temp file + rename) so a crash can never leave a torn JSON file. */
function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, ChatLogItem> = {};
    chats.forEach((chat, id) => {
      data[id] = chat;
    });
    const tmpFile = `${CHATS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, chats: data }), 'utf8');
    fs.renameSync(tmpFile, CHATS_FILE);
  } catch (err) {
    console.error('[chatStore] Failed to persist inbox chats:', err);
  }
}

/** Load once, lazily, so this module stays side-effect free on import. */
export function loadChatStore() {
  if (loaded) return;
  loaded = true;

  try {
    if (!fs.existsSync(CHATS_FILE)) return;
    const raw = fs.readFileSync(CHATS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Tolerate both the wrapped shape and a bare `Record<id, chat>`.
    const data: Record<string, ChatLogItem> = parsed?.chats ?? parsed ?? {};

    const now = Date.now();
    let dropped = 0;
    for (const [id, chat] of Object.entries(data)) {
      if (!chat || typeof chat !== 'object' || !Array.isArray((chat as ChatLogItem).messages)) {
        dropped += 1;
        continue;
      }
      if (now - timestampOf(chat as ChatLogItem) > RETENTION_MS) {
        dropped += 1;
        continue;
      }
      const restored: ChatLogItem = {
        ...(chat as ChatLogItem),
        id: (chat as ChatLogItem).id || id,
        humanTakeover: Boolean((chat as ChatLogItem).humanTakeover),
        messages: (chat as ChatLogItem).messages.slice(-MAX_MESSAGES_PER_CHAT),
      };
      chats.set(id, restored);
    }

    console.log(
      `[chatStore] Loaded ${chats.size} inbox conversation(s) from ${CHATS_FILE}` +
        (dropped ? ` (dropped ${dropped} stale/invalid)` : '')
    );
  } catch (err) {
    console.error('[chatStore] Failed to load inbox chats:', err);
  }
}

/** Conversations for a tenant, newest activity first. */
/**
 * Conversations for one tenant only.
 *
 * The `default_tenant` demo used to see every tenant's DM history — real
 * customers' messages, sender ids and phone numbers included. The demo keeps its
 * built-in sample conversations in the browser instead.
 */
export function getChatsForTenant(tenantId: string): ChatLogItem[] {
  loadChatStore();
  const result: ChatLogItem[] = [];
  chats.forEach((chat) => {
    if (chat.tenantId === tenantId) {
      result.push(chat);
    }
  });
  return result.sort((a, b) => timestampOf(b) - timestampOf(a));
}

export function getChatById(id: string): ChatLogItem | null {
  loadChatStore();
  return chats.get(id) || null;
}

/** True when an agent has paused the bot for this conversation. */
export function isHumanTakeover(id: string): boolean {
  loadChatStore();
  return Boolean(chats.get(id)?.humanTakeover);
}

/**
 * Record an inbound customer DM, optionally together with the AI reply that
 * was sent for it, and flush the conversation to disk.
 */
export function recordIncomingMessage(args: {
  instagramAccountId: string;
  senderId: string;
  tenantId: string;
  text: string;
  /** Omit/null when no automated reply was sent (e.g. human takeover). */
  aiReply?: string | null;
  humanTakeover?: boolean;
}): ChatLogItem {
  loadChatStore();

  const senderId = String(args.senderId);
  const id = buildChatId(String(args.instagramAccountId), senderId);
  const now = new Date().toISOString();

  let chat = chats.get(id);
  if (!chat) {
    chat = {
      id,
      tenantId: args.tenantId,
      instagramAccountId: String(args.instagramAccountId),
      senderId,
      customerName: `Customer (${senderId.slice(-4)})`,
      senderHandle: `@user_${senderId.slice(-4)}`,
      messages: [],
      lastMessage: args.text,
      humanTakeover: false,
      unread: true,
      updatedAt: now,
    };
    chats.set(id, chat);
  }

  chat.messages.push({ sender: 'customer', text: args.text, timestamp: now });

  if (args.aiReply) {
    chat.messages.push({ sender: 'ai', text: args.aiReply, timestamp: now });
    chat.lastMessage = args.aiReply;
    chat.unread = false;
  } else {
    chat.lastMessage = args.text;
    chat.unread = true;
  }

  if (typeof args.humanTakeover === 'boolean') {
    chat.humanTakeover = args.humanTakeover;
  }

  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
  }

  chat.updatedAt = now;
  persist();
  return chat;
}

/** Append a message we sent (AI or a human agent) to an existing conversation. */
export function appendOutboundMessage(
  id: string,
  sender: 'ai' | 'agent',
  text: string
): ChatLogItem | null {
  loadChatStore();
  const chat = chats.get(id);
  if (!chat) return null;

  const now = new Date().toISOString();
  chat.messages.push({ sender, text, timestamp: now });
  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
  }
  chat.lastMessage = text;
  chat.unread = false;
  chat.updatedAt = now;
  persist();
  return chat;
}

/** Pause or resume the AI bot for one conversation. */
export function setHumanTakeover(id: string, value: boolean): ChatLogItem | null {
  loadChatStore();
  const chat = chats.get(id);
  if (!chat) return null;

  chat.humanTakeover = Boolean(value);
  chat.updatedAt = new Date().toISOString();
  persist();
  return chat;
}

/** Periodic housekeeping: drop conversations past retention and compact the file. */
export function startChatStoreSweeper() {
  const timer = setInterval(() => {
    prune();
    persist();
  }, 10 * 60 * 1000);
  // Never keep the process alive just for housekeeping.
  timer.unref?.();
  return timer;
}

/** Conversations grouped by tenant, for the owner-only overview. */
export function getChatCountsByTenant(): Record<
  string,
  { conversations: number; takeovers: number; lastMessageAt: string | null }
> {
  loadChatStore();
  const counts: Record<string, { conversations: number; takeovers: number; lastMessageAt: string | null }> = {};
  chats.forEach((chat) => {
    const entry = (counts[chat.tenantId] ||= { conversations: 0, takeovers: 0, lastMessageAt: null });
    entry.conversations += 1;
    if (chat.humanTakeover) entry.takeovers += 1;
    const last = timestampOf(chat);
    if (last && (!entry.lastMessageAt || last > Date.parse(entry.lastMessageAt))) {
      entry.lastMessageAt = new Date(last).toISOString();
    }
  });
  return counts;
}

/**
 * Meta / GDPR data deletion. Removes every conversation belonging to one tenant
 * and returns how many were dropped, so the caller can report a real number to
 * Meta instead of an empty promise.
 */
export function deleteChatsForTenant(tenantId: string): number {
  loadChatStore();
  let removed = 0;
  chats.forEach((chat, id) => {
    if (chat.tenantId === tenantId) {
      chats.delete(id);
      removed += 1;
    }
  });
  if (removed > 0) persist();
  return removed;
}

export function getChatStoreStats() {
  loadChatStore();
  let humanTakeovers = 0;
  let messages = 0;
  chats.forEach((chat) => {
    if (chat.humanTakeover) humanTakeovers += 1;
    messages += chat.messages.length;
  });
  return {
    conversations: chats.size,
    humanTakeovers,
    messages,
    retentionDays: RETENTION_DAYS,
    file: CHATS_FILE,
    persistentDirConfigured: Boolean(process.env.DATA_DIR),
  };
}
