# Bull Message Queue Setup Documentation

## Overview

This document describes the Redis message queue setup using Bull (a Node.js queue library built on Redis). The message queue is the backbone of the asynchronous message processing pipeline for WhatsApp messages in BotBazaar.

## Architecture

### Message Processing Flow

```
WhatsApp Webhook
    ↓
Webhook Handler (signatures verified)
    ↓
Extract Messages
    ↓
Queue Message (Bull/Redis)
    ↓
Message Queue Worker (Async)
    ↓
Claude AI Processing
    ↓
Database Updates
    ↓
Send via WhatsApp API
```

## Configuration

### Queue Initialization

The message queue is initialized in `src/config/queue.ts` with the following configuration:

#### Connection Settings
- **Redis URL**: Configured via `REDIS_URL` environment variable
- **Default**: `redis://localhost:6379`
- **Connection Pooling**: Enabled with automatic reconnection

#### Queue Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| Queue Name | `message-processing` | Identifies the queue in Redis |
| Concurrency | 5 | Max 5 messages processed in parallel |
| Max Attempts | 3 | Retry failed jobs up to 3 times |
| Job Timeout | 60 seconds | Timeout for each job |
| Backoff Type | Exponential | Delays grow exponentially on retries |
| Initial Delay | 1 second | First retry delay |
| Max Delay | 4 seconds | Maximum delay between retries |

### Retry Strategy

Bull implements automatic retry with exponential backoff:

```
Attempt 1: Job fails → Queue for retry
Wait 1 second
Attempt 2: Job fails → Queue for retry
Wait 2 seconds
Attempt 3: Job fails → Permanently failed
```

**Job Lifecycle:**
- **Created**: Job added to queue with initial data
- **Waiting**: Job waiting for available worker
- **Active**: Job currently being processed
- **Completed**: Job succeeded (removed from Redis after completion)
- **Failed**: Job exhausted all retries (persisted for debugging)
- **Stalled**: Job detection (auto-recovered)
- **Delayed**: Job scheduled for later processing

### Concurrency Limits

The queue processes up to **5 messages in parallel** to prevent:
- Database connection pool exhaustion
- API rate limit violations
- Memory overflow with too many concurrent operations

This is configurable in `QUEUE_CONFIG.CONCURRENCY` in `src/config/queue.ts`.

## Key Features

### 1. Error Handling

The queue includes comprehensive error handling:

```typescript
// Automatic retry with exponential backoff
attempts: 3
backoff: {
  type: 'exponential',
  delay: 1000 // 1s, 2s, 4s progression
}

// Job timeout
timeout: 60000 // 60 seconds per job

// Stalled job detection
stalledInterval: 5000 // Check every 5 seconds
maxStalledCount: 2 // Retry if stalled twice
```

### 2. Event Listeners

The queue emits events for monitoring:

- `connected`: Queue connected to Redis
- `ready`: Queue ready for processing
- `completed`: Job completed successfully
- `failed`: Job failed after all retries
- `error`: Queue connection error
- `stalled`: Job detected as stalled
- `waiting`: Job added to queue
- `active`: Job started processing
- `progress`: Job progress update

### 3. Job Persistence

- **Completed Jobs**: Automatically removed after completion
- **Failed Jobs**: Persisted indefinitely for debugging and replay
- **Queue State**: Survives application restarts (stored in Redis)

## API Reference

### Core Functions

#### `initializeQueue()`
Initializes the message queue with Redis connection.

```typescript
await initializeQueue();
```

**Returns:** Promise<BullQueue<MessageQueueData>>

#### `getMessageQueue()`
Returns the initialized message queue instance.

```typescript
const queue = getMessageQueue();
```

**Throws:** Error if queue not initialized

#### `addMessageToQueue(data: MessageQueueData)`
Adds a message to the queue for async processing.

```typescript
const job = await addMessageToQueue({
  botId: 'bot-123',
  from: '919876543210',
  messageId: 'wamid.123',
  text: 'Hello',
  timestamp: '2024-01-15T10:00:00Z'
});
```

**Returns:** Promise<Job<MessageQueueData>>

#### `getQueueStats()`
Returns current queue statistics.

```typescript
const stats = await getQueueStats();
// {
//   waiting: 5,
//   active: 2,
//   completed: 1000,
//   failed: 3,
//   delayed: 0
// }
```

#### `checkQueueHealth()`
Checks queue health and connectivity.

```typescript
const health = await checkQueueHealth();
// {
//   healthy: true,
//   connected: true,
//   stats: { ... }
// }
```

#### `closeQueue()`
Gracefully shuts down the queue.

```typescript
await closeQueue();
```

#### `clearQueue()`
**WARNING:** Removes all jobs from the queue.

```typescript
await clearQueue();
```

## Environment Configuration

### Required Environment Variables

```env
# Redis Connection
REDIS_URL=redis://localhost:6379

# Optional: Custom credentials
REDIS_URL=redis://user:password@redis-host:6379/db
```

### Queue Configuration

Modify `QUEUE_CONFIG` in `src/config/queue.ts` to adjust:

- `CONCURRENCY`: Number of parallel workers (default: 5)
- `MAX_ATTEMPTS`: Retry attempts (default: 3)
- `BACKOFF_INITIAL_DELAY`: Initial retry delay in ms (default: 1000)
- `JOB_TIMEOUT`: Job timeout in ms (default: 60000)

## Monitoring and Debugging

### Queue Statistics Endpoint

A health check endpoint is available at `/health` for monitoring:

```bash
curl http://localhost:3000/health
```

### Accessing Failed Jobs

Failed jobs are persisted in Redis for debugging. Use Bull's UI or APIs:

```typescript
const failedJobs = await queue.getFailed();
failedJobs.forEach(job => {
  console.log(`Failed job ${job.id}: ${job.failedReason}`);
});
```

### Logging

Queue events are logged via Winston logger with levels:

- `info`: Queue initialized, jobs completed
- `warn`: Queue issues, stalled jobs
- `error`: Connection failures, job failures
- `debug`: Job processing details

View logs in `logs/` directory.

## Best Practices

### 1. Error Recovery

- Failed jobs are automatically retried with exponential backoff
- Keep failed jobs for debugging purposes (`removeOnFail: false`)
- Monitor failed job counts via `/health` endpoint

### 2. Performance

- Adjust `CONCURRENCY` based on database and API limits
- Monitor queue depth to prevent buildup
- Use queue statistics for capacity planning

### 3. Deployment

- Redis should be deployed separately and highly available
- Use connection pooling for production
- Implement Redis backup and recovery procedures

### 4. Scaling

For high-volume message processing:

```typescript
// Multiple queue workers in separate processes
// Process 1 (Main API)
await initializeQueue();

// Process 2 (Dedicated Worker)
const queue = getMessageQueue();
queue.process(10, processMessageJob);
```

## Troubleshooting

### Issue: Queue connection errors

**Symptoms:**
```
Error: Queue error: Error: connect ECONNREFUSED
```

**Solution:**
- Verify Redis is running: `redis-cli ping`
- Check `REDIS_URL` environment variable
- Verify network connectivity to Redis server

### Issue: Jobs not being processed

**Symptoms:**
- Jobs stuck in "waiting" status
- High queue depth

**Solution:**
- Check if queue worker is running
- Verify concurrency settings not bottlenecking
- Check logs for processing errors
- Restart queue worker process

### Issue: Failed job queue growing

**Symptoms:**
- Increasing failed job count
- Application logs show errors

**Solution:**
- Check application logs for root cause
- Verify external API credentials (Claude, WhatsApp)
- Check database connectivity
- Review job implementation for bugs

## Testing

Run queue tests:

```bash
npm test -- src/config/queue.test.ts
```

Tests validate:
- Queue initialization
- Message queuing
- Retry configuration
- Concurrency limits
- Error handling
- Health checks

## Production Deployment

### Pre-deployment Checklist

- [ ] Redis instance running and tested
- [ ] `REDIS_URL` environment variable set
- [ ] Queue configuration tuned for expected load
- [ ] Monitoring and alerting configured
- [ ] Backup and recovery procedures documented
- [ ] Queue tests passing

### Production Settings

```env
# Production Redis (typically managed service)
REDIS_URL=redis://user:pass@redis-prod.example.com:6379/1

# Monitor queue health
NODE_ENV=production
LOG_LEVEL=info
```

### High Availability Setup

For production, implement:

1. **Redis Cluster/Sentinel** for fault tolerance
2. **Multiple Queue Workers** across servers
3. **Health checks** with automated restarts
4. **Monitoring** with Prometheus/CloudWatch
5. **Alerts** for queue depth and failures

## References

- [Bull Documentation](https://github.com/OptimalBits/bull)
- [Redis Documentation](https://redis.io/docs/)
- [BotBazaar Design Document](./design.md)
- [BotBazaar Implementation Plan](./tasks.md)
