import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from '../config/logger';
import config from '../config/environment';

/**
 * Razorpay API Service
 * Handles all interactions with Razorpay payment gateway
 */

// Initialize Razorpay instance
const razorpayInstance = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

/**
 * Create or fetch a plan from Razorpay
 * Plans are used for subscription management
 */
export const createPlan = async (
  planData: {
    period: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    amount: number; // in paise (1 INR = 100 paise)
    currency?: string;
    description?: string;
  }
): Promise<any> => {
  try {
    logger.info('Creating Razorpay plan', { planData });

    const planRequest: any = {
      period: planData.period,
      interval: planData.interval,
      amount: planData.amount,
      currency: planData.currency || 'INR',
    };

    if (planData.description) {
      planRequest.description = planData.description;
    }

    const plan = await razorpayInstance.plans.create(planRequest);

    logger.info('Plan created successfully', { planId: (plan as any).id });
    return plan;
  } catch (error) {
    logger.error('Failed to create Razorpay plan', { error });
    throw new Error(`Failed to create Razorpay plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Fetch an existing plan from Razorpay
 */
export const fetchPlan = async (planId: string): Promise<any> => {
  try {
    logger.info('Fetching Razorpay plan', { planId });

    const plan = await razorpayInstance.plans.fetch(planId);

    logger.info('Plan fetched successfully', { planId });
    return plan;
  } catch (error) {
    logger.error('Failed to fetch Razorpay plan', { error, planId });
    throw new Error(`Failed to fetch Razorpay plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Create a subscription for a customer
 */
export const createSubscription = async (
  subscriptionData: {
    planId: string;
    customerId?: string;
    quantity?: number;
    totalCount?: number; // Total number of billing cycles
    customerNotify?: boolean; // notify customer via email
    notes?: Record<string, string>;
    expire_at?: number; // Unix timestamp
  }
): Promise<any> => {
  try {
    logger.info('Creating Razorpay subscription', { subscriptionData });

    const subscriptionRequest: any = {
      plan_id: subscriptionData.planId,
      customer_notify: subscriptionData.customerNotify !== undefined ? (subscriptionData.customerNotify ? 1 : 0) : 1,
      quantity: subscriptionData.quantity || 1,
      notes: subscriptionData.notes,
    };

    if (subscriptionData.totalCount) {
      subscriptionRequest.total_count = subscriptionData.totalCount;
    }

    if (subscriptionData.customerId) {
      subscriptionRequest.customer_id = subscriptionData.customerId;
    }

    if (subscriptionData.expire_at) {
      subscriptionRequest.expire_at = subscriptionData.expire_at;
    }

    const subscription = await razorpayInstance.subscriptions.create(subscriptionRequest);

    logger.info('Subscription created successfully', { subscriptionId: (subscription as any).id });
    return subscription;
  } catch (error) {
    logger.error('Failed to create Razorpay subscription', { error });
    throw new Error(`Failed to create Razorpay subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Fetch subscription details from Razorpay
 */
export const fetchSubscription = async (subscriptionId: string): Promise<any> => {
  try {
    logger.info('Fetching Razorpay subscription', { subscriptionId });

    const subscription = await razorpayInstance.subscriptions.fetch(subscriptionId);

    logger.info('Subscription fetched successfully', { subscriptionId });
    return subscription;
  } catch (error) {
    logger.error('Failed to fetch Razorpay subscription', { error, subscriptionId });
    throw new Error(`Failed to fetch Razorpay subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Cancel a subscription
 */
export const cancelSubscription = async (
  subscriptionId: string,
  options?: {
    notes?: Record<string, string>;
  }
): Promise<any> => {
  try {
    logger.info('Cancelling Razorpay subscription', { subscriptionId });

    const cancelRequest: any = {};
    if (options?.notes) {
      cancelRequest.notes = options.notes;
    }

        const subscription = await razorpayInstance.subscriptions.cancel(
      subscriptionId,
      (Object.keys(cancelRequest).length > 0 ? cancelRequest : undefined) as any
    );

    logger.info('Subscription cancelled successfully', { subscriptionId });
    return subscription;
  } catch (error) {
    logger.error('Failed to cancel Razorpay subscription', { error, subscriptionId });
    throw new Error(`Failed to cancel Razorpay subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Pause a subscription
 */
export const pauseSubscription = async (
  subscriptionId: string,
  options?: {
    pause_at?: 'now' | number; // 'now' or unix timestamp
    notes?: Record<string, string>;
  }
): Promise<any> => {
  try {
    logger.info('Pausing Razorpay subscription', { subscriptionId });

    const pauseRequest: any = {};
    if (options?.pause_at) {
      pauseRequest.pause_at = options.pause_at;
    } else {
      pauseRequest.pause_at = 'now';
    }

        const subscription = await razorpayInstance.subscriptions.pause(
      subscriptionId,
      pauseRequest as any
    );

    logger.info('Subscription paused successfully', { subscriptionId });
    return subscription;
  } catch (error) {
    logger.error('Failed to pause Razorpay subscription', { error, subscriptionId });
    throw new Error(`Failed to pause Razorpay subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Resume a paused subscription
 */
export const resumeSubscription = async (
  subscriptionId: string,
  options?: {
    notes?: Record<string, string>;
  }
): Promise<any> => {
  try {
    logger.info('Resuming Razorpay subscription', { subscriptionId });

    const resumeRequest: any = {
      resume_at: 'now',
    };

    if (options?.notes) {
      resumeRequest.notes = options.notes;
    }

    const subscription = await razorpayInstance.subscriptions.resume(subscriptionId, resumeRequest as any);

    logger.info('Subscription resumed successfully', { subscriptionId });
    return subscription;
  } catch (error) {
    logger.error('Failed to resume Razorpay subscription', { error, subscriptionId });
    throw new Error(`Failed to resume Razorpay subscription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Fetch customer details from Razorpay
 */
export const fetchCustomer = async (customerId: string): Promise<any> => {
  try {
    logger.info('Fetching Razorpay customer', { customerId });

    const customer = await razorpayInstance.customers.fetch(customerId);

    logger.info('Customer fetched successfully', { customerId });
    return customer;
  } catch (error) {
    logger.error('Failed to fetch Razorpay customer', { error, customerId });
    throw new Error(`Failed to fetch Razorpay customer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Create a customer in Razorpay
 */
export const createCustomer = async (
  customerData: {
    email: string;
    contact?: string;
    name?: string;
    notes?: Record<string, string>;
  }
): Promise<any> => {
  try {
    logger.info('Creating Razorpay customer', { email: customerData.email });

    const customer = await razorpayInstance.customers.create({
      email: customerData.email,
      contact: customerData.contact,
      name: customerData.name,
      notes: customerData.notes,
    });

    logger.info('Customer created successfully', { customerId: customer.id, email: customerData.email });
    return customer;
  } catch (error) {
    logger.error('Failed to create Razorpay customer', { error });
    throw new Error(`Failed to create Razorpay customer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Fetch payment details from Razorpay
 */
export const fetchPayment = async (paymentId: string): Promise<any> => {
  try {
    logger.info('Fetching Razorpay payment', { paymentId });

    const payment = await razorpayInstance.payments.fetch(paymentId);

    logger.info('Payment fetched successfully', { paymentId });
    return payment;
  } catch (error) {
    logger.error('Failed to fetch Razorpay payment', { error, paymentId });
    throw new Error(`Failed to fetch Razorpay payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Verify webhook signature from Razorpay
 * This ensures the webhook is genuine and hasn't been tampered with
 */
export const verifyWebhookSignature = (
  webhookBody: string | Buffer,
  signature: string,
  webhookSecret?: string
): boolean => {
  try {
    const secret = webhookSecret || config.razorpayWebhookSecret;
    if (!secret) {
      logger.error('Razorpay webhook secret not configured');
      return false;
    }

    const hash = crypto.createHmac('sha256', secret).update(webhookBody).digest('hex');

    const isValid = hash === signature;
    if (!isValid) {
      logger.warn('Invalid Razorpay webhook signature', { receivedSignature: signature, expectedHash: hash });
    }
    return isValid;
  } catch (error) {
    logger.error('Error verifying Razorpay webhook signature', { error });
    return false;
  }
};

/**
 * Get Razorpay instance for advanced operations
 */
export const getRazorpayInstance = (): Razorpay => {
  return razorpayInstance;
};

export default {
  createPlan,
  fetchPlan,
  createSubscription,
  fetchSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  fetchCustomer,
  createCustomer,
  fetchPayment,
  verifyWebhookSignature,
  getRazorpayInstance,
};
