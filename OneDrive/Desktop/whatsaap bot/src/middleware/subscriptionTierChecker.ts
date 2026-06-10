/**
 * Subscription Tier Checker Middleware
 * Checks user subscription tier validity and attaches tier info to request object
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import SubscriptionTierService, {
  SubscriptionLimitError,
  SUBSCRIPTION_TIER_CONFIGS,
} from '../services/subscriptionTierService';
import { AuthError } from '../utils/errors';

/**
 * Extended Request object with subscription tier info
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
  subscriptionTier?: {
    tier: string;
    status: string;
    config: typeof SUBSCRIPTION_TIER_CONFIGS[keyof typeof SUBSCRIPTION_TIER_CONFIGS];
    currentBots?: number;
    currentMessages?: number;
    subscriptionEndDate?: Date | null;
  };
}

/**
 * Middleware to check subscription tier validity
 * Should be used after authentication middleware
 *
 * Attaches subscription tier info to req.subscriptionTier
 * Verifies tier is still valid (not expired)
 * Handles grace period logic (24 hours after expiration)
 */
export const subscriptionTierChecker = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract user from request (should be set by auth middleware)
    const userId = (req as any).user?.id;

    if (!userId) {
      logger.warn('Subscription tier checker called without authenticated user');
      return next();
    }

    // Get user subscription info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
      },
    });

    if (!user) {
      logger.error(`User not found during subscription tier check: ${userId}`);
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    // Get tier configuration
    const tierConfig = await SubscriptionTierService.getUserTierConfig(userId);

    // Check subscription validity
    const now = new Date();
    const gracePeriodMs = 24 * 60 * 60 * 1000; // 24 hour grace period

    let isExpired = false;
    let isInGracePeriod = false;

    if (
      user.subscriptionStatus !== 'active' &&
      user.subscriptionEndDate
    ) {
      isExpired = true;
      const gracePeriodEndDate = new Date(
        user.subscriptionEndDate.getTime() + gracePeriodMs
      );

      if (now <= gracePeriodEndDate) {
        isInGracePeriod = true;
        logger.info(
          `User ${userId} is in grace period. Subscription expired on ${user.subscriptionEndDate}, grace period ends at ${gracePeriodEndDate}`
        );
      } else {
        logger.warn(
          `User ${userId} subscription expired and grace period ended. Subscription tier downgraded to free.`
        );
      }
    }

    // Get current usage stats
    const currentBots = await SubscriptionTierService.getCurrentBotCount(userId);
    const currentMessages = await SubscriptionTierService.getCurrentMonthlyMessageCount(userId);

    // Attach subscription tier info to request
    (req as AuthenticatedRequest).subscriptionTier = {
      tier: user.subscriptionTier || 'free',
      status: user.subscriptionStatus || 'active',
      config: tierConfig,
      currentBots,
      currentMessages,
      subscriptionEndDate: user.subscriptionEndDate,
    };

    // Add warnings to response headers for transparency
    if (isInGracePeriod) {
      res.set(
        'X-Subscription-Grace-Period',
        'true'
      );
      res.set(
        'X-Subscription-Expires',
        user.subscriptionEndDate?.toISOString() || ''
      );
    }

    if (isExpired && !isInGracePeriod) {
      res.set('X-Subscription-Expired', 'true');
    }

    next();
  } catch (error: any) {
    logger.error(`Error in subscription tier checker: ${error.message}`, {
      userId: (req as any).user?.id,
      error: error.stack,
    });

    // Don't block request on middleware error - just log it
    next();
  }
};

/**
 * Middleware to enforce bot creation limit
 * Should be used on POST /api/bots route
 */
export const enforceMaxBotsLimit = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId: string | undefined = (req as any).user?.id;

  try {
    if (!userId) {
      return next();
    }

    // Check if bot creation is allowed
    await SubscriptionTierService.checkBotCreationAllowed(userId);

    next();
  } catch (error: any) {
    if (error instanceof SubscriptionLimitError) {
      // Log tier violation
      if (userId) {
        await SubscriptionTierService.logTierViolation(userId, 'BOT_LIMIT_EXCEEDED', {
          tierLimit: error.tierLimit,
          currentValue: error.currentValue,
          limit: error.limit,
        });

        logger.warn(
          `Bot creation limit exceeded for user ${userId}: ${error.message}`
        );

        res.status(error.statusCode).json({
          error: error.message,
          errorCode: error.errorCode,
          tier_limit: error.tierLimit,
          current_value: error.currentValue,
          limit: error.limit,
          statusCode: error.statusCode,
          upgrade_url: error.upgradeUrl,
        });
        return;
      }
    }

    logger.error(
      `Error in bot limit enforcement: ${error.message}`,
      {
        userId,
        error: error.stack,
      }
    );

    next(error);
  }
};

/**
 * Middleware to enforce message sending limit
 * Should be used in message processing pipeline
 */
export const enforceMessageLimit = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId: string | undefined = (req as any).user?.id;

  try {
    if (!userId) {
      return next();
    }

    // Check if message sending is allowed
    await SubscriptionTierService.checkMessageSendingAllowed(userId);

    next();
  } catch (error: any) {
    if (error instanceof SubscriptionLimitError) {
      // Log tier violation
      if (userId) {
        await SubscriptionTierService.logTierViolation(userId, 'MESSAGE_LIMIT_EXCEEDED', {
          tierLimit: error.tierLimit,
          currentValue: error.currentValue,
          limit: error.limit,
        });

        logger.warn(
          `Message sending limit exceeded for user ${userId}: ${error.message}`
        );

        res.status(error.statusCode).json({
          error: error.message,
          errorCode: error.errorCode,
          tier_limit: error.tierLimit,
          current_value: error.currentValue,
          limit: error.limit,
          statusCode: error.statusCode,
          upgrade_url: error.upgradeUrl,
        });
        return;
      }
    }

    logger.error(
      `Error in message limit enforcement: ${error.message}`,
      {
        userId,
        error: error.stack,
      }
    );

    next(error);
  }
};

/**
 * Middleware to attach subscription info to request
 * Similar to subscriptionTierChecker but can be used without blocking
 */
export const attachSubscriptionTierInfo = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return next();
    }

    const tierDetails =
      await SubscriptionTierService.getSubscriptionTierDetails(userId);

    (req as AuthenticatedRequest).subscriptionTier = {
      tier: tierDetails.tier,
      status: tierDetails.status,
      config: tierDetails.config,
      currentBots: tierDetails.currentBots,
      currentMessages: tierDetails.currentMessages,
      subscriptionEndDate: tierDetails.subscriptionEndDate,
    };

    next();
  } catch (error: any) {
    logger.error(
      `Error attaching subscription tier info: ${error.message}`,
      {
        userId: (req as any).user?.id,
        error: error.stack,
      }
    );

    // Don't block request
    next();
  }
};

export default subscriptionTierChecker;
