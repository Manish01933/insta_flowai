/**
 * Tests for Message Queue Worker
 * Tests message processing with Claude API integration and rate limiting enforcement
 */

// Setup all mocks BEFORE any imports that depend on them
jest.mock('../services/rateLimitService');
jest.mock('../services/conversationService');
jest.mock('../services/messageStatusService');
jest.mock('../services/claudeService');
jest.mock('../services/subscriptionTierService', () => {
  const actual = jest.requireActual('../services/subscriptionTierService') as any;
  return {
    __esModule: true,
    ...actual,
    SubscriptionTierService: {
      ...actual.SubscriptionTierService,
      checkBotCreationAllowed: jest.fn().mockResolvedValue(undefined),
      checkMessageSendingAllowed: jest.fn().mockResolvedValue(undefined),
    },
    default: {
      ...actual.SubscriptionTierService,
      checkBotCreationAllowed: jest.fn().mockResolvedValue(undefined),
      checkMessageSendingAllowed: jest.fn().mockResolvedValue(undefined),
    },
  };
});
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../utils/prisma', () => ({
  prisma: {
    bot: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

// Provide actual implementation of validatePhoneNumber
jest.mock('../services/conversationService', () => {
  const actual = jest.requireActual('../services/conversationService');
  return {
    __esModule: true,
    ...actual,
    default: {
      getOrCreateConversation: jest.fn(),
      incrementMessageCount: jest.fn(),
      createMessage: jest.fn(),
    },
  };
});

// NOW import after all mocks are set up
import { processMessageJob } from './messageQueueWorker';
import { prisma } from '../utils/prisma';
import { RateLimitService } from '../services/rateLimitService';
import ConversationService from '../services/conversationService';
import MessageStatusService from '../services/messageStatusService';
import { claudeService } from '../services/claudeService';
import { RateLimitError } from '../utils/errors';
import { Job } from 'bull';

describe('Message Queue Worker - Rate Limiting', () => {
  let mockJob: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockJob = {
      id: 'job-123',
      data: {
        botId: 'bot-123',
        from: '+919876543210', // Valid phone format with +
        messageId: 'msg-123',
        text: 'Hello',
        timestamp: '1705315800',
        senderName: 'John Doe',
      },
    } as Job;
  });

  describe('Rate Limiting Enforcement', () => {
    it('should enforce monthly quota before processing message', async () => {
      const mockBot = {
        id: 'bot-123',
        userId: 'user-123',
        name: 'Test Bot',
        isActive: true,
        deletedAt: null,
      };

      (prisma.bot.findUnique as jest.Mock).mockResolvedValue(mockBot);
      (RateLimitService.enforceMonthlyQuota as jest.Mock).mockRejectedValue(
        new RateLimitError(
          'Monthly message quota exceeded. Limit: 100 messages/month. Resets on 2/1/2024.',
          'MONTHLY_QUOTA_EXCEEDED'
        )
      );

      await expect(processMessageJob(mockJob)).rejects.toThrow(RateLimitError);
      expect(RateLimitService.enforceMonthlyQuota).toHaveBeenCalledWith('user-123');
    });

    it('should enforce WhatsApp rate limit before processing message', async () => {
      const mockBot = {
        id: 'bot-123',
        userId: 'user-123',
        name: 'Test Bot',
        isActive: true,
        deletedAt: null,
      };

      (prisma.bot.findUnique as jest.Mock).mockResolvedValue(mockBot);
      (RateLimitService.enforceMonthlyQuota as jest.Mock).mockResolvedValue(undefined);
      (RateLimitService.enforceWhatsAppRateLimit as jest.Mock).mockRejectedValue(
        new RateLimitError(
          'WhatsApp API rate limit exceeded. Maximum 80 requests per second. Please retry after 1 second(s).',
          'WHATSAPP_RATE_LIMIT_EXCEEDED'
        )
      );

      await expect(processMessageJob(mockJob)).rejects.toThrow(RateLimitError);
      expect(RateLimitService.enforceWhatsAppRateLimit).toHaveBeenCalledWith('bot-123');
    });

    it('should process message successfully when rate limits are not exceeded', async () => {
      const mockBot = {
        id: 'bot-123',
        userId: 'user-123',
        name: 'Test Bot',
        systemPrompt: 'You are helpful',
        temperature: 0.7,
        maxTokens: 1024,
        isActive: true,
        deletedAt: null,
      };

      const mockConversation = {
        id: 'conv-123',
        botId: 'bot-123',
        userPhoneNumber: '+919876543210',
        userName: 'John Doe',
        messageCount: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockMessage = {
        id: 'msg-db-123',
        conversationId: 'conv-123',
        botId: 'bot-123',
        senderType: 'user',
        senderPhoneNumber: '+919876543210',
        senderName: 'John Doe',
        messageText: 'Hello',
        messageType: 'text',
        status: 'received',
        createdAt: new Date(),
      };

      const mockClaudeResponse = {
        response: 'Hello! How can I help?',
        processingTimeMs: 500,
        tokensUsed: 25,
        inputTokens: 20,
        outputTokens: 25,
        model: 'claude-3-5-sonnet-20241022',
      };

      const mockBotMessage = {
        id: 'msg-bot-123',
        conversationId: 'conv-123',
        botId: 'bot-123',
        senderType: 'bot',
        messageText: 'Hello! How can I help?',
        messageType: 'text',
        status: 'sent',
        createdAt: new Date(),
      };

      (prisma.bot.findUnique as jest.Mock).mockResolvedValue(mockBot);
      (RateLimitService.enforceMonthlyQuota as jest.Mock).mockResolvedValue(undefined);
      (RateLimitService.enforceWhatsAppRateLimit as jest.Mock).mockResolvedValue(undefined);
      (ConversationService.getOrCreateConversation as jest.Mock).mockResolvedValue(
        mockConversation
      );
      (prisma.message.create as jest.Mock).mockResolvedValue(mockMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue({
        ...mockMessage,
        status: 'processing',
      });
      (ConversationService.incrementMessageCount as jest.Mock).mockResolvedValue(undefined);
      (claudeService.processMessage as jest.Mock).mockResolvedValue(mockClaudeResponse);
      (ConversationService.createMessage as jest.Mock).mockResolvedValue(mockBotMessage);
      (MessageStatusService.updateMessageMetrics as jest.Mock).mockResolvedValue(undefined);

      const result = await processMessageJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.incomingMessageId).toBe('msg-db-123');
      expect(RateLimitService.enforceMonthlyQuota).toHaveBeenCalled();
      expect(RateLimitService.enforceWhatsAppRateLimit).toHaveBeenCalled();
    });
  });

  describe('Claude API Integration', () => {
    it('should process message with Claude API and save response', async () => {
      const mockBot = {
        id: 'bot-123',
        userId: 'user-123',
        name: 'Test Bot',
        description: 'A test bot',
        systemPrompt: 'You are a helpful assistant.',
        temperature: 0.7,
        maxTokens: 1024,
        isActive: true,
        deletedAt: null,
      };

      const mockConversation = {
        id: 'conv-123',
        botId: 'bot-123',
        userPhoneNumber: '+919876543210',
        messageCount: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockIncomingMessage = {
        id: 'msg-incoming-123',
        conversationId: 'conv-123',
        botId: 'bot-123',
        senderType: 'user',
        status: 'received',
        createdAt: new Date(),
      };

      const mockBotResponseMessage = {
        id: 'msg-bot-123',
        conversationId: 'conv-123',
        botId: 'bot-123',
        senderType: 'bot',
        status: 'sent',
        createdAt: new Date(),
      };

      const mockClaudeResponse = {
        response: 'Hello! How can I help you today?',
        processingTimeMs: 1250,
        tokensUsed: 45,
        inputTokens: 50,
        outputTokens: 45,
        model: 'claude-3-5-sonnet-20241022',
      };

      (prisma.bot.findUnique as jest.Mock).mockResolvedValue(mockBot);
      (RateLimitService.enforceMonthlyQuota as jest.Mock).mockResolvedValue(undefined);
      (RateLimitService.enforceWhatsAppRateLimit as jest.Mock).mockResolvedValue(undefined);
      (ConversationService.getOrCreateConversation as jest.Mock).mockResolvedValue(
        mockConversation
      );
      (prisma.message.create as jest.Mock).mockResolvedValue(mockIncomingMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue({
        ...mockIncomingMessage,
        status: 'processing',
      });
      (ConversationService.incrementMessageCount as jest.Mock).mockResolvedValue(undefined);
      (claudeService.processMessage as jest.Mock).mockResolvedValue(mockClaudeResponse);
      (ConversationService.createMessage as jest.Mock).mockResolvedValue(
        mockBotResponseMessage
      );
      (MessageStatusService.updateMessageMetrics as jest.Mock).mockResolvedValue(undefined);

      const result = await processMessageJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.incomingMessageId).toBe('msg-incoming-123');
      expect(result.botResponseMessageId).toBe('msg-bot-123');
      expect(claudeService.processMessage).toHaveBeenCalledWith(
        'conv-123',
        'Hello',
        'You are a helpful assistant.',
        0.7,
        1024,
        'Test Bot',
        'A test bot',
        true
      );
      expect(ConversationService.createMessage).toHaveBeenCalled();
      expect(MessageStatusService.updateMessageMetrics).toHaveBeenCalledWith(
        'msg-bot-123',
        1250,
        45
      );
    });

    it('should handle Claude API error gracefully', async () => {
      const mockBot = {
        id: 'bot-123',
        userId: 'user-123',
        name: 'Test Bot',
        description: 'A test bot',
        systemPrompt: 'You are a helpful assistant.',
        temperature: 0.7,
        maxTokens: 1024,
        isActive: true,
        deletedAt: null,
      };

      const mockConversation = {
        id: 'conv-123',
        botId: 'bot-123',
        userPhoneNumber: '+919876543210',
        messageCount: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockIncomingMessage = {
        id: 'msg-incoming-123',
        conversationId: 'conv-123',
        botId: 'bot-123',
        senderType: 'user',
        status: 'received',
        createdAt: new Date(),
      };

      (prisma.bot.findUnique as jest.Mock).mockResolvedValue(mockBot);
      (RateLimitService.enforceMonthlyQuota as jest.Mock).mockResolvedValue(undefined);
      (RateLimitService.enforceWhatsAppRateLimit as jest.Mock).mockResolvedValue(undefined);
      (ConversationService.getOrCreateConversation as jest.Mock).mockResolvedValue(
        mockConversation
      );
      (prisma.message.create as jest.Mock).mockResolvedValue(mockIncomingMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue({
        ...mockIncomingMessage,
        status: 'processing',
      });
      (ConversationService.incrementMessageCount as jest.Mock).mockResolvedValue(undefined);
      (claudeService.processMessage as jest.Mock).mockRejectedValue(
        new Error('Claude API rate limit exceeded')
      );
      (MessageStatusService.handleFailedMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await processMessageJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.incomingMessageId).toBe('msg-incoming-123');
      expect(MessageStatusService.handleFailedMessage).toHaveBeenCalledWith(
        'msg-incoming-123',
        'Claude API error: Claude API rate limit exceeded'
      );
    });
  });
});

