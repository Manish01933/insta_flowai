/**
 * Rate Limiting Service
 * Handles subscription tier-based rate limiting and monthly quota tracking
 */

import { getRedisClient } from '../config/redis';
import { prisma } from '../utils/prisma';
import { RateLimitError } from '../utils/errors';
import logger from '../config/logger';

/**
 * Subscription tier limits
 */
export const SUBSCRIPTION_LIMITS = {
  free: {
    messagesPerMonth: 100,
    requestsPerSecond: 1,
  },
  starter: {
    messagesPerMonth: 1000,
    requestsPerSecond: 5,
  },
  growth: {
    messagesPerMonth: 10000,
    requestsPerSecond: 20,
  },
  agency: {
    messagesPerMonth: 100000,
    requestsPerSecond: 80,
  },
};

/**
 * WhatsApp API global rate limit
 */
export const WHATSAPP_API_RATE_LIMIT = 80; // requests per second

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  limit: number;
  retryAfter?: number;
}

/**
 * Rate Limit Service
 */
export class RateLimitService {
  /**
   * Check monthly message quota for a user
   * @param userId - User ID
   * @returns Rate limit check result
   */
  static async checkMonthlyQuota(userId: string): Promise<RateLimitCheckResult> {
    try {
      // Get user with subscription info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          subscriptionTier: true,
          subscriptionStartDate: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Get subscription tier limits
      const tier = (user.subscriptionTier || 'free').toLowerCase() as keyof typeof SUBSCRIPTION_LIMITS;
      const limits = SUBSCRIPTION_LIMITS[tier] || SUBSCRIPTION_LIMITS.free;

      // Calculate current month start and end
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Count messages sent this month
      const messageCount = await prisma.message.count({
        where: {
          bot: {
            userId: userId,
          },
          senderType: 'bot',
          createdAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      });

      const remaining = Math.max(0, limits.messagesPerMonth - messageCount);
      const allowed = messageCount < limits.messagesPerMonth;

      return {
        allowed,
        remaining,
        resetTime: monthEnd,
        limit: limits.messagesPerMonth,
      };
    } catch (error) {
      logger.error(`Error checking monthly quota for user ${userId}:`, error);
      // Allow request if check fails
      return {
        allowed: true,
        remaining: 0,
        resetTime: new Date(),
        limit: 0,
      };
    }
  }

  /**
   * Check per-second rate limit for WhatsApp API
   * @param botId - Bot ID
   * @returns Rate limit check result
   */
  static async checkWhatsAppRateLimit(botId: string): Promise<RateLimitCheckResult> {
    try {
      const redis = getRedisClient();
      const key = `whatsapp_rate_limit:${botId}`;
      const windowSeconds = 1;

      // Increment counter
      const current = await redis.incr(key);

      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      // Get TTL
      const ttl = await redis.ttl(key);

      const allowed = current <= WHATSAPP_API_RATE_LIMIT;
      const remaining = Math.max(0, WHATSAPP_API_RATE_LIMIT - current);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : 1) * 1000);

      return {
        allowed,
        remaining,
        resetTime,
        limit: WHATSAPP_API_RATE_LIMIT,
        retryAfter: allowed ? undefined : ttl > 0 ? ttl : 1,
      };
    } catch (error) {
      logger.error(`Error checking WhatsApp rate limit for bot ${botId}:`, error);
      // Allow request if check fails
      return {
        allowed: true,
        remaining: 0,
        resetTime: new Date(),
        limit: WHATSAPP_API_RATE_LIMIT,
      };
    }
  }

  /**
   * Check per-second rate limit for user tier
   * @param userId - User ID
   * @returns Rate limit check result
   */
  static async checkUserTierRateLimit(userId: string): Promise<RateLimitCheckResult> {
    try {
      // Get user subscription tier
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionTier: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const tier = (user.subscriptionTier || 'free').toLowerCase() as keyof typeof SUBSCRIPTION_LIMITS;
      const limits = SUBSCRIPTION_LIMITS[tier] || SUBSCRIPTION_LIMITS.free;

      const redis = getRedisClient();
      const key = `user_rate_limit:${userId}`;
      const windowSeconds = 1;

      // Increment counter
      const current = await redis.incr(key);

      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      // Get TTL
      const ttl = await redis.ttl(key);

      const allowed = current <= limits.requestsPerSecond;
      const remaining = Math.max(0, limits.requestsPerSecond - current);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : 1) * 1000);

      return {
        allowed,
        remaining,
        resetTime,
        limit: limits.requestsPerSecond,
        retryAfter: allowed ? undefined : ttl > 0 ? ttl : 1,
      };
    } catch (error) {
      logger.error(`Error checking user tier rate limit for user ${userId}:`, error);
      // Allow request if check fails
      return {
        allowed: true,
        remaining: 0,
        resetTime: new Date(),
        limit: 0,
      };
    }
  }

  /**
   * Enforce monthly quota - throws error if exceeded
   * @param userId - User ID
   * @throws RateLimitError if quota exceeded
   */
  static async enforceMonthlyQuota(userId: string): Promise<void> {
    const result = await this.checkMonthlyQuota(userId);

    if (!result.allowed) {
      const resetDate = result.resetTime.toLocaleDateString();
      throw new RateLimitError(
        `Monthly message quota exceeded. Limit: ${result.limit} messages/month. Resets on ${resetDate}.`,
        'MONTHLY_QUOTA_EXCEEDED'
      );
    }
  }

  /**
   * Enforce WhatsApp API rate limit - throws error if exceeded
   * @param botId - Bot ID
   * @throws RateLimitError if rate limit exceeded
   */
  static async enforceWhatsAppRateLimit(botId: string): Promise<void> {
    const result = await this.checkWhatsAppRateLimit(botId);

    if (!result.allowed) {
      throw new RateLimitError(
        `WhatsApp API rate limit exceeded. Maximum ${result.limit} requests per second. Please retry after ${result.retryAfter} second(s).`,
        'WHATSAPP_RATE_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Enforce user tier rate limit - throws error if exceeded
   * @param userId - User ID
   * @throws RateLimitError if rate limit exceeded
   */
  static async enforceUserTierRateLimit(userId: string): Promise<void> {
    const result = await this.checkUserTierRateLimit(userId);

    if (!result.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded for your subscription tier. Maximum ${result.limit} requests per second. Please retry after ${result.retryAfter} second(s).`,
        'USER_TIER_RATE_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Get rate limit status for a user
   * @param userId - User ID
   * @returns Combined rate limit status
   */
  static async getRateLimitStatus(userId: string) {
    const monthlyQuota = await this.checkMonthlyQuota(userId);
    const userTierLimit = await this.checkUserTierRateLimit(userId);

    return {
      monthlyQuota: {
        limit: monthlyQuota.limit,
        remaining: monthlyQuota.remaining,
        resetTime: monthlyQuota.resetTime,
        allowed: monthlyQuota.allowed,
      },
      userTierRateLimit: {
        limit: userTierLimit.limit,
        remaining: userTierLimit.remaining,
        resetTime: userTierLimit.resetTime,
        allowed: userTierLimit.allowed,
      },
    };
  }

  /**
   * Reset rate limit counters for a user (for testing)
   * @param userId - User ID
   */
  static async resetUserRateLimits(userId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `user_rate_limit:${userId}`;
      await redis.del(key);
      logger.info(`Reset rate limit for user ${userId}`);
    } catch (error) {
      logger.error(`Error resetting rate limit for user ${userId}:`, error);
    }
  }

  /**
   * Reset rate limit counters for a bot (for testing)
   * @param botId - Bot ID
   */
  static async resetBotRateLimits(botId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `whatsapp_rate_limit:${botId}`;
      await redis.del(key);
      logger.info(`Reset rate limit for bot ${botId}`);
    } catch (error) {
      logger.error(`Error resetting rate limit for bot ${botId}:`, error);
    }
  }
}
