import { getRedisClient } from '../config/redis';
import logger from '../config/logger';

/**
 * Cache key naming conventions
 */
export const CACHE_KEYS = {
  // User cache
  USER: (userId: string) => `user:${userId}`,
  USER_SUBSCRIPTION: (userId: string) => `user:${userId}:subscription`,
  USER_BOTS: (userId: string) => `user:${userId}:bots`,

  // Bot cache
  BOT: (botId: string) => `bot:${botId}`,
  BOT_CONFIG: (botId: string) => `bot:${botId}:config`,
  BOT_CONVERSATIONS: (botId: string) => `bot:${botId}:conversations`,

  // Conversation cache
  CONVERSATION: (conversationId: string) => `conversation:${conversationId}`,
  CONVERSATION_MESSAGES: (conversationId: string) => `conversation:${conversationId}:messages`,

  // Message cache
  MESSAGE: (messageId: string) => `message:${messageId}`,

  // Rate limiting
  RATE_LIMIT: (userId: string, endpoint: string) => `ratelimit:${userId}:${endpoint}`,
  MESSAGE_QUOTA: (userId: string) => `quota:${userId}:messages`,

  // Session cache
  SESSION: (sessionId: string) => `session:${sessionId}`,
  REFRESH_TOKEN: (userId: string) => `refresh_token:${userId}`,

  // Template cache
  BOT_TEMPLATE: (templateId: string) => `template:${templateId}`,
  BOT_TEMPLATES: () => 'templates:all',
};

/**
 * TTL (Time To Live) configurations for different cache types
 */
export const CACHE_TTL = {
  // Short-lived cache (5 minutes)
  SHORT: 300,

  // Medium-lived cache (1 hour)
  MEDIUM: 3600,

  // Long-lived cache (24 hours)
  LONG: 86400,

  // Session cache (30 days)
  SESSION: 2592000,

  // Rate limit window (1 minute)
  RATE_LIMIT: 60,

  // Message quota (1 month)
  QUOTA: 2592000,
};

/**
 * Get value from cache
 */
export const cacheGet = async <T>(key: string): Promise<T | null> => {
  try {
    const client = getRedisClient();
    const value = await client.get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  } catch (error) {
    logger.error(`Cache get error for key ${key}: ${error}`);
    return null;
  }
};

/**
 * Set value in cache with TTL
 */
export const cacheSet = async <T>(
  key: string,
  value: T,
  ttl: number = CACHE_TTL.MEDIUM,
): Promise<boolean> => {
  try {
    const client = getRedisClient();
    await client.setEx(key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.error(`Cache set error for key ${key}: ${error}`);
    return false;
  }
};

/**
 * Delete value from cache
 */
export const cacheDelete = async (key: string): Promise<boolean> => {
  try {
    const client = getRedisClient();
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    logger.error(`Cache delete error for key ${key}: ${error}`);
    return false;
  }
};

/**
 * Delete multiple keys from cache
 */
export const cacheDeleteMultiple = async (keys: string[]): Promise<boolean> => {
  try {
    if (keys.length === 0) {
      return true;
    }

    const client = getRedisClient();
    await client.del(keys);
    return true;
  } catch (error) {
    logger.error(`Cache delete multiple error: ${error}`);
    return false;
  }
};

/**
 * Set expiration time for a key
 */
export const cacheExpire = async (key: string, ttl: number): Promise<boolean> => {
  try {
    const client = getRedisClient();
    const result = await client.expire(key, ttl);
    return result === true;
  } catch (error) {
    logger.error(`Cache expire error for key ${key}: ${error}`);
    return false;
  }
};

/**
 * Check if key exists in cache
 */
export const cacheExists = async (key: string): Promise<boolean> => {
  try {
    const client = getRedisClient();
    const result = await client.exists(key);
    return result === 1;
  } catch (error) {
    logger.error(`Cache exists error for key ${key}: ${error}`);
    return false;
  }
};

/**
 * Increment counter in cache
 */
export const cacheIncrement = async (key: string, increment: number = 1): Promise<number> => {
  try {
    const client = getRedisClient();
    const result = await client.incrBy(key, increment);
    return result;
  } catch (error) {
    logger.error(`Cache increment error for key ${key}: ${error}`);
    return 0;
  }
};

/**
 * Get counter value from cache
 */
export const cacheGetCounter = async (key: string): Promise<number> => {
  try {
    const client = getRedisClient();
    const value = await client.get(key);

    if (!value) {
      return 0;
    }

    return parseInt(value, 10);
  } catch (error) {
    logger.error(`Cache get counter error for key ${key}: ${error}`);
    return 0;
  }
};

/**
 * Clear all cache (use with caution)
 */
export const cacheClearAll = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    await client.flushDb();
    logger.warn('All cache cleared');
    return true;
  } catch (error) {
    logger.error(`Cache clear all error: ${error}`);
    return false;
  }
};

export default {
  CACHE_KEYS,
  CACHE_TTL,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeleteMultiple,
  cacheExpire,
  cacheExists,
  cacheIncrement,
  cacheGetCounter,
  cacheClearAll,
};
