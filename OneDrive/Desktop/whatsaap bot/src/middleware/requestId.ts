/**
 * Request ID middleware for tracking and debugging
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';

export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Middleware to add request ID to each request
 */
export const requestIdMiddleware = (
  req: RequestWithId,
  res: Response,
  next: NextFunction
): void => {
  // Check if request ID is provided in headers
  const requestId = req.headers['x-request-id'] as string || uuidv4();

  // Attach to request
  req.requestId = requestId;

  // Add to response headers
  res.setHeader('X-Request-ID', requestId);

  // Log request
  logger.http(`[${requestId}] ${req.method} ${req.path}`);

  // Log response when it's sent
  const originalSend = res.send;
  res.send = function (data: any) {
    logger.http(`[${requestId}] ${req.method} ${req.path} - ${res.statusCode}`);
    return originalSend.call(this, data);
  };

  next();
};
