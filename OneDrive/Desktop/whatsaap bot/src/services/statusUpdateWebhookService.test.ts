/**
 * Tests for Status Update Webhook Service
 * Tests status extraction, validation, and processing for WhatsApp delivery updates
 */

import {
  extractStatusUpdates,
  validateStatusWebhookPayload,
  WhatsAppStatusWebhookPayload,
  ExtractedStatusUpdate,
} from './statusUpdateWebhookService';
import { NotFoundError } from '../utils/errors';

// Mock MessageStatusService before importing
jest.mock('./messageStatusService');

import MessageStatusService from './messageStatusService';

describe('Status Update Webhook Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractStatusUpdates', () => {
    it('should extract sent status update', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6',
                      status: 'sent',
                      timestamp: '1671263051',
                      recipient_id: '919876543210',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(1);
      expect(updates[0].messageId).toBe('wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6');
      expect(updates[0].status).toBe('sent');
      expect(updates[0].timestamp).toBe('1671263051');
      expect(updates[0].recipientId).toBe('919876543210');
    });

    it('should extract delivered status update', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6',
                      status: 'delivered',
                      timestamp: '1671263052',
                      recipient_id: '919876543210',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('delivered');
      expect(updates[0].timestamp).toBe('1671263052');
    });

    it('should extract read status update', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6',
                      status: 'read',
                      timestamp: '1671263053',
                      recipient_id: '919876543210',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('read');
    });

    it('should extract failed status update with error information', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6',
                      status: 'failed',
                      timestamp: '1671263054',
                      recipient_id: '919876543210',
                      errors: [
                        {
                          code: 131026,
                          title: 'Message blocked',
                          message: 'Message was unable to be delivered',
                          error_data: {
                            messaging_product: 'whatsapp',
                            details: 'Message blocked by user',
                          },
                        },
                      ],
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('failed');
      expect(updates[0].errorCode).toBe('131026');
      expect(updates[0].errorMessage).toBe('Message was unable to be delivered');
    });

    it('should extract multiple status updates', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.msg1',
                      status: 'sent',
                      timestamp: '1671263051',
                    },
                    {
                      id: 'wamid.msg2',
                      status: 'delivered',
                      timestamp: '1671263052',
                    },
                    {
                      id: 'wamid.msg3',
                      status: 'read',
                      timestamp: '1671263053',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(3);
      expect(updates[0].messageId).toBe('wamid.msg1');
      expect(updates[1].messageId).toBe('wamid.msg2');
      expect(updates[2].messageId).toBe('wamid.msg3');
    });

    it('should skip invalid status updates (missing required fields)', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.msg1',
                      status: 'sent',
                      timestamp: '1671263051',
                    },
                    {
                      // Missing id
                      status: 'delivered',
                      timestamp: '1671263052',
                    } as any,
                    {
                      id: 'wamid.msg3',
                      status: 'read',
                      timestamp: '1671263053',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(2);
      expect(updates[0].messageId).toBe('wamid.msg1');
      expect(updates[1].messageId).toBe('wamid.msg3');
    });

    it('should skip invalid status values', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.msg1',
                      status: 'sent',
                      timestamp: '1671263051',
                    },
                    {
                      id: 'wamid.msg2',
                      status: 'invalid_status' as any,
                      timestamp: '1671263052',
                    },
                    {
                      id: 'wamid.msg3',
                      status: 'delivered',
                      timestamp: '1671263053',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(2);
      expect(updates[0].messageId).toBe('wamid.msg1');
      expect(updates[1].messageId).toBe('wamid.msg3');
    });

    it('should handle non-message_status changes', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                },
                field: 'messages', // Not message_status
              },
            ],
          },
        ],
      };

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(0);
    });

    it('should handle empty payload gracefully', () => {
      const payload: any = {};

      const updates = extractStatusUpdates(payload);

      expect(updates).toHaveLength(0);
    });
  });

  describe('validateStatusWebhookPayload', () => {
    it('should validate correct status webhook payload', () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.msg1',
                      status: 'sent',
                      timestamp: '1671263051',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      const isValid = validateStatusWebhookPayload(payload);

      expect(isValid).toBe(true);
    });

    it('should reject payload without entry array', () => {
      const payload: any = {
        object: 'whatsapp_business_account',
      };

      const isValid = validateStatusWebhookPayload(payload);

      expect(isValid).toBe(false);
    });

    it('should reject payload with empty entry array', () => {
      const payload: any = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const isValid = validateStatusWebhookPayload(payload);

      expect(isValid).toBe(false);
    });

    it('should reject payload without status changes', () => {
      const payload: any = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                },
                field: 'messages', // Not message_status
              },
            ],
          },
        ],
      };

      const isValid = validateStatusWebhookPayload(payload);

      expect(isValid).toBe(false);
    });

    it('should reject null or non-object payload', () => {
      expect(validateStatusWebhookPayload(null)).toBe(false);
      expect(validateStatusWebhookPayload(undefined)).toBe(false);
      expect(validateStatusWebhookPayload('not an object')).toBe(false);
      expect(validateStatusWebhookPayload(123)).toBe(false);
    });
  });

  describe('processStatusUpdate', () => {
    it('should process status update successfully', async () => {
      const statusUpdate: ExtractedStatusUpdate = {
        messageId: 'wamid.msg1',
        status: 'delivered',
        timestamp: '1671263052',
        recipientId: '919876543210',
      };

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'delivered',
        timestamp: new Date(),
      };

      (MessageStatusService.updateMessageStatus as jest.Mock).mockResolvedValue(
        mockStatusEvent
      );

      const processStatusUpdate = (await import('./statusUpdateWebhookService')).processStatusUpdate;
      const result = await processStatusUpdate(statusUpdate);

      expect(MessageStatusService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.msg1',
        expect.objectContaining({
          messageId: 'wamid.msg1',
          status: 'delivered',
          timestamp: '1671263052',
          recipientId: '919876543210',
        })
      );
      expect(result).toEqual(mockStatusEvent);
    });

    it('should process failed status update with error information', async () => {
      const statusUpdate: ExtractedStatusUpdate = {
        messageId: 'wamid.msg1',
        status: 'failed',
        timestamp: '1671263054',
        errorCode: '131026',
        errorMessage: 'Message was unable to be delivered',
      };

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'failed',
        timestamp: new Date(),
        errorMessage: 'Message was unable to be delivered',
      };

      (MessageStatusService.updateMessageStatus as jest.Mock).mockResolvedValue(
        mockStatusEvent
      );

      const processStatusUpdate = (await import('./statusUpdateWebhookService')).processStatusUpdate;
      await processStatusUpdate(statusUpdate);

      expect(MessageStatusService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.msg1',
        expect.objectContaining({
          status: 'failed',
          errorCode: '131026',
          errorMessage: 'Message was unable to be delivered',
        })
      );
    });

    it('should throw error for missing required fields', async () => {
      const statusUpdate = {
        status: 'delivered',
        timestamp: '1671263052',
      } as ExtractedStatusUpdate;

      const processStatusUpdate = (await import('./statusUpdateWebhookService')).processStatusUpdate;

      await expect(processStatusUpdate(statusUpdate)).rejects.toThrow(
        'Message ID and status are required'
      );
    });
  });

  describe('processStatusUpdates', () => {
    it('should process multiple status updates', async () => {
      const statusUpdates: ExtractedStatusUpdate[] = [
        {
          messageId: 'wamid.msg1',
          status: 'sent',
          timestamp: '1671263051',
        },
        {
          messageId: 'wamid.msg2',
          status: 'delivered',
          timestamp: '1671263052',
        },
        {
          messageId: 'wamid.msg3',
          status: 'read',
          timestamp: '1671263053',
        },
      ];

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'delivered',
        timestamp: new Date(),
      };

      (MessageStatusService.updateMessageStatus as jest.Mock).mockResolvedValue(
        mockStatusEvent
      );

      const processStatusUpdates = (await import('./statusUpdateWebhookService')).processStatusUpdates;
      const results = await processStatusUpdates(statusUpdates);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
      expect(MessageStatusService.updateMessageStatus).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures gracefully', async () => {
      const statusUpdates: ExtractedStatusUpdate[] = [
        {
          messageId: 'wamid.msg1',
          status: 'sent',
          timestamp: '1671263051',
        },
        {
          messageId: 'wamid.msg2',
          status: 'delivered',
          timestamp: '1671263052',
        },
      ];

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'delivered',
        timestamp: new Date(),
      };

      (MessageStatusService.updateMessageStatus as jest.Mock)
        .mockResolvedValueOnce(mockStatusEvent)
        .mockRejectedValueOnce(new NotFoundError('Message not found', 'NOT_FOUND'));

      const processStatusUpdates = (await import('./statusUpdateWebhookService')).processStatusUpdates;
      const results = await processStatusUpdates(statusUpdates);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Message not found');
    });

    it('should return empty array for empty input', async () => {
      const processStatusUpdates = (await import('./statusUpdateWebhookService')).processStatusUpdates;
      const results = await processStatusUpdates([]);

      expect(results).toHaveLength(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete workflow: extract -> validate -> process', async () => {
      const payload: WhatsAppStatusWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '1234567890',
                    phone_number_id: '1234567890',
                  },
                  statuses: [
                    {
                      id: 'wamid.HBEUGVFo9LFPAgkqya6KsJtS1H6',
                      status: 'delivered',
                      timestamp: '1671263052',
                      recipient_id: '919876543210',
                    },
                  ],
                },
                field: 'message_status',
              },
            ],
          },
        ],
      };

      // Validate payload
      const isValid = validateStatusWebhookPayload(payload);
      expect(isValid).toBe(true);

      // Extract updates
      const updates = extractStatusUpdates(payload);
      expect(updates).toHaveLength(1);

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'delivered',
        timestamp: new Date(),
      };

      (MessageStatusService.updateMessageStatus as jest.Mock).mockResolvedValue(
        mockStatusEvent
      );

      // Process updates
      const processStatusUpdates = (await import('./statusUpdateWebhookService')).processStatusUpdates;
      const results = await processStatusUpdates(updates);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it('should handle status progression: sent -> delivered -> read', async () => {
      const statusUpdates: ExtractedStatusUpdate[] = [
        {
          messageId: 'wamid.msg1',
          status: 'sent',
          timestamp: '1671263051',
        },
        {
          messageId: 'wamid.msg1',
          status: 'delivered',
          timestamp: '1671263052',
        },
        {
          messageId: 'wamid.msg1',
          status: 'read',
          timestamp: '1671263053',
        },
      ];

      const mockStatusEvent = {
        messageId: 'msg-123',
        previousStatus: 'sent',
        newStatus: 'delivered',
        timestamp: new Date(),
      };

      (MessageStatusService.updateMessageStatus as jest.Mock).mockResolvedValue(
        mockStatusEvent
      );

      const processStatusUpdates = (await import('./statusUpdateWebhookService')).processStatusUpdates;
      const results = await processStatusUpdates(statusUpdates);

      expect(results).toHaveLength(3);
      expect(results.every((r: any) => r.success)).toBe(true);
      expect(MessageStatusService.updateMessageStatus).toHaveBeenCalledTimes(3);
    });
  });
});
