/**
 * Bot template service for template management
 */

import { PrismaClient, BotTemplate } from '@prisma/client';
import logger from '../config/logger';
import { ValidationError, NotFoundError, AuthError } from '../utils/errors';

const prisma = new PrismaClient();

// Template categories
export const TEMPLATE_CATEGORIES = [
  'customer-support',
  'sales',
  'hr',
  'education',
  'healthcare',
  'ecommerce',
  'general',
  'custom',
];

export interface CreateTemplateInput {
  name: string;
  description?: string;
  category: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
  is_public?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  category?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  is_public?: boolean;
}

export interface TemplateResponse {
  id: string;
  name: string;
  description?: string;
  category: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  is_public: boolean;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Validate template name
 */
export const validateTemplateName = (name: string): boolean => {
  if (!name || name.length < 1 || name.length > 255) {
    return false;
  }
  return true;
};

/**
 * Validate template category
 */
export const validateTemplateCategory = (category: string): boolean => {
  return TEMPLATE_CATEGORIES.includes(category);
};

/**
 * Create a new template
 */
export const createTemplate = async (
  userId: string,
  input: CreateTemplateInput
): Promise<TemplateResponse> => {
  try {
    // Validate inputs
    if (!validateTemplateName(input.name)) {
      throw new ValidationError(
        'Template name must be 1-255 characters',
        'INVALID_TEMPLATE_NAME'
      );
    }

    if (!validateTemplateCategory(input.category)) {
      throw new ValidationError(
        `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
        'INVALID_CATEGORY'
      );
    }

    if (!input.system_prompt || input.system_prompt.length < 10 || input.system_prompt.length > 5000) {
      throw new ValidationError(
        'System prompt must be 10-5000 characters',
        'INVALID_SYSTEM_PROMPT'
      );
    }

    if (input.temperature !== undefined && (input.temperature < 0 || input.temperature > 2)) {
      throw new ValidationError(
        'Temperature must be between 0 and 2',
        'INVALID_TEMPERATURE'
      );
    }

    if (input.max_tokens !== undefined && (input.max_tokens < 1 || input.max_tokens > 4096)) {
      throw new ValidationError(
        'Max tokens must be between 1 and 4096',
        'INVALID_MAX_TOKENS'
      );
    }

    // Create template
    const template = await prisma.botTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        systemPrompt: input.system_prompt,
        temperature: input.temperature || 0.7,
        maxTokens: input.max_tokens || 1024,
        isPublic: input.is_public !== false, // Default to public
        createdById: userId,
      },
    });

    logger.info(`Template created: ${template.id}`);

    return formatTemplateResponse(template);
  } catch (error: any) {
    logger.error(`Error creating template: ${error.message}`);
    throw error;
  }
};

/**
 * Get template by ID
 */
export const getTemplateById = async (templateId: string): Promise<TemplateResponse> => {
  try {
    const template = await prisma.botTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }

    return formatTemplateResponse(template);
  } catch (error: any) {
    logger.error(`Error getting template: ${error.message}`);
    throw error;
  }
};

/**
 * Get all public templates with pagination
 */
export const getPublicTemplates = async (
  page: number = 1,
  limit: number = 20,
  category?: string
) => {
  try {
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      is_public: true,
    };

    if (category) {
      if (!validateTemplateCategory(category)) {
        throw new ValidationError(
          `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
          'INVALID_CATEGORY'
        );
      }
      where.category = category;
    }

    // Get total count
    const total = await prisma.botTemplate.count({ where });

    // Get templates
    const templates = await prisma.botTemplate.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const formattedTemplates = templates.map(formatTemplateResponse);

    return {
      data: formattedTemplates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error: any) {
    logger.error(`Error getting public templates: ${error.message}`);
    throw error;
  }
};

/**
 * Get user's templates
 */
export const getUserTemplates = async (
  userId: string,
  page: number = 1,
  limit: number = 20
) => {
  try {
    const skip = (page - 1) * limit;

    // Get total count
    const total = await prisma.botTemplate.count({
      where: { createdById: userId },
    });

    // Get templates
    const templates = await prisma.botTemplate.findMany({
      where: { createdById: userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const formattedTemplates = templates.map(formatTemplateResponse);

    return {
      data: formattedTemplates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error: any) {
    logger.error(`Error getting user templates: ${error.message}`);
    throw error;
  }
};

/**
 * Update template
 */
export const updateTemplate = async (
  templateId: string,
  userId: string,
  input: UpdateTemplateInput
): Promise<TemplateResponse> => {
  try {
    // Get template
    const template = await prisma.botTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }

    // Verify ownership (only creator can update)
    if (template.createdById !== userId) {
      throw new AuthError(
        'You do not have permission to update this template',
        'UNAUTHORIZED'
      );
    }

    // Validate inputs if provided
    if (input.name && !validateTemplateName(input.name)) {
      throw new ValidationError(
        'Template name must be 1-255 characters',
        'INVALID_TEMPLATE_NAME'
      );
    }

    if (input.category && !validateTemplateCategory(input.category)) {
      throw new ValidationError(
        `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
        'INVALID_CATEGORY'
      );
    }

    if (input.system_prompt && (input.system_prompt.length < 10 || input.system_prompt.length > 5000)) {
      throw new ValidationError(
        'System prompt must be 10-5000 characters',
        'INVALID_SYSTEM_PROMPT'
      );
    }

    if (input.temperature !== undefined && (input.temperature < 0 || input.temperature > 2)) {
      throw new ValidationError(
        'Temperature must be between 0 and 2',
        'INVALID_TEMPERATURE'
      );
    }

    if (input.max_tokens !== undefined && (input.max_tokens < 1 || input.max_tokens > 4096)) {
      throw new ValidationError(
        'Max tokens must be between 1 and 4096',
        'INVALID_MAX_TOKENS'
      );
    }

    // Update template
    const updateData: any = {};
    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.category) updateData.category = input.category;
    if (input.system_prompt) updateData.systemPrompt = input.system_prompt;
    if (input.temperature !== undefined) updateData.temperature = input.temperature;
    if (input.max_tokens !== undefined) updateData.maxTokens = input.max_tokens;
    if (input.is_public !== undefined) updateData.isPublic = input.is_public;

    const updatedTemplate = await prisma.botTemplate.update({
      where: { id: templateId },
      data: updateData,
    });

    logger.info(`Template updated: ${templateId}`);

    return formatTemplateResponse(updatedTemplate);
  } catch (error: any) {
    logger.error(`Error updating template: ${error.message}`);
    throw error;
  }
};

/**
 * Delete template
 */
export const deleteTemplate = async (templateId: string, userId: string): Promise<void> => {
  try {
    // Get template
    const template = await prisma.botTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }

    // Verify ownership
    if (template.createdById !== userId) {
      throw new AuthError(
        'You do not have permission to delete this template',
        'UNAUTHORIZED'
      );
    }

    // Delete template
    await prisma.botTemplate.delete({
      where: { id: templateId },
    });

    logger.info(`Template deleted: ${templateId}`);
  } catch (error: any) {
    logger.error(`Error deleting template: ${error.message}`);
    throw error;
  }
};

/**
 * Create default templates
 */
export const createDefaultTemplates = async (): Promise<void> => {
  try {
    const defaultTemplates = [
      {
        name: 'Customer Support Bot',
        description: 'A helpful bot for answering customer inquiries and providing support',
        category: 'customer-support',
        system_prompt:
          'You are a helpful customer support assistant. Your role is to assist customers with their inquiries, provide product information, and help resolve issues. Be polite, professional, and empathetic. If you cannot help, suggest contacting the support team.',
        temperature: 0.7,
        max_tokens: 1024,
        is_public: true,
      },
      {
        name: 'Sales Assistant Bot',
        description: 'A bot designed to help with sales inquiries and product recommendations',
        category: 'sales',
        system_prompt:
          'You are a sales assistant bot. Your role is to help customers find the right products, answer questions about features and pricing, and guide them through the purchase process. Be enthusiastic, helpful, and focus on understanding customer needs.',
        temperature: 0.8,
        max_tokens: 1024,
        is_public: true,
      },
      {
        name: 'HR Assistant Bot',
        description: 'A bot for handling HR-related inquiries and employee support',
        category: 'hr',
        system_prompt:
          'You are an HR assistant bot. Your role is to help employees with HR-related questions, provide information about company policies, benefits, and procedures. Be professional, supportive, and direct employees to the HR team for complex issues.',
        temperature: 0.6,
        max_tokens: 1024,
        is_public: true,
      },
      {
        name: 'Educational Tutor Bot',
        description: 'A bot designed to help students learn and answer educational questions',
        category: 'education',
        system_prompt:
          'You are an educational tutor bot. Your role is to help students learn by explaining concepts, answering questions, and providing study guidance. Be patient, clear, and encourage critical thinking. Adapt your explanations to the student\'s level.',
        temperature: 0.7,
        max_tokens: 2048,
        is_public: true,
      },
      {
        name: 'Healthcare Information Bot',
        description: 'A bot for providing general health information and wellness guidance',
        category: 'healthcare',
        system_prompt:
          'You are a healthcare information bot. Your role is to provide general health information and wellness guidance. Always remind users that you are not a substitute for professional medical advice. Encourage users to consult healthcare professionals for medical concerns.',
        temperature: 0.5,
        max_tokens: 1024,
        is_public: true,
      },
      {
        name: 'E-commerce Assistant Bot',
        description: 'A bot for helping customers with online shopping and product inquiries',
        category: 'ecommerce',
        system_prompt:
          'You are an e-commerce assistant bot. Your role is to help customers browse products, answer questions about availability and pricing, assist with orders, and handle returns. Be helpful, efficient, and focus on customer satisfaction.',
        temperature: 0.7,
        max_tokens: 1024,
        is_public: true,
      },
      {
        name: 'General Purpose Bot',
        description: 'A versatile bot for general conversations and information',
        category: 'general',
        system_prompt:
          'You are a helpful and friendly general-purpose assistant. Your role is to have conversations, answer questions, provide information, and help with various tasks. Be conversational, accurate, and helpful.',
        temperature: 0.8,
        max_tokens: 1024,
        is_public: true,
      },
    ];

    for (const template of defaultTemplates) {
      // Check if template already exists
      const existing = await prisma.botTemplate.findFirst({
        where: { name: template.name },
      });

      if (!existing) {
        await prisma.botTemplate.create({
          data: {
            name: template.name,
            description: template.description,
            category: template.category,
            systemPrompt: template.system_prompt,
            temperature: template.temperature,
            maxTokens: template.max_tokens,
            isPublic: template.is_public,
            createdById: null, // System templates have no creator
          },
        });
        logger.info(`Default template created: ${template.name}`);
      }
    }
  } catch (error: any) {
    logger.error(`Error creating default templates: ${error.message}`);
  }
};

/**
 * Format template response
 */
const formatTemplateResponse = (template: BotTemplate): TemplateResponse => {
  return {
    id: template.id,
    name: template.name,
    description: template.description || undefined,
    category: template.category || 'general',
    system_prompt: template.systemPrompt,
    temperature: Number(template.temperature),
    max_tokens: template.maxTokens,
    is_public: template.isPublic,
    created_by: template.createdById || undefined,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  };
};
