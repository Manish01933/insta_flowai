/**
 * WhatsApp webhook service
 * Handles webhook signature verification and message extraction
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { ValidationError } from '../utils/errors';

const prisma = new PrismaClient();

/**
 * WhatsApp message payload structure
 */
export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
  };
  document?: {
    id: string;
    mime_type: string;
    filename: string;
  };
  audio?: {
    id: string;
    mime_type: string;
  };
  video?: {
    id: string;
    mime_type: string;
  };
}

/**
 * Extracted message data for processing
 */
export interface ExtractedMessage {
  botId: string;
  from: string;
  messageId: string;
  timestamp: string;
  type: string;
  text?: string;
  mediaId?: string;
  mediaType?: string;
  mediaUrl?: string;
}

/**
 * Verify webhook signature using HMAC-SHA256
 * WhatsApp sends X-Hub-Signature-256 header with format: sha256=<signature>
 *
 * @param body - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param webhookSecret - Webhook secret from environment
 * @returns true if signature is valid, false otherwise
 */
export const verifyWebhookSignature = (
  body: string,
  signature: string,
  webhookSecret: string
): boolean => {
  try {
    // Extract the hash from the signature header (format: sha256=<hash>)
    const [algorithm, hash] = signature.split('=');

    if (algorithm !== 'sha256') {
      logger.warn(`Invalid signature algorithm: ${algorithm}`);
      return false;
    }

    // Calculate HMAC-SHA256 hash
    const calculatedHash = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    // Compare hashes using constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(calculatedHash)
    );

    return isValid;
  } catch (error: any) {
    logger.error(`Webhook signature verification error: ${error.message}`);
    return false;
  }
};

/**
 * Extract messages from WhatsApp webhook payload
 *
 * @param payload - WhatsApp webhook payload
 * @param botId - Bot ID from URL parameter
 * @returns Array of extracted messages
 */
export const extractMessages = (
  payload: any,
  botId: string
): ExtractedMessage[] => {
  const messages: ExtractedMessage[] = [];

  try {
    // WhatsApp webhook structure: entry[].changes[].value.messages[]
    if (!payload.entry || !Array.isArray(payload.entry)) {
      logger.warn('Invalid webhook payload: missing entry array');
      return messages;
    }

    for (const entry of payload.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        if (change.field !== 'messages' || !change.value) {
          continue;
        }

        const value = change.value;

        // Extract messages from the value
        if (value.messages && Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            const extracted = extractSingleMessage(msg, botId);
            if (extracted) {
              messages.push(extracted);
            }
          }
        }
      }
    }

    return messages;
  } catch (error: any) {
    logger.error(`Error extracting messages from webhook: ${error.message}`);
    return messages;
  }
};

/**
 * Extract a single message from WhatsApp message object
 *
 * @param msg - WhatsApp message object
 * @param botId - Bot ID
 * @returns Extracted message or null if invalid
 */
const extractSingleMessage = (msg: WhatsAppMessage, botId: string): ExtractedMessage | null => {
  try {
    // Validate required fields
    if (!msg.from || !msg.id || !msg.timestamp || !msg.type) {
      logger.warn('Invalid message: missing required fields');
      return null;
    }

    const extracted: ExtractedMessage = {
      botId,
      from: msg.from,
      messageId: msg.id,
      timestamp: msg.timestamp,
      type: msg.type,
    };

    // Extract message content based on type
    switch (msg.type) {
      case 'text':
        if (msg.text?.body) {
          extracted.text = msg.text.body;
        } else {
          logger.warn(`Text message missing body: ${msg.id}`);
          return null;
        }
        break;

      case 'image':
        if (msg.image?.id) {
          extracted.mediaId = msg.image.id;
          extracted.mediaType = msg.image.mime_type || 'image/jpeg';
        } else {
          logger.warn(`Image message missing ID: ${msg.id}`);
          return null;
        }
        break;

      case 'document':
        if (msg.document?.id) {
          extracted.mediaId = msg.document.id;
          extracted.mediaType = msg.document.mime_type || 'application/octet-stream';
        } else {
          logger.warn(`Document message missing ID: ${msg.id}`);
          return null;
        }
        break;

      case 'audio':
        if (msg.audio?.id) {
          extracted.mediaId = msg.audio.id;
          extracted.mediaType = msg.audio.mime_type || 'audio/ogg';
        } else {
          logger.warn(`Audio message missing ID: ${msg.id}`);
          return null;
        }
        break;

      case 'video':
        if (msg.video?.id) {
          extracted.mediaId = msg.video.id;
          extracted.mediaType = msg.video.mime_type || 'video/mp4';
        } else {
          logger.warn(`Video message missing ID: ${msg.id}`);
          return null;
        }
        break;

      default:
        logger.warn(`Unsupported message type: ${msg.type}`);
        return null;
    }

    return extracted;
  } catch (error: any) {
    logger.error(`Error extracting single message: ${error.message}`);
    return null;
  }
};

/**
 * Validate bot exists and is active
 *
 * @param botId - Bot ID to validate
 * @returns Bot object if valid, throws error otherwise
 */
export const validateBot = async (botId: string) => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      include: { user: true },
    });

    if (!bot) {
      throw new ValidationError('Bot not found', 'BOT_NOT_FOUND');
    }

    if (!bot.isActive) {
      throw new ValidationError('Bot is not active', 'BOT_INACTIVE');
    }

    if (bot.deletedAt) {
      throw new ValidationError('Bot has been deleted', 'BOT_DELETED');
    }

    return bot;
  } catch (error: any) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`Error validating bot: ${error.message}`);
    throw new ValidationError('Failed to validate bot', 'BOT_VALIDATION_ERROR');
  }
};

/**
 * Queue message for processing using Bull queue
 * Adds message to Redis queue for async processing
 *
 * @param message - Extracted message to queue
 */
export const queueMessage = async (message: ExtractedMessage): Promise<void> => {
  try {
    const { addMessageToQueue } = require('../config/queue');

    // Convert extracted message to queue data format
    const queueData = {
      botId: message.botId,
      from: message.from,
      messageId: message.messageId,
      text: message.text || '',
      timestamp: message.timestamp,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    };

    // Add to queue with retry logic
    const job = await addMessageToQueue(queueData);

    logger.info(`Message queued for processing: ${message.messageId}`, {
      jobId: job.id,
      botId: message.botId,
      from: message.from,
      type: message.type,
    });
  } catch (error: any) {
    logger.error(`Error queuing message: ${error.message}`);
    throw error;
  }
};
