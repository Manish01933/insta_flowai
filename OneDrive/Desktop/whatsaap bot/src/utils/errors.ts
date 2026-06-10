/**
 * Custom error classes for consistent error handling
 */

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public errorCode: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, errorCode: string = 'VALIDATION_ERROR') {
    super(message, 400, errorCode);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class AuthError extends AppError {
  constructor(message: string, errorCode: string = 'AUTH_ERROR') {
    super(message, 401, errorCode);
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, errorCode: string = 'NOT_FOUND') {
    super(message, 404, errorCode);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, errorCode: string = 'CONFLICT') {
    super(message, 409, errorCode);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, errorCode: string = 'FORBIDDEN') {
    super(message, 403, errorCode);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, errorCode: string = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, errorCode);
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string, errorCode: string = 'INTERNAL_SERVER_ERROR') {
    super(message, 500, errorCode);
    Object.setPrototypeOf(this, InternalServerError.prototype);
  }
}

export class BusinessLogicError extends AppError {
  constructor(message: string, errorCode: string = 'BUSINESS_LOGIC_ERROR') {
    super(message, 422, errorCode);
    Object.setPrototypeOf(this, BusinessLogicError.prototype);
  }
}
