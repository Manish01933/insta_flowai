/**
 * Tests for MessageStatusService
 */

import { MessageStatusService, WhatsAppStatusUpdate } from './messageStatusService';
import { prisma } from '../utils/prisma';

// Mock Prisma
jest.mock('../utils/prisma', () => ({
  prisma: {
    message: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

// Mock logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('MessageStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateMessageStatus', () => {
    it('should update message status from sent to delivered', async () => {
      const messageId = 'msg-123';
      const whatsappMessageId = 'wamid-456';
      const currentTime = new Date();
      const createdTime = new Date(currentTime.getTime() - 5000); // 5 seconds ago

      const mockMessage = {
        id: messageId,
        status: 'sent',
        conversationId: 'conv-123',
        botId: 'bot-123',
        createdAt: createdTime,
        updatedAt: currentTime,
        deletedAt: null,
      };

      const mockUpdatedMessage = {
        ...mockMessage,
        status: 'delivered',
        updatedAt: new Date(),
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue(mockUpdatedMessage);

      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: whatsappMessageId,
        status: 'delivered',
        timestamp: Math.floor(currentTime.getTime() / 1000).toString(),
      };

      const result = await MessageStatusService.updateMessageStatus(
        whatsappMessageId,
        statusUpdate
      );

      expect(result.previousStatus).toBe('sent');
      expect(result.newStatus).toBe('delivered');
      expect(result.messageId).toBe(messageId);
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: expect.objectContaining({
          status: 'delivered',
          errorMessage: null,
        }),
      });
    });

    it('should update message status to failed with error message', async () => {
      const messageId = 'msg-123';
      const whatsappMessageId = 'wamid-456';

      const mockMessage = {
        id: messageId,
        status: 'sent',
        conversationId: 'conv-123',
        botId: 'bot-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      const mockUpdatedMessage = {
        ...mockMessage,
        status: 'failed',
        errorMessage: 'Message delivery failed',
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue(mockUpdatedMessage);

      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: whatsappMessageId,
        status: 'failed',
        timestamp: Math.floor(Date.now() / 1000).toString(),
        errorCode: '131026',
        errorMessage: 'Message delivery failed',
      };

      const result = await MessageStatusService.updateMessageStatus(
        whatsappMessageId,
        statusUpdate
      );

      expect(result.newStatus).toBe('failed');
      expect(result.errorMessage).toBe('Message delivery failed');
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Message delivery failed',
        }),
      });
    });

    it('should handle idempotent status updates', async () => {
      const messageId = 'msg-123';
      const whatsappMessageId = 'wamid-456';

      const mockMessage = {
        id: messageId,
        status: 'delivered',
        conversationId: 'conv-123',
        botId: 'bot-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);
      (prisma.message.update as jest.Mock).mockResolvedValue(mockMessage);

      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: whatsappMessageId,
        status: 'delivered',
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };

      const result = await MessageStatusService.updateMessageStatus(
        whatsappMessageId,
        statusUpdate
      );

      expect(result.previousStatus).toBe('delivered');
      expect(result.newStatus).toBe('delivered');
    });

    it('should throw error if message not found', async () => {
      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: 'wamid-456',
        status: 'delivered',
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };

      await expect(
        MessageStatusService.updateMessageStatus('wamid-456', statusUpdate)
      ).rejects.toThrow('Message not found');
    });

    it('should throw error if message is deleted', async () => {
      const mockMessage = {
        id: 'msg-123',
        status: 'sent',
        conversationId: 'conv-123',
        botId: 'bot-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);

      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: 'wamid-456',
        status: 'delivered',
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };

      await expect(
        MessageStatusService.updateMessageStatus('wamid-456', statusUpdate)
      ).rejects.toThrow('Message has been deleted');
    });

    it('should throw error for invalid status', async () => {
      const statusUpdate: WhatsAppStatusUpdate = {
        messageId: 'wamid-456',
        status: 'invalid' as any,
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };

      await expect(
        MessageStatusService.updateMessageStatus('wamid-456', statusUpdate)
      ).rejects.toThrow('Invalid status');
    });
  });

  describe('updateMessageMetrics', () => {
    it('should update message with processing metrics', async () => {
      const messageId = 'msg-123';
      const processingTimeMs = 1250;
      const tokensUsed = 45;

      const mockMessage = {
        id: messageId,
        status: 'sent',
        processingTimeMs,
        tokensUsed,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: messageId,
        deletedAt: null,
      });
      (prisma.message.update as jest.Mock).mockResolvedValue(mockMessage);

      const result = await MessageStatusService.updateMessageMetrics(
        messageId,
        processingTimeMs,
        tokensUsed
      );

      expect(result.processingTimeMs).toBe(processingTimeMs);
      expect(result.tokensUsed).toBe(tokensUsed);
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {
          processingTimeMs,
          tokensUsed,
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw error for negative processing time', async () => {
      await expect(
        MessageStatusService.updateMessageMetrics('msg-123', -100, 45)
      ).rejects.toThrow('Processing time cannot be negative');
    });

    it('should throw error for negative tokens used', async () => {
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-123',
        deletedAt: null,
      });

      await expect(
        MessageStatusService.updateMessageMetrics('msg-123', 1250, -10)
      ).rejects.toThrow('Tokens used cannot be negative');
    });
  });

  describe('getMessageStatus', () => {
    it('should retrieve message status and metrics', async () => {
      const messageId = 'msg-123';
      const mockMessage = {
        id: messageId,
        status: 'delivered',
        processingTimeMs: 1250,
        tokensUsed: 45,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);

      const result = await MessageStatusService.getMessageStatus(messageId);

      expect(result).toEqual({
        messageId,
        status: 'delivered',
        processingTimeMs: 1250,
        tokensUsed: 45,
        createdAt: mockMessage.createdAt,
        updatedAt: mockMessage.updatedAt,
      });
    });

    it('should return null if message not found', async () => {
      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await MessageStatusService.getMessageStatus('msg-123');

      expect(result).toBeNull();
    });

    it('should return null if message is deleted', async () => {
      const mockMessage = {
        id: 'msg-123',
        status: 'delivered',
        processingTimeMs: 1250,
        tokensUsed: 45,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(mockMessage);

      const result = await MessageStatusService.getMessageStatus('msg-123');

      expect(result).toBeNull();
    });
  });

  describe('getConversationStatusSummary', () => {
    it('should calculate conversation status summary', async () => {
      const conversationId = 'conv-123';
      const mockMessages = [
        {
          status: 'delivered',
          processingTimeMs: 1000,
          tokensUsed: 50,
        },
        {
          status: 'delivered',
          processingTimeMs: 1500,
          tokensUsed: 60,
        },
        {
          status: 'read',
          processingTimeMs: 1200,
          tokensUsed: 45,
        },
        {
          status: 'sent',
          processingTimeMs: null,
          tokensUsed: null,
        },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);

      const result = await MessageStatusService.getConversationStatusSummary(
        conversationId
      );

      expect(result.totalMessages).toBe(4);
      expect(result.statusCounts).toEqual({
        delivered: 2,
        read: 1,
        sent: 1,
      });
      expect(result.averageProcessingTimeMs).toBe(1233); // (1000 + 1500 + 1200) / 3
      expect(result.totalTokensUsed).toBe(155); // 50 + 60 + 45
    });

    it('should handle messages without processing metrics', async () => {
      const conversationId = 'conv-123';
      const mockMessages = [
        {
          status: 'sent',
          processingTimeMs: null,
          tokensUsed: null,
        },
        {
          status: 'failed',
          processingTimeMs: null,
          tokensUsed: null,
        },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);

      const result = await MessageStatusService.getConversationStatusSummary(
        conversationId
      );

      expect(result.totalMessages).toBe(2);
      expect(result.averageProcessingTimeMs).toBe(0);
      expect(result.totalTokensUsed).toBe(0);
    });
  });

  describe('getMessagesByStatus', () => {
    it('should retrieve messages by status', async () => {
      const conversationId = 'conv-123';
      const mockMessages = [
        {
          id: 'msg-1',
          status: 'delivered',
          processingTimeMs: 1000,
          tokensUsed: 50,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'msg-2',
          status: 'delivered',
          processingTimeMs: 1500,
          tokensUsed: 60,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);

      const result = await MessageStatusService.getMessagesByStatus(
        conversationId,
        'delivered'
      );

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('delivered');
      expect(result[1].status).toBe('delivered');
    });

    it('should throw error for invalid status', async () => {
      await expect(
        MessageStatusService.getMessagesByStatus('conv-123', 'invalid' as any)
      ).rejects.toThrow('Invalid status');
    });
  });

  describe('handleFailedMessage', () => {
    it('should mark message as failed with error message', async () => {
      const messageId = 'msg-123';
      const errorMessage = 'Delivery failed';

      (prisma.message.update as jest.Mock).mockResolvedValue({
        id: messageId,
        status: 'failed',
        errorMessage,
      });

      await MessageStatusService.handleFailedMessage(messageId, errorMessage);

      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {
          status: 'failed',
          errorMessage,
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should use default error message if not provided', async () => {
      const messageId = 'msg-123';

      (prisma.message.update as jest.Mock).mockResolvedValue({
        id: messageId,
        status: 'failed',
        errorMessage: 'Unknown error',
      });

      await MessageStatusService.handleFailedMessage(messageId, '');

      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {
          status: 'failed',
          errorMessage: 'Unknown error',
          updatedAt: expect.any(Date),
        },
      });
    });
  });
});
