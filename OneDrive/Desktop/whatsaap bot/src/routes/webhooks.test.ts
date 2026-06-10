/**
 * Integration tests for webhook routes
 */

import crypto from 'crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { verifyWebhookSignature, extractMessages } from '../services/webhookService';
import app from '../index';

const prisma = new PrismaClient();

describe('Webhook Routes', () => {
  // Store test bot ID for use in tests
  let testBotId: string;
  let testUserId: string;
  let testBot: any;

  // Setup: Create test bot before all tests
  beforeAll(async () => {
    try {
      // Create a test user
      const user = await prisma.user.create({
        data: {
          email: `webhook-test-${Date.now()}@example.com`,
          passwordHash: 'hashed_password',
          firstName: 'Test',
          lastName: 'User',
        },
      });
      testUserId = user.id;

      // Create a test bot
      const bot = await prisma.bot.create({
        data: {
          userId: user.id,
          name: 'Webhook Test Bot',
          description: 'Bot for webhook testing',
          whatsappPhoneNumberId: '1234567890',
          webhookVerifyToken: 'test_verify_token_12345',
          systemPrompt: 'You are a helpful assistant',
          temperature: 0.7,
          maxTokens: 1024,
          isActive: true,
        },
      });
      testBotId = bot.id;
      testBot = bot;
    } catch (error) {
      console.error('Setup error:', error);
      throw error;
    }
  });

  // Cleanup: Delete test data after all tests
  afterAll(async () => {
    try {
      if (testBotId) {
        // Delete conversations and messages first (cascade delete)
        await prisma.message.deleteMany({
          where: { botId: testBotId },
        });
        await prisma.conversation.deleteMany({
          where: { botId: testBotId },
        });

        // Delete bot
        await prisma.bot.delete({
          where: { id: testBotId },
        });
      }

      if (testUserId) {
        // Delete user
        await prisma.user.delete({
          where: { id: testUserId },
        });
      }

      await prisma.$disconnect();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('Webhook signature verification and message extraction', () => {
    it('should verify valid webhook signature and extract messages', () => {
      const secret = 'test_webhook_secret';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      // Verify signature
      const isValid = verifyWebhookSignature(body, signature, secret);
      expect(isValid).toBe(true);

      // Extract messages
      const messages = extractMessages(payload, 'test-bot-id');
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello');
    });

    it('should reject invalid webhook signature', () => {
      const secret = 'test_webhook_secret';
      const payload = { entry: [] };
      const body = JSON.stringify(payload);

      const isValid = verifyWebhookSignature(
        body,
        'sha256=invalid_hash',
        secret
      );
      expect(isValid).toBe(false);
    });

    it('should handle multiple message types', () => {
      const botId = 'test-bot-id';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.1',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Text message' },
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.2',
                      timestamp: '1671234568',
                      type: 'image',
                      image: { id: 'img_123', mime_type: 'image/jpeg' },
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.3',
                      timestamp: '1671234569',
                      type: 'document',
                      document: {
                        id: 'doc_123',
                        mime_type: 'application/pdf',
                        filename: 'file.pdf',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);
      expect(messages).toHaveLength(3);
      expect(messages[0].type).toBe('text');
      expect(messages[1].type).toBe('image');
      expect(messages[2].type).toBe('document');
    });

    it('should skip invalid messages', () => {
      const botId = 'test-bot-id';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.1',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Valid message' },
                    },
                    {
                      // Missing 'from' field
                      id: 'wamid.2',
                      timestamp: '1671234568',
                      type: 'text',
                      text: { body: 'Invalid message' },
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.3',
                      timestamp: '1671234569',
                      type: 'text',
                      text: { body: 'Another valid message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);
      expect(messages).toHaveLength(2);
      expect(messages[0].messageId).toBe('wamid.1');
      expect(messages[1].messageId).toBe('wamid.3');
    });

    it('should handle webhook payload with no messages', () => {
      const botId = 'test-bot-id';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'status', // Not 'messages'
                value: {},
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);
      expect(messages).toHaveLength(0);
    });

    it('should handle empty webhook payload', () => {
      const botId = 'test-bot-id';
      const payload = {};

      const messages = extractMessages(payload, botId);
      expect(messages).toHaveLength(0);
    });

    it('should use default mime types for media without mime_type', () => {
      const botId = 'test-bot-id';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.1',
                      timestamp: '1671234567',
                      type: 'image',
                      image: { id: 'img_123' }, // No mime_type
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.2',
                      timestamp: '1671234568',
                      type: 'audio',
                      audio: { id: 'audio_123' }, // No mime_type
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.3',
                      timestamp: '1671234569',
                      type: 'video',
                      video: { id: 'video_123' }, // No mime_type
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);
      expect(messages).toHaveLength(3);
      expect(messages[0].mediaType).toBe('image/jpeg');
      expect(messages[1].mediaType).toBe('audio/ogg');
      expect(messages[2].mediaType).toBe('video/mp4');
    });

    it('should handle signature with different algorithms', () => {
      const secret = 'test_webhook_secret';
      const body = '{"test": "data"}';

      // SHA256 should work
      const hash256 = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      expect(verifyWebhookSignature(body, `sha256=${hash256}`, secret)).toBe(
        true
      );

      // SHA1 should not work
      expect(verifyWebhookSignature(body, `sha1=${hash256}`, secret)).toBe(
        false
      );
    });

    it('should handle timing-safe comparison for signatures', () => {
      const secret = 'test_webhook_secret';
      const body = '{"test": "data"}';

      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      // Correct signature
      expect(verifyWebhookSignature(body, `sha256=${hash}`, secret)).toBe(true);

      // Wrong signature (even by one character)
      const wrongHash = hash.substring(0, hash.length - 1) + 'x';
      expect(verifyWebhookSignature(body, `sha256=${wrongHash}`, secret)).toBe(
        false
      );
    });
  });

  describe('POST /api/webhooks/whatsapp/:botId - Integration Tests', () => {
    it('should return 200 OK for valid webhook with valid signature', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid.${Date.now()}`,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'text',
                      text: { body: 'Test message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'received');
      expect(response.body).toHaveProperty('requestId');
    });

    it('should return 400 for missing webhook signature header', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Test message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.errorCode).toBe('MISSING_SIGNATURE');
    });

    it('should return 400 for invalid webhook signature', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Test message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', 'sha256=invalid_signature_hash')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('should return 400 for non-existent bot', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Test message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/non-existent-bot-id`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('BOT_NOT_FOUND');
    });

    it('should handle invalid JSON payload', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const invalidBody = 'this is not valid json';
      const hash = crypto
        .createHmac('sha256', secret)
        .update(invalidBody)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(invalidBody);

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('INVALID_JSON');
    });

    it('should extract and queue multiple messages from single webhook', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid.${Date.now()}.1`,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'text',
                      text: { body: 'First message' },
                    },
                    {
                      from: '919876543210',
                      id: `wamid.${Date.now()}.2`,
                      timestamp: (Math.floor(Date.now() / 1000) + 1).toString(),
                      type: 'text',
                      text: { body: 'Second message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('received');
    });

    it('should handle messages with media attachments', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid.${Date.now()}`,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'image',
                      image: {
                        id: 'img_12345',
                        mime_type: 'image/jpeg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('received');
    });

    it('should handle empty messages array in webhook payload', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('received');
    });

    it('should handle webhook payload with no message field', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'status',
                value: {
                  // This is a status update, not a message
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('received');
    });

    it('should return request ID in response', async () => {
      const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid.${Date.now()}`,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      type: 'text',
                      text: { body: 'Test' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const response = await request(app)
        .post(`/api/webhooks/whatsapp/${testBotId}`)
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      expect(typeof response.body.requestId).toBe('string');
    });
  });

  describe('GET /api/webhooks/whatsapp/:botId - Webhook Verification', () => {
    it('should return challenge for valid verification request', async () => {
      const challenge = 'test_challenge_123';
      const verifyToken = testBot.webhookVerifyToken;

      const response = await request(app)
        .get(`/api/webhooks/whatsapp/${testBotId}`)
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': challenge,
          'hub.verify_token': verifyToken,
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe(challenge);
    });

    it('should return 403 for invalid verify token', async () => {
      const challenge = 'test_challenge_123';

      const response = await request(app)
        .get(`/api/webhooks/whatsapp/${testBotId}`)
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': challenge,
          'hub.verify_token': 'invalid_token',
        });

      expect(response.status).toBe(403);
      expect(response.body.errorCode).toBe('VERIFICATION_FAILED');
    });

    it('should return 403 for invalid mode', async () => {
      const challenge = 'test_challenge_123';
      const verifyToken = testBot.webhookVerifyToken;

      const response = await request(app)
        .get(`/api/webhooks/whatsapp/${testBotId}`)
        .query({
          'hub.mode': 'invalid_mode',
          'hub.challenge': challenge,
          'hub.verify_token': verifyToken,
        });

      expect(response.status).toBe(403);
      expect(response.body.errorCode).toBe('VERIFICATION_FAILED');
    });

    it('should return 400 for non-existent bot', async () => {
      const challenge = 'test_challenge_123';

      const response = await request(app)
        .get(`/api/webhooks/whatsapp/non-existent-bot-id`)
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': challenge,
          'hub.verify_token': 'some_token',
        });

      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('BOT_NOT_FOUND');
    });
  });
});
