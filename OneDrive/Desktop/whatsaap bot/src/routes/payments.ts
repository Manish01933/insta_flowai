/**
 * Payment routes for subscription and billing operations
 */

import { Router, Response } from 'express';
import PaymentService from '../services/paymentService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/payments/history
 * Get payment history with pagination
 * Authentication: Required (JWT token)
 * Query params: page (default 1), limit (default 20, max 100)
 */
router.get(
  '/history',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    // Parse query parameters
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    // Get payment history
    const result = await PaymentService.getPaymentHistory(req.user.id, page, limit);

    res.status(200).json(result);
  })
);

export default router;
