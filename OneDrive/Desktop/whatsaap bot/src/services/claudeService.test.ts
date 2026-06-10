/**
 * Unit tests for Claude API service
 */

import { ClaudeService } from './claudeService';
import { ConversationService } from './conversationService';
import { ValidationError } from '../utils/errors';
import axios from 'axios';
import config from '../config/environment';

// Provide a default axios mock so the module-level singleton in claudeService
// can call axios.create() during test file import (before beforeEach runs).
jest.mock('axios', () => {
  const create = jest.fn(() => ({
    post: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  }));
  return {
    __esModule: true,
    default: {
      create,
    },
    create,
  };
});

jest.mock('./conversationService');
jest.mock('../config/logger');
jest.mock('../config/environment');

describe('ClaudeService', () => {
  let claudeService: ClaudeService;
  const mockAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'test-api-key';
    (config as any).claudeApiKey = 'test-api-key';

    // Reset axios.create default to a working instance with interceptors
    mockAxios.create.mockReturnValue({
      post: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn(),
        },
      },
    } as any);

    claudeService = new ClaudeService();
  });

  describe('constructor', () => {
    it('should throw error if Claude API key is not configured', () => {
      delete process.env.CLAUDE_API_KEY;
      (config as any).claudeApiKey = '';
      expect(() => {
        new ClaudeService();
      }).toThrow('Claude API key is not configured');
    });

    it('should initialize with valid API key', () => {
      process.env.CLAUDE_API_KEY = 'valid-key';
      (config as any).claudeApiKey = 'valid-key';
      expect(() => {
        new ClaudeService();
      }).not.toThrow();
    });
  });

  describe('processMessage', () => {
    const mockConversationId = 'conv-123';
    const mockUserMessage = 'Hello, how are you?';
    const mockSystemPrompt = 'You are a helpful assistant.';
    const mockBotName = 'TestBot';
    const mockBotDescription = 'A test bot';

    it('should process message successfully', async () => {
      const mockResponse = {
        data: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'I am doing well, thank you for asking!',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
          },
        },
      };

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      (ConversationService.getConversationHistory as jest.Mock).mockResolvedValue({
        messages: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      claudeService = new ClaudeService();

      const result = await claudeService.processMessage(
        mockConversationId,
        mockUserMessage,
        mockSystemPrompt,
        0.7,
        1024,
        mockBotName,
        mockBotDescription
      );

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('processingTimeMs');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('inputTokens');
      expect(result).toHaveProperty('outputTokens');
      expect(result.response).toBe('I am doing well, thank you for asking!');
      expect(result.inputTokens).toBe(50);
      expect(result.outputTokens).toBe(25);
    });

    it('should throw error if conversation ID is missing', async () => {
      await expect(
        claudeService.processMessage(
          '',
          mockUserMessage,
          mockSystemPrompt
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error if user message is empty', async () => {
      await expect(
        claudeService.processMessage(
          mockConversationId,
          '   ',
          mockSystemPrompt
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error if system prompt is missing', async () => {
      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          ''
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error if temperature is invalid', async () => {
      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          mockSystemPrompt,
          3.0
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error if max tokens is invalid', async () => {
      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          mockSystemPrompt,
          0.7,
          5000
        )
      ).rejects.toThrow(ValidationError);
    });

    it('should handle Claude API authentication error', async () => {
      const mockError = {
        response: {
          status: 401,
          data: {
            error: {
              message: 'Invalid API key',
            },
          },
        },
      };

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          mockSystemPrompt
        )
      ).rejects.toThrow('Claude API authentication failed');
    });

    it('should handle Claude API rate limit error', async () => {
      const mockError = {
        response: {
          status: 429,
        },
      };

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          mockSystemPrompt
        )
      ).rejects.toThrow('Claude API rate limit exceeded');
    });

    it('should handle Claude API server error', async () => {
      const mockError = {
        response: {
          status: 500,
        },
      };

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      await expect(
        claudeService.processMessage(
          mockConversationId,
          mockUserMessage,
          mockSystemPrompt
        )
      ).rejects.toThrow('Claude API server error');
    });

    it('should include conversation history in request', async () => {
      const mockHistoryMessages = [
        {
          id: 'msg-1',
          conversationId: mockConversationId,
          botId: 'bot-123',
          senderType: 'user',
          messageText: 'Previous message',
          messageType: 'text',
          status: 'sent' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockResponse = {
        data: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Response with history',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        },
      };

      const mockPost = jest.fn().mockResolvedValue(mockResponse);
      mockAxios.create.mockReturnValue({
        post: mockPost,
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      (ConversationService.getConversationHistory as jest.Mock).mockResolvedValue({
        messages: mockHistoryMessages,
        total: 1,
        limit: 10,
        offset: 0,
      });

      claudeService = new ClaudeService();

      await claudeService.processMessage(
        mockConversationId,
        mockUserMessage,
        mockSystemPrompt,
        0.7,
        1024,
        mockBotName,
        mockBotDescription,
        true
      );

      expect(mockPost).toHaveBeenCalled();
      const callArgs = mockPost.mock.calls[0][1];
      expect(callArgs.messages.length).toBeGreaterThan(1);
    });

    it('should skip conversation history when includeHistory is false', async () => {
      const mockResponse = {
        data: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Response without history',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 50,
            output_tokens: 25,
          },
        },
      };

      const mockPost = jest.fn().mockResolvedValue(mockResponse);
      mockAxios.create.mockReturnValue({
        post: mockPost,
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      await claudeService.processMessage(
        mockConversationId,
        mockUserMessage,
        mockSystemPrompt,
        0.7,
        1024,
        mockBotName,
        mockBotDescription,
        false
      );

      expect(mockPost).toHaveBeenCalled();
      const callArgs = mockPost.mock.calls[0][1];
      expect(callArgs.messages.length).toBe(1);
      expect(callArgs.messages[0].role).toBe('user');
    });
  });

  describe('testConnection', () => {
    it('should return true on successful connection', async () => {
      const mockResponse = {
        data: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Hello, Claude API is working!',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 20,
            output_tokens: 10,
          },
        },
      };

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      const result = await claudeService.testConnection();

      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      const mockError = new Error('Connection failed');

      mockAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError),
        interceptors: {
          response: {
            use: jest.fn(),
          },
        },
      } as any);

      claudeService = new ClaudeService();

      const result = await claudeService.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('getApiInfo', () => {
    it('should return API information', () => {
      const info = claudeService.getApiInfo();

      expect(info).toHaveProperty('model');
      expect(info).toHaveProperty('baseUrl');
      expect(info).toHaveProperty('apiVersion');
      expect(info.model).toBe('claude-3-5-sonnet-20241022');
      expect(info.baseUrl).toBe('https://api.anthropic.com/v1');
      expect(info.apiVersion).toBe('2023-06-01');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt with bot configuration', () => {
      const basePrompt = 'You are a helpful assistant.';
      const botName = 'TestBot';
      const botDescription = 'A test bot for testing';

      const service = claudeService as any;
      const result = service.buildSystemPrompt(basePrompt, botName, botDescription);

      expect(result).toContain(basePrompt);
      expect(result).toContain(botName);
      expect(result).toContain(botDescription);
      expect(result).toContain('Instructions:');
    });

    it('should build system prompt without bot configuration', () => {
      const basePrompt = 'You are a helpful assistant.';

      const service = claudeService as any;
      const result = service.buildSystemPrompt(basePrompt);

      expect(result).toContain(basePrompt);
      expect(result).toContain('Instructions:');
    });
  });

  describe('getConversationHistory', () => {
    it('should retrieve conversation history', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          conversationId: 'conv-123',
          botId: 'bot-123',
          senderType: 'user',
          messageText: 'Hello',
          messageType: 'text',
          status: 'sent' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'msg-2',
          conversationId: 'conv-123',
          botId: 'bot-123',
          senderType: 'bot',
          messageText: 'Hi there!',
          messageType: 'text',
          status: 'sent' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (ConversationService.getConversationHistory as jest.Mock).mockResolvedValue({
        messages: mockMessages,
        total: 2,
        limit: 10,
        offset: 0,
      });

      const service = claudeService as any;
      const result = await service.getConversationHistory('conv-123', 10);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello');
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toBe('Hi there!');
    });

    it('should return empty array if history retrieval fails', async () => {
      (ConversationService.getConversationHistory as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const service = claudeService as any;
      const result = await service.getConversationHistory('conv-123', 10);

      expect(result).toEqual([]);
    });
  });
});
