/**
 * Tests for SubscriptionTierService
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import SubscriptionTierService, {
  SubscriptionLimitError,
  SUBSCRIPTION_TIER_CONFIGS,
} from './subscriptionTierService';
import { prisma } from '../utils/prisma';

// Mock Prisma
jest.mock('../utils/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    bot: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    message: {
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

describe('SubscriptionTierService', () => {
  const testUserId = 'test-user-id';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserTierConfig', () => {
    it('should return free tier config for free subscription', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });

      const config = await SubscriptionTierService.getUserTierConfig(testUserId);

      expect(config).toEqual(SUBSCRIPTION_TIER_CONFIGS.free);
      expect(config.maxBots).toBe(1);
      expect(config.messagesPerMonth).toBe(1000);
      expect(config.aiModel).toBe('claude-3-haiku');
    });

    it('should return pro tier config for pro subscription', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });

      const config = await SubscriptionTierService.getUserTierConfig(testUserId);

      expect(config).toEqual(SUBSCRIPTION_TIER_CONFIGS.pro);
      expect(config.maxBots).toBe(10);
      expect(config.messagesPerMonth).toBe(100000);
      expect(config.aiModel).toBe('claude-3-sonnet');
    });

    it('should return enterprise tier config for enterprise subscription', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'enterprise',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });

      const config = await SubscriptionTierService.getUserTierConfig(testUserId);

      expect(config).toEqual(SUBSCRIPTION_TIER_CONFIGS.enterprise);
      expect(config.maxBots).toBe(50);
      expect(config.messagesPerMonth).toBe(1000000);
      expect(config.aiModel).toBe('claude-3-opus');
    });

    it('should handle expired subscription with active grace period', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'pro',
        subscriptionStatus: 'inactive',
        subscriptionEndDate: expiredDate,
      });

      const config = await SubscriptionTierService.getUserTierConfig(testUserId);

      // Should still return pro tier config during grace period
      expect(config).toEqual(SUBSCRIPTION_TIER_CONFIGS.pro);
    });

    it('should fall back to free tier after grace period expires', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'pro',
        subscriptionStatus: 'inactive',
        subscriptionEndDate: expiredDate,
      });

      const config = await SubscriptionTierService.getUserTierConfig(testUserId);

      // Should fall back to free tier after grace period
      expect(config).toEqual(SUBSCRIPTION_TIER_CONFIGS.free);
    });
  });

  describe('getCurrentBotCount', () => {
    it('should return the number of active bots for user', async () => {
      (prisma.bot.count as any).mockResolvedValueOnce(3);

      const count = await SubscriptionTierService.getCurrentBotCount(testUserId);

      expect(count).toBe(3);
      expect(prisma.bot.count).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          deletedAt: null,
          isActive: true,
        },
      });
    });

    it('should return 0 if user has no bots', async () => {
      (prisma.bot.count as any).mockResolvedValueOnce(0);

      const count = await SubscriptionTierService.getCurrentBotCount(testUserId);

      expect(count).toBe(0);
    });
  });

  describe('getCurrentMonthlyMessageCount', () => {
    it('should return the number of messages sent in current month', async () => {
      (prisma.bot.findMany as any).mockResolvedValueOnce([
        { id: 'bot-1' },
        { id: 'bot-2' },
      ]);
      (prisma.message.count as any).mockResolvedValueOnce(1500);

      const count = await SubscriptionTierService.getCurrentMonthlyMessageCount(
        testUserId
      );

      expect(count).toBe(1500);
      expect(prisma.message.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            botId: { in: ['bot-1', 'bot-2'] },
            senderType: 'bot',
            status: 'sent',
          }),
        })
      );
    });

    it('should return 0 if user has no bots', async () => {
      (prisma.bot.findMany as any).mockResolvedValueOnce([]);

      const count = await SubscriptionTierService.getCurrentMonthlyMessageCount(
        testUserId
      );

      expect(count).toBe(0);
    });
  });

  describe('checkBotCreationAllowed', () => {
    it('should allow bot creation if under limit', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });
      (prisma.bot.count as any).mockResolvedValueOnce(0);

      // Should not throw
      await expect(
        SubscriptionTierService.checkBotCreationAllowed(testUserId)
      ).resolves.toBeUndefined();
    });

    it('should throw SubscriptionLimitError if at bot limit', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });
      (prisma.bot.count as any).mockResolvedValueOnce(1); // At limit for free tier

      await expect(
        SubscriptionTierService.checkBotCreationAllowed(testUserId)
      ).rejects.toThrow(SubscriptionLimitError);

      const error = new SubscriptionLimitError(
        'Test',
        'max_bots',
        1,
        1
      );
      expect(error.statusCode).toBe(402);
      expect(error.errorCode).toBe('TIER_LIMIT_EXCEEDED');
    });

    it('should allow bot creation for pro tier with higher limit', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });
      (prisma.bot.count as any).mockResolvedValueOnce(5);

      // Should not throw - pro tier allows 10 bots
      await expect(
        SubscriptionTierService.checkBotCreationAllowed(testUserId)
      ).resolves.toBeUndefined();
    });
  });

  describe('checkMessageSendingAllowed', () => {
    it('should allow message sending if under limit', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });
      (prisma.bot.findMany as any).mockResolvedValueOnce([{ id: 'bot-1' }]);
      (prisma.message.count as any).mockResolvedValueOnce(500); // Under 1000 limit

      await expect(
        SubscriptionTierService.checkMessageSendingAllowed(testUserId)
      ).resolves.toBeUndefined();
    });

    it('should throw SubscriptionLimitError if at message limit', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: testUserId,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });
      (prisma.bot.findMany as any).mockResolvedValueOnce([{ id: 'bot-1' }]);
      (prisma.message.count as any).mockResolvedValueOnce(1000); // At limit for free tier

      await expect(
        SubscriptionTierService.checkMessageSendingAllowed(testUserId)
      ).rejects.toThrow(SubscriptionLimitError);
    });
  });

    describe('getSubscriptionTierDetails', () => {
    it('should return complete subscription tier details', async () => {
      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({
          id: testUserId,
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          subscriptionEndDate: new Date('2025-12-31'),
        })
        .mockResolvedValueOnce({
          id: testUserId,
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          subscriptionEndDate: new Date('2025-12-31'),
        });
      (prisma.bot.count as any).mockResolvedValueOnce(5);
      (prisma.bot.findMany as any).mockResolvedValueOnce([
        { id: 'bot-1' },
        { id: 'bot-2' },
        { id: 'bot-3' },
        { id: 'bot-4' },
        { id: 'bot-5' },
      ]);
      (prisma.message.count as any).mockResolvedValueOnce(50000);

      const details = await SubscriptionTierService.getSubscriptionTierDetails(
        testUserId
      );

      expect(details.tier).toBe('pro');
      expect(details.status).toBe('active');
      expect(details.currentBots).toBe(5);
      expect(details.maxBots).toBe(10);
      expect(details.currentMessages).toBe(50000);
      expect(details.maxMessages).toBe(100000);
      expect(details.config).toEqual(SUBSCRIPTION_TIER_CONFIGS.pro);
    });
  });

  describe('logTierViolation', () => {
    it('should log tier violation to audit logs', async () => {
      await SubscriptionTierService.logTierViolation(
        testUserId,
        'BOT_LIMIT_EXCEEDED',
        {
          tierLimit: 'max_bots',
          currentValue: 1,
          limit: 1,
        }
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          action: 'SUBSCRIPTION_TIER_VIOLATION',
          resourceType: 'subscription',
          changes: {
            violationType: 'BOT_LIMIT_EXCEEDED',
            tierLimit: 'max_bots',
            currentValue: 1,
            limit: 1,
          },
        },
      });
    });
  });
});

