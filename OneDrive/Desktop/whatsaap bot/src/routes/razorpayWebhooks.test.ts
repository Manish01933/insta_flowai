/**
 * Tests for Razorpay Webhook Routes
 */

import request from 'supertest';
import express, { Express } from 'express';
import crypto from 'crypto';
import webhookRoutes from './webhooks';
import * as razorpayWebhookService from '../services/razorpayWebhookService';

// Mock the services
jest.mock('../services/razorpayWebhookService');
jest.mock('../services/webhookService');
jest.mock('../services/statusUpdateWebhookService');

// Mock logger
jest.mock('../config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Razorpay Webhook Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/webhooks', webhookRoutes);
    jest.clearAllMocks();
  });

  describe('POST /api/webhooks/razorpay', () => {
    it('should accept valid webhook with correct signature', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_123',
            amount: 99900,
            method: 'card',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);
      (razorpayWebhookService.processWebhookEvent as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('received');
      expect(response.body.eventId).toBe('evt_123');
    });

    it('should reject webhook without signature header', async () => {
      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_123',
          },
        },
      };

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('MISSING_SIGNATURE');
    });

    it('should reject webhook with invalid signature', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        payload: {
          payment: {
            id: 'pay_123',
          },
        },
      };

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(false);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', 'invalid_signature')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('should reject webhook with invalid JSON', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      const body = 'invalid json {';
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(body);

      expect(response.status).toBe(400);
    });

    it('should reject webhook with invalid payload structure', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        // Missing required 'event' field
        created_at: Math.floor(Date.now() / 1000),
        payload: {},
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('INVALID_PAYLOAD_STRUCTURE');
    });

    it('should return 200 immediately even if event processing fails', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_123',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);
      (razorpayWebhookService.processWebhookEvent as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      // Should still return 200 because response was already sent
      expect(response.status).toBe(200);
    });

    it('should handle payment.authorized event', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_123',
            amount: 99900,
            method: 'card',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);
      (razorpayWebhookService.processWebhookEvent as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(razorpayWebhookService.processWebhookEvent).toHaveBeenCalledWith(payload);
    });

    it('should handle subscription.activated event', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_125',
        event: 'subscription.activated',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['subscription'],
        payload: {
          subscription: {
            id: 'sub_Ew4r7kTc1j9FNE',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);
      (razorpayWebhookService.processWebhookEvent as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(razorpayWebhookService.processWebhookEvent).toHaveBeenCalledWith(payload);
    });

    it('should include requestId in response', async () => {
      const webhookSecret = 'test_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payload = {
        id: 'evt_123',
        event: 'payment.authorized',
        created_at: Math.floor(Date.now() / 1000),
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_123',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

      (razorpayWebhookService.verifyWebhookPayload as jest.Mock).mockReturnValue(true);
      (razorpayWebhookService.parseWebhookPayload as jest.Mock).mockReturnValue(payload);
      (razorpayWebhookService.processWebhookEvent as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('X-Razorpay-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.body.requestId).toBeDefined();
    });
  });
});
