/**
 * Tests for WhatsApp API client service
 */

import { WhatsAppService, SendTextMessageInput, SendMediaMessageInput } from './whatsappService';
import axios from 'axios';

// Mock dependencies
jest.mock('../config/logger');
jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const createMockAxiosInstance = () => ({
  post: jest.fn(),
  get: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  interceptors: {
    response: {
      use: jest.fn(),
    },
  },
});

describe('WhatsAppService', () => {
  let whatsappService: WhatsAppService;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    whatsappService = new WhatsAppService('v18.0');
  });

  describe('sendTextMessage', () => {
    it('should send a text message successfully', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello, this is a test message',
        accessToken: 'test_token_123',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [{ id: 'wamid.test123', message_status: 'accepted' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.test123');
      expect(result.status).toBe('sent');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/1234567890/messages',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '919876543210',
          type: 'text',
          text: {
            body: 'Hello, this is a test message',
          },
        }),
        expect.any(Object)
      );
    });

    it('should throw error for invalid phone number', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: 'invalid',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow(
        'Invalid phone number format'
      );
    });

    it('should throw error for empty message text', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: '',
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow(
        'Message text is required'
      );
    });

    it('should throw error for message exceeding 4096 characters', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'a'.repeat(4097),
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow(
        'Message text exceeds 4096 character limit'
      );
    });

    it('should throw error for missing phone number ID', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow(
        'Phone number ID and access token are required'
      );
    });

    it('should throw error for missing access token', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: '',
      };

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow(
        'Phone number ID and access token are required'
      );
    });
  });

  describe('sendMediaMessage', () => {
    it('should send an image message successfully', async () => {
      const input: SendMediaMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image',
        caption: 'Test image',
        accessToken: 'test_token_123',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [{ id: 'wamid.media123', message_status: 'accepted' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendMediaMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.media123');
      expect(result.status).toBe('sent');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/1234567890/messages',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '919876543210',
          type: 'image',
          image: {
            link: 'https://example.com/image.jpg',
            caption: 'Test image',
          },
        }),
        expect.any(Object)
      );
    });

    it('should send a document message successfully', async () => {
      const input: SendMediaMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        mediaUrl: 'https://example.com/document.pdf',
        mediaType: 'document',
        accessToken: 'test_token_123',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [{ id: 'wamid.doc123', message_status: 'accepted' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendMediaMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.doc123');
      expect(result.status).toBe('sent');
    });

    it('should throw error for invalid media URL', async () => {
      const input: SendMediaMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        mediaUrl: 'not-a-url',
        mediaType: 'image',
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendMediaMessage(input)).rejects.toThrow(
        'Invalid media URL format'
      );
    });

    it('should throw error for invalid media type', async () => {
      const input: SendMediaMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        mediaUrl: 'https://example.com/file.txt',
        mediaType: 'invalid' as any,
        accessToken: 'test_token',
      };

      await expect(whatsappService.sendMediaMessage(input)).rejects.toThrow(
        'Invalid media type'
      );
    });
  });

  describe('Retry Logic', () => {
    it('should retry on server error (5xx)', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce({
          response: { status: 500, data: { error: 'Server error' } },
        })
        .mockRejectedValueOnce({
          response: { status: 500, data: { error: 'Server error' } },
        })
        .mockResolvedValueOnce({
          data: {
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.retry123' }],
          },
        });

      whatsappService.setRetryConfig({
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.retry123');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should retry on rate limit (429)', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      mockAxiosInstance.post
        .mockRejectedValueOnce({
          response: { status: 429, data: { error: 'Rate limited' } },
        })
        .mockResolvedValueOnce({
          data: {
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.ratelimit123' }],
          },
        });

      whatsappService.setRetryConfig({
        maxRetries: 2,
        initialDelayMs: 10,
      });

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.ratelimit123');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('should not retry on client error (4xx)', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      const error = new Error('Bad request');
      (error as any).response = { status: 400, data: { error: 'Bad request' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw error', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      const error = new Error('Server error');
      (error as any).response = { status: 500, data: { error: 'Server error' } };
      mockAxiosInstance.post.mockRejectedValue(error);

      whatsappService.setRetryConfig({
        maxRetries: 2,
        initialDelayMs: 10,
      });

      await expect(whatsappService.sendTextMessage(input)).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Retry Configuration', () => {
    it('should get retry configuration', () => {
      const config = whatsappService.getRetryConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(32000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should set retry configuration', () => {
      whatsappService.setRetryConfig({
        maxRetries: 5,
        initialDelayMs: 500,
      });

      const config = whatsappService.getRetryConfig();

      expect(config.maxRetries).toBe(5);
      expect(config.initialDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(32000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle message with exactly 4096 characters', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '919876543210',
        messageText: 'a'.repeat(4096),
        accessToken: 'test_token',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.edge123' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.edge123');
    });

    it('should handle phone number with minimum digits', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '1234567',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.min123' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.min123');
    });

    it('should handle phone number with maximum digits', async () => {
      const input: SendTextMessageInput = {
        phoneNumberId: '1234567890',
        recipientPhoneNumber: '123456789012345',
        messageText: 'Hello',
        accessToken: 'test_token',
      };

      const mockResponse = {
        data: {
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.max123' }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await whatsappService.sendTextMessage(input);

      expect(result.whatsappMessageId).toBe('wamid.max123');
    });
  });
});
