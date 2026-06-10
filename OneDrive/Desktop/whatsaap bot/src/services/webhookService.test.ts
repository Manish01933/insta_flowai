/**
 * Tests for webhook service
 */

import crypto from 'crypto';
import {
  verifyWebhookSignature,
  extractMessages,
} from './webhookService';

describe('Webhook Service', () => {
  describe('verifyWebhookSignature', () => {
    it('should verify a valid webhook signature', () => {
      const secret = 'test_secret';
      const body = '{"test": "data"}';

      // Calculate the expected signature
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const result = verifyWebhookSignature(body, signature, secret);
      expect(result).toBe(true);
    });

    it('should reject an invalid webhook signature', () => {
      const secret = 'test_secret';
      const body = '{"test": "data"}';
      const invalidSignature = 'sha256=invalid_hash';

      const result = verifyWebhookSignature(body, invalidSignature, secret);
      expect(result).toBe(false);
    });

    it('should reject a signature with wrong algorithm', () => {
      const secret = 'test_secret';
      const body = '{"test": "data"}';
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha1=${hash}`;

      const result = verifyWebhookSignature(body, signature, secret);
      expect(result).toBe(false);
    });

    it('should reject a signature with wrong secret', () => {
      const secret = 'test_secret';
      const wrongSecret = 'wrong_secret';
      const body = '{"test": "data"}';

      const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const signature = `sha256=${hash}`;

      const result = verifyWebhookSignature(body, signature, wrongSecret);
      expect(result).toBe(false);
    });

    it('should handle malformed signature gracefully', () => {
      const secret = 'test_secret';
      const body = '{"test": "data"}';
      const malformedSignature = 'invalid_format';

      const result = verifyWebhookSignature(body, malformedSignature, secret);
      expect(result).toBe(false);
    });
  });

  describe('extractMessages', () => {
    const botId = 'test-bot-id';

    it('should extract a text message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: {
                        body: 'Hello, can you help me?',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        botId,
        from: '919876543210',
        messageId: 'wamid.123',
        timestamp: '1671234567',
        type: 'text',
        text: 'Hello, can you help me?',
      });
    });

    it('should extract an image message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.456',
                      timestamp: '1671234567',
                      type: 'image',
                      image: {
                        id: 'image_id_123',
                        mime_type: 'image/jpeg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        botId,
        from: '919876543210',
        messageId: 'wamid.456',
        timestamp: '1671234567',
        type: 'image',
        mediaId: 'image_id_123',
        mediaType: 'image/jpeg',
      });
    });

    it('should extract a document message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.789',
                      timestamp: '1671234567',
                      type: 'document',
                      document: {
                        id: 'doc_id_123',
                        mime_type: 'application/pdf',
                        filename: 'document.pdf',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        botId,
        from: '919876543210',
        messageId: 'wamid.789',
        timestamp: '1671234567',
        type: 'document',
        mediaId: 'doc_id_123',
        mediaType: 'application/pdf',
      });
    });

    it('should extract an audio message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.audio',
                      timestamp: '1671234567',
                      type: 'audio',
                      audio: {
                        id: 'audio_id_123',
                        mime_type: 'audio/ogg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        botId,
        from: '919876543210',
        messageId: 'wamid.audio',
        timestamp: '1671234567',
        type: 'audio',
        mediaId: 'audio_id_123',
        mediaType: 'audio/ogg',
      });
    });

    it('should extract a video message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.video',
                      timestamp: '1671234567',
                      type: 'video',
                      video: {
                        id: 'video_id_123',
                        mime_type: 'video/mp4',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        botId,
        from: '919876543210',
        messageId: 'wamid.video',
        timestamp: '1671234567',
        type: 'video',
        mediaId: 'video_id_123',
        mediaType: 'video/mp4',
      });
    });

    it('should extract multiple messages', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.1',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'First message' },
                    },
                    {
                      from: '919876543210',
                      id: 'wamid.2',
                      timestamp: '1671234568',
                      type: 'text',
                      text: { body: 'Second message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(2);
      expect(messages[0].messageId).toBe('wamid.1');
      expect(messages[1].messageId).toBe('wamid.2');
    });

    it('should skip messages with missing required fields', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      // Missing 'from' field
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should skip text messages with missing body', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'text',
                      text: {}, // Missing body
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should skip unsupported message types', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'sticker', // Unsupported type
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should handle empty payload', () => {
      const payload = {};

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should handle payload with no messages', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'status', // Not 'messages'
                value: {},
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should handle malformed payload gracefully', () => {
      const payload = {
        entry: 'invalid', // Should be array
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(0);
    });

    it('should use default mime types for media without mime_type', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.123',
                      timestamp: '1671234567',
                      type: 'image',
                      image: {
                        id: 'image_id_123',
                        // No mime_type
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = extractMessages(payload, botId);

      expect(messages).toHaveLength(1);
      expect(messages[0].mediaType).toBe('image/jpeg');
    });
  });
});
