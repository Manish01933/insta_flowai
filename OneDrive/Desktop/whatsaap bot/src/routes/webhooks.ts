/**
 * Webhook routes for WhatsApp integration
 */

import { Router, Request, Response, NextFunction } from 'express';
import config from '../config/environment';
import logger from '../config/logger';
import { asyncHandler } from '../middleware/errorHandler';
import {
  verifyWebhookSignature,
  extractMessages,
  validateBot,
  queueMessage,
} from '../services/webhookService';
import {
  extractStatusUpdates,
  processStatusUpdates,
  validateStatusWebhookPayload,
} from '../services/statusUpdateWebhookService';
import {
  verifyWebhookPayload,
  parseWebhookPayload,
  processWebhookEvent,
} from '../services/razorpayWebhookService';
import { ValidationError } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Middleware to capture raw body for signature verification
 * This must be applied before express.json() for this route
 */
export const captureRawBody = (req: Request, _res: Response, next: NextFunction) => {
  let rawBody = '';

  req.on('data', (chunk) => {
    rawBody += chunk.toString('utf8');
  });

  req.on('end', () => {
    (req as any).rawBody = rawBody;
    next();
  });
};

/**
 * POST /api/webhooks/whatsapp/:botId
 * WhatsApp Cloud API webhook endpoint
 *
 * Handles incoming messages from WhatsApp:
 * 1. Verifies webhook signature using HMAC-SHA256
 * 2. Extracts message data from WhatsApp payload
 * 3. Validates bot exists and is active
 * 4. Queues message for async processing
 * 5. Returns 200 OK immediately for webhook acknowledgment
 */
router.post(
  '/whatsapp/:botId',
  captureRawBody,
  asyncHandler(async (req: Request, res: Response) => {
    const botId = req.params.botId;
    const requestId = (req as any).requestId || uuidv4();

    try {
      logger.info(`[${requestId}] Webhook received for bot: ${botId}`);

      // Step 1: Verify webhook signature
      const signature = req.headers['x-hub-signature-256'] as string;

      if (!signature) {
        logger.warn(`[${requestId}] Missing X-Hub-Signature-256 header`);
        throw new ValidationError(
          'Missing webhook signature header',
          'MISSING_SIGNATURE'
        );
      }

      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        logger.warn(`[${requestId}] Missing raw body for signature verification`);
        throw new ValidationError(
          'Invalid request body',
          'INVALID_REQUEST_BODY'
        );
      }

      const webhookSecret = config.whatsappWebhookSecret;
      if (!webhookSecret) {
        logger.error(`[${requestId}] Webhook secret not configured`);
        throw new ValidationError(
          'Webhook secret not configured',
          'WEBHOOK_SECRET_NOT_CONFIGURED'
        );
      }

      const isSignatureValid = verifyWebhookSignature(
        rawBody,
        signature,
        webhookSecret
      );

      if (!isSignatureValid) {
        logger.warn(`[${requestId}] Invalid webhook signature for bot: ${botId}`);
        throw new ValidationError(
          'Invalid webhook signature',
          'INVALID_SIGNATURE'
        );
      }

      logger.info(`[${requestId}] Webhook signature verified successfully`);

      // Step 2: Parse and extract message data
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (error: any) {
        logger.warn(`[${requestId}] Failed to parse webhook payload: ${error.message}`);
        throw new ValidationError(
          'Invalid JSON payload',
          'INVALID_JSON'
        );
      }

      const messages = extractMessages(payload, botId);
      logger.info(`[${requestId}] Extracted ${messages.length} message(s) from webhook`);

      // Step 3: Validate bot exists and is active
      const bot = await validateBot(botId);
      logger.info(`[${requestId}] Bot validated: ${bot.name}`);

      // Step 4: Return 200 OK immediately for webhook acknowledgment
      // This is critical - WhatsApp expects a 200 response within 30 seconds
      res.status(200).json({
        status: 'received',
        requestId,
      });

      // Step 5: Queue messages for async processing
      // This happens after the response is sent
      for (const message of messages) {
        try {
          await queueMessage(message);
          logger.info(`[${requestId}] Message queued: ${message.messageId}`, {
            from: message.from,
            type: message.type,
          });
        } catch (error: any) {
          logger.error(`[${requestId}] Failed to queue message ${message.messageId}: ${error.message}`);
          // Don't throw - continue processing other messages
        }
      }
    } catch (error: any) {
      // Log the error
      logger.error(`[${requestId}] Webhook processing error: ${error.message}`, {
        botId,
        stack: error.stack,
      });

      // If response hasn't been sent yet, send error response
      if (!res.headersSent) {
        if (error instanceof ValidationError) {
          res.status(400).json({
            error: error.message,
            errorCode: error.errorCode,
            requestId,
          });
        } else {
          res.status(500).json({
            error: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR',
            requestId,
          });
        }
      }
    }
  })
);

/**
 * GET /api/webhooks/whatsapp/:botId
 * Webhook verification endpoint for WhatsApp
 *
 * WhatsApp sends a GET request to verify the webhook during setup
 * Query parameters:
 * - hub.mode: 'subscribe'
 * - hub.challenge: verification token
 * - hub.verify_token: token to verify
 */
router.get(
  '/whatsapp/:botId',
  asyncHandler(async (req: Request, res: Response) => {
    const botId = req.params.botId;
    const mode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = req.query['hub.verify_token'];
    const requestId = (req as any).requestId || uuidv4();

    logger.info(`[${requestId}] Webhook verification request for bot: ${botId}`);

    try {
      // Validate bot exists
      const bot = await validateBot(botId);

      // Verify the token
      if (mode === 'subscribe' && verifyToken === bot.webhookVerifyToken) {
        logger.info(`[${requestId}] Webhook verified successfully for bot: ${botId}`);
        res.status(200).send(challenge);
      } else {
        logger.warn(`[${requestId}] Webhook verification failed: invalid token or mode`);
        res.status(403).json({
          error: 'Verification failed',
          errorCode: 'VERIFICATION_FAILED',
          requestId,
        });
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Webhook verification error: ${error.message}`);

      if (error instanceof ValidationError) {
        res.status(400).json({
          error: error.message,
          errorCode: error.errorCode,
          requestId,
        });
      } else {
        res.status(500).json({
          error: 'Internal server error',
          errorCode: 'INTERNAL_SERVER_ERROR',
          requestId,
        });
      }
    }
  })
);

/**
 * POST /api/webhooks/whatsapp/status/:botId
 * WhatsApp status update webhook endpoint
 *
 * Handles message status updates from WhatsApp (sent, delivered, read, failed):
 * 1. Verifies webhook signature using HMAC-SHA256
 * 2. Extracts status update data from WhatsApp payload
 * 3. Validates bot exists and is active
 * 4. Processes status updates and updates message records
 * 5. Returns 200 OK immediately for webhook acknowledgment
 */
router.post(
  '/whatsapp/status/:botId',
  captureRawBody,
  asyncHandler(async (req: Request, res: Response) => {
    const botId = req.params.botId;
    const requestId = (req as any).requestId || uuidv4();

    try {
      logger.info(`[${requestId}] Status update webhook received for bot: ${botId}`);

      // Step 1: Verify webhook signature
      const signature = req.headers['x-hub-signature-256'] as string;

      if (!signature) {
        logger.warn(`[${requestId}] Missing X-Hub-Signature-256 header`);
        throw new ValidationError(
          'Missing webhook signature header',
          'MISSING_SIGNATURE'
        );
      }

      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        logger.warn(`[${requestId}] Missing raw body for signature verification`);
        throw new ValidationError(
          'Invalid request body',
          'INVALID_REQUEST_BODY'
        );
      }

      const webhookSecret = config.whatsappWebhookSecret;
      if (!webhookSecret) {
        logger.error(`[${requestId}] Webhook secret not configured`);
        throw new ValidationError(
          'Webhook secret not configured',
          'WEBHOOK_SECRET_NOT_CONFIGURED'
        );
      }

      const isSignatureValid = verifyWebhookSignature(
        rawBody,
        signature,
        webhookSecret
      );

      if (!isSignatureValid) {
        logger.warn(`[${requestId}] Invalid webhook signature for bot: ${botId}`);
        throw new ValidationError(
          'Invalid webhook signature',
          'INVALID_SIGNATURE'
        );
      }

      logger.info(`[${requestId}] Webhook signature verified successfully`);

      // Step 2: Parse and extract status update data
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (error: any) {
        logger.warn(`[${requestId}] Failed to parse webhook payload: ${error.message}`);
        throw new ValidationError(
          'Invalid JSON payload',
          'INVALID_JSON'
        );
      }

      // Validate payload structure
      if (!validateStatusWebhookPayload(payload)) {
        logger.warn(`[${requestId}] Invalid status webhook payload structure`);
        throw new ValidationError(
          'Invalid webhook payload structure',
          'INVALID_PAYLOAD_STRUCTURE'
        );
      }

      const statusUpdates = extractStatusUpdates(payload);
      logger.info(
        `[${requestId}] Extracted ${statusUpdates.length} status update(s) from webhook`
      );

      // Step 3: Validate bot exists and is active
      const bot = await validateBot(botId);
      logger.info(`[${requestId}] Bot validated: ${bot.name}`);

      // Step 4: Return 200 OK immediately for webhook acknowledgment
      // This is critical - WhatsApp expects a 200 response within 30 seconds
      res.status(200).json({
        status: 'received',
        requestId,
        updatesCount: statusUpdates.length,
      });

      // Step 5: Process status updates asynchronously
      // This happens after the response is sent
      try {
        const results = await processStatusUpdates(statusUpdates);

        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.filter((r) => !r.success).length;

        logger.info(
          `[${requestId}] Status updates processed: ${successCount} successful, ${failureCount} failed`,
          {
            results,
          }
        );
      } catch (error: any) {
        logger.error(
          `[${requestId}] Error processing status updates: ${error.message}`,
          { error: error.stack }
        );
        // Don't throw - we already sent the response
      }
    } catch (error: any) {
      // Log the error
      logger.error(`[${requestId}] Status webhook processing error: ${error.message}`, {
        botId,
        stack: error.stack,
      });

      // If response hasn't been sent yet, send error response
      if (!res.headersSent) {
        if (error instanceof ValidationError) {
          res.status(400).json({
            error: error.message,
            errorCode: error.errorCode,
            requestId,
          });
        } else {
          res.status(500).json({
            error: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR',
            requestId,
          });
        }
      }
    }
  })
);

/**
 * POST /api/webhooks/razorpay
 * Razorpay webhook endpoint for payment and subscription events
 *
 * Handles events:
 * - payment.authorized: Payment successful, update payment and subscription status
 * - payment.failed: Payment failed, update payment status
 * - subscription.activated: Subscription started, update subscription and user status
 * - subscription.halted: Subscription cancelled, update subscription and user status
 *
 * Authentication: Webhook signature verification (HMAC-SHA256)
 * No JWT required
 */
router.post(
  '/razorpay',
  captureRawBody,
  asyncHandler(async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || uuidv4();

    try {
      logger.info(`[${requestId}] Razorpay webhook received`);

      // Step 1: Extract and verify webhook signature
      const signature = req.headers['x-razorpay-signature'] as string;

      if (!signature) {
        logger.warn(`[${requestId}] Missing X-Razorpay-Signature header`);
        throw new ValidationError(
          'Missing webhook signature header',
          'MISSING_SIGNATURE'
        );
      }

      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        logger.warn(`[${requestId}] Missing raw body for signature verification`);
        throw new ValidationError(
          'Invalid request body',
          'INVALID_REQUEST_BODY'
        );
      }

      const webhookSecret = config.razorpayWebhookSecret;
      if (!webhookSecret) {
        logger.error(`[${requestId}] Razorpay webhook secret not configured`);
        throw new ValidationError(
          'Webhook secret not configured',
          'WEBHOOK_SECRET_NOT_CONFIGURED'
        );
      }

      // Verify webhook signature
      const isSignatureValid = verifyWebhookPayload(
        rawBody,
        signature,
        webhookSecret
      );

      if (!isSignatureValid) {
        logger.warn(`[${requestId}] Invalid Razorpay webhook signature`);
        throw new ValidationError(
          'Invalid webhook signature',
          'INVALID_SIGNATURE'
        );
      }

      logger.info(`[${requestId}] Razorpay webhook signature verified successfully`);

      // Step 2: Parse webhook payload
      let payload: any;
      try {
        payload = parseWebhookPayload(rawBody);
      } catch (error: any) {
        logger.warn(`[${requestId}] Failed to parse webhook payload: ${error.message}`);
        throw new ValidationError(
          'Invalid JSON payload',
          'INVALID_JSON'
        );
      }

      // Validate payload structure
      if (!payload.event || !payload.id) {
        logger.warn(`[${requestId}] Invalid webhook payload structure`);
        throw new ValidationError(
          'Invalid webhook payload structure',
          'INVALID_PAYLOAD_STRUCTURE'
        );
      }

      logger.info(`[${requestId}] Webhook event: ${payload.event}`, {
        eventId: payload.id,
        createdAt: payload.created_at,
      });

      // Step 3: Return 200 OK immediately for webhook acknowledgment
      // This is critical - Razorpay expects a 200 response quickly
      res.status(200).json({
        status: 'received',
        requestId,
        eventId: payload.id,
      });

      // Step 4: Process webhook event asynchronously
      // This happens after the response is sent
      try {
        await processWebhookEvent(payload);
        logger.info(`[${requestId}] Webhook event processed successfully: ${payload.event}`);
      } catch (error: any) {
        logger.error(`[${requestId}] Error processing webhook event: ${error.message}`, {
          error: error.stack,
          eventId: payload.id,
          eventType: payload.event,
        });
        // Don't throw - we already sent the response
      }
    } catch (error: any) {
      // Log the error
      logger.error(`[${requestId}] Razorpay webhook processing error: ${error.message}`, {
        stack: error.stack,
      });

      // If response hasn't been sent yet, send error response
      if (!res.headersSent) {
        if (error instanceof ValidationError) {
          res.status(400).json({
            error: error.message,
            errorCode: error.errorCode,
            requestId,
          });
        } else {
          res.status(500).json({
            error: 'Internal server error',
            errorCode: 'INTERNAL_SERVER_ERROR',
            requestId,
          });
        }
      }
    }
  })
);

export default router;
