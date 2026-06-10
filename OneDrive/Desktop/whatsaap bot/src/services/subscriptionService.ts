/**
 * Subscription management service for handling subscription status, renewals, and cancellations
 * Task 4.7: Subscription Status Management
 */

import { Subscription } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
} from '../utils/errors';
import config from '../config/environment';
import axios from 'axios';

// Razorpay API base URL
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

// Grace period duration in milliseconds (7 days)
const GRACE_PERIOD_DURATION = 7 * 24 * 60 * 60 * 1000;

// Subscription renewal interval (30 days)
const RENEWAL_INTERVAL = 30 * 24 * 60 * 60 * 1000;

// Subscription status constants
export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
  GRACE_PERIOD: 'grace_period',
  EXPIRED: 'expired',
};

/**
 * Subscription tier definitions for plan display and validation
 * Used by subscription upgrade flow (Task 4.4)
 */
export const SUBSCRIPTION_TIERS: Record<
  string,
  {
    id: string;
    name: string;
    price: number;
    currency: string;
    features: {
      maxBots: number;
      messagesPerMonth: number;
    };
  }
> = {
  free: {
    id: 'plan_free',
    name: 'Free',
    price: 0,
    currency: 'INR',
    features: {
      maxBots: 1,
      messagesPerMonth: 1000,
    },
  },
  pro: {
    id: 'plan_pro',
    name: 'Pro',
    price: 999,
    currency: 'INR',
    features: {
      maxBots: 10,
      messagesPerMonth: 100000,
    },
  },
  enterprise: {
    id: 'plan_enterprise',
    name: 'Enterprise',
    price: 4999,
    currency: 'INR',
    features: {
      maxBots: 100,
      messagesPerMonth: 10000000,
    },
  },
};

/**
 * Get all available subscription plans (Task 4.4)
 * Returns the SUBSCRIPTION_TIERS object for use in plan selection UI
 */
export const getSubscriptionPlans = (): typeof SUBSCRIPTION_TIERS => {
  return SUBSCRIPTION_TIERS;
};

/**
 * Get the current active subscription for a user (Task 4.4)
 * Returns the most recent active subscription or null
 */
export const getUserCurrentSubscription = async (
  userId: string
): Promise<Subscription | null> => {
  try {
    return await getActiveSubscription(userId);
  } catch (error: any) {
    logger.error(`Get user current subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Upgrade a user's subscription to a new plan (Task 4.4)
 * Wrapper around upgradeSubscription for plan upgrade flow
 */
export const upgradeSubscriptionToNewPlan = async (
  userId: string,
  newPlanId: string
): Promise<Subscription> => {
  try {
    const tier = SUBSCRIPTION_TIERS[newPlanId];
    if (!tier) {
      throw new ValidationError(
        `Invalid plan: ${newPlanId}`,
        'INVALID_PLAN'
      );
    }
    return await upgradeSubscription(userId, tier.id, tier.name, tier.price);
  } catch (error: any) {
    logger.error(`Upgrade subscription to new plan error: ${error.message}`);
    throw error;
  }
};

/**
 * Get payment history for a user (Task 4.4)
 * Returns a paginated list of payment records for the given user
 */
export const getPaymentHistory = async (
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{
  success: boolean;
  data: Array<{
    id: string;
    razorpay_payment_id: string | null;
    amount: number;
    currency: string;
    status: string;
    payment_method: string | null;
    created_at: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}> => {
  try {
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('Page must be an integer >= 1', 'INVALID_PAGE');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError(
        'Limit must be an integer between 1 and 100',
        'INVALID_LIMIT'
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const skip = (page - 1) * limit;

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where: { userId } }),
      prisma.payment.findMany({
        where: { userId },
        select: {
          id: true,
          razorpayPaymentId: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const data = payments.map((payment) => ({
      id: payment.id,
      razorpay_payment_id: payment.razorpayPaymentId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      payment_method: payment.paymentMethod,
      created_at: payment.createdAt.toISOString(),
    }));

    return {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error: any) {
    logger.error(`Get payment history error: ${error.message}`);
    throw error;
  }
};

/**
 * Get active subscription for a user
 * Returns current active subscription or subscription in grace period
 */
export const getActiveSubscription = async (userId: string): Promise<Subscription | null> => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: userId,
        status: {
          in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.GRACE_PERIOD],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscription;
  } catch (error: any) {
    logger.error(`Get active subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Get subscription tier for user based on active subscription
 * Returns plan ID or 'free' if no active subscription
 */
export const getSubscriptionTier = async (userId: string): Promise<string> => {
  try {
    const subscription = await getActiveSubscription(userId);
    if (!subscription) {
      return 'free';
    }
    return subscription.planId;
  } catch (error: any) {
    logger.error(`Get subscription tier error: ${error.message}`);
    throw error;
  }
};

/**
 * Check and verify subscription status is still valid
 * Updates user tier and status based on subscription state
 */
export const checkSubscriptionStatus = async (userId: string): Promise<void> => {
  try {
    const subscription = await getActiveSubscription(userId);

    if (!subscription) {
      // No active subscription, ensure user tier is 'free'
      await prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionTier: 'free',
          subscriptionStatus: 'inactive',
        },
      });
      return;
    }

    // Ensure user tier matches subscription
    const tier = subscription.planId;
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: tier,
        subscriptionStatus: subscription.status,
      },
    });
  } catch (error: any) {
    logger.error(`Check subscription status error: ${error.message}`);
    throw error;
  }
};

/**
 * Auto-renew subscription when next_billing_date arrives
 * Updates nextBillingDate to +30 days
 * Logs renewal events
 */
export const renewSubscription = async (subscriptionId: string): Promise<Subscription> => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      throw new NotFoundError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
      throw new ValidationError(
        'Only active subscriptions can be renewed',
        'INVALID_SUBSCRIPTION_STATUS'
      );
    }

    if (!subscription.razorpaySubscriptionId) {
      throw new ValidationError(
        'Subscription missing Razorpay ID',
        'INVALID_SUBSCRIPTION_DATA'
      );
    }

    // Call Razorpay to verify subscription is still active
    try {
      const razorpayResponse = await axios.get(
        `${RAZORPAY_API_BASE}/subscriptions/${subscription.razorpaySubscriptionId}`,
        {
          auth: {
            username: config.razorpayKeyId,
            password: config.razorpayKeySecret,
          },
        }
      );

      // Check if Razorpay subscription is still active
      if (razorpayResponse.data.status !== 'active') {
        throw new ValidationError(
          'Razorpay subscription is not active',
          'RAZORPAY_SUBSCRIPTION_INACTIVE'
        );
      }
    } catch (razorpayError: any) {
      logger.error(
        `Razorpay verification failed: ${razorpayError.response?.data?.error?.description || razorpayError.message}`
      );
      throw new InternalServerError(
        'Failed to verify subscription with Razorpay',
        'RAZORPAY_ERROR'
      );
    }

    // Update subscription with new billing date
    const nextBillingDate = new Date(Date.now() + RENEWAL_INTERVAL);

    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextBillingDate: nextBillingDate,
        updatedAt: new Date(),
      },
    });

    // Log renewal event
    await prisma.auditLog.create({
      data: {
        userId: subscription.userId,
        action: 'SUBSCRIPTION_RENEWED',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        changes: {
          nextBillingDate: nextBillingDate,
        },
      },
    });

    logger.info(`Subscription renewed: ${subscriptionId}, next billing: ${nextBillingDate}`);

    return updatedSubscription;
  } catch (error: any) {
    logger.error(`Renew subscription error: ${error.message}`);

    // If renewal fails, log and notify user
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: true },
    });

    if (subscription && subscription.user) {
      await prisma.auditLog.create({
        data: {
          userId: subscription.userId,
          action: 'SUBSCRIPTION_RENEWAL_FAILED',
          resourceType: 'subscription',
          resourceId: subscriptionId,
          changes: {
            error: error.message,
          },
        },
      });

      logger.warn(
        `Subscription renewal failed for user ${subscription.user.email}: ${error.message}`
      );
    }

    throw error;
  }
};

/**
 * Upgrade subscription to a different plan
 * Creates new subscription and cancels old one
 */
export const upgradeSubscription = async (
  userId: string,
  newPlanId: string,
  planName: string,
  price: number
): Promise<Subscription> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Get current subscription if exists
    const currentSubscription = await getActiveSubscription(userId);

    // Create new subscription record
    const newSubscription = await prisma.subscription.create({
      data: {
        userId: userId,
        planId: newPlanId,
        planName: planName,
        price: new Decimal(price),
        currency: 'INR',
        billingCycle: 'monthly',
        status: SUBSCRIPTION_STATUS.ACTIVE,
        startedAt: new Date(),
        nextBillingDate: new Date(Date.now() + RENEWAL_INTERVAL),
      },
    });

    // Cancel old subscription if exists
    if (currentSubscription && currentSubscription.id !== newSubscription.id) {
      await prisma.subscription.update({
        where: { id: currentSubscription.id },
        data: { status: SUBSCRIPTION_STATUS.CANCELLED, endedAt: new Date() },
      });

      logger.info(`Previous subscription cancelled: ${currentSubscription.id}`);
    }

    // Update user tier
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: newPlanId,
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      },
    });

    // Log upgrade
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'SUBSCRIPTION_UPGRADED',
        resourceType: 'subscription',
        resourceId: newSubscription.id,
        changes: {
          from_plan: currentSubscription?.planId || 'free',
          to_plan: newPlanId,
        },
      },
    });

    logger.info(`Subscription upgraded for user ${userId}: ${newPlanId}`);

    return newSubscription;
  } catch (error: any) {
    logger.error(`Upgrade subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Cancel subscription with grace period (7 days)
 * Calls Razorpay to cancel subscription
 * Updates subscription status to grace_period
 * User can reactivate within grace period
 */
export const cancelSubscription = async (subscriptionId: string): Promise<Subscription> => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      throw new NotFoundError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
      throw new ValidationError('Subscription is already cancelled', 'SUBSCRIPTION_ALREADY_CANCELLED');
    }

    if (!subscription.razorpaySubscriptionId) {
      throw new ValidationError(
        'Subscription missing Razorpay ID',
        'INVALID_SUBSCRIPTION_DATA'
      );
    }

    // Call Razorpay to cancel subscription
    try {
      await axios.post(
        `${RAZORPAY_API_BASE}/subscriptions/${subscription.razorpaySubscriptionId}/cancel`,
        { notify_customer: 1 },
        {
          auth: {
            username: config.razorpayKeyId,
            password: config.razorpayKeySecret,
          },
        }
      );
    } catch (razorpayError: any) {
      logger.error(
        `Razorpay cancellation failed: ${razorpayError.response?.data?.error?.description || razorpayError.message}`
      );
      // Continue with local cancellation even if Razorpay fails
    }

    // Calculate grace period end date (7 days from now)
    const gracePeriodEndDate = new Date(Date.now() + GRACE_PERIOD_DURATION);

    // Update subscription with grace period status
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update user subscription status
    await prisma.user.update({
      where: { id: subscription.userId },
      data: {
        subscriptionStatus: SUBSCRIPTION_STATUS.GRACE_PERIOD,
      },
    });

    // Log cancellation
    await prisma.auditLog.create({
      data: {
        userId: subscription.userId,
        action: 'SUBSCRIPTION_CANCELLED',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        changes: {
          old_status: subscription.status,
          new_status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          grace_period_end_date: gracePeriodEndDate,
        },
      },
    });

    logger.info(
      `Subscription cancelled with grace period: ${subscriptionId}, expires: ${gracePeriodEndDate}`
    );

    return updatedSubscription;
  } catch (error: any) {
    logger.error(`Cancel subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Reactivate subscription during grace period
 * Validates subscription is in grace period and period hasn't expired
 */
export const reactivateSubscription = async (subscriptionId: string): Promise<Subscription> => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    if (subscription.status !== SUBSCRIPTION_STATUS.GRACE_PERIOD) {
      throw new ValidationError(
        'Only subscriptions in grace period can be reactivated',
        'INVALID_SUBSCRIPTION_STATUS'
      );
    }

    // Reactivate subscription
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        nextBillingDate: new Date(Date.now() + RENEWAL_INTERVAL),
        updatedAt: new Date(),
      },
    });

    // Update user status
    await prisma.user.update({
      where: { id: subscription.userId },
      data: {
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        subscriptionTier: subscription.planId,
      },
    });

    // Log reactivation
    await prisma.auditLog.create({
      data: {
        userId: subscription.userId,
        action: 'SUBSCRIPTION_REACTIVATED',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        changes: {
          old_status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          new_status: SUBSCRIPTION_STATUS.ACTIVE,
        },
      },
    });

    logger.info(`Subscription reactivated: ${subscriptionId}`);

    return updatedSubscription;
  } catch (error: any) {
    logger.error(`Reactivate subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Get all subscriptions for a user (history)
 */
export const getUserSubscriptions = async (userId: string): Promise<Subscription[]> => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions;
  } catch (error: any) {
    logger.error(`Get user subscriptions error: ${error.message}`);
    throw error;
  }
};

/**
 * Get subscription by ID
 */
export const getSubscriptionById = async (subscriptionId: string): Promise<Subscription> => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    return subscription;
  } catch (error: any) {
    logger.error(`Get subscription error: ${error.message}`);
    throw error;
  }
};

/**
 * Verify subscription belongs to user (authorization check)
 */
export const verifySubscriptionOwnership = async (
  subscriptionId: string,
  userId: string
): Promise<boolean> => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    return subscription?.userId === userId;
  } catch (error: any) {
    logger.error(`Verify subscription ownership error: ${error.message}`);
    return false;
  }
};
