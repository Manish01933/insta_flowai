/**
 * Token blacklist management using Redis
 * Used for token invalidation on logout and token rotation
 */

import { getRedisClient } from '../config/redis';
import logger from '../config/logger';

const BLACKLIST_PREFIX = 'token_blacklist:';

/**
 * Add token to blacklist
 */
export const blacklistToken = async (token: string, expiresIn: number): Promise<void> => {
  try {
    const redis = getRedisClient();
    const key = `${BLACKLIST_PREFIX}${token}`;
    
    // Set with TTL equal to token expiry time
    await redis.setEx(key, expiresIn, '1');
    logger.debug(`Token blacklisted: ${key}`);
  } catch (error) {
    logger.error(`Failed to blacklist token: ${error}`);
    throw error;
  }
};

/**
 * Check if token is blacklisted
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  try {
    const redis = getRedisClient();
    const key = `${BLACKLIST_PREFIX}${token}`;
    
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    logger.error(`Failed to check token blacklist: ${error}`);
    // In case of Redis error, assume token is not blacklisted to avoid blocking users
    return false;
  }
};

/**
 * Remove token from blacklist (for testing purposes)
 */
export const removeFromBlacklist = async (token: string): Promise<void> => {
  try {
    const redis = getRedisClient();
    const key = `${BLACKLIST_PREFIX}${token}`;
    
    await redis.del(key);
    logger.debug(`Token removed from blacklist: ${key}`);
  } catch (error) {
    logger.error(`Failed to remove token from blacklist: ${error}`);
    throw error;
  }
};

/**
 * Clear all blacklisted tokens (for testing purposes)
 */
export const clearBlacklist = async (): Promise<void> => {
  try {
    const redis = getRedisClient();
    
    // Get all keys matching the pattern
    const keys = await redis.keys(`${BLACKLIST_PREFIX}*`);
    
    if (keys.length > 0) {
      await redis.del(keys);
      logger.debug(`Cleared ${keys.length} tokens from blacklist`);
    }
  } catch (error) {
    logger.error(`Failed to clear blacklist: ${error}`);
    throw error;
  }
};
