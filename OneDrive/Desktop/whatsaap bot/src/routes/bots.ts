/**
 * Bot management routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  createBot,
  getBotById,
  getBotsByUserId,
  updateBot,
  deleteBot,
  getBotStatistics,
  CreateBotInput,
  UpdateBotInput,
} from '../services/botService';
import { ValidationError, NotFoundError } from '../utils/errors';
import logger from '../config/logger';
import axios from 'axios';
import {
  enforceMaxBotsLimit,
  subscriptionTierChecker,
  attachSubscriptionTierInfo,
} from '../middleware/subscriptionTierChecker';

const router = Router();

// Middleware to ensure authentication and check subscription tier
router.use(authenticateToken);
router.use(subscriptionTierChecker);
router.use(attachSubscriptionTierInfo);

/**
 * POST /api/bots
 * Create a new bot
 */
router.post(
  '/',
  enforceMaxBotsLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const input: CreateBotInput = req.body;

    const bot = await createBot(userId, input);

    res.status(201).json({
      success: true,
      data: bot,
    });
  })
);

/**
 * GET /api/bots
 * List all bots for authenticated user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;

    // Validate pagination
    if (page < 1 || limit < 1 || limit > 100) {
      throw new ValidationError('Invalid pagination parameters', 'INVALID_PAGINATION');
    }

    const result = await getBotsByUserId(userId, page, limit, status);

    res.status(200).json({
      success: true,
      ...result,
    });
  })
);

/**
 * GET /api/bots/:botId
 * Get bot details
 */
router.get(
  '/:botId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;

    const bot = await getBotById(botId, userId);

    // Get statistics
    const stats = await getBotStatistics(botId, userId);

    res.status(200).json({
      success: true,
      data: {
        ...bot,
        ...stats,
      },
    });
  })
);

/**
 * PUT /api/bots/:botId
 * Update bot configuration
 */
router.put(
  '/:botId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;
    const input: UpdateBotInput = req.body;

    const bot = await updateBot(botId, userId, input);

    res.status(200).json({
      success: true,
      data: bot,
    });
  })
);

/**
 * DELETE /api/bots/:botId
 * Delete a bot (soft delete)
 */
router.delete(
  '/:botId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;

    await deleteBot(botId, userId);

    res.status(204).send();
  })
);

/**
 * POST /api/bots/:botId/test
 * Test bot with a sample message
 */
router.post(
  '/:botId/test',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;
    const { message } = req.body;

    // Validate message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new ValidationError('Message is required and must be a non-empty string', 'INVALID_MESSAGE');
    }

    // Get bot
    const bot = await getBotById(botId, userId);

    // Call Claude API
    const startTime = Date.now();
    
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: bot.max_tokens,
          system: bot.system_prompt || 'You are a helpful assistant.',
          messages: [
            {
              role: 'user',
              content: message,
            },
          ],
          temperature: bot.temperature,
        },
        {
          headers: {
            'x-api-key': process.env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        }
      );

      const processingTime = Date.now() - startTime;
      const responseText = response.data.content[0].text;
      const tokensUsed = response.data.usage.output_tokens;

      logger.info(`Bot test executed: ${botId}, processing time: ${processingTime}ms`);

      res.status(200).json({
        success: true,
        data: {
          response: responseText,
          processing_time_ms: processingTime,
          tokens_used: tokensUsed,
        },
      });
    } catch (error: any) {
      logger.error(`Claude API error: ${error.message}`);
      
      if (error.response?.status === 401) {
        throw new ValidationError('Claude API key is invalid or missing', 'CLAUDE_API_ERROR');
      }
      
      throw new ValidationError(
        `Failed to get response from Claude API: ${error.message}`,
        'CLAUDE_API_ERROR'
      );
    }
  })
);

/**
 * GET /api/bots/:botId/conversations
 * List conversations for a bot with pagination
 */
router.get(
  '/:botId/conversations',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;
    const pageRaw = req.query.page;
    const limitRaw = req.query.limit;
    const page = pageRaw !== undefined ? parseInt(pageRaw as string) : 1;
    const limit = limitRaw !== undefined ? parseInt(limitRaw as string) : 20;
    const status = req.query.status as string | undefined;

    // Validate pagination
    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Invalid pagination parameters', 'INVALID_PAGINATION');
    }

    // Validate status filter if provided
    const validStatuses = ['active', 'archived', 'closed'];
    if (status && !validStatuses.includes(status)) {
      throw new ValidationError(
        `Status must be one of: ${validStatuses.join(', ')}`,
        'INVALID_STATUS_FILTER'
      );
    }

    // Verify bot exists and user owns it
    const bot = await getBotById(botId, userId);
    if (!bot) {
      throw new NotFoundError('Bot not found', 'BOT_NOT_FOUND');
    }

    // Build query - exclude soft-deleted conversations
    const where: any = { botId, deletedAt: null };
    if (status) {
      where.status = status;
    }

    // Get total count
    const total = await prisma.conversation.count({ where });

    // Get conversations with pagination
    const conversations = await prisma.conversation.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
    });

    const pages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: conversations.map((conv) => ({
        id: conv.id,
        botId: conv.botId,
        userPhoneNumber: conv.userPhoneNumber,
        userName: conv.userName,
        userAvatarUrl: conv.userAvatarUrl,
        messageCount: conv.messageCount,
        lastMessageAt: conv.lastMessageAt,
        status: conv.status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    });
  })
);

/**
 * GET /api/bots/:botId/conversations/:conversationId/messages
 * Get messages in a conversation with pagination and sorting
 */
router.get(
  '/:botId/conversations/:conversationId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.botId;
    const conversationId = req.params.conversationId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) || 'asc';

    // Validate pagination and sorting parameters
    if (page < 1 || limit < 1 || limit > 500) {
      throw new ValidationError('Invalid pagination parameters', 'INVALID_PAGINATION');
    }

    if (!['asc', 'desc'].includes(sortOrder.toLowerCase())) {
      throw new ValidationError(
        'Sort order must be "asc" or "desc"',
        'INVALID_SORT_ORDER'
      );
    }

    if (!['createdAt', 'status'].includes(sortBy)) {
      throw new ValidationError(
        'Sort by must be "createdAt" or "status"',
        'INVALID_SORT_BY'
      );
    }

    // Verify bot exists and user owns it
    const bot = await getBotById(botId, userId);
    if (!bot) {
      throw new NotFoundError('Bot not found', 'BOT_NOT_FOUND');
    }

    // Verify conversation exists and belongs to the bot
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
        'Conversation does not belong to this bot',
        'CONVERSATION_BOT_MISMATCH'
      );
    }

    // Build query
    const where = {
      conversationId,
      deletedAt: null,
    };

    // Get total message count
    const total = await prisma.message.count({ where });

    // Get messages with pagination and sorting
    const messages = await prisma.message.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: {
        [sortBy]: sortOrder.toLowerCase() as 'asc' | 'desc',
      },
    });

    const pages = Math.ceil(total / limit);

    // Format messages according to MessageResponse interface
    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      conversationId: msg.conversationId,
      botId: msg.botId,
      senderType: msg.senderType,
      senderPhoneNumber: msg.senderPhoneNumber,
      senderName: msg.senderName,
      messageText: msg.messageText,
      messageType: msg.messageType,
      mediaUrl: msg.mediaUrl,
      mediaType: msg.mediaType,
      whatsappMessageId: msg.whatsappMessageId,
      status: msg.status,
      errorMessage: msg.errorMessage,
      processingTimeMs: msg.processingTimeMs,
      tokensUsed: msg.tokensUsed,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));

    logger.info(
      `Retrieved ${formattedMessages.length} messages for conversation ${conversationId} (page ${page})`
    );

    res.status(200).json({
      success: true,
      data: formattedMessages,
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    });
  })
);

export default router;
