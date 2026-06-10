/**
 * Unit tests for validation utilities
 */

import {
  validateEmail,
  validatePasswordStrength,
  validateRegistrationInput,
  validateLoginInput,
} from './validation';
import { ValidationError } from './errors';

describe('Validation Utilities', () => {
  describe('validateEmail', () => {
    it('should validate correct email format', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@example.co.uk')).toBe(true);
      expect(validateEmail('user+tag@example.com')).toBe(true);
    });

    it('should reject invalid email format', () => {
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user @example.com')).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should accept strong password', () => {
      const result = validatePasswordStrength('SecurePassword123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = validatePasswordStrength('Short1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject password without uppercase letter', () => {
      const result = validatePasswordStrength('lowercase123!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject password without number', () => {
      const result = validatePasswordStrength('NoNumbers!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject password without special character', () => {
      const result = validatePasswordStrength('NoSpecial123');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should report multiple password errors', () => {
      const result = validatePasswordStrength('weak');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('validateRegistrationInput', () => {
    it('should accept valid registration input', () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        first_name: 'John',
        last_name: 'Doe',
      };

      expect(() => validateRegistrationInput(input)).not.toThrow();
    });

    it('should reject missing email', () => {
      const input = {
        password: 'SecurePassword123!',
      };

      expect(() => validateRegistrationInput(input)).toThrow(ValidationError);
    });

    it('should reject invalid email', () => {
      const input = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      };

      expect(() => validateRegistrationInput(input)).toThrow(ValidationError);
    });

    it('should reject weak password', () => {
      const input = {
        email: 'test@example.com',
        password: 'weak',
      };

      expect(() => validateRegistrationInput(input)).toThrow(ValidationError);
    });
  });

  describe('validateLoginInput', () => {
    it('should accept valid login input', () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      };

      expect(() => validateLoginInput(input)).not.toThrow();
    });

    it('should reject missing email', () => {
      const input = {
        password: 'SecurePassword123!',
      };

      expect(() => validateLoginInput(input)).toThrow(ValidationError);
    });

    it('should reject invalid email', () => {
      const input = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      };

      expect(() => validateLoginInput(input)).toThrow(ValidationError);
    });

    it('should reject missing password', () => {
      const input = {
        email: 'test@example.com',
      };

      expect(() => validateLoginInput(input)).toThrow(ValidationError);
    });
  });
});
