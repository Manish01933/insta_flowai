/**
 * Payment Request and Response DTOs
 */

/**
 * Create subscription request
 */
export interface CreateSubscriptionRequest {
  planId: string;
  razorpayPaymentId?: string;
}

/**
 * Upgrade subscription request
 */
export interface UpgradeSubscriptionRequest {
  planId: string;
}

/**
 * Razorpay Webhook Payload for Payment
 */
export interface RazorpayPaymentWebhookPayload {
  id: string;
  event: string;
  created_at: number;
  payload: {
    payment: {
      entity: {
        id: string;
        entity: string;
        amount: number;
        currency: string;
        status: string;
                method: string;
        description?: string;
        amount_refunded: number;
        refund_status?: string;
        captured: boolean;
        card_id?: string;
        bank?: string;
        wallet?: string;
        vpa?: string;
        email: string;
        contact: string;
        fee?: number;
        tax?: number;
        error_code?: string;
        error_description?: string;
        error_source?: string;
        error_reason?: string;
        error_step?: string;
        error_id?: string;
        acquire_transaction_id?: string;
        international?: boolean;
        amount_paise?: number;
        created_at: number;
        notes?: Record<string, any>;
      };
    };
  };
}

/**
 * Razorpay Webhook Payload for Subscription
 */
export interface RazorpaySubscriptionWebhookPayload {
  id: string;
  event: string;
  created_at: number;
  payload: {
    subscription: {
      entity: {
        id: string;
        entity: string;
        plan_id: string;
        customer_id: string;
        status: string;
        current_start?: number;
        current_end?: number;
        ended_at?: number;
        quantity: number;
        notes?: Record<string, any>;
        charge_at?: number;
        start_at?: number;
        end_at?: number;
        auth_attempts: number;
        total_count: number;
        paid_count: number;
        customer_notify: number;
        created_at: number;
        expire_by?: number;
        short_url?: string;
        has_scheduled_changes: boolean;
                change_scheduled_at?: number;
        remaining_count?: number;
        offer_id?: string;
      };
    };
  };
}

/**
 * Payment Method Types
 */
export enum PaymentMethodType {
  CARD = 'card',
  NETBANKING = 'netbanking',
  WALLET = 'wallet',
  UPI = 'upi',
  BANK_TRANSFER = 'bank_transfer',
}

/**
 * Subscription Create DTO
 */
export interface SubscriptionCreateDTO {
  userId: string;
  planId: string;
  planName: string;
  price: number;
  currency: string;
  billingCycle: string;
  razorpaySubscriptionId?: string;
  razorpayPlanId?: string;
  status: string;
  startedAt?: Date;
  nextBillingDate?: Date;
}

/**
 * Payment Create DTO
 */
export interface PaymentCreateDTO {
  userId: string;
  subscriptionId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod?: string;
  errorMessage?: string;
}

/**
 * Subscription Update DTO
 */
export interface SubscriptionUpdateDTO {
  status?: string;
  razorpaySubscriptionId?: string;
  razorpayPlanId?: string;
  nextBillingDate?: Date;
  endedAt?: Date;
}

/**
 * Payment Update DTO
 */
export interface PaymentUpdateDTO {
  status?: string;
  razorpayPaymentId?: string;
  errorMessage?: string;
}
