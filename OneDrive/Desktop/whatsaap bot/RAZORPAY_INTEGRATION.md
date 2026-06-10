# Razorpay Integration Guide

## Overview

This document describes the Razorpay payment gateway integration in BotBazaar. The integration handles subscription management, payment processing, and webhook event handling.

## Architecture

### Components

1. **Razorpay Service** (`src/services/razorpayService.ts`)
   - API client wrapper for Razorpay operations
   - Plan creation and management
   - Subscription CRUD operations
   - Customer management
   - Payment fetching
   - Webhook signature verification

2. **Razorpay Webhook Service** (`src/services/razorpayWebhookService.ts`)
   - Webhook signature verification
   - Event parsing and routing
   - Payment event handlers
   - Subscription event handlers
   - Database updates for payment and subscription state

3. **Razorpay Webhook Routes** (`src/routes/webhooks.ts`)
   - POST `/api/webhooks/razorpay` - Webhook endpoint for payment and subscription events
   - Signature verification middleware
   - Async event processing

## Environment Variables

Configure these environment variables in your `.env` file:

```
# Razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

### Getting Razorpay Credentials

1. Create a Razorpay account at https://razorpay.com
2. Go to Settings > API Keys to get `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
3. Go to Settings > Webhooks to create a webhook and get the `RAZORPAY_WEBHOOK_SECRET`

## API Usage

### Razorpay Service API

#### Plan Management

```typescript
import razorpayService from './services/razorpayService';

// Create a plan
const plan = await razorpayService.createPlan({
  period: 'monthly',
  interval: 1,
  amount: 99900, // 999 INR in paise
  currency: 'INR',
  description: 'Pro Plan - 100k messages/month'
});

// Fetch a plan
const planDetails = await razorpayService.fetchPlan('plan_xyz');
```

#### Subscription Management

```typescript
// Create a subscription
const subscription = await razorpayService.createSubscription({
  planId: 'plan_pro',
  customerId: 'cust_123',
  customerNotify: true, // Send email notification
  totalCount: 12, // Billing cycles
  notes: {
    user_id: 'user_uuid',
    tier: 'pro'
  }
});

// Fetch subscription details
const subDetails = await razorpayService.fetchSubscription('sub_xyz');

// Pause subscription
await razorpayService.pauseSubscription('sub_xyz');

// Resume subscription
await razorpayService.resumeSubscription('sub_xyz');

// Cancel subscription
await razorpayService.cancelSubscription('sub_xyz', {
  notes: { reason: 'User requested' }
});
```

#### Customer Management

```typescript
// Create a customer
const customer = await razorpayService.createCustomer({
  email: 'user@example.com',
  contact: '+91-9876543210',
  name: 'John Doe',
  notes: {
    user_id: 'user_uuid'
  }
});

// Fetch customer
const customerDetails = await razorpayService.fetchCustomer('cust_123');
```

#### Payment Operations

```typescript
// Fetch payment details
const payment = await razorpayService.fetchPayment('pay_xyz');
```

#### Webhook Verification

```typescript
// Verify webhook signature
const isValid = razorpayService.verifyWebhookSignature(
  webhookBody,
  signature,
  webhookSecret
);
```

## Webhook Events

### Supported Events

1. **payment.authorized** - Payment successful
   - Triggered when a subscription payment is authorized
   - Updates payment status to 'captured'
   - Updates subscription to 'active'
   - Updates user subscription tier

2. **payment.failed** - Payment failed
   - Triggered when a payment fails
   - Updates payment status to 'failed'
   - Stores error message

3. **subscription.activated** - Subscription activated
   - Triggered when a subscription is created and activated
   - Updates subscription status to 'active'
   - Sets subscription start date and next billing date
   - Updates user subscription tier and status

4. **subscription.halted** - Subscription paused/cancelled
   - Triggered when a subscription is paused or cancelled
   - Updates subscription status to 'halted'
   - Sets subscription end date
   - Updates user subscription status

5. **subscription.pending** - Subscription pending activation
   - Triggered when subscription awaits payment confirmation
   - Updates subscription status to 'pending'

### Webhook Flow

```
1. Razorpay sends POST request to /api/webhooks/razorpay
2. System verifies X-Razorpay-Signature header
3. Payload is parsed and event type is determined
4. Appropriate event handler is called
5. Database records are updated
6. 200 OK response is returned to Razorpay
```

### Sample Webhook Payloads

#### payment.authorized
```json
{
  "event": "payment.authorized",
  "id": "evt_xyz",
  "created_at": 1234567890,
  "payment": {
    "id": "pay_123",
    "amount": 99900,
    "currency": "INR",
    "status": "captured",
    "method": "card"
  },
  "subscription": {
    "id": "sub_123",
    "plan_id": "plan_pro",
    "customer_id": "cust_123"
  }
}
```

#### subscription.activated
```json
{
  "event": "subscription.activated",
  "id": "evt_xyz",
  "created_at": 1234567890,
  "subscription": {
    "id": "sub_123",
    "plan_id": "plan_pro",
    "customer_id": "cust_123",
    "status": "active",
    "start_at": 1234567890,
    "next_billing_at": 1237159890
  }
}
```

## Integration with User Subscriptions

### Subscription Tiers

The system defines subscription tiers with corresponding features:

**Free**
- Max bots: 1
- Messages/month: 1,000
- AI model: claude-3-haiku
- Support: Community

**Pro**
- Max bots: 10
- Messages/month: 100,000
- AI model: claude-3-sonnet
- Support: Email

**Enterprise**
- Max bots: Unlimited
- Messages/month: Unlimited
- AI model: claude-3-opus
- Support: Dedicated

### Flow: User Subscription Update

1. User initiates subscription upgrade in dashboard
2. Frontend calls `POST /api/subscriptions/upgrade` with plan_id
3. Backend creates Razorpay subscription via `createSubscription()`
4. Razorpay sends webhook when subscription is activated
5. Webhook handler updates database:
   - Subscription record (status, dates)
   - User record (subscriptionTier, subscriptionStatus, razorpaySubscriptionId)
6. User's subscription tier is now active

## Error Handling

### Error Scenarios

1. **Invalid Webhook Signature**
   - Returns 400 Bad Request
   - Webhook is not processed
   - Logged for security monitoring

2. **Missing Credentials**
   - Runtime error if environment variables not set
   - Application startup fails with clear error

3. **Razorpay API Errors**
   - Caught and logged
   - Error thrown with descriptive message
   - Can be retried by application logic

4. **Database Errors**
   - Logged with full context
   - Webhook returns 200 OK (already sent to Razorpay)
   - Manual investigation required

### Retry Logic

Razorpay webhooks include exponential backoff retry:
- First retry: 5 seconds
- Maximum 10 retries
- Final retry after 24 hours

## Testing

### Unit Tests

Run Razorpay service tests:
```bash
npm test -- src/services/razorpay
```

### Test Coverage

- Plan creation and fetching
- Subscription CRUD operations
- Webhook signature verification
- Event parsing
- Signature consistency checks

### Manual Testing with Razorpay Dashboard

1. In Razorpay Dashboard, go to Subscriptions
2. Create a test subscription manually
3. View webhook delivery in Settings > Webhooks
4. Use "Send Test Webhook" to verify endpoint

## Production Considerations

### Security

1. **Webhook Secret Protection**
   - Store securely in environment variables
   - Never commit to version control
   - Rotate regularly

2. **Signature Verification**
   - Always verify webhook signatures
   - Invalid signatures are rejected
   - Failed verifications are logged

3. **Rate Limiting**
   - Razorpay webhooks have built-in rate limiting
   - Consider queue-based processing for high volume

### Monitoring

1. **Webhook Delivery**
   - Monitor webhook delivery in Razorpay dashboard
   - Set up alerts for failed webhooks
   - Log all webhook processing

2. **Payment Status**
   - Monitor failed payments
   - Alert on payment failures
   - Investigate chargeback patterns

3. **Subscription Metrics**
   - Track subscription activation rate
   - Monitor churn rate
   - Alert on unusual patterns

### Database

1. **Indexes**
   - Ensure indexes on `razorpay_payment_id`
   - Ensure indexes on `razorpay_subscription_id`
   - Ensure indexes on subscription status

2. **Retention**
   - Keep payment records indefinitely
   - Archive old transactions after 7 years
   - Comply with tax regulations

## Troubleshooting

### Issue: Webhook not being received

1. Verify webhook URL in Razorpay settings
2. Check firewall/network restrictions
3. Verify SSL certificate is valid
4. Check application logs for errors

### Issue: Signature verification failing

1. Verify RAZORPAY_WEBHOOK_SECRET is correct
2. Check webhook is being sent with correct header
3. Verify raw body is being used (not parsed JSON)
4. Check for any middleware modifying request body

### Issue: Payment status not updating

1. Check webhook processing logs
2. Verify database connection
3. Check subscription record exists
4. Verify user record exists

### Issue: Subscription not activated

1. Verify payment was authorized
2. Check Razorpay dashboard for subscription status
3. Review webhook delivery logs
4. Verify customer_id was provided

## API Reference

See `src/services/razorpayService.ts` for complete API documentation.

## Related Documentation

- Razorpay API Docs: https://razorpay.com/docs/
- Razorpay Webhooks: https://razorpay.com/docs/webhooks/
- Razorpay SDK: https://github.com/razorpay/razorpay-node

## Support

For Razorpay integration issues:
1. Check Razorpay dashboard for webhook delivery status
2. Review application logs for errors
3. Contact Razorpay support: https://razorpay.com/support/
