/**
 * Razorpay Webhook Handler Service
 * Processes webhook events from Razorpay payment gateway
 * Handles payment.authorized, payment.failed, subscription.activated, subscription.halted events
 */

import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { verifyWebhookSignature } from './razorpayService';
import { ValidationError } from '../utils/errors';

const prisma = new PrismaClient();

/**
 * Razorpay Webhook Event Type
 */
export enum RazorpayEventType {
  PAYMENT_AUTHORIZED = 'payment.authorized',
  PAYMENT_FAILED = 'payment.failed',
  SUBSCRIPTION_ACTIVATED = 'subscription.activated',
  SUBSCRIPTION_HALTED = 'subscription.halted',
  SUBSCRIPTION_PAUSED = 'subscription.paused',
  SUBSCRIPTION_RESUMED = 'subscription.resumed',
}

/**
 * Razorpay Webhook Payload Interface
 */
export interface RazorpayWebhookPayload {
  id: string;
  event: string;
  created_at: number;
  contains: string[];
  payload: {
    payment?: any;
    subscription?: any;
    invoice?: any;
  };
}

/**
 * Verify webhook signature
 * Extracts and verifies the signature from webhook headers
 */
export const verifyWebhookPayload = (
  body: string | Buffer,
  signature: string,
  webhookSecret: string
): boolean => {
  try {
    return verifyWebhookSignature(body, signature, webhookSecret);
  } catch (error: any) {
    logger.error(`Error verifying webhook payload: ${error.message}`);
    return false;
  }
};

/**
 * Parse webhook payload
 */
export const parseWebhookPayload = (body: string): RazorpayWebhookPayload => {
  try {
    return JSON.parse(body);
  } catch (error: any) {
    logger.error(`Error parsing webhook payload: ${error.message}`);
    throw new ValidationError('Invalid JSON payload', 'INVALID_JSON');
  }
};

/**
 * Handle payment.authorized event
 * Updates Payment status to 'captured' and Subscription status to 'active'
 */
export const handlePaymentAuthorized = async (payload: RazorpayWebhookPayload): Promise<void> => {
  try {
    const payment = payload.payload.payment;

    if (!payment || !payment.id) {
      logger.warn('Invalid payment.authorized payload: missing payment data');
      return;
    }

    logger.info(`Processing payment.authorized event for payment: ${payment.id}`);

    // Find payment record by razorpay_payment_id
    const paymentRecord = await prisma.payment.findUnique({
      where: { razorpayPaymentId: payment.id },
      include: { user: true },
    });

    if (!paymentRecord) {
      logger.warn(`Payment record not found for razorpay_payment_id: ${payment.id}`);
      return;
    }

    // Update payment status to 'captured'
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'captured',
        paymentMethod: payment.method || undefined,
        updatedAt: new Date(),
      },
    });

    logger.info(`Payment status updated to captured: ${paymentRecord.id}`, {
      razorpayPaymentId: payment.id,
      amount: payment.amount,
      method: payment.method,
    });

    // Update related subscription to 'active' if it exists
    if (paymentRecord.subscriptionId) {
      const subscription = await prisma.subscription.update({
        where: { id: paymentRecord.subscriptionId },
        data: {
          status: 'active',
          updatedAt: new Date(),
        },
      });

      logger.info(`Subscription status updated to active: ${subscription.id}`, {
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      });

      // Update user subscription status
      await prisma.user.update({
        where: { id: paymentRecord.userId },
        data: {
          subscriptionStatus: 'active',
          subscriptionStartDate: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info(`User subscription status updated to active: ${paymentRecord.userId}`);
    }

    logger.info(`Payment authorized event processed successfully: ${payment.id}`);
  } catch (error: any) {
    logger.error(`Error handling payment.authorized event: ${error.message}`, {
      error: error.stack,
      payload,
    });
    // Don't throw - webhook must succeed to prevent retries
  }
};

/**
 * Handle payment.failed event
 * Updates Payment status to 'failed' and error message
 */
export const handlePaymentFailed = async (payload: RazorpayWebhookPayload): Promise<void> => {
  try {
    const payment = payload.payload.payment;

    if (!payment || !payment.id) {
      logger.warn('Invalid payment.failed payload: missing payment data');
      return;
    }

    logger.info(`Processing payment.failed event for payment: ${payment.id}`);

    // Find payment record by razorpay_payment_id
    const paymentRecord = await prisma.payment.findUnique({
      where: { razorpayPaymentId: payment.id },
      include: { user: true },
    });

    if (!paymentRecord) {
      logger.warn(`Payment record not found for razorpay_payment_id: ${payment.id}`);
      return;
    }

    // Extract error reason
    const errorMessage =
      payment.error_reason ||
      payment.error_description ||
      payment.error_code ||
      'Payment failed';

    // Update payment status to 'failed'
    await prisma.payment.update({
      where: { id: paymentRecord.id },
      data: {
        status: 'failed',
        errorMessage,
        updatedAt: new Date(),
      },
    });

    logger.info(`Payment status updated to failed: ${paymentRecord.id}`, {
      razorpayPaymentId: payment.id,
      errorMessage,
    });

    // Update related subscription to 'pending' if it exists
    if (paymentRecord.subscriptionId) {
      const subscription = await prisma.subscription.update({
        where: { id: paymentRecord.subscriptionId },
        data: {
          status: 'pending',
          updatedAt: new Date(),
        },
      });

      logger.info(`Subscription status updated to pending: ${subscription.id}`, {
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      });
    }

    logger.info(`Payment failed event processed successfully: ${payment.id}`);
  } catch (error: any) {
    logger.error(`Error handling payment.failed event: ${error.message}`, {
      error: error.stack,
      payload,
    });
    // Don't throw - webhook must succeed to prevent retries
  }
};

/**
 * Handle subscription.activated event
 * Updates Subscription status to 'active' and sets startedAt and nextBillingDate
 */
export const handleSubscriptionActivated = async (payload: RazorpayWebhookPayload): Promise<void> => {
  try {
    const subscription = payload.payload.subscription;

    if (!subscription || !subscription.id) {
      logger.warn('Invalid subscription.activated payload: missing subscription data');
      return;
    }

    logger.info(`Processing subscription.activated event for subscription: ${subscription.id}`);

    // Find subscription record by razorpay_subscription_id
    const subscriptionRecord = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subscription.id },
      include: { user: true },
    });

    if (!subscriptionRecord) {
      logger.warn(`Subscription record not found for razorpay_subscription_id: ${subscription.id}`);
      return;
    }

    // Calculate next billing date (30 days from now)
    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + 30);

    // Update subscription status
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionRecord.id },
      data: {
        status: 'active',
        startedAt: new Date(),
        nextBillingDate,
        updatedAt: new Date(),
      },
    });

    logger.info(`Subscription status updated to active: ${subscriptionRecord.id}`, {
      razorpaySubscriptionId: subscription.id,
      startedAt: updatedSubscription.startedAt,
      nextBillingDate,
    });

    // Update user subscription status to 'active'
    await prisma.user.update({
      where: { id: subscriptionRecord.userId },
      data: {
        subscriptionStatus: 'active',
        subscriptionStartDate: new Date(),
        subscriptionTier: subscriptionRecord.planId,
        updatedAt: new Date(),
      },
    });

    logger.info(`User subscription status updated to active: ${subscriptionRecord.userId}`, {
      subscriptionTier: subscriptionRecord.planId,
    });

    logger.info(`Subscription activated event processed successfully: ${subscription.id}`);
  } catch (error: any) {
    logger.error(`Error handling subscription.activated event: ${error.message}`, {
      error: error.stack,
      payload,
    });
    // Don't throw - webhook must succeed to prevent retries
  }
};

/**
 * Handle subscription.halted event
 * Updates Subscription status to 'cancelled' and sets endedAt
 */
export const handleSubscriptionHalted = async (payload: RazorpayWebhookPayload): Promise<void> => {
  try {
    const subscription = payload.payload.subscription;

    if (!subscription || !subscription.id) {
      logger.warn('Invalid subscription.halted payload: missing subscription data');
      return;
    }

    logger.info(`Processing subscription.halted event for subscription: ${subscription.id}`);

    // Find subscription record by razorpay_subscription_id
    const subscriptionRecord = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subscription.id },
      include: { user: true },
    });

    if (!subscriptionRecord) {
      logger.warn(`Subscription record not found for razorpay_subscription_id: ${subscription.id}`);
      return;
    }

    // Update subscription status to 'cancelled'
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionRecord.id },
      data: {
        status: 'cancelled',
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(`Subscription status updated to cancelled: ${subscriptionRecord.id}`, {
      razorpaySubscriptionId: subscription.id,
      endedAt: updatedSubscription.endedAt,
    });

    // Update user subscription status and tier
    await prisma.user.update({
      where: { id: subscriptionRecord.userId },
      data: {
        subscriptionStatus: 'cancelled',
        subscriptionTier: 'free',
        subscriptionEndDate: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(`User subscription cancelled: ${subscriptionRecord.userId}`, {
      subscriptionTier: 'free',
    });

    logger.info(`Subscription halted event processed successfully: ${subscription.id}`);
  } catch (error: any) {
    logger.error(`Error handling subscription.halted event: ${error.message}`, {
      error: error.stack,
      payload,
    });
    // Don't throw - webhook must succeed to prevent retries
  }
};

/**
 * Main webhook processor
 * Routes events to appropriate handlers based on event type
 */
export const processWebhookEvent = async (payload: RazorpayWebhookPayload): Promise<void> => {
  try {
    const eventType = payload.event as RazorpayEventType;

    logger.info(`Processing Razorpay webhook event: ${eventType}`, {
      eventId: payload.id,
      createdAt: payload.created_at,
    });

    switch (eventType) {
      case RazorpayEventType.PAYMENT_AUTHORIZED:
        await handlePaymentAuthorized(payload);
        break;

      case RazorpayEventType.PAYMENT_FAILED:
        await handlePaymentFailed(payload);
        break;

      case RazorpayEventType.SUBSCRIPTION_ACTIVATED:
        await handleSubscriptionActivated(payload);
        break;

      case RazorpayEventType.SUBSCRIPTION_HALTED:
        await handleSubscriptionHalted(payload);
        break;

      case RazorpayEventType.SUBSCRIPTION_PAUSED:
        logger.info(`Subscription paused event received (not yet implemented): ${payload.id}`);
        break;

      case RazorpayEventType.SUBSCRIPTION_RESUMED:
        logger.info(`Subscription resumed event received (not yet implemented): ${payload.id}`);
        break;

      default:
        logger.warn(`Unhandled webhook event type: ${eventType}`);
    }

    logger.info(`Webhook event processed successfully: ${eventType}`, {
      eventId: payload.id,
    });
  } catch (error: any) {
    logger.error(`Error processing webhook event: ${error.message}`, {
      error: error.stack,
      payload,
    });
    // Don't throw - webhook must succeed to prevent retries
  }
};

export default {
  verifyWebhookPayload,
  parseWebhookPayload,
  handlePaymentAuthorized,
  handlePaymentFailed,
  handleSubscriptionActivated,
  handleSubscriptionHalted,
  processWebhookEvent,
};
