/**
 * Unit tests for bot template service
 */

import {
  validateTemplateName,
  validateTemplateCategory,
  TEMPLATE_CATEGORIES,
} from './botTemplateService';

describe('Bot Template Service Validation', () => {
  describe('validateTemplateName', () => {
    it('should accept valid template names', () => {
      expect(validateTemplateName('Customer Support Bot')).toBe(true);
      expect(validateTemplateName('A')).toBe(true);
      expect(validateTemplateName('My Template Name')).toBe(true);
    });

    it('should reject invalid template names', () => {
      expect(validateTemplateName('')).toBe(false);
      expect(validateTemplateName('a'.repeat(256))).toBe(false); // Too long
    });
  });

  describe('validateTemplateCategory', () => {
    it('should accept valid categories', () => {
      TEMPLATE_CATEGORIES.forEach((category) => {
        expect(validateTemplateCategory(category)).toBe(true);
      });
    });

    it('should reject invalid categories', () => {
      expect(validateTemplateCategory('invalid-category')).toBe(false);
      expect(validateTemplateCategory('unknown')).toBe(false);
    });
  });

  describe('TEMPLATE_CATEGORIES', () => {
    it('should have expected categories', () => {
      expect(TEMPLATE_CATEGORIES).toContain('customer-support');
      expect(TEMPLATE_CATEGORIES).toContain('sales');
      expect(TEMPLATE_CATEGORIES).toContain('hr');
      expect(TEMPLATE_CATEGORIES).toContain('education');
      expect(TEMPLATE_CATEGORIES).toContain('healthcare');
      expect(TEMPLATE_CATEGORIES).toContain('ecommerce');
      expect(TEMPLATE_CATEGORIES).toContain('general');
      expect(TEMPLATE_CATEGORIES).toContain('custom');
    });
  });
});
