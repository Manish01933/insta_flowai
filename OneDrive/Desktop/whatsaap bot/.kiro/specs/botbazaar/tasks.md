# Implementation Plan: BotBazaar WhatsApp Bot Builder SaaS

## Overview

This implementation plan breaks down the BotBazaar technical design into actionable development tasks organized into 7 phases. Each task represents a discrete coding step that builds incrementally toward a complete, production-ready SaaS platform. Tasks are sequenced to enable parallel development where possible while maintaining clear dependencies.

---

## Phase 1: Core Infrastructure & Authentication

### Foundation Setup

- [x] 1.1 Initialize Node.js project with TypeScript configuration
  - Set up Express.js server with TypeScript
  - Configure tsconfig.json with strict mode enabled
  - Set up environment variable management (.env files)
  - Create project directory structure (src/routes, src/services, src/middleware, src/models, src/utils)
  - _Requirements: System Architecture, Technology Stack_

- [x] 1.2 Set up PostgreSQL database and Prisma ORM
  - Create PostgreSQL database schema using Prisma migrations
  - Define all 8 core tables (users, bots, conversations, messages, bot_templates, subscriptions, payments, api_keys, audit_logs)
  - Create database indexes for performance optimization
  - Set up connection pooling with PgBouncer
  - _Requirements: Database Schema_

- [x] 1.3 Configure Redis cache layer
  - Set up Redis connection with connection pooling
  - Create Redis client wrapper with error handling
  - Implement cache key naming conventions
  - Set up TTL management for different cache types
  - _Requirements: System Architecture, Performance Optimization_

- [x] 1.4 Implement authentication middleware and JWT token management
  - Create JWT token generation and verification functions
  - Implement access token (1-hour expiry) and refresh token (30-day expiry) logic
  - Create authentication middleware for route protection
  - Implement token refresh endpoint logic
  - _Requirements: Authentication & Authorization_

- [x] 1.5 Create user registration and login endpoints
  - Implement POST /api/auth/register with email validation
  - Implement password hashing with bcrypt (12 salt rounds)
  - Implement POST /api/auth/login with credential verification
  - Add input validation and error handling
  - _Requirements: Authentication Endpoints, Security Implementation_

- [x] 1.6 Implement token refresh and logout endpoints
  - Create POST /api/auth/refresh endpoint
  - Implement POST /api/auth/logout with token invalidation
  - Add refresh token rotation logic
  - _Requirements: Authentication Endpoints_

- [x] 1.7 Set up error handling and logging infrastructure
  - Implement centralized error handler middleware
  - Configure Winston logger with structured logging
  - Create error response formatter with error codes
  - Set up request ID tracking for debugging
  - _Requirements: Error Handling & Retry Strategies_

- [x] 1.8 Configure security headers and CORS
  - Implement security headers (X-Content-Type-Options, X-Frame-Options, etc.)
  - Configure CORS with allowed origins from environment
  - Implement rate limiting middleware with Redis backend
  - Add request validation middleware
  - _Requirements: Security Implementation, Authentication & Authorization_

- [~] 1.9 Checkpoint - Verify authentication system
  - Ensure all auth endpoints work correctly
  - Test JWT token generation and validation
  - Verify password hashing and comparison
  - Test error handling for invalid credentials
  - Ask the user if questions arise.

---

## Phase 2: Bot Management & Configuration

### Bot CRUD Operations

- [x] 2.1 Create bot management service and data models
  - Define Bot TypeScript interface and Prisma model
  - Create BotService class with CRUD methods
  - Implement bot validation logic
  - Add bot ownership verification
  - _Requirements: Bot Management Endpoints, Components & Interfaces_

- [x] 2.2 Implement POST /api/bots endpoint (create bot)
  - Create bot creation endpoint with request validation
  - Generate webhook URL and verify token for each bot
  - Store bot configuration in PostgreSQL
  - Return bot details with webhook information
  - _Requirements: Bot Management Endpoints_

- [x] 2.3 Implement GET /api/bots endpoint (list bots)
  - Create paginated bot listing endpoint
  - Add filtering by status (active/inactive)
  - Implement sorting by creation date
  - Include message count and metadata
  - _Requirements: Bot Management Endpoints_

- [x] 2.4 Implement GET /api/bots/:botId endpoint (get bot details)
  - Create endpoint to retrieve single bot configuration
  - Include webhook URL and verify token
  - Add bot statistics (message count, conversation count)
  - _Requirements: Bot Management Endpoints_

- [x] 2.5 Implement PUT /api/bots/:botId endpoint (update bot)
  - Create bot update endpoint with partial update support
  - Validate ownership before allowing updates
  - Support updating system prompt, temperature, max_tokens
  - Update audit logs for changes
  - _Requirements: Bot Management Endpoints_

- [x] 2.6 Implement DELETE /api/bots/:botId endpoint (delete bot)
  - Create soft delete functionality
  - Cascade delete related conversations and messages
  - Update audit logs
  - _Requirements: Bot Management Endpoints_

- [x] 2.7 Implement POST /api/bots/:botId/test endpoint (test bot)
  - Create test endpoint for bot responses
  - Call Claude API with test message
  - Return response with processing metrics
  - _Requirements: Bot Management Endpoints_

- [x] 2.8 Create bot templates system
  - Define BotTemplate model in Prisma
  - Create template CRUD endpoints
  - Implement template categories
  - Add public/private template visibility
  - _Requirements: Database Schema_

- [~] 2.9 Checkpoint - Verify bot management system
  - Test all bot CRUD operations
  - Verify webhook URL generation
  - Test bot ownership verification
  - Ensure audit logging works
  - Ask the user if questions arise.

---

## Phase 3: Message Processing Pipeline

### Webhook & Message Queue Setup

- [-] 3.1 Implement WhatsApp webhook handler
  - Create POST /api/webhooks/whatsapp/:botId endpoint
  - Implement webhook signature verification using HMAC-SHA256
  - Extract message data from WhatsApp payload
  - Return 200 OK immediately for webhook acknowledgment
  - _Requirements: Message Processing Pipeline, WhatsApp Cloud API Integration_

- [-] 3.2 Set up Redis message queue with Bull
  - Configure Bull queue for message processing
  - Implement queue connection with error handling
  - Set up retry logic with exponential backoff
  - Configure queue concurrency limits
  - _Requirements: Message Processing Pipeline_

- [-] 3.3 Create message model and conversation tracking
  - Define Message and Conversation Prisma models
  - Implement conversation creation/retrieval logic
  - Add message status tracking (received, processing, sent, delivered)
  - Create conversation metadata updates
  - _Requirements: Database Schema, Message Processing Pipeline_

- [ ] 3.4 Implement message queue worker
  - Create worker process to dequeue messages from Redis
  - Implement message validation and bot lookup
  - Save incoming messages to PostgreSQL
  - Update conversation metadata
  - _Requirements: Message Processing Pipeline_

- [~] 3.5 Integrate Claude API for message responses
  - Create Claude API client wrapper
  - Implement conversation history retrieval (last 10 messages)
  - Build system prompt with bot configuration
  - Handle streaming responses from Claude
  - _Requirements: Integration Points, Message Processing Pipeline_

- [~] 3.6 Implement response formatting and message splitting
  - Create response formatter for WhatsApp (max 4096 chars)
  - Implement message splitting for long responses
  - Add markdown support formatting
  - Handle media responses (images, documents)
  - _Requirements: Message Processing Pipeline_

- [~] 3.7 Integrate WhatsApp Cloud API for sending messages
  - Create WhatsApp API client wrapper
  - Implement message sending with error handling
  - Add retry logic with exponential backoff
  - Store WhatsApp message IDs for tracking
  - _Requirements: Integration Points, WhatsApp Cloud API Integration_

- [~] 3.8 Implement message status tracking and updates
  - Create status update logic (sent, delivered, read)
  - Implement webhook handler for WhatsApp status updates
  - Update message records with delivery status
  - Track processing metrics (time, tokens used)
  - _Requirements: Message Processing Pipeline_

- [~] 3.9 Implement rate limiting per user tier
  - Create rate limit checker based on subscription tier
  - Implement monthly message quota tracking
  - Add per-second rate limiting for WhatsApp API (80 req/sec)
  - Return appropriate error responses when limits exceeded
  - _Requirements: Rate Limiting Strategy_

- [~] 3.10 Implement conversation management endpoints
  - Create GET /api/bots/:botId/conversations endpoint
  - Implement pagination and filtering
  - Add conversation status management
  - _Requirements: Conversation & Message Endpoints_

- [~] 3.11 Implement message retrieval endpoints
  - Create GET /api/bots/:botId/conversations/:conversationId/messages endpoint
  - Implement pagination for message history
  - Add message filtering and sorting
  - _Requirements: Conversation & Message Endpoints_

- [~] 3.12 Checkpoint - Verify message processing pipeline
  - Test webhook signature verification
  - Test message queuing and processing
  - Verify Claude API integration
  - Test WhatsApp message sending
  - Test rate limiting enforcement
  - Ask the user if questions arise.

---

## Phase 4: Payments & Subscriptions

### Subscription Management

- [~] 4.1 Create subscription and payment models
  - Define Subscription and Payment Prisma models
  - Create subscription tier definitions (Free, Pro, Enterprise)
  - Implement subscription status tracking
  - _Requirements: Database Schema_

- [~] 4.2 Integrate Razorpay payment gateway
  - Create Razorpay API client wrapper
  - Implement plan creation in Razorpay
  - Set up webhook signature verification for Razorpay
  - Handle payment and subscription webhooks
  - _Requirements: Integration Points, Razorpay Integration_

- [~] 4.3 Implement subscription plans endpoint
  - Create GET /api/subscriptions/plans endpoint
  - Return available plans with features and pricing
  - Include Razorpay plan IDs for each tier
  - _Requirements: Subscription & Billing Endpoints_

- [~] 4.4 Implement subscription upgrade endpoint
  - Create POST /api/subscriptions/upgrade endpoint
  - Validate plan selection
  - Create Razorpay subscription
  - Update user subscription record
  - _Requirements: Subscription & Billing Endpoints_

- [~] 4.5 Implement payment history endpoint
  - Create GET /api/payments/history endpoint
  - Implement pagination and filtering
  - Return payment details with status
  - _Requirements: Subscription & Billing Endpoints_

- [~] 4.6 Implement Razorpay webhook handler
  - Create webhook endpoint for payment events
  - Handle payment.authorized and payment.failed events
  - Handle subscription.activated and subscription.halted events
  - Update subscription status in database
  - _Requirements: Integration Points, Razorpay Integration_

- [~] 4.7 Implement subscription status management
  - Create subscription renewal logic
  - Implement subscription cancellation
  - Add grace period handling
  - Update user subscription tier on status changes
  - _Requirements: Subscription Management_

- [~] 4.8 Implement feature access control based on subscription
  - Create subscription tier checker middleware
  - Implement feature limits (max bots, messages per month)
  - Add enforcement in bot creation and message processing
  - Return appropriate error responses for tier limits
  - _Requirements: Authorization Levels_

- [~] 4.9 Implement invoice generation and email
  - Create invoice generation logic
  - Integrate SendGrid for email delivery
  - Send invoice emails on payment success
  - _Requirements: Integration Points, SendGrid Integration_

- [~] 4.10 Checkpoint - Verify payment system
  - Test subscription plan retrieval
  - Test subscription upgrade flow
  - Verify Razorpay webhook handling
  - Test payment history retrieval
  - Ask the user if questions arise.

---

## Phase 5: Frontend Dashboard

### Web Application Setup

- [~] 5.1 Initialize Next.js frontend project
  - Set up Next.js 14 with TypeScript
  - Configure Tailwind CSS and shadcn/ui
  - Set up project structure (pages, components, hooks, utils)
  - Configure environment variables for API endpoints
  - _Requirements: Technology Stack, Frontend_

- [~] 5.2 Implement authentication pages and flows
  - Create login page with email/password form
  - Create registration page with validation
  - Implement token storage in localStorage/cookies
  - Create protected route wrapper
  - _Requirements: Frontend, Authentication_

- [~] 5.3 Create bot management dashboard
  - Build bot list page with pagination
  - Implement bot creation form
  - Create bot detail/edit page
  - Add bot deletion with confirmation
  - _Requirements: Frontend, Bot Management_

- [~] 5.4 Implement bot builder interface
  - Create form for bot configuration (name, system prompt, temperature, max_tokens)
  - Add template selection dropdown
  - Implement bot testing interface
  - Add webhook URL display and copy functionality
  - _Requirements: Frontend, Bot Management_

- [~] 5.5 Create conversation viewer
  - Build conversation list page with filtering
  - Implement message thread viewer
  - Add message search functionality
  - Display message metadata (timestamp, tokens used, processing time)
  - _Requirements: Frontend, Conversation Management_

- [~] 5.6 Implement subscription management UI
  - Create subscription plans page
  - Build upgrade/downgrade flow
  - Implement payment history view
  - Add invoice download functionality
  - _Requirements: Frontend, Subscription Management_

- [~] 5.7 Create user settings and profile page
  - Build profile edit form
  - Implement password change functionality
  - Add API key management interface
  - Create account deletion option
  - _Requirements: Frontend, User Management_

- [~] 5.8 Implement analytics dashboard
  - Create message statistics visualization
  - Build conversation metrics charts
  - Add subscription usage tracking
  - Implement date range filtering
  - _Requirements: Frontend, Analytics_

- [~] 5.9 Set up state management with Redux Toolkit
  - Create Redux store configuration
  - Implement auth slice (login, logout, token refresh)
  - Create bot slice (list, create, update, delete)
  - Add subscription slice
  - _Requirements: Frontend, State Management_

- [~] 5.10 Implement API client with TanStack Query
  - Create API client wrapper with axios
  - Implement query hooks for all endpoints
  - Add mutation hooks for create/update/delete operations
  - Implement error handling and retry logic
  - _Requirements: Frontend, HTTP Client_

- [~] 5.11 Add form validation with React Hook Form and Zod
  - Create validation schemas for all forms
  - Implement form components with error display
  - Add real-time validation feedback
  - _Requirements: Frontend, Form Handling_

- [~] 5.12 Implement responsive design and mobile support
  - Ensure all pages are mobile-responsive
  - Test on various screen sizes
  - Implement mobile navigation
  - _Requirements: Frontend, Responsive Design_

- [~] 5.13 Checkpoint - Verify frontend functionality
  - Test authentication flow
  - Test bot management operations
  - Verify API integration
  - Test responsive design
  - Ask the user if questions arise.

---

## Phase 6: Testing & Optimization

### Comprehensive Testing

- [~] 6.1 Set up Jest testing framework
  - Configure Jest with TypeScript support
  - Set up test database for integration tests
  - Create test utilities and helpers
  - Configure coverage reporting
  - _Requirements: Testing Strategy_

- [~] 6.2 Write unit tests for authentication service
  - Test JWT token generation and validation
  - Test password hashing and comparison
  - Test token refresh logic
  - Aim for 90%+ code coverage
  - _Requirements: Testing Strategy_

- [~] 6.3 Write unit tests for bot service
  - Test bot CRUD operations
  - Test bot validation logic
  - Test ownership verification
  - _Requirements: Testing Strategy_

- [~] 6.4 Write unit tests for message processing service
  - Test message queue operations
  - Test Claude API integration
  - Test WhatsApp API integration
  - Test rate limiting logic
  - _Requirements: Testing Strategy_

- [~] 6.5 Write unit tests for subscription service
  - Test subscription tier logic
  - Test feature access control
  - Test payment processing
  - _Requirements: Testing Strategy_

- [~] 6.6 Write integration tests for authentication flow
  - Test complete registration flow
  - Test login and token generation
  - Test token refresh
  - Test logout
  - _Requirements: Testing Strategy_

- [~] 6.7 Write integration tests for bot management flow
  - Test bot creation with webhook setup
  - Test bot update and configuration
  - Test bot deletion
  - _Requirements: Testing Strategy_

- [~] 6.8 Write integration tests for message processing flow
  - Test webhook reception and processing
  - Test message queue handling
  - Test Claude API response generation
  - Test WhatsApp message sending
  - _Requirements: Testing Strategy_

- [~] 6.9 Write API tests with Supertest
  - Test all authentication endpoints
  - Test all bot management endpoints
  - Test all subscription endpoints
  - Test error responses and status codes
  - _Requirements: Testing Strategy_

- [~] 6.10 Set up load testing with k6
  - Create load test for message processing
  - Test webhook endpoint under load
  - Test API endpoints under concurrent load
  - Identify performance bottlenecks
  - _Requirements: Testing Strategy_

- [~] 6.11 Implement performance optimization
  - Add database query optimization
  - Implement caching strategies
  - Optimize API response times
  - Add response compression (gzip)
  - _Requirements: Performance Optimization_

- [~] 6.12 Set up monitoring and alerting
  - Configure Sentry for error tracking
  - Set up application metrics collection
  - Create alert conditions for critical issues
  - Implement health check endpoints
  - _Requirements: Monitoring & Observability_

- [~] 6.13 Checkpoint - Verify testing and optimization
  - Verify test coverage meets targets
  - Run load tests and verify performance
  - Test monitoring and alerting
  - Ask the user if questions arise.

---

## Phase 7: Deployment & Monitoring

### Production Deployment

- [~] 7.1 Create Docker configuration
  - Create Dockerfile for Node.js API server
  - Create Dockerfile for frontend (Next.js)
  - Create Dockerfile for message processing worker
  - Set up docker-compose for local development
  - _Requirements: Deployment Architecture_

- [~] 7.2 Set up Railway deployment
  - Create Railway project and services
  - Configure PostgreSQL database on Railway
  - Configure Redis cache on Railway
  - Set up environment variables for production
  - _Requirements: Deployment Architecture_

- [~] 7.3 Configure CI/CD pipeline with GitHub Actions
  - Create workflow for running tests on push
  - Implement automated deployment to Railway
  - Add database migration step
  - Configure environment-specific deployments
  - _Requirements: Deployment Architecture_

- [~] 7.4 Implement database migrations strategy
  - Set up Prisma migration workflow
  - Create migration for initial schema
  - Document migration procedures
  - Test rollback procedures
  - _Requirements: Deployment Architecture_

- [~] 7.5 Set up SSL/TLS certificates
  - Configure HTTPS for all endpoints
  - Set up certificate auto-renewal
  - Implement HSTS headers
  - _Requirements: Security Implementation_

- [~] 7.6 Implement backup and disaster recovery
  - Set up automated PostgreSQL backups
  - Configure backup retention policy
  - Document recovery procedures
  - Test backup restoration
  - _Requirements: Deployment Architecture_

- [~] 7.7 Configure production logging and monitoring
  - Set up centralized logging
  - Configure application performance monitoring
  - Set up error tracking with Sentry
  - Create monitoring dashboards
  - _Requirements: Monitoring & Observability_

- [~] 7.8 Implement security scanning and compliance
  - Set up dependency vulnerability scanning
  - Implement OWASP security checks
  - Configure rate limiting for production
  - Document security procedures
  - _Requirements: Security Implementation_

- [~] 7.9 Create API documentation
  - Generate OpenAPI/Swagger documentation
  - Create developer guide
  - Document authentication flow
  - Create integration examples
  - _Requirements: Documentation_

- [~] 7.10 Create deployment runbook
  - Document deployment procedures
  - Create rollback procedures
  - Document incident response procedures
  - Create troubleshooting guide
  - _Requirements: Documentation_

- [~] 7.11 Implement feature flags and gradual rollout
  - Set up feature flag system
  - Implement gradual rollout for new features
  - Create feature flag management interface
  - _Requirements: Deployment Architecture_

- [~] 7.12 Final checkpoint - Production readiness
  - Verify all systems are operational
  - Run full test suite
  - Verify monitoring and alerting
  - Verify backup and recovery procedures
  - Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific design sections for traceability
- Checkpoints ensure incremental validation and early issue detection
- Tasks are sequenced to enable parallel development within phases
- All code should follow TypeScript best practices and include proper error handling
- Database migrations should be tested before production deployment
- Security considerations should be reviewed at each phase

---

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "1.2", "1.3"],
      "description": "Project initialization and infrastructure setup"
    },
    {
      "id": 1,
      "tasks": ["1.4", "1.5", "1.6", "1.7", "1.8"],
      "description": "Authentication system implementation"
    },
    {
      "id": 2,
      "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8"],
      "description": "Bot management CRUD operations"
    },
    {
      "id": 3,
      "tasks": ["3.1", "3.2", "3.3", "3.4"],
      "description": "Message queue and webhook setup"
    },
    {
      "id": 4,
      "tasks": ["3.5", "3.6", "3.7", "3.8", "3.9"],
      "description": "Message processing and AI integration"
    },
    {
      "id": 5,
      "tasks": ["3.10", "3.11"],
      "description": "Conversation management endpoints"
    },
    {
      "id": 6,
      "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9"],
      "description": "Payment and subscription system"
    },
    {
      "id": 7,
      "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12"],
      "description": "Frontend dashboard development"
    },
    {
      "id": 8,
      "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12"],
      "description": "Testing, optimization, and monitoring"
    },
    {
      "id": 9,
      "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11"],
      "description": "Deployment and production setup"
    }
  ]
}
```

---

## Implementation Phases Summary

| Phase | Focus | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| 1 | Core Infrastructure & Auth | 1-2 weeks | Auth system, database, logging |
| 2 | Bot Management | 1-2 weeks | Bot CRUD, templates, configuration |
| 3 | Message Processing | 2-3 weeks | Webhooks, queue, Claude integration |
| 4 | Payments & Subscriptions | 1-2 weeks | Razorpay integration, billing |
| 5 | Frontend Dashboard | 2-3 weeks | Web UI, state management, forms |
| 6 | Testing & Optimization | 2-3 weeks | Test coverage, performance tuning |
| 7 | Deployment & Monitoring | 1-2 weeks | Railway setup, CI/CD, monitoring |
| **Total** | **Full Platform** | **10-15 weeks** | **Production-ready SaaS** |

---

**Created**: 2024-01-15
**Version**: 1.0
**Status**: Ready for Implementation
