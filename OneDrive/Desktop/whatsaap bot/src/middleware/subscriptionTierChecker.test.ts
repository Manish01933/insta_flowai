/**
 * Tests for Subscription Tier Checker Middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import {
  subscriptionTierChecker,
  enforceMaxBotsLimit,
  enforceMessageLimit,
  attachSubscriptionTierInfo,
  AuthenticatedRequest,
} from './subscriptionTierChecker';
import SubscriptionTierService, {
  SubscriptionLimitError,
  SUBSCRIPTION_TIER_CONFIGS,
} from '../services/subscriptionTierService';
import { prisma } from '../utils/prisma';

// Mock only the service's methods, but keep the real classes/constants.
jest.mock('../services/subscriptionTierService', () => {
  const actual = jest.requireActual('../services/subscriptionTierService') as any;
  const serviceMock = {
    getUserTierConfig: jest.fn(),
    getCurrentBotCount: jest.fn(),
    getCurrentMonthlyMessageCount: jest.fn(),
    checkBotCreationAllowed: jest.fn(),
    checkMessageSendingAllowed: jest.fn(),
    getSubscriptionTierDetails: jest.fn(),
    logTierViolation: jest.fn(),
  };
  return {
    __esModule: true,
    ...actual,
    SubscriptionTierService: serviceMock,
    default: serviceMock,
  };
});

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

describe('Subscription Tier Checker Middleware', () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any;

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    } as any;

    next = jest.fn();

    jest.clearAllMocks();
  });

  describe('subscriptionTierChecker middleware', () => {
    it('should attach subscription tier info to request', async () => {
      const tierConfig = SUBSCRIPTION_TIER_CONFIGS.free;

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        subscriptionEndDate: null,
      });

      (SubscriptionTierService.getUserTierConfig as any).mockResolvedValueOnce(
        tierConfig
      );
      (SubscriptionTierService.getCurrentBotCount as any).mockResolvedValueOnce(0);
      (SubscriptionTierService.getCurrentMonthlyMessageCount as any).mockResolvedValueOnce(
        500
      );

      await subscriptionTierChecker(req as Request, res as Response, next);

      expect((req as AuthenticatedRequest).subscriptionTier).toBeDefined();
      expect((req as AuthenticatedRequest).subscriptionTier?.tier).toBe('free');
      expect((req as AuthenticatedRequest).subscriptionTier?.config).toEqual(tierConfig);
      expect(next).toHaveBeenCalled();
    });

    it('should set grace period header for expired subscriptions within grace period', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'pro',
        subscriptionStatus: 'inactive',
        subscriptionEndDate: expiredDate,
      });

      (SubscriptionTierService.getUserTierConfig as any).mockResolvedValueOnce(
        SUBSCRIPTION_TIER_CONFIGS.pro
      );
      (SubscriptionTierService.getCurrentBotCount as any).mockResolvedValueOnce(2);
      (SubscriptionTierService.getCurrentMonthlyMessageCount as any).mockResolvedValueOnce(
        5000
      );

      await subscriptionTierChecker(req as Request, res as Response, next);

      expect(res.set).toHaveBeenCalledWith('X-Subscription-Grace-Period', 'true');
      expect(res.set).toHaveBeenCalledWith(
        'X-Subscription-Expires',
        expiredDate.toISOString()
      );
      expect(next).toHaveBeenCalled();
    });

    it('should set expired header for expired subscriptions after grace period', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'pro',
        subscriptionStatus: 'inactive',
        subscriptionEndDate: expiredDate,
      });

      (SubscriptionTierService.getUserTierConfig as any).mockResolvedValueOnce(
        SUBSCRIPTION_TIER_CONFIGS.free
      );
      (SubscriptionTierService.getCurrentBotCount as any).mockResolvedValueOnce(1);
      (SubscriptionTierService.getCurrentMonthlyMessageCount as any).mockResolvedValueOnce(
        100
      );

      await subscriptionTierChecker(req as Request, res as Response, next);

      expect(res.set).toHaveBeenCalledWith('X-Subscription-Expired', 'true');
      expect(next).toHaveBeenCalled();
    });

    it('should call next if user is not authenticated', async () => {
      req.user = undefined;

      await subscriptionTierChecker(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully and still call next', async () => {
      (prisma.user.findUnique as any).mockRejectedValueOnce(
        new Error('Database error')
      );

      await subscriptionTierChecker(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('enforceMaxBotsLimit middleware', () => {
    it('should call next if bot creation is allowed', async () => {
      (SubscriptionTierService.checkBotCreationAllowed as any).mockResolvedValueOnce(
        undefined
      );

      await enforceMaxBotsLimit(req as Request, res as Response, next);

      expect(SubscriptionTierService.checkBotCreationAllowed).toHaveBeenCalledWith(
        'test-user-id'
      );
      expect(next).toHaveBeenCalled();
    });

    it('should return 402 error if bot limit exceeded', async () => {
      const error = new SubscriptionLimitError(
        'Bot limit exceeded',
        'max_bots',
        1,
        1
      );

      (SubscriptionTierService.checkBotCreationAllowed as any).mockRejectedValueOnce(
        error
      );
      (SubscriptionTierService.logTierViolation as any).mockResolvedValueOnce(
        undefined
      );

      await enforceMaxBotsLimit(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          errorCode: 'TIER_LIMIT_EXCEEDED',
          tier_limit: 'max_bots',
          current_value: 1,
          limit: 1,
          statusCode: 402,
        })
      );
      expect(SubscriptionTierService.logTierViolation).toHaveBeenCalled();
    });

    it('should call next for non-SubscriptionLimitError errors', async () => {
      const error = new Error('Other error');

      (SubscriptionTierService.checkBotCreationAllowed as any).mockRejectedValueOnce(
        error
      );

      await enforceMaxBotsLimit(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('should skip if user is not authenticated', async () => {
      req.user = undefined;

      await enforceMaxBotsLimit(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(SubscriptionTierService.checkBotCreationAllowed).not.toHaveBeenCalled();
    });
  });

  describe('enforceMessageLimit middleware', () => {
    it('should call next if message sending is allowed', async () => {
      (SubscriptionTierService.checkMessageSendingAllowed as any).mockResolvedValueOnce(
        undefined
      );

      await enforceMessageLimit(req as Request, res as Response, next);

      expect(SubscriptionTierService.checkMessageSendingAllowed).toHaveBeenCalledWith(
        'test-user-id'
      );
      expect(next).toHaveBeenCalled();
    });

    it('should return 402 error if message limit exceeded', async () => {
      const error = new SubscriptionLimitError(
        'Message limit exceeded',
        'messages_per_month',
        1000,
        1000
      );

      (SubscriptionTierService.checkMessageSendingAllowed as any).mockRejectedValueOnce(
        error
      );
      (SubscriptionTierService.logTierViolation as any).mockResolvedValueOnce(
        undefined
      );

      await enforceMessageLimit(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          errorCode: 'TIER_LIMIT_EXCEEDED',
          tier_limit: 'messages_per_month',
          current_value: 1000,
          limit: 1000,
        })
      );
      expect(SubscriptionTierService.logTierViolation).toHaveBeenCalled();
    });
  });

  describe('attachSubscriptionTierInfo middleware', () => {
    it('should attach subscription tier info to request', async () => {
      const tierDetails = {
        tier: 'pro',
        status: 'active',
        config: SUBSCRIPTION_TIER_CONFIGS.pro,
        currentBots: 3,
        maxBots: 10,
        currentMessages: 50000,
        maxMessages: 100000,
        subscriptionEndDate: null,
      };

      (SubscriptionTierService.getSubscriptionTierDetails as any).mockResolvedValueOnce(
        tierDetails
      );

      await attachSubscriptionTierInfo(req as Request, res as Response, next);

      expect((req as AuthenticatedRequest).subscriptionTier).toEqual({
        tier: 'pro',
        status: 'active',
        config: SUBSCRIPTION_TIER_CONFIGS.pro,
        currentBots: 3,
        currentMessages: 50000,
        subscriptionEndDate: null,
      });
      expect(next).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (SubscriptionTierService.getSubscriptionTierDetails as any).mockRejectedValueOnce(
        new Error('Service error')
      );

      await attachSubscriptionTierInfo(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
