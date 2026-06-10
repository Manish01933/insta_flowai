/**
 * Unit tests for bot service
 */

import {
  validateBotName,
  validateSystemPrompt,
  validateTemperature,
  validateMaxTokens,
  validateLanguage,
  generateWebhookUrl,
  generateWebhookVerifyToken,
} from './botService';

describe('Bot Service Validation', () => {
  describe('validateBotName', () => {
    it('should accept valid bot names', () => {
      expect(validateBotName('Customer Support Bot')).toBe(true);
      expect(validateBotName('Bot-123')).toBe(true);
      expect(validateBotName('A')).toBe(true);
      expect(validateBotName('My Bot Name')).toBe(true);
    });

    it('should reject invalid bot names', () => {
      expect(validateBotName('')).toBe(false);
      expect(validateBotName('a'.repeat(101))).toBe(false); // Too long
      expect(validateBotName('Bot@123')).toBe(false); // Invalid character
      expect(validateBotName('Bot_Name')).toBe(false); // Underscore not allowed
    });
  });

  describe('validateSystemPrompt', () => {
    it('should accept valid system prompts', () => {
      expect(validateSystemPrompt('You are a helpful assistant.')).toBe(true);
      expect(validateSystemPrompt('a'.repeat(10))).toBe(true); // Minimum length
      expect(validateSystemPrompt('a'.repeat(5000))).toBe(true); // Maximum length
    });

    it('should reject invalid system prompts', () => {
      expect(validateSystemPrompt('')).toBe(false);
      expect(validateSystemPrompt('short')).toBe(false); // Too short
      expect(validateSystemPrompt('a'.repeat(5001))).toBe(false); // Too long
    });
  });

  describe('validateTemperature', () => {
    it('should accept valid temperatures', () => {
      expect(validateTemperature(0)).toBe(true);
      expect(validateTemperature(0.7)).toBe(true);
      expect(validateTemperature(1.5)).toBe(true);
      expect(validateTemperature(2)).toBe(true);
    });

    it('should reject invalid temperatures', () => {
      expect(validateTemperature(-0.1)).toBe(false);
      expect(validateTemperature(2.1)).toBe(false);
    });

    it('should accept undefined temperature', () => {
      expect(validateTemperature(undefined as any)).toBe(true);
    });
  });

  describe('validateMaxTokens', () => {
    it('should accept valid max tokens', () => {
      expect(validateMaxTokens(1)).toBe(true);
      expect(validateMaxTokens(1024)).toBe(true);
      expect(validateMaxTokens(4096)).toBe(true);
    });

    it('should reject invalid max tokens', () => {
      expect(validateMaxTokens(0)).toBe(false);
      expect(validateMaxTokens(4097)).toBe(false);
    });

    it('should accept undefined max tokens', () => {
      expect(validateMaxTokens(undefined as any)).toBe(true);
    });
  });

  describe('validateLanguage', () => {
    it('should accept valid languages', () => {
      expect(validateLanguage('en')).toBe(true);
      expect(validateLanguage('es')).toBe(true);
      expect(validateLanguage('hi')).toBe(true);
    });

    it('should reject invalid languages', () => {
      expect(validateLanguage('invalid')).toBe(false);
      expect(validateLanguage('xx')).toBe(false);
    });

    it('should accept undefined language', () => {
      expect(validateLanguage(undefined)).toBe(true);
    });
  });

  describe('generateWebhookUrl', () => {
    it('should generate valid webhook URL', () => {
      const botId = 'test-bot-123';
      const url = generateWebhookUrl(botId);
      expect(url).toContain(botId);
      expect(url).toContain('/api/webhooks/whatsapp/');
    });
  });

  describe('generateWebhookVerifyToken', () => {
    it('should generate unique tokens', () => {
      const token1 = generateWebhookVerifyToken();
      const token2 = generateWebhookVerifyToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate hex tokens', () => {
      const token = generateWebhookVerifyToken();
      expect(/^[a-f0-9]+$/.test(token)).toBe(true);
    });

    it('should generate 64-character tokens', () => {
      const token = generateWebhookVerifyToken();
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
    });
  });
});
