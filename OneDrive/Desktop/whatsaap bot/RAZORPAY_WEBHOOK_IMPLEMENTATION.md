# Razorpay Webhook Handler Implementation (Task 4.6)

## Overview
Successfully implemented a complete Razorpay webhook handler for the BotBazaar payment system. The implementation handles all payment and subscription events from Razorpay, updates database records, and manages subscription status transitions.

## Implementation Details

### 1. Razorpay Webhook Service (`src/services/razorpayWebhookService.ts`)

**Exported Functions:**

#### Verification & Parsing
- `verifyWebhookPayload(body, signature, webhookSecret): boolean`
  - Verifies HMAC-SHA256 signature from Razorpay
  - Uses constant-time comparison to prevent timing attacks
  - Returns true/false based on signature validity

- `parseWebhookPayload(body): RazorpayWebhookPayload`
  - Parses JSON webhook payload
  - Throws ValidationError on invalid JSON
  - Returns strongly-typed webhook payload

#### Event Handlers

##### `handlePaymentAuthorized(payload)`
- Handles `payment.authorized` event
- Updates Payment record:
  - Sets status to 'captured'
  - Records payment method
  - Logs successful payment
- If linked subscription exists:
  - Sets Subscription status to 'active'
  - Updates User subscription status to 'active'
  - Records subscription start date

##### `handlePaymentFailed(payload)`
- Handles `payment.failed` event
- Updates Payment record:
  - Sets status to 'failed'
  - Records error message from payment response
  - Logs failure details
- If linked subscription exists:
  - Sets Subscription status to 'pending'
  - Retains user subscription in pending state

##### `handleSubscriptionActivated(payload)`
- Handles `subscription.activated` event
- Updates Subscription record:
  - Sets status to 'active'
  - Records startedAt timestamp
  - Calculates nextBillingDate (30 days from now)
  - Updates timestamp
- Updates User record:
  - Sets subscriptionStatus to 'active'
  - Records subscriptionStartDate
  - Updates subscriptionTier to plan name
  - Updates timestamp

##### `handleSubscriptionHalted(payload)`
- Handles `subscription.halted` event
- Updates Subscription record:
  - Sets status to 'cancelled'
  - Records endedAt timestamp
  - Updates timestamp
- Updates User record:
  - Sets subscriptionStatus to 'cancelled'
  - Downgrades subscriptionTier to 'free'
  - Records subscriptionEndDate
  - Updates timestamp

#### Main Event Processor
- `processWebhookEvent(payload)`
  - Routes events to appropriate handlers based on event type
  - Supports: payment.authorized, payment.failed, subscription.activated, subscription.halted
  - Also handles: subscription.paused, subscription.resumed (logged but not yet implemented)
  - Gracefully handles unrecognized event types
  - Never throws - logs errors instead to ensure webhook returns 200 OK

### 2. Webhook Route Handler (`src/routes/webhooks.ts`)

**Endpoint:** `POST /api/webhooks/razorpay`

**Features:**
- Raw body capture for signature verification
- HMAC-SHA256 signature verification using `X-Razorpay-Signature` header
- Immediate 200 OK response (as required by Razorpay)
- Asynchronous event processing after response sent
- Comprehensive error handling and logging
- Request ID tracking for debugging

**Authentication:** Webhook signature verification only (no JWT required)

**Request Headers:**
- `X-Razorpay-Signature`: HMAC-SHA256 signature for verification
- `Content-Type`: application/json

**Response:**
```json
{
  "status": "received",
  "requestId": "uuid",
  "eventId": "razorpay_event_id"
}
```

**Error Responses:**
- 400: Missing signature, invalid signature, invalid JSON, invalid payload structure
- 500: Internal server error

### 3. Webhook Event Types

**payment.authorized**
- Event ID format: `evt_...`
- Payload contains: payment object with id, amount, method, status
- Database updates: Payment (status='captured'), Subscription (status='active'), User (subscriptionStatus='active')

**payment.failed**
- Event ID format: `evt_...`
- Payload contains: payment object with id, error_reason, error_code
- Database updates: Payment (status='failed', errorMessage), Subscription (status='pending')

**subscription.activated**
- Event ID format: `evt_...`
- Payload contains: subscription object with id, plan_id, customer_id
- Database updates: Subscription (status='active', startedAt, nextBillingDate), User (subscriptionStatus='active', subscriptionTier)

**subscription.halted**
- Event ID format: `evt_...`
- Payload contains: subscription object with id
- Database updates: Subscription (status='cancelled', endedAt), User (subscriptionStatus='cancelled', subscriptionTier='free', subscriptionEndDate)

### 4. Database Schema Integration

The implementation uses existing Prisma models:

**Payment Model Updates:**
- razorpayPaymentId: Unique identifier for lookup
- status: 'pending' | 'captured' | 'failed'
- errorMessage: Error details from Razorpay

**Subscription Model Updates:**
- razorpaySubscriptionId: Unique identifier for lookup
- razorpayPlanId: Associated Razorpay plan
- status: 'active' | 'pending' | 'cancelled'
- startedAt: Subscription activation timestamp
- endedAt: Subscription cancellation timestamp
- nextBillingDate: Next billing cycle date

**User Model Updates:**
- subscriptionStatus: 'active' | 'cancelled'
- subscriptionTier: Plan name or 'free'
- subscriptionStartDate: When subscription became active
- subscriptionEndDate: When subscription was cancelled

### 5. Error Handling Strategy

The implementation follows a non-failing webhook pattern:
- Always returns 200 OK to Razorpay (prevents infinite retries)
- Logs all errors for monitoring/debugging
- Gracefully handles missing payment/subscription records
- Handles malformed payloads without crashing
- Database errors don't prevent 200 response
- Event processing happens asynchronously after response

### 6. Testing

**Test File:** `src/services/razorpayWebhookService.test.ts`
**Tests Cover:**
- Webhook signature verification (valid and invalid)
- JSON parsing (valid and invalid payloads)
- Payment authorized event handling
- Payment failed event handling
- Subscription activated event handling (including 30-day billing calculation)
- Subscription halted event handling
- Event routing logic
- Graceful handling of unrecognized events
- Missing payment/subscription records

**Test Framework:** Jest with TypeScript support

## Configuration

**Required Environment Variables:**
```
RAZORPAY_KEY_ID=<razorpay_key_id>
RAZORPAY_KEY_SECRET=<razorpay_key_secret>
RAZORPAY_WEBHOOK_SECRET=<webhook_secret_from_razorpay_dashboard>
```

## Usage

### Setting Up Razorpay Webhook

1. Log in to Razorpay Dashboard
2. Navigate to Settings > Webhooks
3. Create new webhook with:
   - URL: `https://api.botbazaar.com/api/webhooks/razorpay`
   - Events: 
     - payment.authorized
     - payment.failed
     - subscription.activated
     - subscription.halted
   - Active: Yes
4. Copy webhook secret to `RAZORPAY_WEBHOOK_SECRET` environment variable

### Processing Flow

```
Razorpay sends webhook
    ↓
[1] Verify X-Razorpay-Signature header
    ↓
[2] Verify HMAC-SHA256 signature
    ↓
[3] Parse JSON payload
    ↓
[4] Return 200 OK to Razorpay (immediate)
    ↓
[5] Route to event handler (async)
    ↓
[6] Update database records
    ↓
[7] Log completion or errors
```

## Security Considerations

1. **Signature Verification**
   - HMAC-SHA256 with timing-safe comparison
   - Prevents webhook spoofing

2. **Raw Body Capture**
   - Middleware captures raw body before JSON parsing
   - Required for signature verification

3. **Webhook Secret**
   - Stored in environment variable
   - Never logged or exposed
   - Used only for signature verification

4. **Error Handling**
   - No sensitive data in error responses
   - Errors logged with context for monitoring
   - Always returns 200 to prevent Razorpay retries

## Monitoring & Debugging

- All webhook events logged with event ID and type
- Request ID included in all logs for tracing
- Errors logged with full stack traces
- Database operation success/failure logged
- Webhook signature verification failures logged

## Future Enhancements

- subscription.paused event handling
- subscription.resumed event handling
- Invoice generation on payment authorized
- Email notifications on payment events
- Webhook retry mechanism for failed updates
- Webhook event archival for audit trail

## Files Created/Modified

**Created:**
- `src/services/razorpayWebhookService.ts` - Main webhook service
- `src/services/razorpayWebhookService.test.ts` - Unit tests
- `src/routes/razorpayWebhooks.test.ts` - Integration tests

**Modified:**
- `src/routes/webhooks.ts` - Added Razorpay endpoint
- Import razorpayWebhookService functions

## Testing Commands

```bash
# Run webhook service tests
npm test -- src/services/razorpayWebhookService.test.ts

# Run integration tests
npm test -- src/routes/razorpayWebhooks.test.ts

# Run all tests
npm test
```

## Compliance

✅ Handles all 4 required events
✅ Updates Payment and Subscription status correctly
✅ Verifies webhook signature with HMAC-SHA256
✅ Returns 200 OK immediately
✅ Processes events asynchronously
✅ No JWT required (signature-based auth)
✅ Comprehensive error handling
✅ Database updates are atomic at event level
✅ Full audit logging
✅ Unit tests with mocks
