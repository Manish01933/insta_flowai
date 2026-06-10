/**
 * Claude API service for handling AI message responses
 * Wraps Anthropic Claude API with conversation history and streaming support
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../config/logger';
import { ValidationError } from '../utils/errors';
import { ConversationService, MessageResponse } from './conversationService';
import config from '../config/environment';

// Claude API configuration
const CLAUDE_API_BASE_URL = 'https://api.anthropic.com/v1';
const CLAUDE_API_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Message format for Claude API
 */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Claude API request payload
 */
export interface ClaudeRequestPayload {
  model: string;
  max_tokens: number;
  system: string;
  messages: ClaudeMessage[];
  temperature: number;
  stream?: boolean;
}

/**
 * Claude API response
 */
export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Streaming response chunk
 */
export interface StreamingChunk {
  type: string;
  delta?: {
    type: string;
    text?: string;
  };
  message?: ClaudeResponse;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Message processing result
 */
export interface MessageProcessingResult {
  response: string;
  processingTimeMs: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Claude Service for AI message processing
 */
export class ClaudeService {
  private axiosInstance: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = config.claudeApiKey;

    if (!this.apiKey) {
      throw new Error('Claude API key is not configured. Set CLAUDE_API_KEY environment variable.');
    }

    // Create axios instance with default headers
    this.axiosInstance = axios.create({
      baseURL: CLAUDE_API_BASE_URL,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': CLAUDE_API_VERSION,
        'content-type': 'application/json',
      },
      timeout: 60000, // 60 second timeout
    });

    // Add error interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          logger.error('Claude API authentication failed - invalid API key');
        } else if (error.response?.status === 429) {
          logger.warn('Claude API rate limit exceeded');
        } else if (error.response?.status === 500) {
          logger.error('Claude API server error');
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get conversation history for context (last N messages)
   */
  private async getConversationHistory(
    conversationId: string,
    limit: number = 10
  ): Promise<ClaudeMessage[]> {
    try {
      const history = await ConversationService.getConversationHistory(
        conversationId,
        limit,
        0
      );

      // Convert messages to Claude format
      const claudeMessages: ClaudeMessage[] = history.messages.map((msg: MessageResponse) => ({
        role: msg.senderType === 'user' ? 'user' : 'assistant',
        content: msg.messageText,
      }));

      return claudeMessages;
    } catch (error: any) {
      logger.error(`Error retrieving conversation history: ${error.message}`);
      // Return empty array if history retrieval fails
      return [];
    }
  }

  /**
   * Build system prompt with bot configuration
   */
  private buildSystemPrompt(
    botSystemPrompt: string,
    botName?: string,
    botDescription?: string
  ): string {
    let systemPrompt = botSystemPrompt;

    // Add bot context if available
    if (botName || botDescription) {
      systemPrompt += '\n\n---\n';
      if (botName) {
        systemPrompt += `Bot Name: ${botName}\n`;
      }
      if (botDescription) {
        systemPrompt += `Bot Description: ${botDescription}\n`;
      }
    }

    // Add instructions for response format
    systemPrompt += '\n---\nInstructions:\n';
    systemPrompt += '- Keep responses concise and relevant\n';
    systemPrompt += '- Use clear and friendly language\n';
    systemPrompt += '- If you cannot help, politely explain why\n';

    return systemPrompt;
  }

  /**
   * Process a message and get Claude response
   * Includes conversation history for context
   */
  async processMessage(
    conversationId: string,
    userMessage: string,
    botSystemPrompt: string,
    temperature: number = 0.7,
    maxTokens: number = 1024,
    botName?: string,
    botDescription?: string,
    includeHistory: boolean = true
  ): Promise<MessageProcessingResult> {
    try {
      // Validate inputs
      if (!conversationId || !userMessage || !botSystemPrompt) {
        throw new ValidationError(
          'Conversation ID, user message, and system prompt are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      if (userMessage.trim().length === 0) {
        throw new ValidationError('User message cannot be empty', 'EMPTY_MESSAGE');
      }

      if (temperature < 0 || temperature > 2) {
        throw new ValidationError('Temperature must be between 0 and 2', 'INVALID_TEMPERATURE');
      }

      if (maxTokens < 1 || maxTokens > 4096) {
        throw new ValidationError('Max tokens must be between 1 and 4096', 'INVALID_MAX_TOKENS');
      }

      const startTime = Date.now();

      // Get conversation history for context
      let conversationHistory: ClaudeMessage[] = [];
      if (includeHistory) {
        conversationHistory = await this.getConversationHistory(conversationId, 10);
      }

      // Build system prompt with bot configuration
      const systemPrompt = this.buildSystemPrompt(botSystemPrompt, botName, botDescription);

      // Prepare messages array
      const messages: ClaudeMessage[] = [
        ...conversationHistory,
        {
          role: 'user',
          content: userMessage,
        },
      ];

      // Prepare request payload
      const payload: ClaudeRequestPayload = {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages,
        temperature: temperature,
      };

      logger.debug(`Sending request to Claude API with ${messages.length} messages`);

      // Call Claude API
      const response = await this.axiosInstance.post<ClaudeResponse>(
        '/messages',
        payload
      );

      const processingTime = Date.now() - startTime;

      // Extract response text
      const responseText = response.data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      if (!responseText) {
        throw new ValidationError('No text content in Claude response', 'EMPTY_RESPONSE');
      }

      const result: MessageProcessingResult = {
        response: responseText,
        processingTimeMs: processingTime,
        tokensUsed: response.data.usage.output_tokens,
        inputTokens: response.data.usage.input_tokens,
        outputTokens: response.data.usage.output_tokens,
        model: response.data.model,
      };

      logger.info(
        `Claude API response processed: ${processingTime}ms, ` +
        `tokens: ${response.data.usage.input_tokens}/${response.data.usage.output_tokens}`
      );

      return result;
    } catch (error: any) {
      logger.error(`Error processing message with Claude API: ${error.message}`);

      // Handle specific API errors
      if (error.response?.status === 401) {
        throw new ValidationError(
          'Claude API authentication failed - invalid or missing API key',
          'CLAUDE_AUTH_ERROR'
        );
      }

      if (error.response?.status === 429) {
        throw new ValidationError(
          'Claude API rate limit exceeded - please try again later',
          'CLAUDE_RATE_LIMIT'
        );
      }

      if (error.response?.status === 500) {
        throw new ValidationError(
          'Claude API server error - please try again later',
          'CLAUDE_SERVER_ERROR'
        );
      }

      if (error.response?.data?.error) {
        throw new ValidationError(
          `Claude API error: ${error.response.data.error.message}`,
          'CLAUDE_API_ERROR'
        );
      }

      throw new ValidationError(
        `Failed to process message with Claude API: ${error.message}`,
        'CLAUDE_API_ERROR'
      );
    }
  }

  /**
   * Process message with streaming response
   * Yields response chunks as they arrive
   */
  async *processMessageStream(
    conversationId: string,
    userMessage: string,
    botSystemPrompt: string,
    temperature: number = 0.7,
    maxTokens: number = 1024,
    botName?: string,
    botDescription?: string,
    includeHistory: boolean = true
  ): AsyncGenerator<string, MessageProcessingResult, unknown> {
    try {
      // Validate inputs
      if (!conversationId || !userMessage || !botSystemPrompt) {
        throw new ValidationError(
          'Conversation ID, user message, and system prompt are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      if (userMessage.trim().length === 0) {
        throw new ValidationError('User message cannot be empty', 'EMPTY_MESSAGE');
      }

      const startTime = Date.now();

      // Get conversation history for context
      let conversationHistory: ClaudeMessage[] = [];
      if (includeHistory) {
        conversationHistory = await this.getConversationHistory(conversationId, 10);
      }

      // Build system prompt with bot configuration
      const systemPrompt = this.buildSystemPrompt(botSystemPrompt, botName, botDescription);

      // Prepare messages array
      const messages: ClaudeMessage[] = [
        ...conversationHistory,
        {
          role: 'user',
          content: userMessage,
        },
      ];

      // Prepare request payload with streaming enabled
      const payload: ClaudeRequestPayload = {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages,
        temperature: temperature,
        stream: true,
      };

      logger.debug(`Starting streaming request to Claude API with ${messages.length} messages`);

      // Call Claude API with streaming
      const response = await this.axiosInstance.post(
        '/messages',
        payload,
        {
          responseType: 'stream',
        }
      );

      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // Process stream chunks
      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamingChunk;

              // Handle content block delta
              if (data.type === 'content_block_delta' && data.delta?.text) {
                fullResponse += data.delta.text;
                yield data.delta.text;
              }

              // Handle message delta for token usage
              if (data.type === 'message_delta' && data.usage) {
                outputTokens = data.usage.output_tokens;
              }

              // Handle message start for input tokens
              if (data.type === 'message_start' && data.message?.usage) {
                inputTokens = data.message.usage.input_tokens;
              }
            } catch (parseError) {
              // Skip lines that can't be parsed
              continue;
            }
          }
        }
      }

      const processingTime = Date.now() - startTime;

      logger.info(
        `Claude API streaming completed: ${processingTime}ms, ` +
        `tokens: ${inputTokens}/${outputTokens}`
      );

      return {
        response: fullResponse,
        processingTimeMs: processingTime,
        tokensUsed: outputTokens,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        model: CLAUDE_MODEL,
      };
    } catch (error: any) {
      logger.error(`Error processing streaming message with Claude API: ${error.message}`);

      // Handle specific API errors
      if (error.response?.status === 401) {
        throw new ValidationError(
          'Claude API authentication failed - invalid or missing API key',
          'CLAUDE_AUTH_ERROR'
        );
      }

      if (error.response?.status === 429) {
        throw new ValidationError(
          'Claude API rate limit exceeded - please try again later',
          'CLAUDE_RATE_LIMIT'
        );
      }

      if (error.response?.status === 500) {
        throw new ValidationError(
          'Claude API server error - please try again later',
          'CLAUDE_SERVER_ERROR'
        );
      }

      throw new ValidationError(
        `Failed to process streaming message with Claude API: ${error.message}`,
        'CLAUDE_API_ERROR'
      );
    }
  }

  /**
   * Test Claude API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const payload: ClaudeRequestPayload = {
        model: CLAUDE_MODEL,
        max_tokens: 100,
        system: 'You are a helpful assistant.',
        messages: [
          {
            role: 'user',
            content: 'Say "Hello, Claude API is working!"',
          },
        ],
        temperature: 0.7,
      };

      await this.axiosInstance.post<ClaudeResponse>('/messages', payload);

      logger.info('Claude API connection test successful');
      return true;
    } catch (error: any) {
      logger.error(`Claude API connection test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get API usage information
   */
  getApiInfo(): {
    model: string;
    baseUrl: string;
    apiVersion: string;
  } {
    return {
      model: CLAUDE_MODEL,
      baseUrl: CLAUDE_API_BASE_URL,
      apiVersion: CLAUDE_API_VERSION,
    };
  }
}

// Lazy singleton instance
let instance: ClaudeService | null = null;

export function getClaudeService(): ClaudeService {
  if (!instance) {
    instance = new ClaudeService();
  }
  return instance;
}

export const claudeService = getClaudeService();

export default ClaudeService;
