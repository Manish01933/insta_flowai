/**
 * Conversation management service for handling conversation creation, retrieval, and metadata updates
 */

import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import { ValidationError, NotFoundError } from '../utils/errors';

// Message status types
export type MessageStatus = 'received' | 'processing' | 'sent' | 'delivered' | 'failed';

export interface CreateConversationInput {
  botId: string;
  userPhoneNumber: string;
  userName?: string;
  userAvatarUrl?: string;
}

export interface UpdateConversationMetadataInput {
  conversationId: string;
  messageCount?: number;
  lastMessageAt?: Date;
  status?: string;
}

export interface ConversationResponse {
  id: string;
  botId: string;
  userPhoneNumber: string;
  userName?: string;
  userAvatarUrl?: string;
  messageCount: number;
  lastMessageAt?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  botId: string;
  senderType: string;
  senderPhoneNumber?: string;
  senderName?: string;
  messageText: string;
  messageType: string;
  mediaUrl?: string;
  mediaType?: string;
  whatsappMessageId?: string;
  status: MessageStatus;
  errorMessage?: string;
  processingTimeMs?: number;
  tokensUsed?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Validate phone number format
 */
export const validatePhoneNumber = (phoneNumber: string): boolean => {
  if (!phoneNumber || phoneNumber.length < 7 || phoneNumber.length > 20) {
    return false;
  }
  // Allow digits, +, and hyphens
  const phoneRegex = /^[\d+\-]+$/;
  return phoneRegex.test(phoneNumber);
};

/**
 * Validate message status
 */
export const validateMessageStatus = (status: string): boolean => {
  const validStatuses: MessageStatus[] = ['received', 'processing', 'sent', 'delivered', 'failed'];
  return validStatuses.includes(status as MessageStatus);
};

/**
 * ConversationService handles conversation management
 */
export class ConversationService {
  /**
   * Get or create a conversation
   */
  static async getOrCreateConversation(
    input: CreateConversationInput
  ): Promise<ConversationResponse> {
    try {
      const { botId, userPhoneNumber, userName, userAvatarUrl } = input;

      // Validate inputs
      if (!botId || !userPhoneNumber) {
        throw new ValidationError(
          'Bot ID and phone number are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      if (!validatePhoneNumber(userPhoneNumber)) {
        throw new ValidationError(
          'Invalid phone number format',
          'INVALID_PHONE_NUMBER'
        );
      }

      // Verify bot exists
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { id: true, deletedAt: true },
      });

      if (!bot) {
        throw new NotFoundError('Bot not found', 'BOT_NOT_FOUND');
      }

      if (bot.deletedAt) {
        throw new NotFoundError('Bot has been deleted', 'BOT_DELETED');
      }

      // Try to find existing conversation
      let conversation = await prisma.conversation.findFirst({
        where: {
          botId,
          userPhoneNumber,
          deletedAt: null,
        },
      });

      // Create new conversation if not found
      if (!conversation) {
        logger.info(
          `Creating new conversation for bot ${botId} with phone ${userPhoneNumber}`
        );
        conversation = await prisma.conversation.create({
          data: {
            botId,
            userPhoneNumber,
            userName: userName || 'Unknown',
            userAvatarUrl,
            status: 'active',
            messageCount: 0,
          },
        });
      }

      return this.formatConversationResponse(conversation);
    } catch (error: any) {
      logger.error(
        `Error getting or creating conversation: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get conversation by ID
   */
  static async getConversationById(
    conversationId: string
  ): Promise<ConversationResponse | null> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation || conversation.deletedAt) {
        return null;
      }

      return this.formatConversationResponse(conversation);
    } catch (error: any) {
      logger.error(`Error getting conversation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update conversation metadata
   */
  static async updateConversationMetadata(
    input: UpdateConversationMetadataInput
  ): Promise<ConversationResponse> {
    try {
      const { conversationId, messageCount, lastMessageAt, status } = input;

      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      // Verify conversation exists
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, deletedAt: true },
      });

      if (!conversation) {
        throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
      }

      if (conversation.deletedAt) {
        throw new NotFoundError('Conversation has been deleted', 'CONVERSATION_DELETED');
      }

      // Build update data
      const updateData: any = {};
      if (messageCount !== undefined) {
        if (messageCount < 0) {
          throw new ValidationError(
            'Message count cannot be negative',
            'INVALID_MESSAGE_COUNT'
          );
        }
        updateData.messageCount = messageCount;
      }
      if (lastMessageAt !== undefined) {
        updateData.lastMessageAt = lastMessageAt;
      }
      if (status !== undefined) {
        const validStatuses = ['active', 'archived', 'closed'];
        if (!validStatuses.includes(status)) {
          throw new ValidationError(
            `Status must be one of: ${validStatuses.join(', ')}`,
            'INVALID_STATUS'
          );
        }
        updateData.status = status;
      }

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: updateData,
      });

      logger.info(`Updated conversation metadata for ${conversationId}`);
      return this.formatConversationResponse(updatedConversation);
    } catch (error: any) {
      logger.error(
        `Error updating conversation metadata: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get conversation history with pagination
   */
  static async getConversationHistory(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    messages: MessageResponse[];
    total: number;
    limit: number;
    offset: number;
  }> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      // Validate limit and offset
      if (limit < 1 || limit > 500) {
        throw new ValidationError(
          'Limit must be between 1 and 500',
          'INVALID_LIMIT'
        );
      }

      if (offset < 0) {
        throw new ValidationError(
          'Offset cannot be negative',
          'INVALID_OFFSET'
        );
      }

      // Verify conversation exists
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, deletedAt: true },
      });

      if (!conversation) {
        throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
      }

      if (conversation.deletedAt) {
        throw new NotFoundError('Conversation has been deleted', 'CONVERSATION_DELETED');
      }

      // Get total message count
      const total = await prisma.message.count({
        where: {
          conversationId: conversationId,
          deletedAt: null,
        },
      });

      // Get messages
      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversationId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      });

      const formattedMessages = messages.map((msg) => this.formatMessageResponse(msg));

      return {
        messages: formattedMessages,
        total,
        limit,
        offset,
      };
    } catch (error: any) {
      logger.error(`Error getting conversation history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a message in a conversation
   */
  static async createMessage(
    conversationId: string,
    botId: string,
    senderType: 'user' | 'bot',
    messageText: string,
    senderPhoneNumber?: string,
    senderName?: string,
    messageType: string = 'text',
    mediaUrl?: string,
    mediaType?: string,
    whatsappMessageId?: string
  ): Promise<MessageResponse> {
    try {
      // Validate inputs
      if (!conversationId || !botId || !messageText) {
        throw new ValidationError(
          'Conversation ID, bot ID, and message text are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      if (!['user', 'bot'].includes(senderType)) {
        throw new ValidationError(
          'Sender type must be either "user" or "bot"',
          'INVALID_SENDER_TYPE'
        );
      }

      if (messageText.length < 1 || messageText.length > 10000) {
        throw new ValidationError(
          'Message text must be between 1 and 10000 characters',
          'INVALID_MESSAGE_TEXT'
        );
      }

      // Verify conversation exists
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, botId: true, deletedAt: true },
      });

      if (!conversation) {
        throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
      }

      if (conversation.deletedAt) {
        throw new NotFoundError('Conversation has been deleted', 'CONVERSATION_DELETED');
      }

      if (conversation.botId !== botId) {
        throw new ValidationError(
          'Bot ID does not match conversation bot ID',
          'BOT_MISMATCH'
        );
      }

      // Create message
      const message = await prisma.message.create({
        data: {
          conversationId: conversationId,
          botId: botId,
          senderType: senderType,
          senderPhoneNumber: senderPhoneNumber,
          senderName: senderName,
          messageText: messageText,
          messageType: messageType,
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          whatsappMessageId: whatsappMessageId,
          status: 'received',
        },
      });

      logger.info(`Message created: ${message.id} in conversation: ${conversationId}`);

      return this.formatMessageResponse(message);
    } catch (error: any) {
      logger.error(`Error creating message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update message status
   */
  static async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    errorMessage?: string,
    processingTimeMs?: number,
    tokensUsed?: number,
    whatsappMessageId?: string
  ): Promise<MessageResponse> {
    try {
      if (!messageId) {
        throw new ValidationError(
          'Message ID is required',
          'MISSING_MESSAGE_ID'
        );
      }

      if (!validateMessageStatus(status)) {
        throw new ValidationError(
          'Invalid message status',
          'INVALID_MESSAGE_STATUS'
        );
      }

      // Verify message exists
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, deletedAt: true },
      });

      if (!message) {
        throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
      }

      if (message.deletedAt) {
        throw new NotFoundError('Message has been deleted', 'MESSAGE_DELETED');
      }

      // Build update data
      const updateData: any = {
        status: status,
      };

      if (errorMessage !== undefined) {
        updateData.errorMessage = errorMessage;
      }

      if (processingTimeMs !== undefined) {
        if (processingTimeMs < 0) {
          throw new ValidationError(
            'Processing time cannot be negative',
            'INVALID_PROCESSING_TIME'
          );
        }
        updateData.processingTimeMs = processingTimeMs;
      }

      if (tokensUsed !== undefined) {
        if (tokensUsed < 0) {
          throw new ValidationError(
            'Tokens used cannot be negative',
            'INVALID_TOKENS_USED'
          );
        }
        updateData.tokensUsed = tokensUsed;
      }

      if (whatsappMessageId !== undefined) {
        updateData.whatsappMessageId = whatsappMessageId;
      }

      // Update message
      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: updateData,
      });

      logger.info(`Message status updated: ${messageId} to ${status}`);

      return this.formatMessageResponse(updatedMessage);
    } catch (error: any) {
      logger.error(`Error updating message status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get messages by status
   */
  static async getMessagesByStatus(
    conversationId: string,
    status: MessageStatus,
    limit: number = 50
  ): Promise<MessageResponse[]> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      if (!validateMessageStatus(status)) {
        throw new ValidationError(
          'Invalid message status',
          'INVALID_MESSAGE_STATUS'
        );
      }

      if (limit < 1 || limit > 500) {
        throw new ValidationError(
          'Limit must be between 1 and 500',
          'INVALID_LIMIT'
        );
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversationId,
          status: status,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return messages.map((msg) => this.formatMessageResponse(msg));
    } catch (error: any) {
      logger.error(`Error getting messages by status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Increment message count
   */
  static async incrementMessageCount(conversationId: string): Promise<void> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          messageCount: {
            increment: 1,
          },
          lastMessageAt: new Date(),
        },
      });
    } catch (error: any) {
      logger.error(`Error incrementing message count: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format conversation response
   */
  private static formatConversationResponse(conversation: any): ConversationResponse {
    return {
      id: conversation.id,
      botId: conversation.botId,
      userPhoneNumber: conversation.userPhoneNumber,
      userName: conversation.userName,
      userAvatarUrl: conversation.userAvatarUrl,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  /**
   * Format message response
   */
  private static formatMessageResponse(message: any): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      botId: message.botId,
      senderType: message.senderType,
      senderPhoneNumber: message.senderPhoneNumber,
      senderName: message.senderName,
      messageText: message.messageText,
      messageType: message.messageType,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      whatsappMessageId: message.whatsappMessageId,
      status: message.status as MessageStatus,
      errorMessage: message.errorMessage,
      processingTimeMs: message.processingTimeMs,
      tokensUsed: message.tokensUsed,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }
}

export default ConversationService;
