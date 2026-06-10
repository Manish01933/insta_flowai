/**
 * Input validation utilities
 */

import { ValidationError } from './errors';

/**
 * Validate email format
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 * Requirements: 8+ chars, 1 uppercase, 1 number, 1 special character
 */
export const validatePasswordStrength = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validate registration input
 */
export const validateRegistrationInput = (data: any): void => {
  if (!data.email || typeof data.email !== 'string') {
    throw new ValidationError('Email is required and must be a string', 'INVALID_EMAIL');
  }

  if (!validateEmail(data.email)) {
    throw new ValidationError('Invalid email format', 'INVALID_EMAIL_FORMAT');
  }

  if (!data.password || typeof data.password !== 'string') {
    throw new ValidationError('Password is required and must be a string', 'INVALID_PASSWORD');
  }

  const passwordValidation = validatePasswordStrength(data.password);
  if (!passwordValidation.valid) {
    throw new ValidationError(
      `Password does not meet requirements: ${passwordValidation.errors.join(', ')}`,
      'WEAK_PASSWORD'
    );
  }

  if (data.first_name && typeof data.first_name !== 'string') {
    throw new ValidationError('First name must be a string', 'INVALID_FIRST_NAME');
  }

  if (data.last_name && typeof data.last_name !== 'string') {
    throw new ValidationError('Last name must be a string', 'INVALID_LAST_NAME');
  }

  if (data.phone && typeof data.phone !== 'string') {
    throw new ValidationError('Phone must be a string', 'INVALID_PHONE');
  }
};

/**
 * Validate login input
 */
export const validateLoginInput = (data: any): void => {
  if (!data.email || typeof data.email !== 'string') {
    throw new ValidationError('Email is required and must be a string', 'INVALID_EMAIL');
  }

  if (!validateEmail(data.email)) {
    throw new ValidationError('Invalid email format', 'INVALID_EMAIL_FORMAT');
  }

  if (!data.password || typeof data.password !== 'string') {
    throw new ValidationError('Password is required and must be a string', 'INVALID_PASSWORD');
  }
};

/**
 * Validate refresh token input
 */
export const validateRefreshTokenInput = (data: any): void => {
  if (!data.refresh_token || typeof data.refresh_token !== 'string') {
    throw new ValidationError('Refresh token is required and must be a string', 'INVALID_REFRESH_TOKEN');
  }
};
