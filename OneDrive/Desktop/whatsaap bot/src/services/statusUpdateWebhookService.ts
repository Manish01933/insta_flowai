/**
 * Status Update Webhook Service
 * Handles WhatsApp status update webhooks (sent, delivered, read)
 */

import logger from '../config/logger';
import { ValidationError } from '../utils/errors';
import MessageStatusService, { WhatsAppStatusUpdate } from './messageStatusService';

/**
 * WhatsApp status update webhook payload structure
 * This is sent by WhatsApp when a message status changes
 */
export interface WhatsAppStatusWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id?: string;
          errors?: Array<{
            code: number;
            title: string;
            message: string;
            error_data?: {
              messaging_product: string;
              details: string;
            };
          }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

/**
 * Extracted status update for processing
 */
export interface ExtractedStatusUpdate {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipientId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Extract status updates from WhatsApp webhook payload
 *
 * @param payload - WhatsApp webhook payload
 * @returns Array of extracted status updates
 */
export const extractStatusUpdates = (
  payload: any
): ExtractedStatusUpdate[] => {
  const updates: ExtractedStatusUpdate[] = [];

  try {
    // Validate payload structure
    if (!payload.entry || !Array.isArray(payload.entry)) {
      logger.warn('Invalid status webhook payload: missing entry array');
      return updates;
    }

    for (const entry of payload.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        // Look for status updates (field === 'message_status')
        if (change.field !== 'message_status' || !change.value) {
          continue;
        }

        const value = change.value;

        // Extract status updates from the value
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            const extracted = extractSingleStatusUpdate(status);
            if (extracted) {
              updates.push(extracted);
            }
          }
        }
      }
    }

    return updates;
  } catch (error: any) {
    logger.error(
      `Error extracting status updates from webhook: ${error.message}`,
      { error: error.stack }
    );
    return updates;
  }
};

/**
 * Extract a single status update from WhatsApp status object
 *
 * @param status - WhatsApp status object
 * @returns Extracted status update or null if invalid
 */
const extractSingleStatusUpdate = (status: any): ExtractedStatusUpdate | null => {
  try {
    // Validate required fields
    if (!status.id || !status.status || !status.timestamp) {
      logger.warn('Invalid status update: missing required fields', {
        id: status.id,
        status: status.status,
        timestamp: status.timestamp,
      });
      return null;
    }

    // Validate status value
    const validStatuses = ['sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status.status)) {
      logger.warn(`Invalid status value: ${status.status}`);
      return null;
    }

    const extracted: ExtractedStatusUpdate = {
      messageId: status.id,
      status: status.status,
      timestamp: status.timestamp,
      recipientId: status.recipient_id,
    };

    // Extract error information if status is failed
    if (status.status === 'failed' && status.errors && Array.isArray(status.errors)) {
      const error = status.errors[0];
      if (error) {
        extracted.errorCode = error.code?.toString();
        extracted.errorMessage = error.message || error.title;
      }
    }

    return extracted;
  } catch (error: any) {
    logger.error(
      `Error extracting single status update: ${error.message}`,
      { error: error.stack }
    );
    return null;
  }
};

/**
 * Process status update
 * Updates message status in database and logs the change
 *
 * @param statusUpdate - Extracted status update
 * @returns Promise resolving to the status update event
 */
export const processStatusUpdate = async (
  statusUpdate: ExtractedStatusUpdate
): Promise<any> => {
  try {
    // Validate status update
    if (!statusUpdate.messageId || !statusUpdate.status) {
      throw new ValidationError(
        'Message ID and status are required',
        'MISSING_REQUIRED_FIELDS'
      );
    }

    logger.info(
      `Processing status update for message: ${statusUpdate.messageId}`,
      {
        status: statusUpdate.status,
        timestamp: statusUpdate.timestamp,
        errorMessage: statusUpdate.errorMessage,
      }
    );

    // Convert to WhatsAppStatusUpdate format
    const whatsappStatusUpdate: WhatsAppStatusUpdate = {
      messageId: statusUpdate.messageId,
      status: statusUpdate.status,
      timestamp: statusUpdate.timestamp,
      recipientId: statusUpdate.recipientId,
      errorCode: statusUpdate.errorCode,
      errorMessage: statusUpdate.errorMessage,
    };

    // Update message status using MessageStatusService
    const statusEvent = await MessageStatusService.updateMessageStatus(
      statusUpdate.messageId,
      whatsappStatusUpdate
    );

    logger.info(
      `Status update processed successfully: ${statusUpdate.messageId}`,
      {
        previousStatus: statusEvent.previousStatus,
        newStatus: statusEvent.newStatus,
      }
    );

    return statusEvent;
  } catch (error: any) {
    logger.error(
      `Error processing status update: ${error.message}`,
      {
        statusUpdate,
        error: error.stack,
      }
    );
    throw error;
  }
};

/**
 * Process multiple status updates
 * Handles batch status updates from WhatsApp
 *
 * @param statusUpdates - Array of status updates to process
 * @returns Promise resolving to array of processed events
 */
export const processStatusUpdates = async (
  statusUpdates: ExtractedStatusUpdate[]
): Promise<any[]> => {
  const results = [];

  for (const statusUpdate of statusUpdates) {
    try {
      const result = await processStatusUpdate(statusUpdate);
      results.push({
        success: true,
        messageId: statusUpdate.messageId,
        result,
      });
    } catch (error: any) {
      logger.error(
        `Failed to process status update for message ${statusUpdate.messageId}: ${error.message}`
      );
      results.push({
        success: false,
        messageId: statusUpdate.messageId,
        error: error.message,
      });
    }
  }

  return results;
};

/**
 * Validate status webhook payload structure
 *
 * @param payload - Payload to validate
 * @returns true if valid, false otherwise
 */
export const validateStatusWebhookPayload = (payload: any): boolean => {
  try {
    if (!payload || typeof payload !== 'object') {
      logger.warn('Invalid payload: not an object');
      return false;
    }

    if (!payload.entry || !Array.isArray(payload.entry)) {
      logger.warn('Invalid payload: missing entry array');
      return false;
    }

    if (payload.entry.length === 0) {
      logger.warn('Invalid payload: empty entry array');
      return false;
    }

    // Check if at least one entry has status changes
    let hasStatusChanges = false;
    for (const entry of payload.entry) {
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'message_status' && change.value?.statuses) {
            hasStatusChanges = true;
            break;
          }
        }
      }
    }

    if (!hasStatusChanges) {
      logger.warn('Invalid payload: no status changes found');
      return false;
    }

    return true;
  } catch (error: any) {
    logger.error(
      `Error validating status webhook payload: ${error.message}`
    );
    return false;
  }
};

export default {
  extractStatusUpdates,
  processStatusUpdate,
  processStatusUpdates,
  validateStatusWebhookPayload,
};
