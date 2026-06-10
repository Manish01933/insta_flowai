/**
 * Global error handler middleware
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import logger from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

export interface ErrorResponse {
  error: string;
  errorCode: string;
  statusCode: number;
  requestId?: string;
  timestamp: string;
  path: string;
  method: string;
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = (_req as any).requestId || uuidv4();
  const timestamp = new Date().toISOString();

  // Log error
  logger.error(`[${requestId}] Error: ${err.message}`, {
    stack: err.stack,
    path: _req.path,
    method: _req.method,
    statusCode: err.statusCode || 500,
  });

  // Handle AppError instances
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: err.message,
      errorCode: err.errorCode,
      statusCode: err.statusCode,
      requestId,
      timestamp,
      path: _req.path,
      method: _req.method,
    };

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    const response: ErrorResponse = {
      error: 'Invalid token',
      errorCode: 'INVALID_TOKEN',
      statusCode: 401,
      requestId,
      timestamp,
      path: _req.path,
      method: _req.method,
    };

    res.status(401).json(response);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    const response: ErrorResponse = {
      error: 'Token expired',
      errorCode: 'TOKEN_EXPIRED',
      statusCode: 401,
      requestId,
      timestamp,
      path: _req.path,
      method: _req.method,
    };

    res.status(401).json(response);
    return;
  }

  // Handle Prisma errors
  if (err.code === 'P2002') {
    const response: ErrorResponse = {
      error: 'Unique constraint violation',
      errorCode: 'UNIQUE_CONSTRAINT_VIOLATION',
      statusCode: 409,
      requestId,
      timestamp,
      path: _req.path,
      method: _req.method,
    };

    res.status(409).json(response);
    return;
  }

  if (err.code === 'P2025') {
    const response: ErrorResponse = {
      error: 'Record not found',
      errorCode: 'NOT_FOUND',
      statusCode: 404,
      requestId,
      timestamp,
      path: _req.path,
      method: _req.method,
    };

    res.status(404).json(response);
    return;
  }

  // Handle generic errors
  const response: ErrorResponse = {
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    errorCode: 'INTERNAL_SERVER_ERROR',
    statusCode: 500,
    requestId,
    timestamp,
    path: _req.path,
    method: _req.method,
  };

  res.status(500).json(response);
};

/**
 * Async error wrapper for route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
