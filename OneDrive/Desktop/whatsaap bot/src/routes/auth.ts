/**
 * Authentication routes
 */

import { Router, Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getUserById,
  updateUserProfile,
  changePassword,
} from '../services/authService';
import {
  validateRegistrationInput,
  validateLoginInput,
  validateRefreshTokenInput,
} from '../utils/validation';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user account
 */
router.post(
  '/register',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    validateRegistrationInput(req.body);

    // Register user
    const result = await registerUser({
      email: req.body.email,
      password: req.body.password,
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      phone: req.body.phone,
    });

    res.status(201).json({
      id: result.id,
      email: result.email,
      first_name: result.first_name,
      last_name: result.last_name,
      subscription_tier: result.subscription_tier,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
    });
  })
);

/**
 * POST /api/auth/login
 * Authenticate user and return JWT tokens
 */
router.post(
  '/login',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    validateLoginInput(req.body);

    // Login user
    const result = await loginUser({
      email: req.body.email,
      password: req.body.password,
    });

    res.status(200).json({
      id: result.id,
      email: result.email,
      first_name: result.first_name,
      last_name: result.last_name,
      subscription_tier: result.subscription_tier,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
    });
  })
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    validateRefreshTokenInput(req.body);

    // Refresh token
    const result = await refreshAccessToken(req.body.refresh_token);

    res.status(200).json({
      access_token: result.access_token,
      expires_in: result.expires_in,
    });
  })
);

/**
 * POST /api/auth/logout
 * Invalidate refresh token and logout user
 */
router.post(
  '/logout',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    // Validate input
    validateRefreshTokenInput(req.body);

    // Logout user
    await logoutUser(req.body.refresh_token);

    res.status(200).json({
      message: 'Logged out successfully',
    });
  })
);

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    const user = await getUserById(req.user.id);

    res.status(200).json(user);
  })
);

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put(
  '/profile',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    const user = await updateUserProfile(req.user.id, {
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      phone: req.body.phone,
    });

    res.status(200).json(user);
  })
);

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post(
  '/change-password',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    if (!req.body.old_password || !req.body.new_password) {
      res.status(400).json({
        error: 'Old password and new password are required',
        errorCode: 'MISSING_FIELDS',
      });
      return;
    }

    await changePassword(req.user.id, req.body.old_password, req.body.new_password);

    res.status(200).json({
      message: 'Password changed successfully',
    });
  })
);

export default router;
