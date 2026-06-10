# BotBazaar - WhatsApp Bot Builder SaaS Platform

A comprehensive Software-as-a-Service platform for creating, configuring, and managing AI-powered WhatsApp bots without coding.

## Project Setup

### Phase 1: Core Infrastructure & Authentication

This phase includes the foundational setup for the BotBazaar platform:

#### Task 1.1: Node.js Project with TypeScript Configuration ✅
- **Status**: Completed
- **Components**:
  - Express.js server with TypeScript support
  - Strict TypeScript configuration (tsconfig.json)
  - Environment variable management with dotenv
  - Project directory structure:
    - `src/routes/` - API route handlers
    - `src/services/` - Business logic services
    - `src/middleware/` - Express middleware
    - `src/models/` - Data models and types
    - `src/utils/` - Utility functions
    - `src/config/` - Configuration files
  - Build and dev scripts configured in package.json
  - Logging infrastructure with Winston

**Key Files**:
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration with strict mode
- `.env.example` - Environment variables template
- `src/index.ts` - Express server entry point
- `src/config/environment.ts` - Environment configuration
- `src/config/logger.ts` - Winston logger setup

#### Task 1.2: PostgreSQL Database & Prisma ORM ✅
- **Status**: Completed
- **Components**:
  - Prisma ORM configuration
  - Complete database schema with 8 core tables:
    - `users` - User accounts and subscription info
    - `bots` - WhatsApp bot configurations
    - `conversations` - User conversations with bots
    - `messages` - Message history and metadata
    - `bot_templates` - Pre-configured bot templates
    - `subscriptions` - Subscription management
    - `payments` - Payment transaction records
    - `api_keys` - API key management
    - `audit_logs` - Audit trail for compliance
  - Relationships and foreign keys configured
  - Performance indexes on frequently queried columns
  - UUID primary keys for all tables
  - Soft delete support (deleted_at field)
  - Timestamps (createdAt, updatedAt) on all tables

**Key Files**:
- `prisma/schema.prisma` - Complete database schema

**Next Steps**:
1. Create `.env` file with DATABASE_URL pointing to PostgreSQL
2. Run `npx prisma migrate dev --name init` to create initial migration
3. Run `npx prisma generate` to generate Prisma client

#### Task 1.3: Redis Cache Layer ✅
- **Status**: Completed
- **Components**:
  - Redis client with connection pooling
  - Automatic reconnection with exponential backoff
  - Error handling and logging
  - Cache key naming conventions for organized cache structure
  - TTL management for different cache types:
    - SHORT: 5 minutes (300s)
    - MEDIUM: 1 hour (3600s)
    - LONG: 24 hours (86400s)
    - SESSION: 30 days (2592000s)
    - RATE_LIMIT: 1 minute (60s)
    - QUOTA: 1 month (2592000s)
  - Utility functions for cache operations:
    - `cacheGet()` - Retrieve cached values
    - `cacheSet()` - Store values with TTL
    - `cacheDelete()` - Remove single key
    - `cacheDeleteMultiple()` - Remove multiple keys
    - `cacheExpire()` - Set expiration time
    - `cacheExists()` - Check key existence
    - `cacheIncrement()` - Increment counters
    - `cacheGetCounter()` - Get counter values
    - `cacheClearAll()` - Clear entire cache

**Key Files**:
- `src/config/redis.ts` - Redis client initialization and management
- `src/utils/cache.ts` - Cache utility functions and key conventions

**Cache Key Structure**:
```
user:{userId}
user:{userId}:subscription
user:{userId}:bots
bot:{botId}
bot:{botId}:config
bot:{botId}:conversations
conversation:{conversationId}
conversation:{conversationId}:messages
message:{messageId}
ratelimit:{userId}:{endpoint}
quota:{userId}:messages
session:{sessionId}
refresh_token:{userId}
template:{templateId}
templates:all
```

## Technology Stack

### Backend
- **Runtime**: Node.js 18+ (LTS)
- **Framework**: Express.js 4.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7.x
- **ORM**: Prisma 5.x
- **API Client**: Axios 1.x

### Security & Middleware
- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **bcrypt**: Password hashing (12 salt rounds)
- **JWT**: Token-based authentication
- **Winston**: Structured logging

## Installation & Setup

### Prerequisites
- Node.js 18+ installed
- PostgreSQL 15+ running
- Redis 7+ running

### Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Initialize database**:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Build for production**:
   ```bash
   npm run build
   npm start
   ```

## Project Structure

```
botbazaar/
├── src/
│   ├── config/
│   │   ├── environment.ts      # Environment configuration
│   │   ├── logger.ts           # Winston logger setup
│   │   └── redis.ts            # Redis client initialization
│   ├── middleware/             # Express middleware
│   ├── models/                 # Data models and types
│   ├── routes/                 # API route handlers
│   ├── services/               # Business logic services
│   ├── utils/
│   │   └── cache.ts            # Cache utility functions
│   └── index.ts                # Express server entry point
├── prisma/
│   └── schema.prisma           # Database schema
├── logs/                       # Application logs
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── .env.example                # Environment variables template
└── README.md                   # This file
```

## Environment Variables

See `.env.example` for all required environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection URL
- `JWT_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - Refresh token signing secret
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `ALLOWED_ORIGINS` - CORS allowed origins
- `WHATSAPP_WEBHOOK_SECRET` - WhatsApp webhook verification secret
- `CLAUDE_API_KEY` - Claude API key for AI responses
- `RAZORPAY_KEY_ID` - Razorpay API key
- `RAZORPAY_KEY_SECRET` - Razorpay API secret
- `SENDGRID_API_KEY` - SendGrid API key for emails

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Authentication (Phase 1.4-1.6)
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - User logout

### Bot Management (Phase 2)
- `POST /api/bots` - Create bot
- `GET /api/bots` - List bots
- `GET /api/bots/:botId` - Get bot details
- `PUT /api/bots/:botId` - Update bot
- `DELETE /api/bots/:botId` - Delete bot
- `POST /api/bots/:botId/test` - Test bot

### Conversations & Messages (Phase 3)
- `GET /api/bots/:botId/conversations` - List conversations
- `GET /api/bots/:botId/conversations/:conversationId/messages` - Get messages

### Subscriptions & Billing (Phase 4)
- `GET /api/subscriptions/plans` - Get subscription plans
- `POST /api/subscriptions/upgrade` - Upgrade subscription
- `GET /api/payments/history` - Get payment history

### Webhooks
- `POST /api/webhooks/whatsapp/:botId` - WhatsApp message webhook

## Next Steps

The following phases are planned:

- **Phase 2**: Bot Management & Configuration (CRUD operations)
- **Phase 3**: Message Processing Pipeline (Webhooks, Queue, AI integration)
- **Phase 4**: Payments & Subscriptions (Razorpay integration)
- **Phase 5**: Frontend Dashboard (Next.js, React)
- **Phase 6**: Testing & Optimization (Jest, k6 load testing)
- **Phase 7**: Deployment & Monitoring (Docker, Railway, CI/CD)

## Development

### Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run type-check` - Check TypeScript types

### Database Migrations
```bash
# Create a new migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Prisma Studio
```bash
# Open Prisma Studio to view/edit database
npx prisma studio
```

## Security Considerations

- All passwords are hashed with bcrypt (12 salt rounds)
- JWT tokens expire in 1 hour (access) and 30 days (refresh)
- CORS is configured with allowed origins from environment
- Security headers are set via Helmet middleware
- Rate limiting will be implemented in Phase 1.8
- All API keys are stored as SHA-256 hashes

## Logging

Winston logger is configured with:
- Console output with colors
- Error log file (`logs/error.log`)
- Combined log file (`logs/all.log`)
- Structured logging with timestamps
- Configurable log levels via `LOG_LEVEL` environment variable

## License

MIT

## Support

For issues or questions, please refer to the technical design document or contact the development team.
