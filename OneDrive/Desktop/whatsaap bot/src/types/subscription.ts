/**
 * Subscription Tier Definitions and Types
 * Defines subscription plans, features, and related DTOs
 */

/**
 * Subscription Tier Types
 */
export enum SubscriptionTier {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

/**
 * Subscription Status
 */
export enum SubscriptionStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/**
 * Payment Status
 */
export enum PaymentStatus {
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  CAPTURED = 'captured',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

/**
 * Subscription Plan Definition
 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: SubscriptionTier;
  price: number; // in paise for INR
  currency: string;
  billingCycle: string;
  features: {
    maxBots: number;
    messagesPerMonth: number;
    aiModel: string;
    support: string;
  };
  razorpayPlanId?: string;
  description: string;
}

/**
 * Subscription Tier Definitions with all features
 */
export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, SubscriptionPlan> = {
  [SubscriptionTier.FREE]: {
    id: 'plan_free',
    name: 'Free',
    tier: SubscriptionTier.FREE,
    price: 0, // Free plan
    currency: 'INR',
    billingCycle: 'monthly',
    description: 'Perfect for getting started with BotBazaar',
    features: {
      maxBots: 1,
      messagesPerMonth: 1000,
      aiModel: 'claude-3-haiku',
      support: 'community',
    },
  },
  [SubscriptionTier.PRO]: {
    id: 'plan_pro',
    name: 'Pro',
    tier: SubscriptionTier.PRO,
    price: 99900, // 999 INR in paise
    currency: 'INR',
    billingCycle: 'monthly',
    description: 'For growing businesses',
    features: {
      maxBots: 10,
      messagesPerMonth: 100000,
      aiModel: 'claude-3-sonnet',
      support: 'email',
    },
  },
  [SubscriptionTier.ENTERPRISE]: {
    id: 'plan_enterprise',
    name: 'Enterprise',
    tier: SubscriptionTier.ENTERPRISE,
    price: 499900, // 4999 INR in paise
    currency: 'INR',
    billingCycle: 'monthly',
    description: 'For large-scale operations',
    features: {
      maxBots: 50,
      messagesPerMonth: 1000000,
      aiModel: 'claude-3-opus',
      support: 'dedicated',
    },
  },
};

/**
 * Subscription Response DTO
 */
export interface SubscriptionResponseDTO {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  price: number;
  currency: string;
  billingCycle: string;
  razorpaySubscriptionId?: string;
  razorpayPlanId?: string;
  status: SubscriptionStatus;
  startedAt?: Date;
  endedAt?: Date;
  nextBillingDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  features?: {
    maxBots: number;
    messagesPerMonth: number;
    aiModel: string;
    support: string;
  };
}

/**
 * Payment Response DTO
 */
export interface PaymentResponseDTO {
  id: string;
  userId: string;
  subscriptionId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription Plan Response DTO
 */
export interface SubscriptionPlanResponseDTO {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: {
    maxBots: number;
    messagesPerMonth: number;
    aiModel: string;
    support: string;
  };
  razorpayPlanId?: string;
  description: string;
}

/**
 * Helper function to get subscription plan by tier
 */
export function getSubscriptionPlan(tier: SubscriptionTier): SubscriptionPlan {
  return SUBSCRIPTION_PLANS[tier];
}

/**
 * Helper function to get all subscription plans
 */
export function getAllSubscriptionPlans(): SubscriptionPlan[] {
  return Object.values(SUBSCRIPTION_PLANS);
}

/**
 * Helper function to format price for display
 * Converts paise to rupees
 */
export function formatPrice(priceInPaise: number): string {
  const priceInRupees = priceInPaise / 100;
  return priceInRupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
  });
}

/**
 * Helper function to check if a subscription is active
 */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === SubscriptionStatus.ACTIVE;
}

/**
 * Helper function to check feature access based on subscription tier
 */
export function hasAccessToFeature(
  tier: SubscriptionTier,
  featureCheck: (plan: SubscriptionPlan) => boolean
): boolean {
  const plan = getSubscriptionPlan(tier);
  return featureCheck(plan);
}

/**
 * Helper function to check bot limit for a tier
 */
export function canCreateBot(tier: SubscriptionTier, currentBotCount: number): boolean {
  const plan = getSubscriptionPlan(tier);
  return currentBotCount < plan.features.maxBots;
}

/**
 * Helper function to check message limit for a tier
 */
export function canSendMessage(
  tier: SubscriptionTier,
  messagesThisMonth: number
): boolean {
  const plan = getSubscriptionPlan(tier);
  return messagesThisMonth < plan.features.messagesPerMonth;
}

/**
 * Create subscription plan DTO from plan definition
 */
export function createSubscriptionPlanDTO(
  plan: SubscriptionPlan
): SubscriptionPlanResponseDTO {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    billingCycle: plan.billingCycle,
    features: plan.features,
    razorpayPlanId: plan.razorpayPlanId,
    description: plan.description,
  };
}
