/**
 * Tests for GET /api/bots/:botId/conversations endpoint
 */

import request from 'supertest';
import express from 'express';

// Setup mocks before importing router
jest.mock('../services/botService', () => ({
  getBotById: jest.fn(),
}));

jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../utils/prisma', () => ({
  prisma: {
    conversation: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

// Mock the auth middleware to skip JWT validation
jest.mock('../middleware/auth', () => ({
  authenticateToken: jest.fn((req: any, _res, next) => {
    req.user = {
      id: 'test-user-123',
      email: 'test@example.com',
      subscription_tier: 'pro',
    };
    req.userId = 'test-user-123';
    next();
  }),
  AuthenticatedRequest: jest.fn(),
}));

// Mock subscription tier middleware
jest.mock('../middleware/subscriptionTierChecker', () => ({
  subscriptionTierChecker: jest.fn((_req: any, _res: any, next: any) => next()),
  attachSubscriptionTierInfo: jest.fn((_req: any, _res: any, next: any) => next()),
  enforceMaxBotsLimit: jest.fn((_req: any, _res: any, next: any) => next()),
  enforceMessageLimit: jest.fn((_req: any, _res: any, next: any) => next()),
}));

import botsRouter from './bots';
import { errorHandler } from '../middleware/errorHandler';
import { getBotById } from '../services/botService';
import { prisma } from '../utils/prisma';

const mockBot = {
  id: 'test-bot-123',
  user_id: 'test-user-123',
  name: 'Test Bot',
  whatsapp_phone_number_id: '123456789',
  webhook_url: 'https://api.example.com/webhooks/whatsapp/test-bot-123',
  webhook_verify_token: 'verify-token-123',
  system_prompt: 'You are a helpful bot',
  temperature: 0.7,
  max_tokens: 1024,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('GET /api/bots/:botId/conversations', () => {
  let app: express.Application;

    beforeAll(() => {
    app = express();
    app.use(express.json());

    app.use('/api/bots', botsRouter);
    app.use(errorHandler);

    // Setup default mocks
    (getBotById as jest.Mock).mockResolvedValue(mockBot);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset to default mocks after each test
    (getBotById as jest.Mock).mockResolvedValue(mockBot);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
  });

    it('should return conversations with default pagination', async () => {
      const conversations = [
        {
          id: 'conv-1',
          userPhoneNumber: '+91-9876543210',
          userName: 'John Doe',
          messageCount: 10,
          lastMessageAt: new Date('2024-01-15T10:30:00Z'),
          status: 'active',
          createdAt: new Date('2024-01-10T08:00:00Z'),
          updatedAt: new Date('2024-01-15T10:30:00Z'),
        },
      ];

      (prisma.conversation.count as jest.Mock).mockResolvedValue(1);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue(conversations);

      const response = await request(app).get('/api/bots/test-bot-123/conversations');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        pages: 1,
      });
    });

  it('should support custom pagination parameters', async () => {
    const conversations = Array.from({ length: 10 }, (_, i) => ({
      id: `conv-${i}`,
      userPhoneNumber: `+91-987654321${i}`,
      userName: `User ${i}`,
      messageCount: i,
      lastMessageAt: new Date(),
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    (prisma.conversation.count as jest.Mock).mockResolvedValue(50);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue(conversations);

    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ page: 2, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 50,
      pages: 5,
    });

    // Verify skip and take
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
  });

  it('should filter conversations by status', async () => {
    const activeConversations = [
      {
        id: 'conv-1',
        userPhoneNumber: '+91-9876543210',
        userName: 'John',
        messageCount: 5,
        lastMessageAt: new Date(),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    (prisma.conversation.count as jest.Mock).mockResolvedValue(1);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue(activeConversations);

    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ status: 'active' });

    expect(response.status).toBe(200);
    expect(response.body.data[0].status).toBe('active');

    // Verify status filter in where clause
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'active',
        }),
      })
    );
  });

  it('should include all required metadata fields', async () => {
    const conversations = [
      {
        id: 'conv-1',
        userPhoneNumber: '+91-9876543210',
        userName: 'John Doe',
        messageCount: 10,
        lastMessageAt: new Date('2024-01-15T10:30:00Z'),
        status: 'active',
        createdAt: new Date('2024-01-10T08:00:00Z'),
        updatedAt: new Date('2024-01-15T10:30:00Z'),
      },
    ];

    (prisma.conversation.count as jest.Mock).mockResolvedValue(1);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue(conversations);

    const response = await request(app).get('/api/bots/test-bot-123/conversations');

    expect(response.status).toBe(200);
    const conversation = response.body.data[0];

    expect(conversation).toHaveProperty('id');
    expect(conversation).toHaveProperty('userPhoneNumber');
    expect(conversation).toHaveProperty('userName');
    expect(conversation).toHaveProperty('messageCount');
    expect(conversation).toHaveProperty('lastMessageAt');
    expect(conversation).toHaveProperty('status');
    expect(conversation).toHaveProperty('createdAt');
    expect(conversation).toHaveProperty('updatedAt');
  });

  it('should return empty array when no conversations exist', async () => {
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

    const response = await request(app).get('/api/bots/test-bot-123/conversations');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  it('should return 400 for invalid pagination page', async () => {
    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ page: 0 });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_PAGINATION');
  });

  it('should return 400 for invalid pagination limit > 100', async () => {
    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ limit: 101 });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_PAGINATION');
  });

  it('should return 400 for invalid status filter', async () => {
    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ status: 'invalid-status' });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_STATUS_FILTER');
  });

  it('should accept valid status values (active, archived, closed)', async () => {
    for (const status of ['active', 'archived', 'closed']) {
      const response = await request(app)
        .get('/api/bots/test-bot-123/conversations')
        .query({ status });

      expect(response.status).toBe(200);
    }
  });

  it('should sort conversations by lastMessageAt in descending order', async () => {
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

    const response = await request(app).get('/api/bots/test-bot-123/conversations');

    expect(response.status).toBe(200);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { lastMessageAt: 'desc' },
      })
    );
  });

  it('should exclude soft-deleted conversations', async () => {
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

    const response = await request(app).get('/api/bots/test-bot-123/conversations');

    expect(response.status).toBe(200);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
        }),
      })
    );
  });

  it('should properly calculate pagination pages', async () => {
    (prisma.conversation.count as jest.Mock).mockResolvedValue(75);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        id: `conv-${i}`,
        userPhoneNumber: '+91-9876543210',
        userName: 'User',
        messageCount: i,
        lastMessageAt: new Date(),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    const response = await request(app)
      .get('/api/bots/test-bot-123/conversations')
      .query({ limit: 25 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 25,
      total: 75,
      pages: 3, // ceil(75 / 25)
    });
  });
});
