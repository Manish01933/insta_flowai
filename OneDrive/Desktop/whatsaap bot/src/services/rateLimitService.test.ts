/**
 * Tests for Rate Limit Service
 * Tests subscription tier-based rate limiting and monthly quota tracking
 */

import { RateLimitService, SUBSCRIPTION_LIMITS, WHATSAPP_API_RATE_LIMIT } from './rateLimitService';
import { RateLimitError } from '../utils/errors';

// Mock dependencies
jest.mock('../config/redis', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    message: {
      count: jest.fn(),
    },
  },
}));

import { getRedisClient } from '../config/redis';
import { prisma } from '../utils/prisma';

describe('RateLimitService', () => {
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      del: jest.fn(),
    };
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
  });

  describe('checkMonthlyQuota', () => {
    it('should allow messages within free tier limit', async () => {
      const userId = 'user-123';
      const now = new Date();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(50); // 50 messages sent

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50); // 100 - 50
      expect(result.limit).toBe(100);
      expect(result.resetTime).toEqual(monthEnd);
    });

    it('should deny messages exceeding free tier limit', async () => {
      const userId = 'user-123';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(100); // At limit

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(100);
    });

    it('should allow messages within starter tier limit', async () => {
      const userId = 'user-456';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'starter',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(500); // 500 messages sent

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(500); // 1000 - 500
      expect(result.limit).toBe(1000);
    });

    it('should allow messages within growth tier limit', async () => {
      const userId = 'user-789';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'growth',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(5000); // 5000 messages sent

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5000); // 10000 - 5000
      expect(result.limit).toBe(10000);
    });

    it('should allow messages within agency tier limit', async () => {
      const userId = 'user-agency';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'agency',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(50000); // 50000 messages sent

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50000); // 100000 - 50000
      expect(result.limit).toBe(100000);
    });

    it('should handle missing user gracefully', async () => {
      const userId = 'nonexistent-user';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const result = await RateLimitService.checkMonthlyQuota(userId);

      // Should allow request if check fails
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should handle case-insensitive subscription tier', async () => {
      const userId = 'user-case';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'STARTER', // Uppercase
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(500);

      const result = await RateLimitService.checkMonthlyQuota(userId);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1000); // Starter tier limit
    });
  });

  describe('checkWhatsAppRateLimit', () => {
    it('should allow requests within WhatsApp rate limit', async () => {
      const botId = 'bot-123';
      mockRedis.incr.mockResolvedValueOnce(40); // 40 requests
      mockRedis.ttl.mockResolvedValueOnce(1); // 1 second remaining

      const result = await RateLimitService.checkWhatsAppRateLimit(botId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(40); // 80 - 40
      expect(result.limit).toBe(WHATSAPP_API_RATE_LIMIT);
      expect(result.retryAfter).toBeUndefined();
    });

    it('should deny requests exceeding WhatsApp rate limit', async () => {
      const botId = 'bot-456';
      mockRedis.incr.mockResolvedValueOnce(81); // 81 requests (exceeds 80)
      mockRedis.ttl.mockResolvedValueOnce(1);

      const result = await RateLimitService.checkWhatsAppRateLimit(botId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(WHATSAPP_API_RATE_LIMIT);
      expect(result.retryAfter).toBe(1);
    });

    it('should set expiry on first request', async () => {
      const botId = 'bot-789';
      mockRedis.incr.mockResolvedValueOnce(1); // First request
      mockRedis.ttl.mockResolvedValueOnce(1);

      await RateLimitService.checkWhatsAppRateLimit(botId);

      expect(mockRedis.expire).toHaveBeenCalledWith(`whatsapp_rate_limit:${botId}`, 1);
    });

    it('should handle Redis errors gracefully', async () => {
      const botId = 'bot-error';
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await RateLimitService.checkWhatsAppRateLimit(botId);

      // Should allow request if check fails
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });
  });

  describe('checkUserTierRateLimit', () => {
    it('should allow requests within free tier per-second limit', async () => {
      const userId = 'user-free';
      mockRedis.incr.mockResolvedValueOnce(1); // 1 request
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
      });

      const result = await RateLimitService.checkUserTierRateLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 1 - 1
      expect(result.limit).toBe(1); // Free tier: 1 req/sec
    });

    it('should deny requests exceeding free tier per-second limit', async () => {
      const userId = 'user-free-exceeded';
      mockRedis.incr.mockResolvedValueOnce(2); // 2 requests (exceeds 1)
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
      });

      const result = await RateLimitService.checkUserTierRateLimit(userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(1);
      expect(result.retryAfter).toBe(1);
    });

    it('should allow requests within starter tier per-second limit', async () => {
      const userId = 'user-starter';
      mockRedis.incr.mockResolvedValueOnce(5); // 5 requests
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'starter',
      });

      const result = await RateLimitService.checkUserTierRateLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 5 - 5
      expect(result.limit).toBe(5); // Starter tier: 5 req/sec
    });

    it('should allow requests within growth tier per-second limit', async () => {
      const userId = 'user-growth';
      mockRedis.incr.mockResolvedValueOnce(20); // 20 requests
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'growth',
      });

      const result = await RateLimitService.checkUserTierRateLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 20 - 20
      expect(result.limit).toBe(20); // Growth tier: 20 req/sec
    });

    it('should allow requests within agency tier per-second limit', async () => {
      const userId = 'user-agency';
      mockRedis.incr.mockResolvedValueOnce(80); // 80 requests
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'agency',
      });

      const result = await RateLimitService.checkUserTierRateLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 80 - 80
      expect(result.limit).toBe(80); // Agency tier: 80 req/sec
    });
  });

  describe('enforceMonthlyQuota', () => {
    it('should throw error when monthly quota exceeded', async () => {
      const userId = 'user-exceeded';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(100); // At limit

      await expect(RateLimitService.enforceMonthlyQuota(userId)).rejects.toThrow(
        RateLimitError
      );
    });

    it('should not throw error when within quota', async () => {
      const userId = 'user-within';

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
        subscriptionStartDate: new Date(),
      });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(50); // Within limit

      await expect(RateLimitService.enforceMonthlyQuota(userId)).resolves.toBeUndefined();
    });
  });

  describe('enforceWhatsAppRateLimit', () => {
    it('should throw error when WhatsApp rate limit exceeded', async () => {
      const botId = 'bot-exceeded';
      mockRedis.incr.mockResolvedValueOnce(81); // Exceeds 80
      mockRedis.ttl.mockResolvedValueOnce(1);

      await expect(RateLimitService.enforceWhatsAppRateLimit(botId)).rejects.toThrow(
        RateLimitError
      );
    });

    it('should not throw error when within rate limit', async () => {
      const botId = 'bot-within';
      mockRedis.incr.mockResolvedValueOnce(40); // Within 80
      mockRedis.ttl.mockResolvedValueOnce(1);

      await expect(RateLimitService.enforceWhatsAppRateLimit(botId)).resolves.toBeUndefined();
    });
  });

  describe('enforceUserTierRateLimit', () => {
    it('should throw error when user tier rate limit exceeded', async () => {
      const userId = 'user-exceeded';
      mockRedis.incr.mockResolvedValueOnce(2); // Exceeds free tier limit of 1
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
      });

      await expect(RateLimitService.enforceUserTierRateLimit(userId)).rejects.toThrow(
        RateLimitError
      );
    });

    it('should not throw error when within user tier rate limit', async () => {
      const userId = 'user-within';
      mockRedis.incr.mockResolvedValueOnce(1); // Within free tier limit of 1
      mockRedis.ttl.mockResolvedValueOnce(1);

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: userId,
        subscriptionTier: 'free',
      });

      await expect(RateLimitService.enforceUserTierRateLimit(userId)).resolves.toBeUndefined();
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return combined rate limit status', async () => {
      const userId = 'user-status';

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: userId,
          subscriptionTier: 'starter',
          subscriptionStartDate: new Date(),
        })
        .mockResolvedValueOnce({
          id: userId,
          subscriptionTier: 'starter',
        });

      (prisma.message.count as jest.Mock).mockResolvedValueOnce(500); // 500 of 1000
      mockRedis.incr.mockResolvedValueOnce(3); // 3 of 5 req/sec
      mockRedis.ttl.mockResolvedValueOnce(1);

      const status = await RateLimitService.getRateLimitStatus(userId);

      expect(status.monthlyQuota.limit).toBe(1000);
      expect(status.monthlyQuota.remaining).toBe(500);
      expect(status.monthlyQuota.allowed).toBe(true);

      expect(status.userTierRateLimit.limit).toBe(5);
      expect(status.userTierRateLimit.remaining).toBe(2);
      expect(status.userTierRateLimit.allowed).toBe(true);
    });
  });

  describe('resetUserRateLimits', () => {
    it('should reset user rate limit counters', async () => {
      const userId = 'user-reset';

      await RateLimitService.resetUserRateLimits(userId);

      expect(mockRedis.del).toHaveBeenCalledWith(`user_rate_limit:${userId}`);
    });
  });

  describe('resetBotRateLimits', () => {
    it('should reset bot rate limit counters', async () => {
      const botId = 'bot-reset';

      await RateLimitService.resetBotRateLimits(botId);

      expect(mockRedis.del).toHaveBeenCalledWith(`whatsapp_rate_limit:${botId}`);
    });
  });

  describe('SUBSCRIPTION_LIMITS', () => {
    it('should have correct free tier limits', () => {
      expect(SUBSCRIPTION_LIMITS.free.messagesPerMonth).toBe(100);
      expect(SUBSCRIPTION_LIMITS.free.requestsPerSecond).toBe(1);
    });

    it('should have correct starter tier limits', () => {
      expect(SUBSCRIPTION_LIMITS.starter.messagesPerMonth).toBe(1000);
      expect(SUBSCRIPTION_LIMITS.starter.requestsPerSecond).toBe(5);
    });

    it('should have correct growth tier limits', () => {
      expect(SUBSCRIPTION_LIMITS.growth.messagesPerMonth).toBe(10000);
      expect(SUBSCRIPTION_LIMITS.growth.requestsPerSecond).toBe(20);
    });

    it('should have correct agency tier limits', () => {
      expect(SUBSCRIPTION_LIMITS.agency.messagesPerMonth).toBe(100000);
      expect(SUBSCRIPTION_LIMITS.agency.requestsPerSecond).toBe(80);
    });
  });

  describe('WHATSAPP_API_RATE_LIMIT', () => {
    it('should be set to 80 requests per second', () => {
      expect(WHATSAPP_API_RATE_LIMIT).toBe(80);
    });
  });
});
