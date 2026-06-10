/**
 * Rate limiting middleware using Redis backend
 */

import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis';
import { RateLimitError } from '../utils/errors';
import logger from '../config/logger';

export interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: Request) => string; // Custom key generator
}

/**
 * Create rate limiter middleware
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req: Request) => req.ip || 'unknown',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();
      const key = `rate_limit:${keyGenerator(req)}`;
      const windowSeconds = Math.ceil(windowMs / 1000);

      // Get current count
      const current = await redis.incr(key);

      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      // Get TTL
      const ttl = await redis.ttl(key);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());

      // Check if limit exceeded
      if (current > maxRequests) {
        logger.warn(`Rate limit exceeded for ${keyGenerator(req)}`);
        throw new RateLimitError(
          `Too many requests, please try again later`,
          'RATE_LIMIT_EXCEEDED'
        );
      }

      next();
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        res.status(429).json({
          error: error.message,
          errorCode: error.errorCode,
        });
      } else {
        logger.error(`Rate limiter error: ${error.message}`);
        // Allow request if Redis fails
        next();
      }
    }
  };
};

/**
 * Global rate limiter for all requests
 */
export const globalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
});

/**
 * Strict rate limiter for auth endpoints
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 requests per 15 minutes
});

/**
 * API rate limiter for authenticated users
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise use IP
    return (req as any).user?.id || req.ip || 'unknown';
  },
});
