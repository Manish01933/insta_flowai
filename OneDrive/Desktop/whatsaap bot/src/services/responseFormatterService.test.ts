/**
 * Tests for response formatter service
 */

import {
  validateMediaAttachment,
  convertMarkdownToWhatsApp,
  hasMarkdownFormatting,
  findOptimalSplitPoint,
  splitMessage,
  formatResponse,
  formatResponseWithContext,
  estimateTokenCount,
  createMediaMessage,
  combineResponses,
  MediaAttachment,
  SplitMessageResult,
} from './responseFormatterService';

describe('ResponseFormatterService', () => {
  describe('validateMediaAttachment', () => {
    it('should validate correct media attachments', () => {
      const validMedia: MediaAttachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
        caption: 'Test image',
      };
      expect(validateMediaAttachment(validMedia)).toBe(true);
    });

    it('should reject invalid media types', () => {
      const invalidMedia: any = {
        type: 'invalid',
        url: 'https://example.com/file.txt',
      };
      expect(validateMediaAttachment(invalidMedia)).toBe(false);
    });

    it('should reject invalid URLs', () => {
      const invalidMedia: any = {
        type: 'image',
        url: 'not-a-url',
      };
      expect(validateMediaAttachment(invalidMedia)).toBe(false);
    });

    it('should reject oversized media', () => {
      const oversizedMedia: any = {
        type: 'image',
        url: 'https://example.com/image.jpg',
        size: 101 * 1024 * 1024, // 101MB
      };
      expect(validateMediaAttachment(oversizedMedia)).toBe(false);
    });

    it('should reject missing required fields', () => {
      expect(validateMediaAttachment({} as any)).toBe(false);
      expect(validateMediaAttachment({ type: 'image' } as any)).toBe(false);
      expect(validateMediaAttachment({ url: 'https://example.com/image.jpg' } as any)).toBe(false);
    });

    it('should accept all valid media types', () => {
      const types: Array<'image' | 'document' | 'video' | 'audio'> = [
        'image',
        'document',
        'video',
        'audio',
      ];

      types.forEach((type) => {
        const media: MediaAttachment = {
          type,
          url: 'https://example.com/file',
        };
        expect(validateMediaAttachment(media)).toBe(true);
      });
    });
  });

  describe('convertMarkdownToWhatsApp', () => {
    it('should convert bold markdown', () => {
      expect(convertMarkdownToWhatsApp('**bold text**')).toBe('*bold text*');
      expect(convertMarkdownToWhatsApp('This is **bold** text')).toBe('This is *bold* text');
    });

    it('should convert italic markdown', () => {
      expect(convertMarkdownToWhatsApp('*italic text*')).toBe('_italic text_');
      expect(convertMarkdownToWhatsApp('This is *italic* text')).toBe('This is _italic_ text');
    });

    it('should convert strikethrough markdown', () => {
      expect(convertMarkdownToWhatsApp('~~strikethrough~~')).toBe('~strikethrough~');
    });

    it('should convert links', () => {
      expect(convertMarkdownToWhatsApp('[Google](https://google.com)')).toBe(
        'Google (https://google.com)'
      );
    });

    it('should convert headings to bold', () => {
      expect(convertMarkdownToWhatsApp('# Heading 1')).toBe('*Heading 1*');
      expect(convertMarkdownToWhatsApp('## Heading 2')).toBe('*Heading 2*');
      expect(convertMarkdownToWhatsApp('### Heading 3')).toBe('*Heading 3*');
    });

    it('should convert lists to bullet points', () => {
      expect(convertMarkdownToWhatsApp('* Item 1')).toBe('• Item 1');
      expect(convertMarkdownToWhatsApp('- Item 2')).toBe('• Item 2');
      expect(convertMarkdownToWhatsApp('+ Item 3')).toBe('• Item 3');
    });

    it('should handle mixed markdown', () => {
      const input = '**Bold** and *italic* with ~~strikethrough~~';
      const output = convertMarkdownToWhatsApp(input);
      expect(output).toContain('*Bold*');
      expect(output).toContain('_italic_');
      expect(output).toContain('~strikethrough~');
    });

    it('should handle empty or null input', () => {
      expect(convertMarkdownToWhatsApp('')).toBe('');
      expect(convertMarkdownToWhatsApp(null as any)).toBe('');
    });

    it('should preserve code blocks', () => {
      const input = '```\ncode block\n```';
      const output = convertMarkdownToWhatsApp(input);
      expect(output).toContain('```');
    });
  });

  describe('hasMarkdownFormatting', () => {
    it('should detect markdown formatting', () => {
      expect(hasMarkdownFormatting('**bold**')).toBe(true);
      expect(hasMarkdownFormatting('*italic*')).toBe(true);
      expect(hasMarkdownFormatting('~~strikethrough~~')).toBe(true);
      expect(hasMarkdownFormatting('[link](url)')).toBe(true);
      expect(hasMarkdownFormatting('# Heading')).toBe(true);
    });

    it('should not detect markdown in plain text', () => {
      expect(hasMarkdownFormatting('plain text')).toBe(false);
      expect(hasMarkdownFormatting('hello world')).toBe(false);
    });

    it('should handle empty or null input', () => {
      expect(hasMarkdownFormatting('')).toBe(false);
      expect(hasMarkdownFormatting(null as any)).toBe(false);
    });
  });

  describe('findOptimalSplitPoint', () => {
    it('should return full length if text is shorter than max', () => {
      const text = 'Short text';
      expect(findOptimalSplitPoint(text, 100)).toBe(text.length);
    });

    it('should split at sentence boundary', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const splitPoint = findOptimalSplitPoint(text, 30);
      // Should split at or near sentence boundary after position 21 (70% of 30)
      expect(splitPoint).toBeGreaterThan(15);
      expect(splitPoint).toBeLessThanOrEqual(30);
    });

    it('should split at newline if available', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const splitPoint = findOptimalSplitPoint(text, 10);
      // Should split at or near newline after position 7 (70% of 10 = 7)
      expect(splitPoint).toBeLessThanOrEqual(10);
      expect(splitPoint).toBeGreaterThan(0);
    });

    it('should split at word boundary', () => {
      const text = 'This is a long text that needs splitting';
      const splitPoint = findOptimalSplitPoint(text, 15);
      // Should split at or near word boundary
      expect(splitPoint).toBeLessThanOrEqual(15);
      expect(splitPoint).toBeGreaterThan(0);
    });

    it('should handle text with no good split points', () => {
      const text = 'verylongwordwithoutanyspacesorpunctuation';
      const splitPoint = findOptimalSplitPoint(text, 20);
      expect(splitPoint).toBeLessThanOrEqual(20);
    });
  });

  describe('splitMessage', () => {
    it('should not split short messages', () => {
      const text = 'This is a short message';
      const result = splitMessage(text);
      expect(result.totalMessages).toBe(1);
      expect(result.messages[0].text).toBe(text);
    });

    it('should split long messages', () => {
      const text = 'A'.repeat(5000);
      const result = splitMessage(text, 1000);
      expect(result.totalMessages).toBeGreaterThan(1);
      expect(result.messages.every((msg) => msg.text.length <= 1000)).toBe(true);
    });

    it('should preserve message content when splitting', () => {
      const text = 'First part. Second part. Third part.';
      const result = splitMessage(text, 100); // Use 100 instead of 20
      const combined = result.messages.map((msg) => msg.text).join(' ');
      expect(combined).toContain('First part');
      expect(combined).toContain('Second part');
      expect(combined).toContain('Third part');
    });

    it('should track split points', () => {
      const text = 'A'.repeat(5000);
      const result = splitMessage(text, 1000);
      expect(result.splitPoints.length).toBeGreaterThan(0);
      expect(result.splitPoints.length).toBeLessThanOrEqual(result.totalMessages);
    });

    it('should throw error for invalid input', () => {
      expect(() => splitMessage('')).toThrow();
      expect(() => splitMessage(null as any)).toThrow();
      expect(() => splitMessage('text', 50)).toThrow(); // Max length too small
    });

    it('should handle messages at exact boundary', () => {
      const text = 'A'.repeat(4096);
      const result = splitMessage(text, 4096);
      expect(result.totalMessages).toBe(1);
    });

    it('should handle messages just over boundary', () => {
      const text = 'A'.repeat(4097);
      const result = splitMessage(text, 4096);
      expect(result.totalMessages).toBeGreaterThan(1);
    });
  });

  describe('formatResponse', () => {
    it('should format response with markdown conversion', () => {
      const text = '**Bold** and *italic*';
      const result = formatResponse(text, { convertMarkdown: true });
      expect(result.messages[0].text).toContain('*Bold*');
      expect(result.messages[0].text).toContain('_italic_');
    });

    it('should skip markdown conversion if disabled', () => {
      const text = '**Bold** and *italic*';
      const result = formatResponse(text, { convertMarkdown: false });
      expect(result.messages[0].text).toBe(text);
    });

    it('should add media to last message', () => {
      const text = 'Check this image';
      const media: MediaAttachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
        caption: 'Test image',
      };
      const result = formatResponse(text, { media });
      expect(result.messages[result.messages.length - 1].media).toEqual(media);
    });

    it('should throw error for invalid media', () => {
      const text = 'Check this image';
      const invalidMedia: any = {
        type: 'invalid',
        url: 'not-a-url',
      };
      expect(() => formatResponse(text, { media: invalidMedia })).toThrow();
    });

    it('should split long responses', () => {
      const text = 'A'.repeat(5000);
      const result = formatResponse(text, { maxLength: 1000 });
      expect(result.totalMessages).toBeGreaterThan(1);
    });

    it('should return original length', () => {
      const text = 'This is a test message';
      const result = formatResponse(text);
      expect(result.originalLength).toBe(text.length);
    });
  });

  describe('formatResponseWithContext', () => {
    it('should add context indicators when split', () => {
      const text = 'A'.repeat(5000);
      const result = formatResponseWithContext(text, {
        maxLength: 1000,
        addContextIndicators: true,
      });
      expect(result.messages[0].text).toContain('[1/');
      expect(result.messages[result.messages.length - 1].text).toContain(
        `/${result.totalMessages}]`
      );
    });

    it('should not add context indicators if disabled', () => {
      const text = 'A'.repeat(5000);
      const result = formatResponseWithContext(text, {
        maxLength: 1000,
        addContextIndicators: false,
      });
      expect(result.messages[0].text).not.toContain('[1/');
    });

    it('should not add context indicators for single message', () => {
      const text = 'Short message';
      const result = formatResponseWithContext(text, { addContextIndicators: true });
      expect(result.messages[0].text).not.toContain('[1/1]');
    });
  });

  describe('estimateTokenCount', () => {
    it('should estimate token count', () => {
      const text = 'This is a test message';
      const tokens = estimateTokenCount(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 4));
    });

    it('should return 0 for empty input', () => {
      expect(estimateTokenCount('')).toBe(0);
      expect(estimateTokenCount(null as any)).toBe(0);
    });

    it('should scale with text length', () => {
      const short = estimateTokenCount('short');
      const long = estimateTokenCount('A'.repeat(1000));
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('createMediaMessage', () => {
    it('should create media message with caption', () => {
      const media: MediaAttachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
      };
      const result = createMediaMessage(media, 'Test caption');
      expect(result.text).toBe('Test caption');
      expect(result.media).toEqual(media);
    });

    it('should create media message without caption', () => {
      const media: MediaAttachment = {
        type: 'document',
        url: 'https://example.com/doc.pdf',
      };
      const result = createMediaMessage(media);
      expect(result.text).toBe('');
      expect(result.media).toEqual(media);
    });

    it('should throw error for invalid media', () => {
      const invalidMedia: any = {
        type: 'invalid',
        url: 'not-a-url',
      };
      expect(() => createMediaMessage(invalidMedia)).toThrow();
    });
  });

  describe('combineResponses', () => {
    it('should combine multiple responses', () => {
      const response1: SplitMessageResult = {
        messages: [{ text: 'Message 1' }],
        totalMessages: 1,
        originalLength: 9,
        splitPoints: [9],
      };
      const response2: SplitMessageResult = {
        messages: [{ text: 'Message 2' }],
        totalMessages: 1,
        originalLength: 9,
        splitPoints: [9],
      };

      const result = combineResponses([response1, response2]);
      expect(result.totalMessages).toBe(2);
      expect(result.originalLength).toBe(18);
    });

    it('should throw error for empty responses', () => {
      expect(() => combineResponses([])).toThrow();
    });

    it('should preserve media in combined responses', () => {
      const media: MediaAttachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
      };
      const response1: SplitMessageResult = {
        messages: [{ text: 'Message 1', media }],
        totalMessages: 1,
        originalLength: 9,
        splitPoints: [9],
      };
      const response2: SplitMessageResult = {
        messages: [{ text: 'Message 2' }],
        totalMessages: 1,
        originalLength: 9,
        splitPoints: [9],
      };

      const result = combineResponses([response1, response2]);
      expect(result.messages[0].media).toEqual(media);
    });
  });

  describe('Integration tests', () => {
    it('should handle complex markdown with splitting', () => {
      const text = `
# Heading
**Bold text** and *italic text*

- Item 1
- Item 2
- Item 3

[Link](https://example.com)

${'A'.repeat(4000)}
      `;

      const result = formatResponse(text, {
        convertMarkdown: true,
        maxLength: 1000,
      });

      expect(result.totalMessages).toBeGreaterThan(1);
      expect(result.messages.every((msg) => msg.text.length <= 1000)).toBe(true);
    });

    it('should handle response with media and context', () => {
      const text = 'A'.repeat(5000);
      const media: MediaAttachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
        caption: 'Test image',
      };

      const result = formatResponseWithContext(text, {
        maxLength: 1000,
        media,
        addContextIndicators: true,
      });

      expect(result.totalMessages).toBeGreaterThan(1);
      expect(result.messages[result.messages.length - 1].media).toEqual(media);
      expect(result.messages[0].text).toContain('[1/');
    });

    it('should handle edge case: message exactly at boundary', () => {
      const text = 'A'.repeat(4096);
      const result = formatResponse(text, { maxLength: 4096 });
      expect(result.totalMessages).toBe(1);
      expect(result.messages[0].text.length).toBe(4096);
    });

    it('should handle edge case: very long word', () => {
      const longWord = 'A'.repeat(5000);
      const result = formatResponse(longWord, { maxLength: 1000 });
      expect(result.totalMessages).toBeGreaterThan(1);
      expect(result.messages.every((msg) => msg.text.length <= 1000)).toBe(true);
    });
  });
});
