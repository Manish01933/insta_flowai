/**
 * WhatsApp Cloud API client service for sending messages
 * Handles text messages, media messages, and implements retry logic with exponential backoff
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../config/logger';
import { prisma } from '../utils/prisma';
import { ValidationError } from '../utils/errors';
import config from '../config/environment';

// Message types
export type MessageType = 'text' | 'image' | 'document' | 'audio' | 'video';

// WhatsApp API response types
export interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status: string;
  }>;
}

export interface SendTextMessageInput {
  phoneNumberId: string;
  recipientPhoneNumber: string;
  messageText: string;
  accessToken: string;
}

export interface SendMediaMessageInput {
  phoneNumberId: string;
  recipientPhoneNumber: string;
  mediaUrl: string;
  mediaType: MessageType;
  caption?: string;
  accessToken: string;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface WhatsAppMessageRecord {
  id: string;
  conversationId: string;
  botId: string;
  whatsappMessageId: string;
  status: string;
  createdAt: Date;
}

/**
 * WhatsApp API client service
 */
export class WhatsAppService {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private retryConfig: RetryConfig;

  constructor(
    apiVersion: string = config.whatsappApiVersion,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.baseUrl = `https://graph.instagram.com/${apiVersion}`;

    // Default retry configuration
    this.retryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 32000,
      backoffMultiplier: 2,
      ...retryConfig,
    };

    // Create axios instance with default config
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error(`WhatsApp API error: ${error.message}`, {
          status: error.response?.status,
          data: error.response?.data,
        });
        throw error;
      }
    );
  }

  /**
   * Send a text message via WhatsApp
   */
  async sendTextMessage(input: SendTextMessageInput): Promise<WhatsAppMessageRecord> {
    try {
      const { phoneNumberId, recipientPhoneNumber, messageText, accessToken } = input;

      // Validate inputs
      this.validatePhoneNumber(recipientPhoneNumber);
      this.validateMessageText(messageText);

      if (!phoneNumberId || !accessToken) {
        throw new ValidationError(
          'Phone number ID and access token are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      logger.info(
        `Sending text message to ${recipientPhoneNumber} via phone ID ${phoneNumberId}`
      );

      // Send message with retry logic
      const response = await this.sendWithRetry(
        async () => {
          return this.axiosInstance.post(
            `/${phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipientPhoneNumber,
              type: 'text',
              text: {
                body: messageText,
              },
            },
            {
              params: { access_token: accessToken },
            }
          );
        },
        'text message'
      );

      const whatsappMessageId = response.data.messages[0].id;

      logger.info(
        `Text message sent successfully. WhatsApp message ID: ${whatsappMessageId}`
      );

      return {
        id: whatsappMessageId,
        conversationId: '', // Will be set by caller
        botId: '', // Will be set by caller
        whatsappMessageId,
        status: 'sent',
        createdAt: new Date(),
      };
    } catch (error: any) {
      logger.error(`Error sending text message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a media message via WhatsApp
   */
  async sendMediaMessage(input: SendMediaMessageInput): Promise<WhatsAppMessageRecord> {
    try {
      const {
        phoneNumberId,
        recipientPhoneNumber,
        mediaUrl,
        mediaType,
        caption,
        accessToken,
      } = input;

      // Validate inputs
      this.validatePhoneNumber(recipientPhoneNumber);
      this.validateMediaUrl(mediaUrl);
      this.validateMediaType(mediaType);

      if (!phoneNumberId || !accessToken) {
        throw new ValidationError(
          'Phone number ID and access token are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      logger.info(
        `Sending ${mediaType} message to ${recipientPhoneNumber} via phone ID ${phoneNumberId}`
      );

      // Build media object based on type
      const mediaObject = this.buildMediaObject(mediaType, mediaUrl, caption);

      // Send message with retry logic
      const response = await this.sendWithRetry(
        async () => {
          return this.axiosInstance.post(
            `/${phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipientPhoneNumber,
              type: mediaType,
              [mediaType]: mediaObject,
            },
            {
              params: { access_token: accessToken },
            }
          );
        },
        `${mediaType} message`
      );

      const whatsappMessageId = response.data.messages[0].id;

      logger.info(
        `${mediaType} message sent successfully. WhatsApp message ID: ${whatsappMessageId}`
      );

      return {
        id: whatsappMessageId,
        conversationId: '', // Will be set by caller
        botId: '', // Will be set by caller
        whatsappMessageId,
        status: 'sent',
        createdAt: new Date(),
      };
    } catch (error: any) {
      logger.error(`Error sending media message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send message with exponential backoff retry logic
   */
  private async sendWithRetry(
    sendFn: () => Promise<any>,
    messageType: string,
    attempt: number = 1
  ): Promise<any> {
    try {
      return await sendFn();
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error);
      const hasRetriesLeft = attempt < this.retryConfig.maxRetries;

      if (isRetryable && hasRetriesLeft) {
        const delayMs = this.calculateBackoffDelay(attempt);
        logger.warn(
          `Retrying ${messageType} (attempt ${attempt + 1}/${this.retryConfig.maxRetries}) after ${delayMs}ms`,
          { error: error.message }
        );

        // Wait before retrying
        await this.delay(delayMs);

        // Recursive retry
        return this.sendWithRetry(sendFn, messageType, attempt + 1);
      }

      // No more retries or non-retryable error
      logger.error(
        `Failed to send ${messageType} after ${attempt} attempt(s): ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (!error.response) {
      return true;
    }

    const status = error.response.status;

    // Retry on server errors (5xx)
    if (status >= 500) {
      return true;
    }

    // Retry on rate limiting (429)
    if (status === 429) {
      return true;
    }

    // Retry on timeout (408)
    if (status === 408) {
      return true;
    }

    // Don't retry on client errors (4xx) except those above
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * exponentialDelay;
    const delayWithJitter = exponentialDelay + jitter;

    // Cap at max delay
    return Math.min(delayWithJitter, this.retryConfig.maxDelayMs);
  }

  /**
   * Delay helper function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build media object based on media type
   */
  private buildMediaObject(
    mediaType: MessageType,
    mediaUrl: string,
    caption?: string
  ): any {
    const mediaObject: any = {
      link: mediaUrl,
    };

    // Add caption for image and document types
    if ((mediaType === 'image' || mediaType === 'document') && caption) {
      mediaObject.caption = caption;
    }

    return mediaObject;
  }

  /**
   * Validate phone number format
   */
  private validatePhoneNumber(phoneNumber: string): void {
    if (!phoneNumber) {
      throw new ValidationError(
        'Phone number is required',
        'MISSING_PHONE_NUMBER'
      );
    }

    // WhatsApp phone numbers should be 7-15 digits
    const phoneRegex = /^\d{7,15}$/;
    if (!phoneRegex.test(phoneNumber.replace(/\D/g, ''))) {
      throw new ValidationError(
        'Invalid phone number format. Must be 7-15 digits.',
        'INVALID_PHONE_NUMBER'
      );
    }
  }

  /**
   * Validate message text
   */
  private validateMessageText(messageText: string): void {
    if (!messageText) {
      throw new ValidationError(
        'Message text is required',
        'MISSING_MESSAGE_TEXT'
      );
    }

    // WhatsApp has a 4096 character limit per message
    if (messageText.length > 4096) {
      throw new ValidationError(
        'Message text exceeds 4096 character limit',
        'MESSAGE_TOO_LONG'
      );
    }
  }

  /**
   * Validate media URL
   */
  private validateMediaUrl(mediaUrl: string): void {
    if (!mediaUrl) {
      throw new ValidationError(
        'Media URL is required',
        'MISSING_MEDIA_URL'
      );
    }

    // Basic URL validation
    try {
      new URL(mediaUrl);
    } catch {
      throw new ValidationError(
        'Invalid media URL format',
        'INVALID_MEDIA_URL'
      );
    }
  }

  /**
   * Validate media type
   */
  private validateMediaType(mediaType: MessageType): void {
    const validTypes: MessageType[] = ['image', 'document', 'audio', 'video'];
    if (!validTypes.includes(mediaType)) {
      throw new ValidationError(
        `Invalid media type. Must be one of: ${validTypes.join(', ')}`,
        'INVALID_MEDIA_TYPE'
      );
    }
  }

  /**
   * Store WhatsApp message ID in database for tracking
   */
  async storeMessageId(
    messageId: string,
    conversationId: string,
    botId: string,
    whatsappMessageId: string
  ): Promise<WhatsAppMessageRecord> {
    try {
      if (!messageId || !conversationId || !botId || !whatsappMessageId) {
        throw new ValidationError(
          'All parameters are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      // Update message with WhatsApp message ID
      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          whatsappMessageId: whatsappMessageId,
          status: 'sent',
        },
      });

      logger.info(
        `Stored WhatsApp message ID ${whatsappMessageId} for message ${messageId}`
      );

      return {
        id: updatedMessage.id,
        conversationId: updatedMessage.conversationId,
        botId: updatedMessage.botId,
        whatsappMessageId: updatedMessage.whatsappMessageId || '',
        status: updatedMessage.status,
        createdAt: updatedMessage.createdAt,
      };
    } catch (error: any) {
      logger.error(`Error storing message ID: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get message by WhatsApp message ID
   */
  async getMessageByWhatsAppId(whatsappMessageId: string): Promise<WhatsAppMessageRecord | null> {
    try {
      if (!whatsappMessageId) {
        throw new ValidationError(
          'WhatsApp message ID is required',
          'MISSING_WHATSAPP_MESSAGE_ID'
        );
      }

      const message = await prisma.message.findUnique({
        where: { whatsappMessageId: whatsappMessageId },
      });

      if (!message) {
        return null;
      }

      return {
        id: message.id,
        conversationId: message.conversationId,
        botId: message.botId,
        whatsappMessageId: message.whatsappMessageId || '',
        status: message.status,
        createdAt: message.createdAt,
      };
    } catch (error: any) {
      logger.error(`Error getting message by WhatsApp ID: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update message status based on WhatsApp webhook
   */
  async updateMessageStatus(
    whatsappMessageId: string,
    status: string,
    errorMessage?: string
  ): Promise<WhatsAppMessageRecord | null> {
    try {
      if (!whatsappMessageId) {
        throw new ValidationError(
          'WhatsApp message ID is required',
          'MISSING_WHATSAPP_MESSAGE_ID'
        );
      }

      const validStatuses = ['sent', 'delivered', 'read', 'failed'];
      if (!validStatuses.includes(status)) {
        throw new ValidationError(
          `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          'INVALID_STATUS'
        );
      }

      const updatedMessage = await prisma.message.update({
        where: { whatsappMessageId: whatsappMessageId },
        data: {
          status: status,
          errorMessage: errorMessage,
        },
      });

      logger.info(
        `Updated message status for WhatsApp ID ${whatsappMessageId} to ${status}`
      );

      return {
        id: updatedMessage.id,
        conversationId: updatedMessage.conversationId,
        botId: updatedMessage.botId,
        whatsappMessageId: updatedMessage.whatsappMessageId || '',
        status: updatedMessage.status,
        createdAt: updatedMessage.createdAt,
      };
    } catch (error: any) {
      logger.error(`Error updating message status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get retry configuration
   */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
  }

  /**
   * Set retry configuration
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = {
      ...this.retryConfig,
      ...config,
    };
    logger.info('Updated WhatsApp retry configuration', this.retryConfig);
  }
}

export default WhatsAppService;
