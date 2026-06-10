/**
 * Tests for conversation service
 */

import {
  validatePhoneNumber,
  validateMessageStatus,
} from './conversationService';

describe('ConversationService - Validation Functions', () => {
  describe('validatePhoneNumber', () => {
    it('should validate correct phone numbers', () => {
      expect(validatePhoneNumber('+919876543210')).toBe(true);
      expect(validatePhoneNumber('919876543210')).toBe(true);
      expect(validatePhoneNumber('+1-234-567-8900')).toBe(true);
      expect(validatePhoneNumber('1234567890')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(validatePhoneNumber('')).toBe(false);
      expect(validatePhoneNumber('abc')).toBe(false);
      expect(validatePhoneNumber('123')).toBe(false); // Too short
      expect(validatePhoneNumber('a'.repeat(25))).toBe(false); // Too long
      expect(validatePhoneNumber('abc-def-ghij')).toBe(false); // Invalid characters
    });

    it('should handle edge cases', () => {
      expect(validatePhoneNumber('1234567')).toBe(true); // Minimum valid length
      expect(validatePhoneNumber('12345678901234567890')).toBe(true); // Maximum valid length
      expect(validatePhoneNumber('+1-234-567-8900')).toBe(true); // With hyphens
      expect(validatePhoneNumber('+1 234 567 8900')).toBe(false); // With spaces (invalid)
    });
  });

  describe('validateMessageStatus', () => {
    it('should validate correct message statuses', () => {
      expect(validateMessageStatus('received')).toBe(true);
      expect(validateMessageStatus('processing')).toBe(true);
      expect(validateMessageStatus('sent')).toBe(true);
      expect(validateMessageStatus('delivered')).toBe(true);
      expect(validateMessageStatus('failed')).toBe(true);
    });

    it('should reject invalid message statuses', () => {
      expect(validateMessageStatus('pending')).toBe(false);
      expect(validateMessageStatus('unknown')).toBe(false);
      expect(validateMessageStatus('')).toBe(false);
      expect(validateMessageStatus('SENT')).toBe(false); // Case sensitive
      expect(validateMessageStatus('read')).toBe(false);
    });
  });
});
