# BotBazaar WhatsApp Bot Builder SaaS - Technical Design

## Overview

BotBazaar is a Software-as-a-Service platform that enables users to create, configure, and manage AI-powered WhatsApp bots without coding. The system integrates with WhatsApp Cloud API for messaging, Claude AI for intelligent responses, and Razorpay for payment processing.

### Key Features
- No-code bot builder interface
- AI-powered message responses using Claude
- WhatsApp Cloud API integration
- Subscription-based pricing with Razorpay
- Multi-tenant architecture
- Real-time message processing
- Analytics and conversation history

---

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Web Dashboard   │  │  Mobile App      │  │  Admin Panel │  │
│  │  (React/Next.js) │  │  (React Native)  │  │  (React)     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
┌───────────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Express.js / Node.js API Server                            │ │
│  │  - Authentication & Authorization                           │ │
│  │  - Rate Limiting & Throttling                               │ │
│  │  - Request Validation                                       │ │
│  │  - CORS & Security Headers                                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Bot Management   │ │  Message Handler │ │  User Management │
│  Service          │ │  Service         │ │  Service         │
│  - CRUD Bots      │ │  - Webhook       │ │  - Auth          │
│  - Config Store   │ │  - AI Processing │ │  - Subscriptions │
│  - Templates      │ │  - Response Send │ │  - Billing       │
└───────────────────┘ └──────────────────┘ └──────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
┌───────────────────────────────────────────────────────────────────┐
│                    Data Layer                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐│
│  │  PostgreSQL      │  │  Redis Cache     │  │  File Storage    ││
│  │  (Primary DB)    │  │  (Sessions/Cache)│  │  (S3/Cloudinary) ││
│  └──────────────────┘  └──────────────────┘  └──────────────────┘│
└───────────────────────────────────────────────────────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
┌───────────────────────────────────────────────────────────────────┐
│                  External Integrations                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐│
│  │  WhatsApp Cloud  │  │  Claude AI API   │  │  Razorpay        ││
│  │  API             │  │  (Anthropic)     │  │  Payment Gateway ││
│  └──────────────────┘  └──────────────────┘  └──────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend
- **Runtime**: Node.js 18+ (LTS)
- **Framework**: Express.js 4.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7.x
- **ORM**: Prisma 5.x
- **API Client**: Axios 1.x

### Frontend
- **Framework**: React 18.x / Next.js 14.x
- **State Management**: Redux Toolkit / Zustand
- **UI Library**: Tailwind CSS + shadcn/ui
- **Form Handling**: React Hook Form + Zod
- **HTTP Client**: TanStack Query (React Query)

### DevOps & Deployment
- **Container**: Docker
- **Orchestration**: Railway (PaaS)
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry + LogRocket
- **Analytics**: Mixpanel / Segment

### External Services
- **AI**: Claude API (Anthropic)
- **Messaging**: WhatsApp Cloud API (Meta)
- **Payments**: Razorpay
- **Email**: SendGrid / Resend
- **SMS**: Twilio (optional)

---

## Database Schema

### Core Tables

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  avatar_url TEXT,
  subscription_tier VARCHAR(50) DEFAULT 'free',
  subscription_status VARCHAR(50) DEFAULT 'active',
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  razorpay_customer_id VARCHAR(255),
  razorpay_subscription_id VARCHAR(255),
  total_messages_sent INT DEFAULT 0,
  total_messages_received INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);
```

#### bots
```sql
CREATE TABLE bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  whatsapp_phone_number_id VARCHAR(255) UNIQUE NOT NULL,
  whatsapp_business_account_id VARCHAR(255),
  access_token VARCHAR(500),
  webhook_url TEXT,
  webhook_verify_token VARCHAR(255),
  system_prompt TEXT,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INT DEFAULT 1024,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### conversations
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_phone_number VARCHAR(20) NOT NULL,
  user_name VARCHAR(255),
  user_avatar_url TEXT,
  last_message_at TIMESTAMP,
  message_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
```

#### messages
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  sender_type VARCHAR(50) NOT NULL,
  sender_phone_number VARCHAR(20),
  sender_name VARCHAR(255),
  message_text TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  media_url TEXT,
  media_type VARCHAR(50),
  whatsapp_message_id VARCHAR(255) UNIQUE,
  status VARCHAR(50) DEFAULT 'sent',
  error_message TEXT,
  processing_time_ms INT,
  tokens_used INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
```

#### bot_templates
```sql
CREATE TABLE bot_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  system_prompt TEXT NOT NULL,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INT DEFAULT 1024,
  is_public BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### subscriptions
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR(100) NOT NULL,
  plan_name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  billing_cycle VARCHAR(50),
  razorpay_subscription_id VARCHAR(255) UNIQUE,
  razorpay_plan_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  next_billing_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### payments
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  razorpay_payment_id VARCHAR(255) UNIQUE,
  razorpay_order_id VARCHAR(255),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(50) DEFAULT 'pending',
  payment_method VARCHAR(100),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### api_keys
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### audit_logs
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  changes JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes for Performance

```sql
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_subscription_status ON users(subscription_status);
CREATE INDEX idx_bots_user_id ON bots(user_id);
CREATE INDEX idx_bots_whatsapp_phone ON bots(whatsapp_phone_number_id);
CREATE INDEX idx_conversations_bot_id ON conversations(bot_id);
CREATE INDEX idx_conversations_user_phone ON conversations(user_phone_number);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_bot_id ON messages(bot_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_whatsapp_id ON messages(whatsapp_message_id);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```



---

## API Endpoint Specifications

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+91-9876543210"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "access_token": "jwt_token",
  "refresh_token": "refresh_jwt_token",
  "expires_in": 3600
}
```

#### POST /api/auth/login
Authenticate user and return JWT tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "access_token": "jwt_token",
  "refresh_token": "refresh_jwt_token",
  "expires_in": 3600,
  "subscription_tier": "pro"
}
```

#### POST /api/auth/refresh
Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "refresh_jwt_token"
}
```

**Response (200):**
```json
{
  "access_token": "new_jwt_token",
  "expires_in": 3600
}
```

#### POST /api/auth/logout
Invalidate refresh token and logout user.

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

### Bot Management Endpoints

#### POST /api/bots
Create a new WhatsApp bot.

**Request:**
```json
{
  "name": "Customer Support Bot",
  "description": "Handles customer inquiries",
  "whatsapp_phone_number_id": "1234567890",
  "system_prompt": "You are a helpful customer support assistant...",
  "temperature": 0.7,
  "max_tokens": 1024
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "Customer Support Bot",
  "whatsapp_phone_number_id": "1234567890",
  "webhook_url": "https://api.botbazaar.com/webhooks/whatsapp/uuid",
  "webhook_verify_token": "verify_token_xyz",
  "system_prompt": "You are a helpful customer support assistant...",
  "temperature": 0.7,
  "max_tokens": 1024,
  "is_active": true,
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### GET /api/bots
List all bots for authenticated user.

**Query Parameters:**
- `page`: integer (default: 1)
- `limit`: integer (default: 20)
- `status`: string (active|inactive)

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Customer Support Bot",
      "whatsapp_phone_number_id": "1234567890",
      "is_active": true,
      "message_count": 1250,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1
  }
}
```

#### GET /api/bots/:botId
Get bot details.

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Customer Support Bot",
  "description": "Handles customer inquiries",
  "whatsapp_phone_number_id": "1234567890",
  "system_prompt": "You are a helpful customer support assistant...",
  "temperature": 0.7,
  "max_tokens": 1024,
  "is_active": true,
  "webhook_url": "https://api.botbazaar.com/webhooks/whatsapp/uuid",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

#### PUT /api/bots/:botId
Update bot configuration.

**Request:**
```json
{
  "name": "Updated Bot Name",
  "system_prompt": "Updated system prompt...",
  "temperature": 0.8,
  "max_tokens": 2048
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Updated Bot Name",
  "system_prompt": "Updated system prompt...",
  "temperature": 0.8,
  "max_tokens": 2048,
  "updated_at": "2024-01-15T11:00:00Z"
}
```

#### DELETE /api/bots/:botId
Delete a bot.

**Response (204):** No content

#### POST /api/bots/:botId/test
Test bot with a sample message.

**Request:**
```json
{
  "message": "Hello, can you help me?"
}
```

**Response (200):**
```json
{
  "response": "Hello! I'm here to help. What can I assist you with?",
  "processing_time_ms": 1250,
  "tokens_used": 45
}
```

### Conversation & Message Endpoints

#### GET /api/bots/:botId/conversations
List conversations for a bot.

**Query Parameters:**
- `page`: integer (default: 1)
- `limit`: integer (default: 20)
- `status`: string (active|archived)

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "user_phone_number": "+91-9876543210",
      "user_name": "John Doe",
      "message_count": 15,
      "last_message_at": "2024-01-15T10:30:00Z",
      "status": "active"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

#### GET /api/bots/:botId/conversations/:conversationId/messages
Get messages in a conversation.

**Query Parameters:**
- `page`: integer (default: 1)
- `limit`: integer (default: 50)

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "sender_type": "user",
      "sender_phone_number": "+91-9876543210",
      "sender_name": "John Doe",
      "message_text": "Hello, can you help me?",
      "message_type": "text",
      "status": "delivered",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "uuid",
      "sender_type": "bot",
      "message_text": "Hello! I'm here to help. What can I assist you with?",
      "message_type": "text",
      "status": "sent",
      "processing_time_ms": 1250,
      "tokens_used": 45,
      "created_at": "2024-01-15T10:30:05Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 200,
    "pages": 4
  }
}
```

### Subscription & Billing Endpoints

#### GET /api/subscriptions/plans
Get available subscription plans.

**Response (200):**
```json
{
  "data": [
    {
      "id": "plan_free",
      "name": "Free",
      "price": 0,
      "currency": "INR",
      "billing_cycle": "monthly",
      "features": {
        "max_bots": 1,
        "messages_per_month": 1000,
        "ai_model": "claude-3-haiku",
        "support": "community"
      }
    },
    {
      "id": "plan_pro",
      "name": "Pro",
      "price": 999,
      "currency": "INR",
      "billing_cycle": "monthly",
      "razorpay_plan_id": "plan_xyz",
      "features": {
        "max_bots": 10,
        "messages_per_month": 100000,
        "ai_model": "claude-3-sonnet",
        "support": "email"
      }
    }
  ]
}
```

#### POST /api/subscriptions/upgrade
Upgrade subscription plan.

**Request:**
```json
{
  "plan_id": "plan_pro"
}
```

**Response (200):**
```json
{
  "subscription_id": "uuid",
  "plan_id": "plan_pro",
  "plan_name": "Pro",
  "price": 999,
  "razorpay_subscription_id": "sub_xyz",
  "status": "active",
  "started_at": "2024-01-15T10:30:00Z",
  "next_billing_date": "2024-02-15T10:30:00Z"
}
```

#### GET /api/payments/history
Get payment history.

**Query Parameters:**
- `page`: integer (default: 1)
- `limit`: integer (default: 20)

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "razorpay_payment_id": "pay_xyz",
      "amount": 999,
      "currency": "INR",
      "status": "captured",
      "payment_method": "card",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 12,
    "pages": 1
  }
}
```

### Webhook Endpoint

#### POST /api/webhooks/whatsapp/:botId
WhatsApp Cloud API webhook for incoming messages.

**Request (from WhatsApp):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "123456789",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "1234567890",
              "phone_number_id": "1234567890"
            },
            "messages": [
              {
                "from": "919876543210",
                "id": "wamid.xyz",
                "timestamp": "1671234567",
                "type": "text",
                "text": {
                  "body": "Hello, can you help me?"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

**Response (200):**
```json
{
  "status": "received"
}
```



---

## Authentication & Authorization

### JWT Token Structure

**Access Token (expires in 1 hour):**
```json
{
  "sub": "user_uuid",
  "email": "user@example.com",
  "subscription_tier": "pro",
  "iat": 1705315800,
  "exp": 1705319400,
  "iss": "botbazaar"
}
```

**Refresh Token (expires in 30 days):**
```json
{
  "sub": "user_uuid",
  "type": "refresh",
  "iat": 1705315800,
  "exp": 1708094200,
  "iss": "botbazaar"
}
```

### Authorization Levels

1. **Public**: No authentication required
   - GET /api/subscriptions/plans
   - POST /api/auth/register
   - POST /api/auth/login

2. **Authenticated**: Valid JWT token required
   - All /api/bots/* endpoints
   - All /api/subscriptions/* endpoints
   - All /api/payments/* endpoints

3. **Bot Owner**: Must own the bot resource
   - PUT /api/bots/:botId
   - DELETE /api/bots/:botId
   - GET /api/bots/:botId/conversations

4. **Admin**: Special admin privileges
   - GET /api/admin/users
   - GET /api/admin/analytics
   - POST /api/admin/templates

### Security Implementation

**Password Hashing:**
- Algorithm: bcrypt with salt rounds = 12
- Minimum requirements: 8 characters, 1 uppercase, 1 number, 1 special character

**API Key Authentication (for third-party integrations):**
- Format: `Authorization: Bearer api_key_xyz`
- Keys stored as SHA-256 hash in database
- Rate limited to 1000 requests/hour per key

**CORS Configuration:**
```javascript
{
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}
```

**Security Headers:**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
```

---

## Message Processing Pipeline

### Webhook Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  1. WhatsApp Cloud API sends webhook to /api/webhooks/whatsapp  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Webhook Handler                                             │
│     - Verify webhook signature                                  │
│     - Extract message data                                      │
│     - Validate bot exists                                       │
│     - Return 200 OK immediately                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Queue Message to Redis                                      │
│     - Store message in Redis queue                              │
│     - Set TTL: 24 hours                                         │
│     - Priority: normal                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Message Processing Worker                                   │
│     - Dequeue from Redis                                        │
│     - Save to PostgreSQL (messages table)                       │
│     - Update conversation metadata                              │
│     - Check rate limits                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. AI Processing                                               │
│     - Build conversation context (last 10 messages)             │
│     - Call Claude API with system prompt                        │
│     - Handle streaming responses                                │
│     - Track token usage                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Response Formatting                                         │
│     - Split long responses (max 4096 chars per message)         │
│     - Format with markdown support                              │
│     - Add quick reply buttons if configured                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Send via WhatsApp API                                       │
│     - Call WhatsApp Cloud API                                   │
│     - Handle rate limiting (80 requests/second)                 │
│     - Retry with exponential backoff                            │
│     - Store message ID for tracking                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. Update Message Status                                       │
│     - Mark as sent/delivered/read                               │
│     - Store processing metrics                                  │
│     - Update conversation last_message_at                       │
└─────────────────────────────────────────────────────────────────┘
```

### Message Processing Implementation

**Webhook Handler (Express middleware):**
```typescript
// Verify webhook signature
const verifyWebhookSignature = (req: Request): boolean => {
  const signature = req.headers['x-hub-signature-256'];
  const body = req.rawBody;
  const hash = crypto
    .createHmac('sha256', process.env.WHATSAPP_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return `sha256=${hash}` === signature;
};

// Process incoming message
const handleWebhook = async (req: Request, res: Response) => {
  // 1. Verify signature
  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Return 200 immediately
  res.status(200).json({ status: 'received' });

  // 3. Queue for async processing
  const messages = extractMessages(req.body);
  for (const msg of messages) {
    await messageQueue.add(msg, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });
  }
};
```

**Message Processing Worker:**
```typescript
messageQueue.process(async (job) => {
  const { botId, from, messageId, text, timestamp } = job.data;

  try {
    // 1. Get bot configuration
    const bot = await Bot.findById(botId);
    if (!bot) throw new Error('Bot not found');

    // 2. Get or create conversation
    let conversation = await Conversation.findOne({
      bot_id: botId,
      user_phone_number: from
    });
    if (!conversation) {
      conversation = await Conversation.create({
        bot_id: botId,
        user_phone_number: from,
        user_name: 'Unknown',
        status: 'active'
      });
    }

    // 3. Save incoming message
    const incomingMsg = await Message.create({
      conversation_id: conversation.id,
      bot_id: botId,
      sender_type: 'user',
      sender_phone_number: from,
      message_text: text,
      message_type: 'text',
      whatsapp_message_id: messageId,
      status: 'received'
    });

    // 4. Check rate limits
    const messageCount = await Message.count({
      bot_id: botId,
      created_at: { $gte: new Date(Date.now() - 3600000) }
    });
    if (messageCount > bot.user.subscription.message_limit) {
      throw new Error('Rate limit exceeded');
    }

    // 5. Get conversation history
    const history = await Message.find({
      conversation_id: conversation.id
    }).sort({ created_at: -1 }).limit(10);

    // 6. Call Claude API
    const startTime = Date.now();
    const response = await callClaudeAPI({
      system_prompt: bot.system_prompt,
      messages: formatConversationHistory(history),
      temperature: bot.temperature,
      max_tokens: bot.max_tokens
    });
    const processingTime = Date.now() - startTime;

    // 7. Save bot response
    const botMsg = await Message.create({
      conversation_id: conversation.id,
      bot_id: botId,
      sender_type: 'bot',
      message_text: response.text,
      message_type: 'text',
      status: 'pending',
      processing_time_ms: processingTime,
      tokens_used: response.usage.output_tokens
    });

    // 8. Send via WhatsApp API
    const whatsappResponse = await sendWhatsAppMessage({
      phone_number_id: bot.whatsapp_phone_number_id,
      to: from,
      text: response.text,
      access_token: bot.access_token
    });

    // 9. Update message status
    botMsg.whatsapp_message_id = whatsappResponse.messages[0].id;
    botMsg.status = 'sent';
    await botMsg.save();

    // 10. Update conversation
    conversation.last_message_at = new Date();
    conversation.message_count += 2;
    await conversation.save();

    return { success: true, messageId: botMsg.id };
  } catch (error) {
    console.error('Message processing error:', error);
    throw error; // Retry
  }
});
```

### Rate Limiting Strategy

**Per-User Limits:**
- Free tier: 1,000 messages/month
- Pro tier: 100,000 messages/month
- Enterprise: Unlimited

**Per-Bot Limits:**
- Max 80 messages/second (WhatsApp API limit)
- Max 1,000 concurrent conversations

**Per-API Limits:**
- 100 requests/minute for authenticated users
- 10 requests/minute for unauthenticated endpoints



---

## Integration Points

### WhatsApp Cloud API Integration

**Base URL:** `https://graph.instagram.com/v18.0`

**Authentication:**
- Bearer token in Authorization header
- Token obtained from Meta Business Platform

**Key Endpoints:**

1. **Send Message:**
```
POST /v18.0/{phone_number_id}/messages
Authorization: Bearer {access_token}

{
  "messaging_product": "whatsapp",
  "to": "919876543210",
  "type": "text",
  "text": {
    "body": "Hello! How can I help you?"
  }
}
```

2. **Mark as Read:**
```
POST /v18.0/{phone_number_id}/messages
Authorization: Bearer {access_token}

{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "wamid.xyz"
}
```

3. **Upload Media:**
```
POST /v18.0/{phone_number_id}/media
Authorization: Bearer {access_token}

{
  "messaging_product": "whatsapp",
  "file": <binary_file>,
  "type": "image"
}
```

**Error Handling:**
- 400: Invalid request parameters
- 401: Invalid access token
- 429: Rate limit exceeded (retry after 60 seconds)
- 500: Server error (retry with exponential backoff)

### Claude API Integration

**Base URL:** `https://api.anthropic.com/v1`

**Authentication:**
- API key in x-api-key header
- Key stored in environment variables

**Request Format:**
```
POST /v1/messages
x-api-key: {api_key}
anthropic-version: 2023-06-01

{
  "model": "claude-3-sonnet-20240229",
  "max_tokens": 1024,
  "system": "You are a helpful customer support assistant...",
  "messages": [
    {
      "role": "user",
      "content": "Hello, can you help me?"
    }
  ],
  "temperature": 0.7
}
```

**Response Format:**
```json
{
  "id": "msg_xyz",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! I'm here to help. What can I assist you with?"
    }
  ],
  "model": "claude-3-sonnet-20240229",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 45,
    "output_tokens": 32
  }
}
```

**Model Selection by Tier:**
- Free: claude-3-haiku-20240307 (fastest, cheapest)
- Pro: claude-3-sonnet-20240229 (balanced)
- Enterprise: claude-3-opus-20240229 (most capable)

**Pricing (as of 2024):**
- Haiku: $0.25/$0.75 per 1M input/output tokens
- Sonnet: $3/$15 per 1M input/output tokens
- Opus: $15/$75 per 1M input/output tokens

### Razorpay Integration

**Base URL:** `https://api.razorpay.com/v1`

**Authentication:**
- Basic auth with key_id and key_secret
- Credentials stored in environment variables

**Key Operations:**

1. **Create Subscription Plan:**
```
POST /v1/plans
Authorization: Basic {base64(key_id:key_secret)}

{
  "period": "monthly",
  "interval": 1,
  "period": "monthly",
  "item": {
    "active": true,
    "description": "Pro Plan",
    "amount": 99900,
    "currency": "INR"
  }
}
```

2. **Create Subscription:**
```
POST /v1/subscriptions
Authorization: Basic {base64(key_id:key_secret)}

{
  "plan_id": "plan_xyz",
  "customer_notify": 1,
  "quantity": 1,
  "total_count": 12,
  "addons": [],
  "notes": {
    "user_id": "uuid"
  }
}
```

3. **Webhook Verification:**
```typescript
const verifyRazorpaySignature = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  const message = `${orderId}|${paymentId}`;
  const hash = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(message)
    .digest('hex');
  return hash === signature;
};
```

**Webhook Events:**
- `payment.authorized`: Payment authorized
- `payment.failed`: Payment failed
- `subscription.activated`: Subscription activated
- `subscription.paused`: Subscription paused
- `subscription.cancelled`: Subscription cancelled
- `subscription.completed`: Subscription completed

### Email Service Integration (SendGrid)

**Base URL:** `https://api.sendgrid.com/v3`

**Key Endpoints:**

1. **Send Email:**
```
POST /v3/mail/send
Authorization: Bearer {api_key}

{
  "personalizations": [
    {
      "to": [{ "email": "user@example.com" }],
      "subject": "Welcome to BotBazaar"
    }
  ],
  "from": { "email": "noreply@botbazaar.com" },
  "content": [
    {
      "type": "text/html",
      "value": "<h1>Welcome!</h1>"
    }
  ]
}
```

**Email Templates:**
- Welcome email
- Subscription confirmation
- Payment receipt
- Bot creation notification
- Usage alerts
- Password reset

---

## Error Handling & Retry Strategies

### Error Classification

**Client Errors (4xx):**
- 400: Bad Request - Invalid input parameters
- 401: Unauthorized - Missing or invalid authentication
- 403: Forbidden - Insufficient permissions
- 404: Not Found - Resource doesn't exist
- 409: Conflict - Resource already exists
- 429: Too Many Requests - Rate limit exceeded

**Server Errors (5xx):**
- 500: Internal Server Error - Unexpected error
- 502: Bad Gateway - External service unavailable
- 503: Service Unavailable - Temporary outage

### Retry Strategy

**Exponential Backoff Configuration:**
```typescript
const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
};

const calculateDelay = (attempt: number): number => {
  const exponentialDelay = Math.min(
    retryConfig.initialDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt),
    retryConfig.maxDelayMs
  );
  const jitter = exponentialDelay * retryConfig.jitterFactor * Math.random();
  return exponentialDelay + jitter;
};
```

**Retryable Errors:**
- 429: Too Many Requests (retry after 60 seconds)
- 502: Bad Gateway (retry with exponential backoff)
- 503: Service Unavailable (retry with exponential backoff)
- Network timeouts (retry with exponential backoff)

**Non-Retryable Errors:**
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found

### Error Response Format

**Standard Error Response:**
```json
{
  "error": {
    "code": "INVALID_BOT_ID",
    "message": "The specified bot does not exist",
    "status": 404,
    "timestamp": "2024-01-15T10:30:00Z",
    "request_id": "req_xyz",
    "details": {
      "bot_id": "invalid_uuid"
    }
  }
}
```

### Logging & Monitoring

**Log Levels:**
- ERROR: Critical errors requiring immediate attention
- WARN: Warnings about potential issues
- INFO: General informational messages
- DEBUG: Detailed debugging information

**Structured Logging Format:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "ERROR",
  "service": "message-processor",
  "request_id": "req_xyz",
  "user_id": "user_uuid",
  "bot_id": "bot_uuid",
  "message": "Failed to process message",
  "error": {
    "name": "APIError",
    "message": "Claude API rate limit exceeded",
    "stack": "..."
  },
  "context": {
    "attempt": 2,
    "retry_after": 60
  }
}
```

**Monitoring Metrics:**
- Message processing latency (p50, p95, p99)
- API error rates by service
- Queue depth and processing time
- Token usage and costs
- Subscription churn rate
- Payment success rate

---

## Security Implementation

### Data Protection

**Encryption at Rest:**
- Database: PostgreSQL with pgcrypto extension
- Sensitive fields encrypted: passwords, API keys, access tokens
- Encryption algorithm: AES-256

**Encryption in Transit:**
- TLS 1.3 for all HTTPS connections
- Certificate pinning for external API calls
- Secure WebSocket (WSS) for real-time features

**Sensitive Data Handling:**
```typescript
// Encrypt sensitive fields before storage
const encryptField = (value: string, key: string): string => {
  const cipher = crypto.createCipher('aes-256-cbc', key);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

// Decrypt when needed
const decryptField = (encrypted: string, key: string): string => {
  const decipher = crypto.createDecipher('aes-256-cbc', key);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
```

### Input Validation & Sanitization

**Validation Rules:**
- Email: RFC 5322 compliant
- Phone numbers: E.164 format
- URLs: Valid HTTPS URLs only
- Text input: Max 4096 characters, no script tags
- JSON: Valid JSON schema validation

**Sanitization:**
```typescript
import DOMPurify from 'isomorphic-dompurify';

const sanitizeInput = (input: string): string => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  });
};
```

### SQL Injection Prevention

**Parameterized Queries (Prisma ORM):**
```typescript
// Safe - uses parameterized queries
const user = await prisma.user.findUnique({
  where: { email: userInput }
});

// Avoid - string concatenation
const query = `SELECT * FROM users WHERE email = '${userInput}'`; // UNSAFE
```

### CSRF Protection

**Token-Based CSRF Protection:**
```typescript
// Generate CSRF token
const csrfToken = crypto.randomBytes(32).toString('hex');
res.cookie('csrf-token', csrfToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
});

// Verify CSRF token
const verifyCsrfToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers['x-csrf-token'];
  const cookieToken = req.cookies['csrf-token'];
  if (token !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
};
```

### Rate Limiting

**Redis-Based Rate Limiting:**
```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rate-limit:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later'
});

app.use('/api/', limiter);
```

### API Key Security

**API Key Generation & Storage:**
```typescript
// Generate API key
const generateApiKey = (): string => {
  return `sk_${crypto.randomBytes(32).toString('hex')}`;
};

// Store hashed key
const hashApiKey = (key: string): string => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// Verify API key
const verifyApiKey = async (key: string): Promise<User | null> => {
  const hash = hashApiKey(key);
  return await prisma.apiKey.findUnique({
    where: { key_hash: hash },
    include: { user: true }
  });
};
```



---

## Deployment Architecture

### Railway Deployment Setup

**Project Structure:**
```
botbazaar/
├── apps/
│   ├── api/                    # Express.js backend
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── worker/                 # Message processing worker
│       ├── src/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── database/               # Prisma schema
│   ├── types/                  # Shared TypeScript types
│   └── utils/                  # Shared utilities
├── docker-compose.yml
├── railway.json
└── .github/workflows/          # CI/CD pipelines
```

### Docker Configuration

**API Service Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["npm", "start"]
```

**Worker Service Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["npm", "run", "worker"]
```

### Railway Configuration

**railway.json:**
```json
{
  "services": [
    {
      "name": "api",
      "dockerfile": "apps/api/Dockerfile",
      "port": 3000,
      "environment": {
        "NODE_ENV": "production",
        "DATABASE_URL": "${{ DATABASE_URL }}",
        "REDIS_URL": "${{ REDIS_URL }}",
        "JWT_SECRET": "${{ JWT_SECRET }}",
        "WHATSAPP_WEBHOOK_SECRET": "${{ WHATSAPP_WEBHOOK_SECRET }}",
        "CLAUDE_API_KEY": "${{ CLAUDE_API_KEY }}",
        "RAZORPAY_KEY_ID": "${{ RAZORPAY_KEY_ID }}",
        "RAZORPAY_KEY_SECRET": "${{ RAZORPAY_KEY_SECRET }}"
      },
      "healthCheck": {
        "path": "/health",
        "interval": 30,
        "timeout": 10
      }
    },
    {
      "name": "web",
      "dockerfile": "apps/web/Dockerfile",
      "port": 3001,
      "environment": {
        "NEXT_PUBLIC_API_URL": "https://api.botbazaar.com"
      }
    },
    {
      "name": "worker",
      "dockerfile": "apps/worker/Dockerfile",
      "environment": {
        "NODE_ENV": "production",
        "DATABASE_URL": "${{ DATABASE_URL }}",
        "REDIS_URL": "${{ REDIS_URL }}",
        "CLAUDE_API_KEY": "${{ CLAUDE_API_KEY }}"
      }
    }
  ],
  "databases": [
    {
      "name": "postgres",
      "engine": "postgresql",
      "version": "15"
    },
    {
      "name": "redis",
      "engine": "redis",
      "version": "7"
    }
  ]
}
```

### Environment Variables

**Production Environment (.env.production):**
```
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:password@host:5432/botbazaar
DATABASE_POOL_SIZE=20
DATABASE_TIMEOUT=30000

# Redis
REDIS_URL=redis://user:password@host:6379/0
REDIS_MAX_RETRIES=3

# Authentication
JWT_SECRET=<random_secret_key>
JWT_EXPIRY=3600
REFRESH_TOKEN_EXPIRY=2592000

# WhatsApp
WHATSAPP_WEBHOOK_SECRET=<webhook_secret>
WHATSAPP_API_VERSION=v18.0
WHATSAPP_RATE_LIMIT=80

# Claude API
CLAUDE_API_KEY=<api_key>
CLAUDE_MODEL_FREE=claude-3-haiku-20240307
CLAUDE_MODEL_PRO=claude-3-sonnet-20240229
CLAUDE_MODEL_ENTERPRISE=claude-3-opus-20240229

# Razorpay
RAZORPAY_KEY_ID=<key_id>
RAZORPAY_KEY_SECRET=<key_secret>
RAZORPAY_WEBHOOK_SECRET=<webhook_secret>

# SendGrid
SENDGRID_API_KEY=<api_key>
SENDGRID_FROM_EMAIL=noreply@botbazaar.com

# External URLs
FRONTEND_URL=https://botbazaar.com
API_URL=https://api.botbazaar.com
WEBHOOK_URL=https://api.botbazaar.com/webhooks

# Monitoring
SENTRY_DSN=<sentry_dsn>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_BETA_FEATURES=false
```

### CI/CD Pipeline

**GitHub Actions Workflow (.github/workflows/deploy.yml):**
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379/0
      
      - name: Build
        run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'

    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Railway
        uses: railway-app/deploy-action@v1
        with:
          token: ${{ secrets.RAILWAY_TOKEN }}
          service: api
          environment: production
```

### Database Migrations

**Prisma Migration Strategy:**
```bash
# Generate migration
npx prisma migrate dev --name add_new_table

# Apply migration to production
npx prisma migrate deploy

# Rollback (if needed)
npx prisma migrate resolve --rolled-back migration_name
```

### Scaling Strategy

**Horizontal Scaling:**
- API service: Auto-scale 2-10 instances based on CPU/memory
- Worker service: Auto-scale 1-5 instances based on queue depth
- Database: Read replicas for analytics queries

**Vertical Scaling:**
- API: 512MB-2GB RAM per instance
- Worker: 256MB-1GB RAM per instance
- Database: 2GB-16GB RAM based on data size

**Load Balancing:**
- Railway's built-in load balancer distributes traffic
- Sticky sessions for WebSocket connections
- Health checks every 30 seconds

---

## Technology Stack Decisions & Rationale

### Backend Framework: Express.js

**Why Express.js?**
- Lightweight and flexible
- Large ecosystem of middleware
- Easy to integrate with external APIs
- Good performance for I/O-heavy operations
- Strong TypeScript support

**Alternatives Considered:**
- Fastify: Faster but smaller ecosystem
- NestJS: More opinionated, steeper learning curve
- Django: Different language, not ideal for real-time

### Database: PostgreSQL

**Why PostgreSQL?**
- ACID compliance for financial transactions
- JSON support for flexible data structures
- Full-text search capabilities
- Excellent performance at scale
- Strong open-source community

**Alternatives Considered:**
- MongoDB: Less suitable for relational data
- MySQL: Less advanced features
- DynamoDB: Expensive for this use case

### Cache: Redis

**Why Redis?**
- Fast in-memory data structure store
- Perfect for message queues
- Session management
- Rate limiting
- Pub/Sub for real-time features

**Alternatives Considered:**
- Memcached: Simpler but less flexible
- DynamoDB: More expensive
- In-memory cache: Not suitable for distributed systems

### ORM: Prisma

**Why Prisma?**
- Type-safe database access
- Auto-generated migrations
- Excellent developer experience
- Built-in query optimization
- Strong TypeScript integration

**Alternatives Considered:**
- TypeORM: More verbose
- Sequelize: Less type-safe
- Raw SQL: More error-prone

### Frontend Framework: Next.js

**Why Next.js?**
- Server-side rendering for SEO
- API routes for backend
- Excellent performance
- Built-in optimization
- Great developer experience

**Alternatives Considered:**
- React: More setup required
- Vue.js: Different ecosystem
- Svelte: Smaller community

### Deployment: Railway

**Why Railway?**
- Simple deployment process
- Built-in PostgreSQL and Redis
- Automatic scaling
- Good pricing for startups
- GitHub integration

**Alternatives Considered:**
- Vercel: Better for frontend, limited backend
- Heroku: More expensive
- AWS: More complex setup
- DigitalOcean: More manual configuration

### AI Model: Claude API

**Why Claude?**
- Superior reasoning capabilities
- Better context understanding
- Safer by default
- Good pricing
- Excellent API documentation

**Alternatives Considered:**
- GPT-4: More expensive
- Gemini: Less mature API
- Open-source models: Requires hosting

### Payment Gateway: Razorpay

**Why Razorpay?**
- Best for Indian market
- Multiple payment methods
- Subscription management
- Good documentation
- Competitive pricing

**Alternatives Considered:**
- Stripe: Better international, higher fees in India
- PayPal: Limited in India
- Custom payment: Complex and risky

### Messaging: WhatsApp Cloud API

**Why WhatsApp Cloud API?**
- Official Meta API
- Reliable delivery
- Rich message types
- Good rate limits
- Webhook support

**Alternatives Considered:**
- Twilio: More expensive
- Custom integration: Not recommended

---

## Performance Optimization

### Caching Strategy

**Multi-Level Caching:**
1. **Browser Cache**: Static assets (CSS, JS) with 1-year expiry
2. **CDN Cache**: Images and media with 30-day expiry
3. **Redis Cache**: API responses with 5-minute TTL
4. **Database Query Cache**: Frequently accessed data

**Cache Invalidation:**
```typescript
// Invalidate cache on data change
const updateBot = async (botId: string, data: any) => {
  const bot = await prisma.bot.update({
    where: { id: botId },
    data
  });
  
  // Invalidate cache
  await redis.del(`bot:${botId}`);
  await redis.del(`user:${bot.user_id}:bots`);
  
  return bot;
};
```

### Database Optimization

**Query Optimization:**
- Use indexes on frequently queried columns
- Implement pagination for large result sets
- Use database views for complex queries
- Connection pooling with max 20 connections

**Denormalization:**
- Cache message count in conversations table
- Store user subscription tier in users table
- Pre-calculate analytics metrics

### API Response Optimization

**Response Compression:**
```typescript
import compression from 'compression';
app.use(compression({
  level: 6,
  threshold: 1024
}));
```

**Pagination:**
- Default limit: 20 items
- Maximum limit: 100 items
- Cursor-based pagination for large datasets

**Field Selection:**
```typescript
// Allow clients to select specific fields
GET /api/bots?fields=id,name,created_at
```

### Frontend Performance

**Code Splitting:**
- Route-based code splitting with Next.js
- Dynamic imports for heavy components
- Lazy loading for images

**Bundle Size:**
- Tree-shaking unused code
- Minification and compression
- CDN delivery for static assets

---

## Monitoring & Observability

### Application Monitoring

**Metrics to Track:**
- Request latency (p50, p95, p99)
- Error rates by endpoint
- Database query performance
- Redis operation latency
- External API response times
- Message processing queue depth

**Sentry Configuration:**
```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ request: true, serverName: true })
  ]
});
```

### Logging

**Structured Logging with Winston:**
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### Alerting

**Alert Conditions:**
- Error rate > 5% for 5 minutes
- API latency p95 > 2 seconds
- Database connection pool exhausted
- Redis connection lost
- Message queue depth > 10,000
- Payment processing failure rate > 1%



---

## Components and Interfaces

### Core Service Interfaces

**BotService Interface:**
```typescript
interface IBotService {
  createBot(userId: string, data: CreateBotDTO): Promise<Bot>;
  updateBot(botId: string, data: UpdateBotDTO): Promise<Bot>;
  deleteBot(botId: string): Promise<void>;
  getBotById(botId: string): Promise<Bot>;
  listBots(userId: string, pagination: PaginationDTO): Promise<PaginatedResponse<Bot>>;
  testBot(botId: string, message: string): Promise<TestBotResponse>;
  getWebhookUrl(botId: string): string;
}
```

**MessageService Interface:**
```typescript
interface IMessageService {
  processIncomingMessage(message: IncomingMessage): Promise<void>;
  sendMessage(botId: string, to: string, text: string): Promise<SentMessage>;
  getConversationHistory(conversationId: string, limit: number): Promise<Message[]>;
  markAsRead(messageId: string): Promise<void>;
}
```

**AIService Interface:**
```typescript
interface IAIService {
  generateResponse(
    systemPrompt: string,
    conversationHistory: Message[],
    userMessage: string,
    config: AIConfig
  ): Promise<AIResponse>;
  estimateTokens(text: string): number;
  validatePrompt(prompt: string): boolean;
}
```

**SubscriptionService Interface:**
```typescript
interface ISubscriptionService {
  getAvailablePlans(): Promise<Plan[]>;
  upgradePlan(userId: string, planId: string): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscriptionStatus(userId: string): Promise<SubscriptionStatus>;
  checkMessageLimit(userId: string): Promise<boolean>;
}
```

**PaymentService Interface:**
```typescript
interface IPaymentService {
  createOrder(userId: string, amount: number): Promise<Order>;
  verifyPayment(orderId: string, paymentId: string, signature: string): Promise<boolean>;
  processWebhook(event: RazorpayEvent): Promise<void>;
  getPaymentHistory(userId: string): Promise<Payment[]>;
}
```

### Data Transfer Objects (DTOs)

**CreateBotDTO:**
```typescript
interface CreateBotDTO {
  name: string;
  description?: string;
  whatsapp_phone_number_id: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
}
```

**UpdateBotDTO:**
```typescript
interface UpdateBotDTO {
  name?: string;
  description?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  is_active?: boolean;
}
```

**IncomingMessage:**
```typescript
interface IncomingMessage {
  botId: string;
  from: string;
  messageId: string;
  text: string;
  timestamp: number;
  type: 'text' | 'image' | 'document' | 'audio';
  mediaUrl?: string;
}
```

**AIResponse:**
```typescript
interface AIResponse {
  text: string;
  tokens: {
    input: number;
    output: number;
  };
  processingTimeMs: number;
  model: string;
}
```

### Middleware Components

**Authentication Middleware:**
```typescript
const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

**Rate Limiting Middleware:**
```typescript
const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false
});
```

**Error Handling Middleware:**
```typescript
const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }

  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
};
```

---

## Testing Strategy

### Unit Testing

**Framework:** Jest with TypeScript support

**Coverage Targets:**
- Services: 80%+ coverage
- Utilities: 90%+ coverage
- Controllers: 70%+ coverage

**Example Unit Test:**
```typescript
describe('BotService', () => {
  let botService: BotService;
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = new PrismaClient();
    botService = new BotService(prisma);
  });

  describe('createBot', () => {
    it('should create a new bot with valid data', async () => {
      const userId = 'user-123';
      const botData = {
        name: 'Test Bot',
        whatsapp_phone_number_id: '1234567890',
        system_prompt: 'You are helpful'
      };

      const result = await botService.createBot(userId, botData);

      expect(result).toHaveProperty('id');
      expect(result.name).toBe('Test Bot');
      expect(result.user_id).toBe(userId);
    });

    it('should throw error for invalid phone number', async () => {
      const botData = {
        name: 'Test Bot',
        whatsapp_phone_number_id: 'invalid',
        system_prompt: 'You are helpful'
      };

      await expect(botService.createBot('user-123', botData))
        .rejects
        .toThrow('Invalid phone number');
    });
  });
});
```

### Integration Testing

**Framework:** Jest with test database

**Test Scenarios:**
- User registration and login flow
- Bot creation and configuration
- Message sending and receiving
- Subscription upgrade and payment
- Webhook processing

**Example Integration Test:**
```typescript
describe('Message Processing Flow', () => {
  it('should process incoming message and send response', async () => {
    // 1. Create user and bot
    const user = await createTestUser();
    const bot = await createTestBot(user.id);

    // 2. Send incoming message
    const incomingMessage = {
      botId: bot.id,
      from: '919876543210',
      messageId: 'msg-123',
      text: 'Hello',
      timestamp: Date.now()
    };

    // 3. Process message
    await messageService.processIncomingMessage(incomingMessage);

    // 4. Verify message was saved
    const savedMessage = await prisma.message.findUnique({
      where: { whatsapp_message_id: 'msg-123' }
    });
    expect(savedMessage).toBeDefined();

    // 5. Verify response was sent
    const responses = await prisma.message.findMany({
      where: {
        conversation_id: savedMessage.conversation_id,
        sender_type: 'bot'
      }
    });
    expect(responses.length).toBeGreaterThan(0);
  });
});
```

### API Testing

**Framework:** Supertest

**Test Coverage:**
- All endpoints with valid requests
- Error cases (400, 401, 404, 500)
- Rate limiting
- Authentication

**Example API Test:**
```typescript
describe('POST /api/bots', () => {
  it('should create bot with valid data', async () => {
    const response = await request(app)
      .post('/api/bots')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Bot',
        whatsapp_phone_number_id: '1234567890',
        system_prompt: 'You are helpful'
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .post('/api/bots')
      .send({
        name: 'Test Bot',
        whatsapp_phone_number_id: '1234567890',
        system_prompt: 'You are helpful'
      });

    expect(response.status).toBe(401);
  });
});
```

### Load Testing

**Framework:** k6

**Test Scenarios:**
- 100 concurrent users
- 1000 requests/second
- Message processing under load
- Database connection pool stress

**Example Load Test:**
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 }
  ]
};

export default function () {
  const url = 'https://api.botbazaar.com/api/bots';
  const payload = JSON.stringify({
    name: 'Load Test Bot',
    whatsapp_phone_number_id: '1234567890',
    system_prompt: 'You are helpful'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.TOKEN}`
    }
  };

  const response = http.post(url, payload, params);

  check(response, {
    'status is 201': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500
  });

  sleep(1);
}
```

### End-to-End Testing

**Framework:** Cypress

**Test Scenarios:**
- User signup and login
- Bot creation and configuration
- Sending test messages
- Subscription upgrade
- Dashboard navigation

---

## Data Models

### Entity Relationship Diagram

```
┌─────────────┐
│   users     │
├─────────────┤
│ id (PK)     │
│ email       │
│ password    │
│ subscription│
└──────┬──────┘
       │
       │ 1:N
       │
┌──────▼──────────┐
│     bots        │
├─────────────────┤
│ id (PK)         │
│ user_id (FK)    │
│ name            │
│ system_prompt   │
└──────┬──────────┘
       │
       │ 1:N
       │
┌──────▼──────────────────┐
│   conversations         │
├─────────────────────────┤
│ id (PK)                 │
│ bot_id (FK)             │
│ user_phone_number       │
│ last_message_at         │
└──────┬──────────────────┘
       │
       │ 1:N
       │
┌──────▼──────────┐
│    messages     │
├─────────────────┤
│ id (PK)         │
│ conversation_id │
│ sender_type     │
│ message_text    │
│ created_at      │
└─────────────────┘

┌─────────────────┐
│  subscriptions  │
├─────────────────┤
│ id (PK)         │
│ user_id (FK)    │
│ plan_id         │
│ status          │
└─────────────────┘

┌─────────────────┐
│    payments     │
├─────────────────┤
│ id (PK)         │
│ user_id (FK)    │
│ subscription_id │
│ amount          │
│ status          │
└─────────────────┘
```

---

## Conclusion

This technical design provides a comprehensive blueprint for implementing BotBazaar WhatsApp Bot Builder SaaS. The architecture is designed to be:

- **Scalable**: Horizontal scaling with load balancing
- **Reliable**: Error handling, retry strategies, and monitoring
- **Secure**: Encryption, authentication, and input validation
- **Maintainable**: Clear separation of concerns and well-documented APIs
- **Cost-effective**: Efficient resource usage and pricing optimization

The implementation should follow this design while remaining flexible to adapt to changing requirements and market feedback.

