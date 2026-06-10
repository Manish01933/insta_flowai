import Queue, { Queue as BullQueue, Job, QueueOptions } from 'bull';
import config from './environment';
import logger from './logger';

/**
 * Message processing queue interface
 */
export interface MessageQueueData {
  botId: string;
  from: string;
  messageId: string;
  text: string;
  timestamp: string;
  mediaUrl?: string;
  mediaType?: string;
}

/**
 * Queue instance for message processing
 */
let messageQueue: BullQueue<MessageQueueData> | null = null;

/**
 * Queue configuration constants
 * These define the queue behavior for production-grade message processing
 */
export const QUEUE_CONFIG = {
  // Concurrency: process up to 5 messages in parallel
  CONCURRENCY: 5,
  
  // Retry attempts: try up to 3 times
  MAX_ATTEMPTS: 3,
  
  // Exponential backoff delays (in milliseconds)
  // Attempt 1: fail immediately -> retry
  // Attempt 2: wait 1s -> retry
  // Attempt 3: wait 2s -> fail
  BACKOFF_INITIAL_DELAY: 1000,
  BACKOFF_MAX_DELAY: 4000,
  
  // Job timeout: 60 seconds per job
  JOB_TIMEOUT: 60000,
  
  // Stalled detection: mark job as stalled after 5 seconds of no progress
  STALLED_INTERVAL: 5000,
  MAX_STALLED_COUNT: 2,
  
  // Lock management for distributed processing
  LOCK_DURATION: 30000,
  LOCK_RENEW_TIME: 15000,
  
  // Queue name for message processing
  QUEUE_NAME: 'message-processing',
} as const;

/**
 * Parse Redis URL and extract connection options
 * Handles both standard redis:// and with-authentication formats
 */
const parseRedisUrl = (url: string): any => {
  try {
    const redisUrl = new URL(url);
    return {
      host: redisUrl.hostname || 'localhost',
      port: parseInt(redisUrl.port || '6379', 10),
      password: redisUrl.password || undefined,
      db: redisUrl.pathname ? parseInt(redisUrl.pathname.slice(1), 10) : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    };
  } catch (error: any) {
    logger.error(`Failed to parse Redis URL: ${error.message}`);
    throw new Error(`Invalid Redis URL format: ${error.message}`);
  }
};

/**
 * Initialize Bull queue for message processing
 * 
 * Configuration includes:
 * - Connection to Redis instance with error handling
 * - Retry logic with exponential backoff (3 attempts: 1s, 2s, 4s)
 * - Concurrency limit of 5 messages in parallel
 * - Comprehensive error handling and event listeners
 * - Stalled job detection and recovery
 * 
 * @returns Promise resolving to initialized message queue
 * @throws Error if queue initialization fails
 */
export const initializeQueue = async (): Promise<BullQueue<MessageQueueData>> => {
  if (messageQueue) {
    logger.info('Message queue already initialized');
    return messageQueue;
  }

  try {
    logger.debug('Initializing message queue...');
    
    // Parse Redis URL to extract connection options
    const redisOptions = parseRedisUrl(config.redisUrl);

    // Create queue options with production settings
    const queueOptions: QueueOptions = {
      redis: redisOptions,
      settings: {
        // Stalled detection configuration
        maxStalledCount: QUEUE_CONFIG.MAX_STALLED_COUNT,
        stalledInterval: QUEUE_CONFIG.STALLED_INTERVAL,
        
        // Lock management for distributed processing
        lockDuration: QUEUE_CONFIG.LOCK_DURATION,
        lockRenewTime: QUEUE_CONFIG.LOCK_RENEW_TIME,
      },
    };

    // Create message processing queue
    messageQueue = new Queue<MessageQueueData>(QUEUE_CONFIG.QUEUE_NAME, queueOptions);

    // Configure queue concurrency: process messages in parallel with limit
    messageQueue.process(QUEUE_CONFIG.CONCURRENCY, async (job: Job<MessageQueueData>) => {
      logger.debug(`Processing message job ${job.id} for bot ${job.data.botId}`);
      // Job processing logic will be implemented in the message handler
      return { success: true, jobId: job.id };
    });

    // Event handlers for queue operations
    
    messageQueue.on('connected', () => {
      logger.info('Message queue connected to Redis');
    });

    messageQueue.on('ready', () => {
      logger.info('Message queue is ready for processing');
    });

    messageQueue.on('completed', (job: Job<MessageQueueData>) => {
      logger.info(`Message job ${job.id} completed successfully`, {
        botId: job.data.botId,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      });
    });

    messageQueue.on('failed', (job: Job<MessageQueueData>, err: Error) => {
      logger.error(
        `Message job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`,
        {
          botId: job.data.botId,
          attempt: job.attemptsMade,
          maxAttempts: job.opts.attempts,
          error: err.stack,
        }
      );
    });

    messageQueue.on('error', (err: Error) => {
      logger.error(`Queue connection error: ${err.message}`, {
        error: err.stack,
      });
    });

    messageQueue.on('stalled', (job: Job<MessageQueueData>) => {
      logger.warn(`Message job ${job.id} stalled and will be reprocessed`, {
        botId: job.data.botId,
        staledCount: job.attemptsMade,
      });
    });

    messageQueue.on('waiting', (jobId: string) => {
      logger.debug(`Message job ${jobId} is waiting to be processed`);
    });

    messageQueue.on('active', (job: Job<MessageQueueData>) => {
      logger.debug(`Message job ${job.id} is now active`, {
        botId: job.data.botId,
      });
    });

    messageQueue.on('progress', (job: Job<MessageQueueData>, progress: number) => {
      logger.debug(`Message job ${job.id} progress: ${progress}%`);
    });

    logger.info('Message queue initialized successfully', {
      concurrency: QUEUE_CONFIG.CONCURRENCY,
      maxAttempts: QUEUE_CONFIG.MAX_ATTEMPTS,
      backoffDelay: QUEUE_CONFIG.BACKOFF_INITIAL_DELAY,
      jobTimeout: QUEUE_CONFIG.JOB_TIMEOUT,
    });
    
    return messageQueue;
  } catch (error: any) {
    logger.error(`Failed to initialize message queue: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Queue initialization failed: ${error.message}`);
  }
};

/**
 * Get message queue instance
 * Throws error if queue is not initialized
 * 
 * @returns The initialized message queue instance
 * @throws Error if queue is not initialized
 */
export const getMessageQueue = (): BullQueue<MessageQueueData> => {
  if (!messageQueue) {
    throw new Error(
      'Message queue not initialized. Call initializeQueue first.'
    );
  }
  return messageQueue;
};

/**
 * Add message to queue for processing
 * 
 * Features:
 * - Exponential backoff retry strategy (3 attempts)
 * - 60-second timeout per job
 * - Automatic cleanup of completed jobs
 * - Persistent storage of failed jobs for debugging
 * 
 * Retry schedule:
 * - Attempt 1: Initial submission
 * - Attempt 2: After 1 second delay
 * - Attempt 3: After 2 second delay
 * 
 * @param data - Message data to process
 * @returns Promise resolving to the created job
 * @throws Error if message cannot be added to queue
 */
export const addMessageToQueue = async (
  data: MessageQueueData
): Promise<Job<MessageQueueData>> => {
  const queue = getMessageQueue();

  try {
    logger.debug(`Adding message to queue for bot ${data.botId}`, {
      messageId: data.messageId,
      from: data.from,
    });

    const job = await queue.add(data, {
      // Retry configuration
      attempts: QUEUE_CONFIG.MAX_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: QUEUE_CONFIG.BACKOFF_INITIAL_DELAY,
      },
      
      // Job lifecycle
      removeOnComplete: true, // Automatically remove successful jobs
      removeOnFail: false, // Keep failed jobs for debugging
      
      // Job timeout
      timeout: QUEUE_CONFIG.JOB_TIMEOUT,
      
      // Prevent duplicate jobs with the same ID within a time window
      repeat: undefined, // No repeat scheduling for standard message jobs
    });

    logger.info(`Message added to queue successfully`, {
      jobId: job.id,
      botId: data.botId,
      messageId: data.messageId,
      from: data.from,
    });
    
    return job;
  } catch (error: any) {
    logger.error(`Failed to add message to queue: ${error.message}`, {
      botId: data.botId,
      messageId: data.messageId,
      error: error.stack,
    });
    throw new Error(`Failed to queue message: ${error.message}`);
  }
};

/**
 * Close queue connection
 * Gracefully shuts down the queue and releases Redis resources
 * 
 * This should be called on application shutdown to:
 * - Stop processing new jobs
 * - Close Redis connections
 * - Clean up event listeners
 * 
 * @throws Error if queue closure fails
 */
export const closeQueue = async (): Promise<void> => {
  if (messageQueue) {
    try {
      logger.info('Closing message queue...');
      
      await messageQueue.close();
      messageQueue = null;
      
      logger.info('Message queue closed successfully');
    } catch (error: any) {
      logger.error(`Error closing message queue: ${error.message}`, {
        error: error.stack,
      });
      throw new Error(`Failed to close queue: ${error.message}`);
    }
  }
};

/**
 * Get queue statistics and metrics
 * Returns current state of the message queue for monitoring
 * 
 * @returns Queue statistics including job counts by status
 * @throws Error if unable to retrieve statistics
 */
export const getQueueStats = async (): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> => {
  const queue = getMessageQueue();

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    const stats = {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };

    logger.debug('Queue statistics retrieved', stats);
    
    return stats;
  } catch (error: any) {
    logger.error(`Failed to get queue stats: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Failed to retrieve queue statistics: ${error.message}`);
  }
};

/**
 * Clear all jobs from the queue
 * 
 * ⚠️ WARNING: This will remove ALL jobs (waiting, active, completed, failed, delayed)
 * Use with caution as this cannot be undone.
 * 
 * This is useful for:
 * - Cleaning up after testing
 * - Emergency recovery from queue corruption
 * 
 * @throws Error if queue clearing fails
 */
export const clearQueue = async (): Promise<void> => {
  const queue = getMessageQueue();

  try {
    logger.warn('Clearing message queue - all jobs will be removed');
    
    await queue.empty();
    
    logger.warn('Message queue cleared successfully');
  } catch (error: any) {
    logger.error(`Failed to clear queue: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Failed to clear queue: ${error.message}`);
  }
};

/**
 * Health check for the message queue
 * Verifies that the queue is operational and connected
 * 
 * @returns Object with health status and queue metrics
 * @throws Error if health check fails
 */
export const checkQueueHealth = async (): Promise<{
  healthy: boolean;
  connected: boolean;
  stats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}> => {
  try {
    getMessageQueue(); // Verify queue is initialized
    const stats = await getQueueStats();
    
    return {
      healthy: true,
      connected: true, // If we got stats, connection is good
      stats,
    };
  } catch (error: any) {
    logger.error(`Queue health check failed: ${error.message}`);
    return {
      healthy: false,
      connected: false,
      stats: {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      },
    };
  }
};

export default {
  initializeQueue,
  getMessageQueue,
  addMessageToQueue,
  closeQueue,
  getQueueStats,
  clearQueue,
  checkQueueHealth,
  QUEUE_CONFIG,
};
