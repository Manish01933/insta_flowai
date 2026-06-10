/**
 * Bot templates routes
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  createTemplate,
  getTemplateById,
  getPublicTemplates,
  getUserTemplates,
  updateTemplate,
  deleteTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
} from '../services/botTemplateService';
import { ValidationError } from '../utils/errors';

const router = Router();

/**
 * GET /api/templates
 * Get public templates
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string | undefined;

    // Validate pagination
    if (page < 1 || limit < 1 || limit > 100) {
      throw new ValidationError('Invalid pagination parameters', 'INVALID_PAGINATION');
    }

    const result = await getPublicTemplates(page, limit, category);

    res.status(200).json({
      success: true,
      ...result,
    });
  })
);

/**
 * GET /api/templates/:templateId
 * Get template by ID
 */
router.get(
  '/:templateId',
  asyncHandler(async (req: Request, res: Response) => {
    const templateId = req.params.templateId;

    const template = await getTemplateById(templateId);

    res.status(200).json({
      success: true,
      data: template,
    });
  })
);

// Protected routes (require authentication)
router.use(authenticateToken);

/**
 * POST /api/templates
 * Create a new template
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const input: CreateTemplateInput = req.body;

    const template = await createTemplate(userId, input);

    res.status(201).json({
      success: true,
      data: template,
    });
  })
);

/**
 * GET /api/templates/user/my-templates
 * Get user's templates
 */
router.get(
  '/user/my-templates',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    // Validate pagination
    if (page < 1 || limit < 1 || limit > 100) {
      throw new ValidationError('Invalid pagination parameters', 'INVALID_PAGINATION');
    }

    const result = await getUserTemplates(userId, page, limit);

    res.status(200).json({
      success: true,
      ...result,
    });
  })
);

/**
 * PUT /api/templates/:templateId
 * Update template
 */
router.put(
  '/:templateId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const templateId = req.params.templateId;
    const input: UpdateTemplateInput = req.body;

    const template = await updateTemplate(templateId, userId, input);

    res.status(200).json({
      success: true,
      data: template,
    });
  })
);

/**
 * DELETE /api/templates/:templateId
 * Delete template
 */
router.delete(
  '/:templateId',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const templateId = req.params.templateId;

    await deleteTemplate(templateId, userId);

    res.status(204).send();
  })
);

export default router;
