/**
 * Subscription management routes
 * Task 4.7: Subscription Status Management
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth';
import * as subscriptionService from '../services/subscriptionService';
import { ValidationError, ForbiddenError } from '../utils/errors';
import logger from '../config/logger';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * Subscription plan definitions
 */
interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  billing_cycle: string;
  razorpay_plan_id: string | null;
  features: {
    max_bots: number;
    messages_per_month: number;
    ai_model: string;
    support: string;
  };
}

/**
 * Available subscription plans
 */
const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_free',
    name: 'Free',
    price: 0,
    currency: 'INR',
    billing_cycle: 'monthly',
    razorpay_plan_id: null,
    features: {
      max_bots: 1,
      messages_per_month: 1000,
      ai_model: 'claude-3-haiku',
      support: 'community',
    },
  },
  {
    id: 'plan_pro',
    name: 'Pro',
    price: 999,
    currency: 'INR',
    billing_cycle: 'monthly',
    razorpay_plan_id: process.env.RAZORPAY_PLAN_ID_PRO || 'plan_pro_placeholder',
    features: {
      max_bots: 10,
      messages_per_month: 100000,
      ai_model: 'claude-3-sonnet',
      support: 'email',
    },
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    price: 4999,
    currency: 'INR',
    billing_cycle: 'monthly',
    razorpay_plan_id: process.env.RAZORPAY_PLAN_ID_ENTERPRISE || 'plan_enterprise_placeholder',
    features: {
      max_bots: 50,
      messages_per_month: 1000000,
      ai_model: 'claude-3-opus',
      support: 'priority',
    },
  },
];

/**
 * GET /api/subscriptions/plans
 * Get available subscription plans
 * Public endpoint - no authentication required
 */
router.get(
  '/plans',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.debug('Fetching available subscription plans');

    res.status(200).json({
      data: SUBSCRIPTION_PLANS,
    });
  })
);

/**
 * POST /api/subscriptions/cancel
 * Cancel user's active subscription with grace period
 * Authentication: Required (JWT)
 */
router.post('/cancel', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;

    // Get active subscription
    const activeSubscription = await subscriptionService.getActiveSubscription(userId);

    if (!activeSubscription) {
      throw new ValidationError(
        'No active subscription found',
        'NO_ACTIVE_SUBSCRIPTION'
      );
    }

    // Cancel subscription
    const cancelledSubscription = await subscriptionService.cancelSubscription(
      activeSubscription.id
    );

    logger.info(`User ${userId} cancelled subscription: ${activeSubscription.id}`);

    return res.status(200).json({
      message: 'Subscription cancelled successfully',
      subscription: {
        id: cancelledSubscription.id,
        status: cancelledSubscription.status,
        ended_at: cancelledSubscription.endedAt,
      },
    });
    } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/subscriptions/current
 * Get user's active subscription
 * Authentication: Required (JWT)
 */
router.get('/current', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;

    // Check subscription status first
    await subscriptionService.checkSubscriptionStatus(userId);

    // Get active subscription
    const subscription = await subscriptionService.getActiveSubscription(userId);

    if (!subscription) {
      return res.status(200).json({
        subscription: null,
        tier: 'free',
      });
    }

    return res.status(200).json({
      subscription: {
        id: subscription.id,
        plan_id: subscription.planId,
        plan_name: subscription.planName,
        price: subscription.price,
        status: subscription.status,
        started_at: subscription.startedAt,
        next_billing_date: subscription.nextBillingDate,
      },
      tier: subscription.planId,
    });
    } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/subscriptions/history
 * Get user's subscription history
 * Authentication: Required (JWT)
 * Query: page=1, limit=10
 */
router.get('/history', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    // Get all subscriptions
    const allSubscriptions = await subscriptionService.getUserSubscriptions(userId);

    // Paginate
    const startIdx = (page - 1) * limit;
    const subscriptions = allSubscriptions.slice(startIdx, startIdx + limit);

    return res.status(200).json({
      data: subscriptions.map((sub) => ({
        id: sub.id,
        plan_id: sub.planId,
        plan_name: sub.planName,
        price: sub.price,
        status: sub.status,
        started_at: sub.startedAt,
        ended_at: sub.endedAt,
        created_at: sub.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: allSubscriptions.length,
        pages: Math.ceil(allSubscriptions.length / limit),
      },
    });
    } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/subscriptions/:subscriptionId/reactivate
 * Reactivate subscription during grace period
 * Authentication: Required (JWT)
 */
router.post(
  '/:subscriptionId/reactivate',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { subscriptionId } = req.params;

      // Verify ownership
      const isOwner = await subscriptionService.verifySubscriptionOwnership(subscriptionId, userId);
      if (!isOwner) {
        throw new ForbiddenError(
          'You do not have permission to reactivate this subscription',
          'FORBIDDEN'
        );
      }

      // Reactivate subscription
      const reactivatedSubscription = await subscriptionService.reactivateSubscription(
        subscriptionId
      );

      logger.info(`User ${userId} reactivated subscription: ${subscriptionId}`);

      return res.status(200).json({
        message: 'Subscription reactivated successfully',
        subscription: {
          id: reactivatedSubscription.id,
          plan_id: reactivatedSubscription.planId,
          status: reactivatedSubscription.status,
          next_billing_date: reactivatedSubscription.nextBillingDate,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /api/subscriptions/:subscriptionId/status
 * Get subscription status and details
 * Authentication: Required (JWT)
 */
router.get(
  '/:subscriptionId/status',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { subscriptionId } = req.params;

      // Verify ownership
      const isOwner = await subscriptionService.verifySubscriptionOwnership(subscriptionId, userId);
      if (!isOwner) {
        throw new ForbiddenError(
          'You do not have permission to view this subscription',
          'FORBIDDEN'
        );
      }

      // Get subscription
      const subscription = await subscriptionService.getSubscriptionById(subscriptionId);

      return res.status(200).json({
        subscription: {
          id: subscription.id,
          plan_id: subscription.planId,
          plan_name: subscription.planName,
          status: subscription.status,
          started_at: subscription.startedAt,
          ended_at: subscription.endedAt,
          next_billing_date: subscription.nextBillingDate,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
