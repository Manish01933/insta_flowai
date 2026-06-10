import { createClient, RedisClientType } from 'redis';
import config from './environment';
import logger from './logger';

let redisClient: RedisClientType | null = null;

/**
 * Initialize Redis client with connection pooling and error handling
 */
export const initializeRedis = async (): Promise<RedisClientType> => {
  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = createClient({
      url: config.redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            logger.error('Redis reconnection failed after 10 attempts');
            return new Error('Redis max retries exceeded');
          }
          return retries * 100;
        },
        connectTimeout: 10000,
        keepAlive: 30000,
      },
    });

    redisClient.on('error', (err) => {
      logger.error(`Redis Client Error: ${err.message}`);
    });

    redisClient.on('connect', () => {
      logger.info('Redis Client Connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis Client Ready');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis Client Reconnecting');
    });

    await redisClient.connect();
    logger.info('Redis connection established');

    return redisClient;
  } catch (error) {
    logger.error(`Failed to initialize Redis: ${error}`);
    throw error;
  }
};

/**
 * Get Redis client instance
 */
export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initializeRedis first.');
  }
  return redisClient;
};

/**
 * Close Redis connection
 */
export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
};

export default {
  initializeRedis,
  getRedisClient,
  closeRedis,
};
