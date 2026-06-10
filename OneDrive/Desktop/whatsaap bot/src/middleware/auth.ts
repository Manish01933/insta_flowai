/**
 * Authentication middleware for JWT token verification
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { isTokenBlacklisted } from '../utils/tokenBlacklist';
import { AuthError } from '../utils/errors';
import logger from '../config/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    subscription_tier: string;
  };
  requestId?: string;
}

/**
 * Middleware to verify JWT token and attach user to request
 */
export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      throw new AuthError('No token provided', 'NO_TOKEN');
    }

    // Check if token is blacklisted
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      throw new AuthError('Token has been invalidated', 'TOKEN_INVALIDATED');
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      subscription_tier: decoded.subscription_tier,
    };

    logger.debug(`User authenticated: ${decoded.email}`);
    next();
  } catch (error: any) {
    logger.warn(`Authentication failed: ${error.message}`);
    
    if (error instanceof AuthError) {
      res.status(error.statusCode).json({
        error: error.message,
        errorCode: error.errorCode,
      });
    } else {
      res.status(401).json({
        error: 'Authentication failed',
        errorCode: 'AUTH_FAILED',
      });
    }
  }
};

/**
 * Middleware to verify JWT token is valid (for optional auth)
 */
export const optionalAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Check if token is blacklisted
      const blacklisted = await isTokenBlacklisted(token);
      if (!blacklisted) {
        const decoded = verifyAccessToken(token);
        req.user = {
          id: decoded.sub,
          email: decoded.email,
          subscription_tier: decoded.subscription_tier,
        };
      }
    }

    next();
  } catch (error: any) {
    // Silently fail for optional auth
    logger.debug(`Optional auth failed: ${error.message}`);
    next();
  }
};

/**
 * Middleware to verify user owns a resource
 */
export const verifyOwnership = (resourceUserId: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    if (req.user.id !== resourceUserId) {
      res.status(403).json({
        error: 'Forbidden - You do not own this resource',
        errorCode: 'FORBIDDEN',
      });
      return;
    }

    next();
  };
};
