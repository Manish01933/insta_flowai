import crypto from 'crypto';
import {
  verifyWebhookPayload,
  parseWebhookPayload,
} from './razorpayWebhookService';

jest.mock('@prisma/client');

describe('Razorpay Webhook Service', () => {
  describe('verifyWebhookPayload', () => {
    it('should verify a valid webhook signature', () => {
      const webhookSecret = 'test_webhook_secret';
      const webhookBody = '{"event":"payment.authorized","payment":{"id":"pay_123"}}';

      // Calculate expected signature
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(webhookBody)
        .digest('hex');

      const result = verifyWebhookPayload(webhookBody, expectedSignature, webhookSecret);

      expect(result).toBe(true);
    });

    it('should reject invalid webhook signature', () => {
      const webhookSecret = 'test_webhook_secret';
      const webhookBody = '{"event":"payment.authorized"}';
      const invalidSignature = 'invalid_signature_xyz';

      const result = verifyWebhookPayload(webhookBody, invalidSignature, webhookSecret);

      expect(result).toBe(false);
    });

    it('should handle Buffer webhook body', () => {
      const webhookSecret = 'test_secret';
      const webhookBody = Buffer.from('{"event":"subscription.activated"}');

      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(webhookBody)
        .digest('hex');

      const result = verifyWebhookPayload(webhookBody as any, expectedSignature, webhookSecret);

      expect(result).toBe(true);
    });

    it('should handle invalid input gracefully', () => {
      const result = verifyWebhookPayload(null as any, 'signature', 'secret');
      expect(result).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('should parse valid JSON string', () => {
      const payloadString = '{"event":"payment.authorized","id":"evt_123"}';

      const result = parseWebhookPayload(payloadString);

      expect(result.event).toBe('payment.authorized');
      expect(result.id).toBe('evt_123');
    });

    it('should parse valid Buffer', () => {
      const payloadBuffer = Buffer.from('{"event":"subscription.activated","id":"evt_456"}');

      const result = parseWebhookPayload(payloadBuffer as any);

      expect(result.event).toBe('subscription.activated');
      expect(result.id).toBe('evt_456');
    });

    it('should throw error for invalid JSON string', () => {
      const invalidPayload = '{"event": "payment.authorized" invalid}';

      expect(() => {
        parseWebhookPayload(invalidPayload);
      }).toThrow();
    });

    it('should parse complex nested payload', () => {
      const complexPayload = JSON.stringify({
        event: 'payment.authorized',
        id: 'evt_123',
        created_at: 1234567890,
        payment: {
          id: 'pay_xyz',
          amount: 99900,
          currency: 'INR',
          status: 'captured',
        },
        subscription: {
          id: 'sub_123',
          plan_id: 'plan_pro',
        },
      });

      const result = parseWebhookPayload(complexPayload);

      expect(result.event).toBe('payment.authorized');
      expect((result as any).payment.amount).toBe(99900);
      expect((result as any).subscription.plan_id).toBe('plan_pro');
    });
  });

  describe('webhook signature verification patterns', () => {
    it('should create consistent signatures for same input', () => {
      const secret = 'webhook_secret_123';
      const payload = '{"event":"test"}';

      const sig1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const sig2 = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      expect(sig1).toBe(sig2);
    });

    it('should create different signatures for different payloads', () => {
      const secret = 'webhook_secret_123';

      const sig1 = crypto.createHmac('sha256', secret).update('payload1').digest('hex');
      const sig2 = crypto.createHmac('sha256', secret).update('payload2').digest('hex');

      expect(sig1).not.toBe(sig2);
    });

    it('should create different signatures for different secrets', () => {
      const payload = '{"event":"test"}';

      const sig1 = crypto.createHmac('sha256', 'secret1').update(payload).digest('hex');
      const sig2 = crypto.createHmac('sha256', 'secret2').update(payload).digest('hex');

      expect(sig1).not.toBe(sig2);
    });
  });
});
