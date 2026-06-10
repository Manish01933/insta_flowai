# BotBazaar Infrastructure Setup Guide

## Phase 1: Core Infrastructure & Authentication - Setup Complete ✅

This document provides detailed setup instructions for the three parallel infrastructure tasks completed in Phase 1.

---

## Task 1.1: Node.js Project with TypeScript Configuration ✅

### What Was Created

#### 1. **package.json** - Project Dependencies & Scripts
- Express.js 4.18.2 - Web framework
- TypeScript 5.3.3 - Type-safe JavaScript
- Prisma 5.7.1 - ORM for database
- Redis 4.6.12 - Caching layer
- bcrypt 5.1.1 - Password hashing
- jsonwebtoken 9.1.2 - JWT authentication
- Winston 3.11.0 - Structured logging
- Helmet 7.1.0 - Security headers
- CORS 2.8.5 - Cross-origin support
- Dotenv 16.3.1 - Environment variables

**Available Scripts**:
```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript to JavaScript
npm start            # Run production server
npm run lint         # Check code quality
npm run format       # Format code with Prettier
npm run type-check   # Verify TypeScript types
```

#### 2. **tsconfig.json** - TypeScript Configuration
- **Target**: ES2020 (modern JavaScript)
- **Module**: CommonJS (Node.js compatible)
- **Strict Mode**: Enabled for type safety
  - `noImplicitAny` - Require explicit types
  - `strictNullChecks` - Strict null/undefined handling
  - `strictFunctionTypes` - Strict function type checking
  - `noUnusedLocals` - Error on unused variables
  - `noUnusedParameters` - Error on unused parameters
  - `noImplicitReturns` - Require explicit returns
- **Source Maps**: Enabled for debugging
- **Declaration Files**: Generated for type definitions

#### 3. **Project Directory Structure**
```
src/
├── config/              # Configuration files
│   ├── environment.ts   # Environment variables
│   ├── logger.ts        # Winston logger setup
│   └── redis.ts         # Redis client
├── middleware/          # Express middleware
├── models/              # Data models & types
├── routes/              # API route handlers
├── services/            # Business logic
├── utils/               # Utility functions
│   └── cache.ts         # Cache utilities
└── index.ts             # Express server entry point
```

#### 4. **Environment Configuration** (src/config/environment.ts)
Centralized configuration management with environment variables:
- Server settings (port, environment)
- Database connection
- Redis connection
- JWT secrets and expiry times
- CORS allowed origins
- WhatsApp integration settings
- Claude API key
- Razorpay credentials
- SendGrid API key
- Logging level

#### 5. **Logging Infrastructure** (src/config/logger.ts)
Winston logger with:
- Console output with color coding
- Error log file (`logs/error.log`)
- Combined log file (`logs/all.log`)
- Structured logging with timestamps
- Configurable log levels

#### 6. **Express Server** (src/index.ts)
Basic Express server with:
- Helmet security headers
- CORS middleware
- JSON body parsing
- Request logging
- Health check endpoint (`GET /health`)
- 404 handler
- Global error handler

### Setup Instructions

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create .env file**:
   ```bash
   cp .env.example .env
   ```

3. **Edit .env with your settings**:
   ```
   PORT=3000
   NODE_ENV=development
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
   LOG_LEVEL=info
   ```

4. **Verify TypeScript compilation**:
   ```bash
   npm run type-check
   ```

---

## Task 1.2: PostgreSQL Database & Prisma ORM ✅

### What Was Created

#### 1. **Prisma Schema** (prisma/schema.prisma)
Complete database schema with 8 core tables:

##### **users** Table
- User accounts and authentication
- Subscription tier and status tracking
- Razorpay customer and subscription IDs
- Message counters
- Soft delete support (deleted_at)

```sql
Columns: id, email, passwordHash, firstName, lastName, phone, avatarUrl,
subscriptionTier, subscriptionStatus, subscriptionStartDate, subscriptionEndDate,
razorpayCustomerId, razorpaySubscriptionId, totalMessagesSent, totalMessagesReceived,
createdAt, updatedAt, deletedAt, isActive
```

##### **bots** Table
- WhatsApp bot configurations
- System prompt and AI parameters
- Webhook URL and verification token
- Ownership tracking (user_id)

```sql
Columns: id, userId, name, description, whatsappPhoneNumberId,
whatsappBusinessAccountId, accessToken, webhookUrl, webhookVerifyToken,
systemPrompt, temperature, maxTokens, isActive, createdAt, updatedAt, deletedAt
```

##### **conversations** Table
- User conversations with bots
- Message count and status
- Last message timestamp

```sql
Columns: id, botId, userPhoneNumber, userName, userAvatarUrl,
lastMessageAt, messageCount, status, createdAt, updatedAt
```

##### **messages** Table
- Message history and metadata
- Sender information (user or bot)
- Processing metrics (time, tokens used)
- WhatsApp message ID tracking

```sql
Columns: id, conversationId, botId, senderType, senderPhoneNumber,
senderName, messageText, messageType, mediaUrl, mediaType,
whatsappMessageId, status, errorMessage, processingTimeMs,
tokensUsed, createdAt, updatedAt
```

##### **bot_templates** Table
- Pre-configured bot templates
- Template categories and visibility
- System prompt templates

```sql
Columns: id, name, description, category, systemPrompt,
temperature, maxTokens, isPublic, createdById, createdAt, updatedAt
```

##### **subscriptions** Table
- Subscription management
- Razorpay subscription tracking
- Billing cycle information

```sql
Columns: id, userId, planId, planName, price, currency,
billingCycle, razorpaySubscriptionId, razorpayPlanId,
status, startedAt, endedAt, nextBillingDate, createdAt, updatedAt
```

##### **payments** Table
- Payment transaction records
- Razorpay payment tracking
- Payment status and method

```sql
Columns: id, userId, subscriptionId, razorpayPaymentId,
razorpayOrderId, amount, currency, status, paymentMethod,
errorMessage, createdAt, updatedAt
```

##### **api_keys** Table
- API key management
- Key expiration and usage tracking

```sql
Columns: id, userId, keyHash, name, lastUsedAt,
expiresAt, isActive, createdAt
```

##### **audit_logs** Table
- Audit trail for compliance
- Action tracking and change history

```sql
Columns: id, userId, action, resourceType, resourceId,
changes (JSON), ipAddress, userAgent, createdAt
```

#### 2. **Database Indexes**
Performance indexes on frequently queried columns:
- `users(email)` - User lookup by email
- `users(subscriptionStatus)` - Subscription filtering
- `bots(userId)` - User's bots
- `bots(whatsappPhoneNumberId)` - Bot lookup by phone
- `conversations(botId)` - Bot's conversations
- `conversations(userPhoneNumber)` - Conversation lookup
- `messages(conversationId)` - Conversation messages
- `messages(botId)` - Bot messages
- `messages(createdAt)` - Time-based queries
- `messages(whatsappMessageId)` - WhatsApp tracking
- `subscriptions(userId)` - User subscriptions
- `subscriptions(status)` - Subscription filtering
- `payments(userId)` - User payments
- `payments(status)` - Payment filtering
- `api_keys(userId)` - User API keys
- `audit_logs(userId)` - User audit logs
- `audit_logs(createdAt)` - Time-based audit queries

#### 3. **Relationships**
- Users → Bots (one-to-many, cascade delete)
- Users → Conversations (through Bots)
- Users → Messages (through Bots)
- Users → Subscriptions (one-to-many, cascade delete)
- Users → Payments (one-to-many, cascade delete)
- Users → API Keys (one-to-many, cascade delete)
- Bots → Conversations (one-to-many, cascade delete)
- Bots → Messages (one-to-many, cascade delete)
- Conversations → Messages (one-to-many, cascade delete)

### Setup Instructions

1. **Create PostgreSQL database**:
   ```bash
   createdb botbazaar
   ```

2. **Update .env with database URL**:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/botbazaar
   ```

3. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

4. **Create initial migration**:
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Verify schema**:
   ```bash
   npx prisma studio
   ```

### Database Connection Pooling

For production, configure PgBouncer:

```ini
[databases]
botbazaar = host=localhost port=5432 dbname=botbazaar user=postgres password=password

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
min_pool_size = 10
reserve_pool_size = 5
reserve_pool_timeout = 3
```

Update DATABASE_URL to use PgBouncer:
```
DATABASE_URL=postgresql://username:password@localhost:6432/botbazaar
```

---

## Task 1.3: Redis Cache Layer ✅

### What Was Created

#### 1. **Redis Client Configuration** (src/config/redis.ts)
- Connection pooling with automatic reconnection
- Exponential backoff retry strategy (max 10 retries)
- Connection timeout: 10 seconds
- Keep-alive: 30 seconds
- Error handling and logging
- Event listeners for connection state

**Connection Events**:
- `connect` - Connection established
- `ready` - Client ready for commands
- `error` - Connection error
- `reconnecting` - Attempting to reconnect

#### 2. **Cache Utility Functions** (src/utils/cache.ts)

##### **Cache Key Naming Conventions**
Organized cache structure for easy management:

```typescript
// User cache
user:{userId}
user:{userId}:subscription
user:{userId}:bots

// Bot cache
bot:{botId}
bot:{botId}:config
bot:{botId}:conversations

// Conversation cache
conversation:{conversationId}
conversation:{conversationId}:messages

// Message cache
message:{messageId}

// Rate limiting
ratelimit:{userId}:{endpoint}
quota:{userId}:messages

// Session cache
session:{sessionId}
refresh_token:{userId}

// Template cache
template:{templateId}
templates:all
```

##### **TTL (Time To Live) Configurations**
```typescript
CACHE_TTL = {
  SHORT: 300,           // 5 minutes
  MEDIUM: 3600,         // 1 hour
  LONG: 86400,          // 24 hours
  SESSION: 2592000,     // 30 days
  RATE_LIMIT: 60,       // 1 minute
  QUOTA: 2592000,       // 1 month
}
```

##### **Available Cache Operations**

1. **cacheGet<T>(key: string): Promise<T | null>**
   - Retrieve cached value
   - Returns null if not found
   - Automatic JSON parsing

2. **cacheSet<T>(key: string, value: T, ttl?: number): Promise<boolean>**
   - Store value with TTL
   - Default TTL: MEDIUM (1 hour)
   - Automatic JSON serialization

3. **cacheDelete(key: string): Promise<boolean>**
   - Remove single key from cache
   - Returns true if deleted

4. **cacheDeleteMultiple(keys: string[]): Promise<boolean>**
   - Remove multiple keys efficiently
   - Batch operation

5. **cacheExpire(key: string, ttl: number): Promise<boolean>**
   - Update expiration time for existing key
   - Useful for extending cache lifetime

6. **cacheExists(key: string): Promise<boolean>**
   - Check if key exists in cache
   - Returns true/false

7. **cacheIncrement(key: string, increment?: number): Promise<number>**
   - Increment counter value
   - Default increment: 1
   - Returns new value

8. **cacheGetCounter(key: string): Promise<number>**
   - Get counter value
   - Returns 0 if not found

9. **cacheClearAll(): Promise<boolean>**
   - Clear entire cache database
   - Use with caution!

#### 3. **Error Handling**
All cache operations include:
- Try-catch error handling
- Logging of errors
- Graceful fallback (returns null/false)
- No exception throwing (prevents cascade failures)

### Setup Instructions

1. **Install Redis** (if not already installed):
   ```bash
   # macOS
   brew install redis
   
   # Ubuntu/Debian
   sudo apt-get install redis-server
   
   # Windows (using WSL or Docker)
   docker run -d -p 6379:6379 redis:7
   ```

2. **Start Redis server**:
   ```bash
   redis-server
   ```

3. **Update .env with Redis URL**:
   ```
   REDIS_URL=redis://localhost:6379
   ```

4. **Initialize Redis in application**:
   ```typescript
   import { initializeRedis } from './config/redis';
   
   // In your main application startup
   await initializeRedis();
   ```

5. **Use cache in your code**:
   ```typescript
   import { cacheGet, cacheSet, CACHE_KEYS, CACHE_TTL } from './utils/cache';
   
   // Store user data
   await cacheSet(
     CACHE_KEYS.USER(userId),
     userData,
     CACHE_TTL.LONG
   );
   
   // Retrieve user data
   const user = await cacheGet(CACHE_KEYS.USER(userId));
   ```

### Redis Configuration for Production

For production deployments, configure Redis with:

```conf
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000
```

---

## Integration Summary

### How the Three Tasks Work Together

```
┌─────────────────────────────────────────────────────────────┐
│  Task 1.1: Node.js + TypeScript                             │
│  - Express server with middleware                           │
│  - Environment configuration                               │
│  - Logging infrastructure                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
┌───────────────────────────────┐  ┌────────────────────────────┐
│ Task 1.2: PostgreSQL + Prisma │  │ Task 1.3: Redis Cache      │
│ - Database schema             │  │ - Cache layer              │
│ - 8 core tables               │  │ - Connection pooling       │
│ - Relationships & indexes     │  │ - Cache utilities          │
│ - ORM for data access         │  │ - TTL management           │
└───────────────────────────────┘  └────────────────────────────┘
                │                           │
                └─────────────┬─────────────┘
                              │
                ┌─────────────────────────────┐
                │  Ready for Phase 1.4-1.8    │
                │  Authentication System      │
                └─────────────────────────────┘
```

### Data Flow Example

```
1. User registers (Phase 1.5)
   ↓
2. Password hashed with bcrypt
   ↓
3. User stored in PostgreSQL (Task 1.2)
   ↓
4. JWT token generated
   ↓
5. User data cached in Redis (Task 1.3)
   ↓
6. Response sent via Express (Task 1.1)
```

---

## Verification Checklist

- [x] Node.js project initialized with TypeScript
- [x] Express server configured with middleware
- [x] Environment configuration system set up
- [x] Winston logger configured
- [x] PostgreSQL schema defined with Prisma
- [x] All 8 core tables created
- [x] Database indexes configured
- [x] Redis client initialized
- [x] Cache utility functions implemented
- [x] TTL management configured
- [x] Error handling implemented
- [x] Project directory structure created
- [x] Documentation completed

## Next Steps

1. **Install dependencies**: `npm install`
2. **Set up PostgreSQL**: Create database and configure connection
3. **Set up Redis**: Start Redis server and configure connection
4. **Create .env file**: Copy from .env.example and fill in values
5. **Run migrations**: `npx prisma migrate dev --name init`
6. **Start development server**: `npm run dev`
7. **Proceed to Phase 1.4**: Implement authentication middleware

## Troubleshooting

### PostgreSQL Connection Issues
```bash
# Test connection
psql -U username -d botbazaar -h localhost

# Check DATABASE_URL format
postgresql://username:password@localhost:5432/botbazaar
```

### Redis Connection Issues
```bash
# Test Redis connection
redis-cli ping
# Should return: PONG

# Check Redis URL format
redis://localhost:6379
```

### TypeScript Compilation Issues
```bash
# Clear cache and rebuild
rm -rf dist/
npm run build
```

### Prisma Issues
```bash
# Regenerate Prisma client
npx prisma generate

# Reset database (development only)
npx prisma migrate reset
```

---

## Support & Documentation

- **Prisma Docs**: https://www.prisma.io/docs/
- **Express Docs**: https://expressjs.com/
- **Redis Docs**: https://redis.io/documentation
- **TypeScript Docs**: https://www.typescriptlang.org/docs/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/

---

**Setup Completed**: Phase 1 Infrastructure Tasks 1.1, 1.2, 1.3 ✅
**Next Phase**: Phase 1 Authentication Tasks 1.4-1.8
