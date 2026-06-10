/**
 * Subscription Tier Service
 * Manages subscription tier checks, feature limits, and enforcement
 */

import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import { AppError } from '../utils/errors';

/**
 * Subscription tier configuration with feature limits
 */
export interface SubscriptionTierConfig {
  maxBots: number;
  messagesPerMonth: number;
  aiModel: string;
  support: string;
}

export const SUBSCRIPTION_TIER_CONFIGS: Record<string, SubscriptionTierConfig> = {
  free: {
    maxBots: 1,
    messagesPerMonth: 1000,
    aiModel: 'claude-3-haiku',
    support: 'community',
  },
  pro: {
    maxBots: 10,
    messagesPerMonth: 100000,
    aiModel: 'claude-3-sonnet',
    support: 'email',
  },
  enterprise: {
    maxBots: 50,
    messagesPerMonth: 1000000,
    aiModel: 'claude-3-opus',
    support: 'priority',
  },
};

/**
 * Error for subscription tier limit exceeded
 */
export class SubscriptionLimitError extends AppError {
  constructor(
    message: string,
    public tierLimit: string,
    public currentValue: number,
    public limit: number,
    public upgradeUrl: string = '/api/subscriptions/plans'
  ) {
    super(message, 402, 'TIER_LIMIT_EXCEEDED');
    Object.setPrototypeOf(this, SubscriptionLimitError.prototype);
  }
}

export class SubscriptionTierService {
  /**
   * Get subscription tier configuration for a user
   */
  static async getUserTierConfig(userId: string): Promise<SubscriptionTierConfig> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          subscriptionTier: true,
          subscriptionStatus: true,
          subscriptionEndDate: true,
        },
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // Check if subscription is expired
      if (user.subscriptionStatus !== 'active' && user.subscriptionEndDate) {
        const now = new Date();
        const gracePeriodMs = 24 * 60 * 60 * 1000; // 24 hour grace period
        const gracePeriodEndDate = new Date(
          user.subscriptionEndDate.getTime() + gracePeriodMs
        );

        if (now > gracePeriodEndDate) {
          logger.warn(
            `Subscription for user ${userId} expired. Grace period ended on ${gracePeriodEndDate}`
          );
          // Fall back to free tier after grace period
          return SUBSCRIPTION_TIER_CONFIGS['free'];
        }
      }

      const tier = user.subscriptionTier?.toLowerCase() || 'free';
      return SUBSCRIPTION_TIER_CONFIGS[tier] || SUBSCRIPTION_TIER_CONFIGS['free'];
    } catch (error: any) {
      logger.error(
        `Error getting subscription tier config for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get current bot count for user
   */
  static async getCurrentBotCount(userId: string): Promise<number> {
    try {
      const count = await prisma.bot.count({
        where: {
          userId: userId,
          deletedAt: null,
          isActive: true,
        },
      });

      return count;
    } catch (error: any) {
      logger.error(
        `Error getting bot count for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get current monthly message count for user
   * Resets on the first day of each month
   */
  static async getCurrentMonthlyMessageCount(userId: string): Promise<number> {
    try {
      // Get the first day of current month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get user's bots
      const bots = await prisma.bot.findMany({
        where: {
          userId: userId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (bots.length === 0) {
        return 0;
      }

      const botIds = bots.map((b) => b.id);

      // Count messages from all user's bots sent in current month
      // Messages are counted as sent when senderType is 'bot' and status is 'sent'
      const count = await prisma.message.count({
        where: {
          botId: { in: botIds },
          senderType: 'bot',
          status: 'sent',
          createdAt: {
            gte: monthStart,
          },
          deletedAt: null,
        },
      });

      return count;
    } catch (error: any) {
      logger.error(
        `Error getting monthly message count for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Check if user can create a new bot
   * Throws SubscriptionLimitError if limit exceeded
   */
  static async checkBotCreationAllowed(userId: string): Promise<void> {
    try {
      const tierConfig = await this.getUserTierConfig(userId);
      const currentCount = await this.getCurrentBotCount(userId);

      if (currentCount >= tierConfig.maxBots) {
        logger.warn(
          `User ${userId} attempted to exceed bot limit. Current: ${currentCount}, Limit: ${tierConfig.maxBots}`
        );

        throw new SubscriptionLimitError(
          `Bot creation limit reached. You have ${currentCount} bots. Maximum for your tier: ${tierConfig.maxBots}`,
          'max_bots',
          currentCount,
          tierConfig.maxBots
        );
      }
    } catch (error: any) {
      if (error instanceof SubscriptionLimitError) {
        throw error;
      }
      logger.error(
        `Error checking bot creation allowed for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Check if user can send a message (not exceeding monthly limit)
   * Throws SubscriptionLimitError if limit exceeded
   */
  static async checkMessageSendingAllowed(userId: string): Promise<void> {
    try {
      const tierConfig = await this.getUserTierConfig(userId);
      const currentCount = await this.getCurrentMonthlyMessageCount(userId);

      if (currentCount >= tierConfig.messagesPerMonth) {
        logger.warn(
          `User ${userId} attempted to exceed message limit. Current: ${currentCount}, Limit: ${tierConfig.messagesPerMonth}`
        );

        throw new SubscriptionLimitError(
          `Monthly message limit reached. You have sent ${currentCount} messages. Limit: ${tierConfig.messagesPerMonth}`,
          'messages_per_month',
          currentCount,
          tierConfig.messagesPerMonth
        );
      }
    } catch (error: any) {
      if (error instanceof SubscriptionLimitError) {
        throw error;
      }
      logger.error(
        `Error checking message sending allowed for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get subscription tier details for user
   */
  static async getSubscriptionTierDetails(userId: string): Promise<{
    tier: string;
    status: string;
    config: SubscriptionTierConfig;
    currentBots: number;
    maxBots: number;
    currentMessages: number;
    maxMessages: number;
    subscriptionEndDate: Date | null;
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          subscriptionTier: true,
          subscriptionStatus: true,
          subscriptionEndDate: true,
        },
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      const config = await this.getUserTierConfig(userId);
      const currentBots = await this.getCurrentBotCount(userId);
      const currentMessages = await this.getCurrentMonthlyMessageCount(userId);

      return {
        tier: user.subscriptionTier || 'free',
        status: user.subscriptionStatus || 'active',
        config,
        currentBots,
        maxBots: config.maxBots,
        currentMessages,
        maxMessages: config.messagesPerMonth,
        subscriptionEndDate: user.subscriptionEndDate,
      };
    } catch (error: any) {
      logger.error(
        `Error getting subscription tier details for user ${userId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Log subscription tier violation for monitoring
   */
  static async logTierViolation(
    userId: string,
    violationType: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      logger.warn(
        `Subscription tier violation for user ${userId}: ${violationType}`,
        { details }
      );

      // Could also be saved to a dedicated violations table for analytics
      await prisma.auditLog.create({
        data: {
          userId: userId,
          action: 'SUBSCRIPTION_TIER_VIOLATION',
          resourceType: 'subscription',
          changes: {
            violationType,
            ...details,
          },
        },
      });
    } catch (error: any) {
      logger.error(
        `Error logging tier violation for user ${userId}: ${error.message}`
      );
      // Don't throw - this is just for monitoring
    }
  }

  /**
   * Increment monthly message counter after successful send
   * This is called after a message is successfully sent via WhatsApp
   */
  static async incrementMonthlyMessageCount(
    userId: string,
    count: number = 1
  ): Promise<void> {
    try {
      // This is handled implicitly when messages are created in the database
      // with status 'sent' and senderType 'bot'
      logger.debug(
        `Incremented message count for user ${userId} by ${count}`
      );
    } catch (error: any) {
      logger.error(
        `Error incrementing message count for user ${userId}: ${error.message}`
      );
      // Don't throw - this is just for accounting
    }
  }

  /**
   * Reset monthly message counter at month boundary
   * This would typically be called by a cron job on the first day of each month
   */
  static async resetMonthlyMessageCounter(userId: string): Promise<void> {
    try {
      // Messages are counted based on their createdAt date, so no explicit reset needed
      // However, we log it for monitoring
      logger.info(
        `Monthly message counter would reset for user ${userId} at month boundary`
      );
    } catch (error: any) {
      logger.error(
        `Error resetting message counter for user ${userId}: ${error.message}`
      );
    }
  }

  /**
   * Check if AI model is available for subscription tier
   */
  static getAiModelForTier(userId: string): Promise<string> {
    return this.getUserTierConfig(userId).then((config) => config.aiModel);
  }

  /**
   * Check support level for subscription tier
   */
  static getSupportLevelForTier(userId: string): Promise<string> {
    return this.getUserTierConfig(userId).then((config) => config.support);
  }
}

export default SubscriptionTierService;
