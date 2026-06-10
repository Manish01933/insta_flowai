/**
 * Invoice routes
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticateToken } from '../middleware/auth';
import logger from '../config/logger';
import { ValidationError } from '../utils/errors';
import {
  getInvoice,
  getUserInvoices,
  updateInvoiceStatus,
} from '../services/invoiceService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * GET /api/invoices
 * Get user's invoices with pagination
 */
router.get(
  '/',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const requestId = (req as any).requestId || uuidv4();

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (page < 1) {
        throw new ValidationError('Page must be greater than 0', 'INVALID_PAGE');
      }

      if (limit < 1 || limit > 100) {
        throw new ValidationError('Limit must be between 1 and 100', 'INVALID_LIMIT');
      }

      const { invoices, total, pages } = await getUserInvoices(userId, page, limit);

      logger.info(`[${requestId}] Invoices retrieved for user: ${userId}`, {
        page,
        limit,
        total,
      });

      res.status(200).json({
        data: invoices,
        pagination: {
          page,
          limit,
          total,
          pages,
        },
        requestId,
      });
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to get invoices: ${error.message}`, {
        userId,
        error: error.stack,
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          errorCode: error.errorCode,
          requestId,
        });
      } else {
        res.status(500).json({
          error: 'Failed to retrieve invoices',
          errorCode: 'INVOICE_RETRIEVAL_FAILED',
          requestId,
        });
      }
    }
  })
);

/**
 * GET /api/invoices/:invoiceId
 * Get a specific invoice
 */
router.get(
  '/:invoiceId',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { invoiceId } = req.params;
    const requestId = (req as any).requestId || uuidv4();

    try {
      // Validate invoice ID format
      if (!invoiceId || invoiceId.length === 0) {
        throw new ValidationError('Invoice ID is required', 'INVALID_INVOICE_ID');
      }

      const invoice = await getInvoice(invoiceId);

      if (!invoice) {
        logger.warn(`[${requestId}] Invoice not found: ${invoiceId}`);
        res.status(404).json({
          error: 'Invoice not found',
          errorCode: 'INVOICE_NOT_FOUND',
          requestId,
        });
        return;
      }

      // Verify invoice belongs to user
      if (invoice.userId !== userId) {
        logger.warn(`[${requestId}] Unauthorized access to invoice: ${invoiceId}`, {
          userId,
          invoiceUserId: invoice.userId,
        });

        res.status(403).json({
          error: 'Access denied',
          errorCode: 'ACCESS_DENIED',
          requestId,
        });
        return;
      }

      logger.info(`[${requestId}] Invoice retrieved: ${invoiceId}`, {
        userId,
      });

      res.status(200).json({
        data: invoice,
        requestId,
      });
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to get invoice: ${error.message}`, {
        invoiceId,
        error: error.stack,
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          errorCode: error.errorCode,
          requestId,
        });
      } else {
        res.status(500).json({
          error: 'Failed to retrieve invoice',
          errorCode: 'INVOICE_RETRIEVAL_FAILED',
          requestId,
        });
      }
    }
  })
);

/**
 * PATCH /api/invoices/:invoiceId/status
 * Update invoice status (admin only)
 */
router.patch(
  '/:invoiceId/status',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { invoiceId } = req.params;
    const { status } = req.body;
    const requestId = (req as any).requestId || uuidv4();

    try {
      // Validate status
      const validStatuses = ['draft', 'sent', 'viewed', 'paid'];
      if (!status || !validStatuses.includes(status)) {
        throw new ValidationError(
          `Status must be one of: ${validStatuses.join(', ')}`,
          'INVALID_STATUS'
        );
      }

      const invoice = await getInvoice(invoiceId);

      if (!invoice) {
        logger.warn(`[${requestId}] Invoice not found: ${invoiceId}`);
        res.status(404).json({
          error: 'Invoice not found',
          errorCode: 'INVOICE_NOT_FOUND',
          requestId,
        });
        return;
      }

      // Verify invoice belongs to user
      if (invoice.userId !== userId) {
        logger.warn(`[${requestId}] Unauthorized status update: ${invoiceId}`, {
          userId,
          invoiceUserId: invoice.userId,
        });

        res.status(403).json({
          error: 'Access denied',
          errorCode: 'ACCESS_DENIED',
          requestId,
        });
        return;
      }

      const updatedInvoice = await updateInvoiceStatus(invoiceId, status);

      logger.info(`[${requestId}] Invoice status updated: ${invoiceId}`, {
        userId,
        status,
      });

      res.status(200).json({
        data: updatedInvoice,
        requestId,
      });
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to update invoice status: ${error.message}`, {
        invoiceId,
        error: error.stack,
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          errorCode: error.errorCode,
          requestId,
        });
      } else {
        res.status(500).json({
          error: 'Failed to update invoice status',
          errorCode: 'STATUS_UPDATE_FAILED',
          requestId,
        });
      }
    }
  })
);

export default router;
