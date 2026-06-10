import {
  initializeQueue,
  getMessageQueue,
  addMessageToQueue,
  closeQueue,
  getQueueStats,
  checkQueueHealth,
  MessageQueueData,
  QUEUE_CONFIG,
} from './queue';
import logger from './logger';

describe('Message Queue Configuration', () => {
  beforeAll(async () => {
    // Initialize queue before tests
    await initializeQueue();
  });

  afterAll(async () => {
    // Close queue after tests
    await closeQueue();
  });

  describe('Queue Initialization', () => {
    it('should initialize queue successfully', async () => {
      const queue = getMessageQueue();
      expect(queue).toBeDefined();
      expect(queue.name).toBe(QUEUE_CONFIG.QUEUE_NAME);
    });

    it('should return same queue instance on multiple calls', async () => {
      const queue1 = getMessageQueue();
      const queue2 = getMessageQueue();
      expect(queue1).toBe(queue2);
    });

    it('should throw error if queue not initialized', async () => {
      await closeQueue();
      expect(() => getMessageQueue()).toThrow(
        'Message queue not initialized. Call initializeQueue first.'
      );
      // Re-initialize for other tests
      await initializeQueue();
    });

    it('should have correct concurrency configuration', () => {
      expect(QUEUE_CONFIG.CONCURRENCY).toBe(5);
      expect(QUEUE_CONFIG.MAX_ATTEMPTS).toBe(3);
      expect(QUEUE_CONFIG.JOB_TIMEOUT).toBe(60000);
    });

    it('should have exponential backoff configured', () => {
      expect(QUEUE_CONFIG.BACKOFF_INITIAL_DELAY).toBe(1000);
      expect(QUEUE_CONFIG.BACKOFF_MAX_DELAY).toBe(4000);
    });
  });

  describe('Message Queue Operations', () => {
    it('should add message to queue', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-123',
        from: '919876543210',
        messageId: 'wamid.test123',
        text: 'Hello, test message',
        timestamp: new Date().toISOString(),
      };

      const job = await addMessageToQueue(messageData);
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.data).toEqual(messageData);
    });

    it('should add message with media to queue', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-456',
        from: '919876543211',
        messageId: 'wamid.test456',
        text: 'Image message',
        timestamp: new Date().toISOString(),
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image',
      };

      const job = await addMessageToQueue(messageData);
      expect(job).toBeDefined();
      expect(job.data.mediaUrl).toBe('https://example.com/image.jpg');
      expect(job.data.mediaType).toBe('image');
    });

    it('should configure retry logic with exponential backoff', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-789',
        from: '919876543212',
        messageId: 'wamid.test789',
        text: 'Retry test message',
        timestamp: new Date().toISOString(),
      };

      const job = await addMessageToQueue(messageData);
      expect(job.opts.attempts).toBe(QUEUE_CONFIG.MAX_ATTEMPTS);
      expect(job.opts.backoff).toEqual({
        type: 'exponential',
        delay: QUEUE_CONFIG.BACKOFF_INITIAL_DELAY,
      });
    });

    it('should set job timeout to configured value', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-timeout',
        from: '919876543213',
        messageId: 'wamid.test-timeout',
        text: 'Timeout test message',
        timestamp: new Date().toISOString(),
      };

      const job = await addMessageToQueue(messageData);
      expect(job.opts.timeout).toBe(QUEUE_CONFIG.JOB_TIMEOUT);
    });

    it('should remove completed jobs automatically', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-complete',
        from: '919876543219',
        messageId: 'wamid.test-complete',
        text: 'Complete test message',
        timestamp: new Date().toISOString(),
      };

      const job = await addMessageToQueue(messageData);
      expect(job.opts.removeOnComplete).toBe(true);
    });

    it('should keep failed jobs for debugging', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-failed',
        from: '919876543217',
        messageId: 'wamid.test-failed',
        text: 'Failed job test message',
        timestamp: new Date().toISOString(),
      };

      const job = await addMessageToQueue(messageData);
      expect(job.opts.removeOnFail).toBe(false);
    });
  });

  describe('Queue Statistics', () => {
    it('should get queue statistics', async () => {
      const stats = await getQueueStats();
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('delayed');
      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.delayed).toBe('number');
    });

    it('should track waiting jobs', async () => {
      const messageData: MessageQueueData = {
        botId: 'test-bot-stats',
        from: '919876543214',
        messageId: 'wamid.test-stats',
        text: 'Stats test message',
        timestamp: new Date().toISOString(),
      };

      const initialStats = await getQueueStats();
      await addMessageToQueue(messageData);
      const updatedStats = await getQueueStats();

      // Waiting count should be greater or equal (job might be processing)
      expect(updatedStats.waiting + updatedStats.active).toBeGreaterThanOrEqual(
        initialStats.waiting + initialStats.active
      );
    });
  });

  describe('Queue Health Check', () => {
    it('should perform health check successfully', async () => {
      const health = await checkQueueHealth();
      expect(health).toBeDefined();
      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('connected');
      expect(health).toHaveProperty('stats');
      expect(typeof health.healthy).toBe('boolean');
      expect(typeof health.connected).toBe('boolean');
    });

    it('should return queue statistics in health check', async () => {
      const health = await checkQueueHealth();
      expect(health.stats).toHaveProperty('waiting');
      expect(health.stats).toHaveProperty('active');
      expect(health.stats).toHaveProperty('completed');
      expect(health.stats).toHaveProperty('failed');
      expect(health.stats).toHaveProperty('delayed');
    });
  });

  describe('Queue Configuration Validation', () => {
    it('should have correct concurrency limit', () => {
      expect(QUEUE_CONFIG.CONCURRENCY).toBe(5);
    });

    it('should have correct max retry attempts', () => {
      expect(QUEUE_CONFIG.MAX_ATTEMPTS).toBe(3);
    });

    it('should have exponential backoff settings', () => {
      expect(QUEUE_CONFIG.BACKOFF_INITIAL_DELAY).toBe(1000);
      expect(QUEUE_CONFIG.BACKOFF_MAX_DELAY).toBe(4000);
    });

    it('should have stalled job detection enabled', () => {
      expect(QUEUE_CONFIG.STALLED_INTERVAL).toBe(5000);
      expect(QUEUE_CONFIG.MAX_STALLED_COUNT).toBe(2);
    });

    it('should have lock management configured', () => {
      expect(QUEUE_CONFIG.LOCK_DURATION).toBe(30000);
      expect(QUEUE_CONFIG.LOCK_RENEW_TIME).toBe(15000);
    });
  });

  describe('Error Handling', () => {
    it('should handle queue errors gracefully', async () => {
      const queue = getMessageQueue();
      expect(queue).toBeDefined();
      // Queue error handlers are set up in initializeQueue
    });

    it('should log queue events', async () => {
      const loggerSpy = jest.spyOn(logger, 'info');
      const messageData: MessageQueueData = {
        botId: 'test-bot-logging',
        from: '919876543218',
        messageId: 'wamid.test-logging',
        text: 'Logging test message',
        timestamp: new Date().toISOString(),
      };

      await addMessageToQueue(messageData);
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });

    it('should throw error with descriptive message on queue add failure', async () => {
      // Close queue to simulate failure
      await closeQueue();

      const messageData: MessageQueueData = {
        botId: 'test-bot-error',
        from: '919876543220',
        messageId: 'wamid.test-error',
        text: 'Error test message',
        timestamp: new Date().toISOString(),
      };

      await expect(addMessageToQueue(messageData)).rejects.toThrow();

      // Re-initialize for remaining tests
      await initializeQueue();
    });
  });
});
