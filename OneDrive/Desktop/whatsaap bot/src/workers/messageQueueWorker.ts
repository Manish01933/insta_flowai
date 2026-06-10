import { Job } from 'bull';
import { getMessageQueue, MessageQueueData } from '../config/queue';
import { prisma } from '../utils/prisma';
import logger from '../config/logger';
import ConversationService, { validatePhoneNumber } from '../services/conversationService';
import { RateLimitService } from '../services/rateLimitService';
import MessageStatusService from '../services/messageStatusService';
import { claudeService } from '../services/claudeService';
import { RateLimitError } from '../utils/errors';
import SubscriptionTierService, {
  SubscriptionLimitError,
} from '../services/subscriptionTierService';

/**
 * Message queue job data interface (extends MessageQueueData)
 */
export interface MessageQueueJobData extends MessageQueueData {
  senderName?: string;
}

/**
 * Validate message data
 */
const validateMessageData = (data: any): MessageQueueJobData => {
  const { botId, from, messageId, text, timestamp } = data;

  // Validate required fields in order
  if (!botId || typeof botId !== 'string') {
    throw new Error('Invalid or missing botId');
  }

  if (!from || typeof from !== 'string') {
    throw new Error('Invalid or missing from (phone number)');
  }

  if (!messageId || typeof messageId !== 'string') {
    throw new Error('Invalid or missing messageId');
  }

  if (!text || typeof text !== 'string') {
    throw new Error('Invalid or missing text');
  }

  if (!timestamp || typeof timestamp !== 'string') {
    throw new Error('Invalid or missing timestamp');
  }

  // Validate phone number format after all required fields are present
  if (!validatePhoneNumber(from)) {
    throw new Error('Invalid phone number format');
  }

  return {
    botId,
    from,
    messageId,
    text,
    timestamp,
    senderName: data.senderName,
    mediaUrl: data.mediaUrl,
    mediaType: data.mediaType,
  };
};

/**
 * Look up bot configuration from database
 */
const lookupBot = async (botId: string) => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      include: {
        user: {
          select: {
            id: true,
            subscriptionTier: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    if (bot.deletedAt) {
      throw new Error(`Bot is deleted: ${botId}`);
    }

    if (!bot.isActive) {
      throw new Error(`Bot is inactive: ${botId}`);
    }

    return bot;
  } catch (error: any) {
    logger.error(`Error looking up bot ${botId}: ${error.message}`);
    throw error;
  }
};

/**
 * Save incoming message to database
 */
const saveIncomingMessage = async (
  conversationId: string,
  botId: string,
  data: MessageQueueJobData
) => {
  try {
    const message = await prisma.message.create({
      data: {
        conversationId,
        botId,
        senderType: 'user',
        senderPhoneNumber: data.from,
        senderName: data.senderName || 'Unknown',
        messageText: data.text,
        messageType: data.mediaType ? 'media' : 'text',
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType,
        whatsappMessageId: data.messageId,
        status: 'received',
        createdAt: new Date(parseInt(data.timestamp) * 1000),
      },
    });

    logger.info(
      `Saved incoming message ${message.id} for conversation ${conversationId}`
    );
    return message;
  } catch (error: any) {
    logger.error(`Error saving incoming message: ${error.message}`);
    throw error;
  }
};

/**
 * Update message status
 */
const updateMessageStatus = async (
  messageId: string,
  status: string,
  errorMessage?: string
) => {
  try {
    const updateData: any = { status };
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    await prisma.message.update({
      where: { id: messageId },
      data: updateData,
    });

    logger.info(`Updated message ${messageId} status to ${status}`);
  } catch (error: any) {
    logger.error(`Error updating message status: ${error.message}`);
    throw error;
  }
};

/**
 * Process message queue job
 */
export const processMessageJob = async (job: Job<MessageQueueJobData>) => {
  const jobId = job.id;
  const data = job.data;

  logger.info(`Processing message queue job ${jobId}`, { data });

  try {
    // Step 1: Validate message data
    logger.debug(`Validating message data for job ${jobId}`);
    const validatedData = validateMessageData(data);

    // Step 2: Look up bot configuration
    logger.debug(`Looking up bot ${validatedData.botId}`);
    const bot = await lookupBot(validatedData.botId);

    // Step 3: Check rate limits before processing
    logger.debug(`Checking rate limits for user ${bot.userId} and bot ${validatedData.botId}`);
    
    // Check subscription tier message limit
    try {
      await SubscriptionTierService.checkMessageSendingAllowed(bot.userId);
      logger.debug(`Subscription message limit check passed for user ${bot.userId}`);
    } catch (error: any) {
      if (error instanceof SubscriptionLimitError) {
        logger.warn(
          `Subscription message limit exceeded for user ${bot.userId}: ${error.message}`
        );
        // Log tier violation
        await SubscriptionTierService.logTierViolation(
          bot.userId,
          'MESSAGE_LIMIT_EXCEEDED',
          {
            tierLimit: error.tierLimit,
            currentValue: error.currentValue,
            limit: error.limit,
          }
        );
        throw error;
      }
      throw error;
    }

    // Check monthly quota
    try {
      await RateLimitService.enforceMonthlyQuota(bot.userId);
      logger.debug(`Monthly quota check passed for user ${bot.userId}`);
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        logger.warn(`Monthly quota exceeded for user ${bot.userId}: ${error.message}`);
        throw error;
      }
      throw error;
    }

    // Check WhatsApp API rate limit
    try {
      await RateLimitService.enforceWhatsAppRateLimit(validatedData.botId);
      logger.debug(`WhatsApp rate limit check passed for bot ${validatedData.botId}`);
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        logger.warn(`WhatsApp rate limit exceeded for bot ${validatedData.botId}: ${error.message}`);
        throw error;
      }
      throw error;
    }

    // Step 4: Get or create conversation
    logger.debug(
      `Getting or creating conversation for bot ${validatedData.botId} and phone ${validatedData.from}`
    );
    const conversation = await ConversationService.getOrCreateConversation({
      botId: validatedData.botId,
      userPhoneNumber: validatedData.from,
      userName: validatedData.senderName,
    });

    // Step 5: Save incoming message with status 'received'
    logger.debug(`Saving incoming message for conversation ${conversation.id}`);
    const incomingMessage = await saveIncomingMessage(
      conversation.id,
      validatedData.botId,
      validatedData
    );

    // Step 6: Update message status to 'processing'
    logger.debug(`Updating message ${incomingMessage.id} status to processing`);
    await updateMessageStatus(incomingMessage.id, 'processing');

    // Step 7: Update conversation metadata
    logger.debug(`Updating conversation metadata for ${conversation.id}`);
    await ConversationService.incrementMessageCount(conversation.id);

    // Step 8: Process message with Claude API to generate response
    logger.debug(`Processing message with Claude API for conversation ${conversation.id}`);
    let claudeResponse: any;
    let botResponseMessage: any;
    
    try {
      claudeResponse = await claudeService.processMessage(
        conversation.id,
        validatedData.text,
        bot.systemPrompt || 'You are a helpful assistant.',
        Number(bot.temperature) || 0.7,
        Number(bot.maxTokens) || 1024,
        bot.name,
        bot.description || undefined,
        true // includeHistory
      );

      logger.info(`Claude API response received for conversation ${conversation.id}`, {
        tokensUsed: claudeResponse.tokensUsed,
        processingTimeMs: claudeResponse.processingTimeMs,
      });

      // Step 9: Save bot response message
      logger.debug(`Saving bot response message for conversation ${conversation.id}`);
      botResponseMessage = await ConversationService.createMessage(
        conversation.id,
        validatedData.botId,
        'bot',
        claudeResponse.response,
        undefined, // senderPhoneNumber
        bot.name,
        'text',
        undefined, // mediaUrl
        undefined  // mediaType
      );

      // Step 10: Update bot message with processing metrics
      logger.debug(`Updating bot message metrics for ${botResponseMessage.id}`);
      await MessageStatusService.updateMessageMetrics(
        botResponseMessage.id,
        claudeResponse.processingTimeMs,
        claudeResponse.tokensUsed
      );

      // Step 11: Update bot message status to 'sent'
      logger.debug(`Updating bot message status to sent for ${botResponseMessage.id}`);
      await updateMessageStatus(botResponseMessage.id, 'sent');

      // Step 12: Update incoming message status to 'sent' (processed successfully)
      logger.debug(`Updating incoming message status to sent for ${incomingMessage.id}`);
      await updateMessageStatus(incomingMessage.id, 'sent');

    } catch (claudeError: any) {
      logger.error(
        `Error processing message with Claude API: ${claudeError.message}`,
        { conversationId: conversation.id, botId: validatedData.botId }
      );

      // Update incoming message status to 'failed' with error
      await MessageStatusService.handleFailedMessage(
        incomingMessage.id,
        `Claude API error: ${claudeError.message}`
      );

      // Don't throw - allow the job to complete as we've recorded the error
      return {
        success: false,
        incomingMessageId: incomingMessage.id,
        conversationId: conversation.id,
        botId: validatedData.botId,
        error: `Claude API processing failed: ${claudeError.message}`,
      };
    }

    // Step 13: Return success
    logger.info(`Successfully processed message job ${jobId}`, {
      incomingMessageId: incomingMessage.id,
      botResponseMessageId: botResponseMessage?.id,
      conversationId: conversation.id,
      botId: validatedData.botId,
    });

    return {
      success: true,
      incomingMessageId: incomingMessage.id,
      botResponseMessageId: botResponseMessage?.id,
      conversationId: conversation.id,
      botId: validatedData.botId,
    };
  } catch (error: any) {
    logger.error(`Error processing message job ${jobId}: ${error.message}`, {
      data,
      error: error.stack,
    });

    // Throw error to trigger retry
    throw error;
  }
};

/**
 * Register message queue processor
 */
export const registerMessageQueueProcessor = async (
  concurrency: number = 5
): Promise<void> => {
  try {
    logger.info(`Registering message queue processor with concurrency ${concurrency}`);

    const queue = getMessageQueue();
    queue.process(concurrency, processMessageJob);

    logger.info('Message queue processor registered successfully');
  } catch (error: any) {
    logger.error(
      `Failed to register message queue processor: ${error.message}`
    );
    throw error;
  }
};

export default {
  registerMessageQueueProcessor,
  processMessageJob,
};
