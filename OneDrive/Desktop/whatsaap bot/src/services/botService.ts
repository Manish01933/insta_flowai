/**
 * Bot management service for CRUD operations and bot configuration
 */

import { PrismaClient, Bot } from '@prisma/client';
import crypto from 'crypto';
import logger from '../config/logger';
import { ValidationError, NotFoundError, AuthError, ConflictError } from '../utils/errors';

const prisma = new PrismaClient();

// Subscription tier limits
const SUBSCRIPTION_LIMITS = {
  free: 1,
  starter: 5,
  growth: 50,
  agency: 500,
};

// Supported languages for bot configuration
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'hi', 'ar', 'zh', 'ja'];

export interface CreateBotInput {
  name: string;
  description?: string;
  whatsapp_phone_number_id: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
  language?: string;
}

export interface UpdateBotInput {
  name?: string;
  description?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  language?: string;
}

export interface BotResponse {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  whatsapp_phone_number_id: string;
  webhook_url: string;
  webhook_verify_token: string;
  system_prompt?: string;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Validate bot name
 * Requirements: 1-100 chars, alphanumeric/spaces/hyphens
 */
export const validateBotName = (name: string): boolean => {
  if (!name || name.length < 1 || name.length > 100) {
    return false;
  }
  // Allow alphanumeric, spaces, and hyphens
  const nameRegex = /^[a-zA-Z0-9\s\-]+$/;
  return nameRegex.test(name);
};

/**
 * Validate system prompt
 * Requirements: 10-5000 chars
 */
export const validateSystemPrompt = (prompt: string): boolean => {
  if (!prompt || prompt.length < 10 || prompt.length > 5000) {
    return false;
  }
  return true;
};

/**
 * Validate temperature
 * Requirements: 0-2 (decimal with 2 places)
 */
export const validateTemperature = (temp: number): boolean => {
  if (temp === undefined || temp === null) {
    return true; // Optional, will use default
  }
  return temp >= 0 && temp <= 2;
};

/**
 * Validate max_tokens
 * Requirements: 1-4096
 */
export const validateMaxTokens = (tokens: number): boolean => {
  if (tokens === undefined || tokens === null) {
    return true; // Optional, will use default
  }
  return tokens >= 1 && tokens <= 4096;
};

/**
 * Validate language
 */
export const validateLanguage = (language?: string): boolean => {
  if (!language) {
    return true; // Optional
  }
  return SUPPORTED_LANGUAGES.includes(language);
};

/**
 * Generate webhook URL for a bot
 */
export const generateWebhookUrl = (botId: string): string => {
  return `${process.env.API_BASE_URL || 'https://api.botbazaar.com'}/api/webhooks/whatsapp/${botId}`;
};

/**
 * Generate webhook verify token
 */
export const generateWebhookVerifyToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Verify bot ownership
 */
export const verifyBotOwnership = async (botId: string, userId: string): Promise<boolean> => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { userId: true },
    });

    if (!bot) {
      return false;
    }

    return bot.userId === userId;
  } catch (error: any) {
    logger.error(`Error verifying bot ownership: ${error.message}`);
    return false;
  }
};

/**
 * Check subscription tier limits
 */
export const checkSubscriptionLimit = async (userId: string): Promise<boolean> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const tier = user.subscriptionTier as keyof typeof SUBSCRIPTION_LIMITS;
    const limit = SUBSCRIPTION_LIMITS[tier] || 1;

    // Count active bots for user
    const botCount = await prisma.bot.count({
      where: {
        userId: userId,
        deletedAt: null,
      },
    });

    return botCount < limit;
  } catch (error: any) {
    logger.error(`Error checking subscription limit: ${error.message}`);
    throw error;
  }
};

/**
 * Get subscription limit for user
 */
export const getSubscriptionLimit = async (userId: string): Promise<number> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    const tier = user.subscriptionTier as keyof typeof SUBSCRIPTION_LIMITS;
    return SUBSCRIPTION_LIMITS[tier] || 1;
  } catch (error: any) {
    logger.error(`Error getting subscription limit: ${error.message}`);
    throw error;
  }
};

/**
 * Create a new bot
 */
export const createBot = async (userId: string, input: CreateBotInput): Promise<BotResponse> => {
  try {
    // Validate inputs
    if (!validateBotName(input.name)) {
      throw new ValidationError(
        'Bot name must be 1-100 characters and contain only alphanumeric characters, spaces, and hyphens',
        'INVALID_BOT_NAME'
      );
    }

    if (!validateSystemPrompt(input.system_prompt)) {
      throw new ValidationError(
        'System prompt must be 10-5000 characters',
        'INVALID_SYSTEM_PROMPT'
      );
    }

    if (!validateTemperature(input.temperature || 0.7)) {
      throw new ValidationError(
        'Temperature must be between 0 and 2',
        'INVALID_TEMPERATURE'
      );
    }

    if (!validateMaxTokens(input.max_tokens || 1024)) {
      throw new ValidationError(
        'Max tokens must be between 1 and 4096',
        'INVALID_MAX_TOKENS'
      );
    }

    if (!validateLanguage(input.language)) {
      throw new ValidationError(
        `Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
        'INVALID_LANGUAGE'
      );
    }

    // Check subscription limit
    const canCreate = await checkSubscriptionLimit(userId);
    if (!canCreate) {
      const limit = await getSubscriptionLimit(userId);
      throw new ValidationError(
        `You have reached the maximum number of bots (${limit}) for your subscription tier`,
        'SUBSCRIPTION_LIMIT_EXCEEDED'
      );
    }

    // Check if WhatsApp phone number is already used
    const existingBot = await prisma.bot.findUnique({
      where: { whatsappPhoneNumberId: input.whatsapp_phone_number_id },
    });

    if (existingBot) {
      throw new ConflictError(
        'This WhatsApp phone number is already associated with another bot',
        'PHONE_NUMBER_ALREADY_USED'
      );
    }

    // Generate webhook credentials
    const webhookVerifyToken = generateWebhookVerifyToken();

    // Create bot
    const bot = await prisma.bot.create({
      data: {
        userId: userId,
        name: input.name,
        description: input.description,
        whatsappPhoneNumberId: input.whatsapp_phone_number_id,
        systemPrompt: input.system_prompt,
        temperature: input.temperature || 0.7,
        maxTokens: input.max_tokens || 1024,
        webhookVerifyToken: webhookVerifyToken,
        isActive: true,
      },
    });

    // Generate webhook URL
    const webhookUrl = generateWebhookUrl(bot.id);

    // Update bot with webhook URL
    const updatedBot = await prisma.bot.update({
      where: { id: bot.id },
      data: { webhookUrl: webhookUrl },
    });

    logger.info(`Bot created: ${bot.id} for user: ${userId}`);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'BOT_CREATED',
        resourceType: 'bot',
        resourceId: bot.id,
        changes: {
          name: input.name,
          whatsapp_phone_number_id: input.whatsapp_phone_number_id,
        },
      },
    });

    return formatBotResponse(updatedBot);
  } catch (error: any) {
    logger.error(`Error creating bot: ${error.message}`);
    throw error;
  }
};

/**
 * Get bot by ID
 */
export const getBotById = async (botId: string, userId: string): Promise<BotResponse> => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
    });

    if (!bot) {
      throw new NotFoundError('Bot not found', 'BOT_NOT_FOUND');
    }

    // Verify ownership
    if (bot.userId !== userId) {
      throw new AuthError('You do not have permission to access this bot', 'UNAUTHORIZED');
    }

    return formatBotResponse(bot);
  } catch (error: any) {
    logger.error(`Error getting bot: ${error.message}`);
    throw error;
  }
};

/**
 * Get all bots for a user with pagination
 */
export const getBotsByUserId = async (
  userId: string,
  page: number = 1,
  limit: number = 20,
  status?: string
) => {
  try {
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      userId: userId,
      deletedAt: null,
    };

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    // Get total count
    const total = await prisma.bot.count({ where });

    // Get bots with message count
    const bots = await prisma.bot.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const formattedBots = bots.map((bot: any) => ({
      ...formatBotResponse(bot),
      message_count: bot._count.messages,
    }));

    return {
      data: formattedBots,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error: any) {
    logger.error(`Error getting bots: ${error.message}`);
    throw error;
  }
};

/**
 * Update bot
 */
export const updateBot = async (
  botId: string,
  userId: string,
  input: UpdateBotInput
): Promise<BotResponse> => {
  try {
    // Verify ownership
    const isOwner = await verifyBotOwnership(botId, userId);
    if (!isOwner) {
      throw new AuthError('You do not have permission to update this bot', 'UNAUTHORIZED');
    }

    // Validate inputs if provided
    if (input.name && !validateBotName(input.name)) {
      throw new ValidationError(
        'Bot name must be 1-100 characters and contain only alphanumeric characters, spaces, and hyphens',
        'INVALID_BOT_NAME'
      );
    }

    if (input.system_prompt && !validateSystemPrompt(input.system_prompt)) {
      throw new ValidationError(
        'System prompt must be 10-5000 characters',
        'INVALID_SYSTEM_PROMPT'
      );
    }

    if (input.temperature !== undefined && !validateTemperature(input.temperature)) {
      throw new ValidationError(
        'Temperature must be between 0 and 2',
        'INVALID_TEMPERATURE'
      );
    }

    if (input.max_tokens !== undefined && !validateMaxTokens(input.max_tokens)) {
      throw new ValidationError(
        'Max tokens must be between 1 and 4096',
        'INVALID_MAX_TOKENS'
      );
    }

    if (input.language && !validateLanguage(input.language)) {
      throw new ValidationError(
        `Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
        'INVALID_LANGUAGE'
      );
    }

    // Get current bot for audit log
    const currentBot = await prisma.bot.findUnique({
      where: { id: botId },
    });

    if (!currentBot) {
      throw new NotFoundError('Bot not found', 'BOT_NOT_FOUND');
    }

    // Update bot
    const updateData: any = {};
    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.system_prompt) updateData.systemPrompt = input.system_prompt;
    if (input.temperature !== undefined) updateData.temperature = input.temperature;
    if (input.max_tokens !== undefined) updateData.maxTokens = input.max_tokens;

    const updatedBot = await prisma.bot.update({
      where: { id: botId },
      data: updateData,
    });

    logger.info(`Bot updated: ${botId}`);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'BOT_UPDATED',
        resourceType: 'bot',
        resourceId: botId,
        changes: updateData,
      },
    });

    return formatBotResponse(updatedBot);
  } catch (error: any) {
    logger.error(`Error updating bot: ${error.message}`);
    throw error;
  }
};

/**
 * Delete bot (soft delete)
 */
export const deleteBot = async (botId: string, userId: string): Promise<void> => {
  try {
    // Verify ownership
    const isOwner = await verifyBotOwnership(botId, userId);
    if (!isOwner) {
      throw new AuthError('You do not have permission to delete this bot', 'UNAUTHORIZED');
    }

    // Soft delete bot
    await prisma.bot.update({
      where: { id: botId },
      data: { deletedAt: new Date() },
    });

    // Soft delete related conversations and messages
    const conversations = await prisma.conversation.findMany({
      where: { botId: botId },
      select: { id: true },
    });

    for (const conversation of conversations) {
      await prisma.message.updateMany(
        {
          where: { conversationId: conversation.id },
          data: { deletedAt: new Date() },
        }
      );
    }

    await prisma.conversation.updateMany(
      {
        where: { botId: botId },
        data: { deletedAt: new Date() },
      }
    );

    logger.info(`Bot deleted: ${botId}`);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'BOT_DELETED',
        resourceType: 'bot',
        resourceId: botId,
      },
    });
  } catch (error: any) {
    logger.error(`Error deleting bot: ${error.message}`);
    throw error;
  }
};

/**
 * Get bot statistics
 */
export const getBotStatistics = async (botId: string, userId: string) => {
  try {
    // Verify ownership
    const isOwner = await verifyBotOwnership(botId, userId);
    if (!isOwner) {
      throw new AuthError('You do not have permission to access this bot', 'UNAUTHORIZED');
    }

    const messageCount = await prisma.message.count({
      where: { botId: botId },
    });

    const conversationCount = await prisma.conversation.count({
      where: { botId: botId },
    });

    return {
      message_count: messageCount,
      conversation_count: conversationCount,
    };
  } catch (error: any) {
    logger.error(`Error getting bot statistics: ${error.message}`);
    throw error;
  }
};

/**
 * Format bot response
 */
const formatBotResponse = (bot: Bot): BotResponse => {
  return {
    id: bot.id,
    user_id: bot.userId,
    name: bot.name,
    description: bot.description || undefined,
    whatsapp_phone_number_id: bot.whatsappPhoneNumberId,
    webhook_url: bot.webhookUrl || generateWebhookUrl(bot.id),
    webhook_verify_token: bot.webhookVerifyToken || '',
    system_prompt: bot.systemPrompt || undefined,
    temperature: Number(bot.temperature),
    max_tokens: bot.maxTokens,
    is_active: bot.isActive,
    created_at: bot.createdAt,
    updated_at: bot.updatedAt,
  };
};
