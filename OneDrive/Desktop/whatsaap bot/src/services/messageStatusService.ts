/**
 * Message Status Service
 * Handles message status tracking, updates, and webhook processing for WhatsApp status updates
 */

import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import { ValidationError, NotFoundError } from '../utils/errors';

/**
 * WhatsApp status update payload structure
 */
export interface WhatsAppStatusUpdate {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipientId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Status update event for logging
 */
export interface StatusUpdateEvent {
  messageId: string;
  previousStatus: string;
  newStatus: string;
  timestamp: Date;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Message status metrics
 */
export interface MessageStatusMetrics {
  messageId: string;
  status: string;
  processingTimeMs?: number;
  tokensUsed?: number;
  deliveryTimeMs?: number;
  readTimeMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Valid message statuses
 */
export const VALID_MESSAGE_STATUSES = [
  'received',
  'processing',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

export type MessageStatus = typeof VALID_MESSAGE_STATUSES[number];

/**
 * MessageStatusService handles message status tracking and updates
 */
export class MessageStatusService {
  /**
   * Update message status with WhatsApp status update
   * Handles transitions: sent -> delivered -> read
   * Also handles failed status
   */
  static async updateMessageStatus(
    whatsappMessageId: string,
    statusUpdate: WhatsAppStatusUpdate
  ): Promise<StatusUpdateEvent> {
    try {
      // Validate inputs
      if (!whatsappMessageId || !statusUpdate.status) {
        throw new ValidationError(
          'WhatsApp message ID and status are required',
          'MISSING_REQUIRED_FIELDS'
        );
      }

      if (!this.isValidStatus(statusUpdate.status)) {
        throw new ValidationError(
          `Invalid status: ${statusUpdate.status}`,
          'INVALID_STATUS'
        );
      }

      // Find message by WhatsApp message ID
      const message = await prisma.message.findUnique({
        where: { whatsappMessageId },
        select: {
          id: true,
          status: true,
          conversationId: true,
          botId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      if (!message) {
        logger.warn(
          `Message not found for WhatsApp ID: ${whatsappMessageId}`,
          { whatsappMessageId, newStatus: statusUpdate.status }
        );
        throw new NotFoundError(
          `Message not found: ${whatsappMessageId}`,
          'MESSAGE_NOT_FOUND'
        );
      }

      if (message.deletedAt) {
        throw new NotFoundError(
          'Message has been deleted',
          'MESSAGE_DELETED'
        );
      }

      // Check if status transition is valid
      const isValidTransition = this.isValidStatusTransition(
        message.status,
        statusUpdate.status
      );

      if (!isValidTransition) {
        logger.warn(
          `Invalid status transition for message ${message.id}`,
          {
            currentStatus: message.status,
            newStatus: statusUpdate.status,
            whatsappMessageId,
          }
        );
        // Log but don't throw - allow idempotent updates
      }

      // Calculate delivery time if transitioning to delivered
      let deliveryTimeMs: number | undefined;
      if (
        statusUpdate.status === 'delivered' &&
        message.status !== 'delivered' &&
        message.status !== 'read'
      ) {
        const deliveryTime = new Date(parseInt(statusUpdate.timestamp) * 1000);
        deliveryTimeMs = deliveryTime.getTime() - message.createdAt.getTime();
      }

      // Calculate read time if transitioning to read
      let readTimeMs: number | undefined;
      if (statusUpdate.status === 'read' && message.status !== 'read') {
        const readTime = new Date(parseInt(statusUpdate.timestamp) * 1000);
        readTimeMs = readTime.getTime() - message.createdAt.getTime();
      }

      // Build update data
      const updateData: any = {
        status: statusUpdate.status,
        updatedAt: new Date(),
      };

      // Add error information if status is failed
      if (statusUpdate.status === 'failed') {
        updateData.errorMessage = statusUpdate.errorMessage || 'Message delivery failed';
      } else {
        // Clear error message on successful delivery
        updateData.errorMessage = null;
      }

      // Store delivery/read times in metadata if available
      if (deliveryTimeMs !== undefined || readTimeMs !== undefined) {
        // We'll store this in a separate tracking table or as JSON
        // For now, we'll just log it
        logger.info(
          `Message delivery metrics for ${message.id}`,
          {
            deliveryTimeMs,
            readTimeMs,
          }
        );
      }

      // Update message in database
      await prisma.message.update({
        where: { id: message.id },
        data: updateData,
      });

      // Create status update event for logging
      const statusEvent: StatusUpdateEvent = {
        messageId: message.id,
        previousStatus: message.status,
        newStatus: statusUpdate.status,
        timestamp: new Date(),
        errorMessage: statusUpdate.errorMessage,
        metadata: {
          whatsappMessageId,
          deliveryTimeMs,
          readTimeMs,
          conversationId: message.conversationId,
          botId: message.botId,
        },
      };

      // Log status change
      await this.logStatusChange(statusEvent);

      logger.info(
        `Message status updated: ${message.id}`,
        {
          previousStatus: message.status,
          newStatus: statusUpdate.status,
          whatsappMessageId,
          deliveryTimeMs,
          readTimeMs,
        }
      );

      return statusEvent;
    } catch (error: any) {
      logger.error(
        `Error updating message status: ${error.message}`,
        {
          whatsappMessageId,
          statusUpdate,
          error: error.stack,
        }
      );
      throw error;
    }
  }

  /**
   * Update message with processing metrics
   * Called after AI processing to store processing time and tokens used
   */
  static async updateMessageMetrics(
    messageId: string,
    processingTimeMs: number,
    tokensUsed: number
  ): Promise<MessageStatusMetrics> {
    try {
      // Validate inputs
      if (!messageId) {
        throw new ValidationError(
          'Message ID is required',
          'MISSING_MESSAGE_ID'
        );
      }

      if (processingTimeMs < 0) {
        throw new ValidationError(
          'Processing time cannot be negative',
          'INVALID_PROCESSING_TIME'
        );
      }

      if (tokensUsed < 0) {
        throw new ValidationError(
          'Tokens used cannot be negative',
          'INVALID_TOKENS_USED'
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

      // Update message with metrics
      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          processingTimeMs,
          tokensUsed,
          updatedAt: new Date(),
        },
      });

      logger.info(
        `Message metrics updated: ${messageId}`,
        {
          processingTimeMs,
          tokensUsed,
        }
      );

      return {
        messageId: updatedMessage.id,
        status: updatedMessage.status,
        processingTimeMs: updatedMessage.processingTimeMs || undefined,
        tokensUsed: updatedMessage.tokensUsed || undefined,
        createdAt: updatedMessage.createdAt,
        updatedAt: updatedMessage.updatedAt,
      };
    } catch (error: any) {
      logger.error(
        `Error updating message metrics: ${error.message}`,
        {
          messageId,
          processingTimeMs,
          tokensUsed,
          error: error.stack,
        }
      );
      throw error;
    }
  }

  /**
   * Get message status and metrics
   */
  static async getMessageStatus(
    messageId: string
  ): Promise<MessageStatusMetrics | null> {
    try {
      if (!messageId) {
        throw new ValidationError(
          'Message ID is required',
          'MISSING_MESSAGE_ID'
        );
      }

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          status: true,
          processingTimeMs: true,
          tokensUsed: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      if (!message || message.deletedAt) {
        return null;
      }

      return {
        messageId: message.id,
        status: message.status,
        processingTimeMs: message.processingTimeMs || undefined,
        tokensUsed: message.tokensUsed || undefined,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };
    } catch (error: any) {
      logger.error(
        `Error getting message status: ${error.message}`,
        { messageId }
      );
      throw error;
    }
  }

  /**
   * Get conversation status summary
   * Returns aggregated status information for all messages in a conversation
   */
  static async getConversationStatusSummary(
    conversationId: string
  ): Promise<{
    totalMessages: number;
    statusCounts: Record<string, number>;
    averageProcessingTimeMs: number;
    totalTokensUsed: number;
  }> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      // Get all messages in conversation
      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          deletedAt: null,
        },
        select: {
          status: true,
          processingTimeMs: true,
          tokensUsed: true,
        },
      });

      // Calculate statistics
      const statusCounts: Record<string, number> = {};
      let totalProcessingTime = 0;
      let messagesWithProcessingTime = 0;
      let totalTokensUsed = 0;

      for (const message of messages) {
        // Count statuses
        statusCounts[message.status] = (statusCounts[message.status] || 0) + 1;

        // Sum processing times
        if (message.processingTimeMs !== null) {
          totalProcessingTime += message.processingTimeMs;
          messagesWithProcessingTime++;
        }

        // Sum tokens
        if (message.tokensUsed !== null) {
          totalTokensUsed += message.tokensUsed;
        }
      }

      const averageProcessingTimeMs =
        messagesWithProcessingTime > 0
          ? Math.round(totalProcessingTime / messagesWithProcessingTime)
          : 0;

      return {
        totalMessages: messages.length,
        statusCounts,
        averageProcessingTimeMs,
        totalTokensUsed,
      };
    } catch (error: any) {
      logger.error(
        `Error getting conversation status summary: ${error.message}`,
        { conversationId }
      );
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
  ): Promise<MessageStatusMetrics[]> {
    try {
      if (!conversationId) {
        throw new ValidationError(
          'Conversation ID is required',
          'MISSING_CONVERSATION_ID'
        );
      }

      if (!this.isValidStatus(status)) {
        throw new ValidationError(
          `Invalid status: ${status}`,
          'INVALID_STATUS'
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
          conversationId,
          status,
          deletedAt: null,
        },
        select: {
          id: true,
          status: true,
          processingTimeMs: true,
          tokensUsed: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return messages.map((msg) => ({
        messageId: msg.id,
        status: msg.status,
        processingTimeMs: msg.processingTimeMs || undefined,
        tokensUsed: msg.tokensUsed || undefined,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      }));
    } catch (error: any) {
      logger.error(
        `Error getting messages by status: ${error.message}`,
        { conversationId, status }
      );
      throw error;
    }
  }

  /**
   * Check if status is valid
   */
  private static isValidStatus(status: string): boolean {
    return VALID_MESSAGE_STATUSES.includes(status as MessageStatus);
  }

  /**
   * Check if status transition is valid
   * Allowed transitions:
   * - received -> processing -> sent -> delivered -> read
   * - Any status -> failed (error state)
   * - Idempotent updates (same status)
   */
  private static isValidStatusTransition(
    currentStatus: string,
    newStatus: string
  ): boolean {
    // Idempotent - same status is always valid
    if (currentStatus === newStatus) {
      return true;
    }

    // Failed is always valid (error state)
    if (newStatus === 'failed') {
      return true;
    }

    // Define valid transitions
    const validTransitions: Record<string, string[]> = {
      received: ['processing', 'failed'],
      processing: ['sent', 'failed'],
      sent: ['delivered', 'failed'],
      delivered: ['read', 'failed'],
      read: ['failed'],
      failed: ['sent', 'delivered', 'read'], // Allow recovery from failed state
    };

    const allowedNextStatuses = validTransitions[currentStatus] || [];
    return allowedNextStatuses.includes(newStatus);
  }

  /**
   * Log status change event
   * Stores status change history for audit trail
   */
  private static async logStatusChange(event: StatusUpdateEvent): Promise<void> {
    try {
      logger.info(
        `Status change logged: ${event.messageId}`,
        {
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          timestamp: event.timestamp,
          errorMessage: event.errorMessage,
          metadata: event.metadata,
        }
      );

      // In a production system, you might want to store this in a separate audit table
      // For now, we're just logging it
    } catch (error: any) {
      logger.error(
        `Error logging status change: ${error.message}`,
        { event }
      );
      // Don't throw - logging errors shouldn't break the main flow
    }
  }

  /**
   * Handle failed message with retry logic
   */
  static async handleFailedMessage(
    messageId: string,
    errorMessage: string,
    errorCode?: string
  ): Promise<void> {
    try {
      if (!messageId) {
        throw new ValidationError(
          'Message ID is required',
          'MISSING_MESSAGE_ID'
        );
      }

      // Update message status to failed
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'failed',
          errorMessage: errorMessage || 'Unknown error',
          updatedAt: new Date(),
        },
      });

      logger.error(
        `Message marked as failed: ${messageId}`,
        {
          errorMessage,
          errorCode,
        }
      );
    } catch (error: any) {
      logger.error(
        `Error handling failed message: ${error.message}`,
        { messageId, errorMessage }
      );
      throw error;
    }
  }
}

export default MessageStatusService;
