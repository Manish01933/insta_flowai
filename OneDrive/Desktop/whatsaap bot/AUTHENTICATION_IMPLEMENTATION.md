# BotBazaar Authentication System Implementation

## Overview

This document summarizes the implementation of the complete authentication system for BotBazaar, covering all 5 parallel tasks (1.4-1.8) from the technical design specification.

## Tasks Completed

### Task 1.4: Authentication Middleware and JWT Token Management

**Files Created:**
- `src/utils/jwt.ts` - JWT token generation and verification
- `src/utils/tokenBlacklist.ts` - Token invalidation management using Redis
- `src/middleware/auth.ts` - Authentication middleware for route protection

**Key Features:**
- **Access Token Generation**: 1-hour expiry with user ID, email, and subscription tier
- **Refresh Token Generation**: 30-day expiry for token rotation
- **Token Verification**: Validates token signature, expiry, and issuer
- **Token Blacklist**: Redis-backed token invalidation for logout and rotation
- **Authentication Middleware**: Protects routes and attaches user context
- **Optional Auth**: Allows routes to work with or without authentication

**Implementation Details:**
```typescript
// Token Payload Structure
{
  sub: string;           // User ID
  email: string;
  subscription_tier: string;
  iat: number;          // Issued at
  exp: number;          // Expiration
  iss: string;          // Issuer (botbazaar)
}

// Refresh Token Payload
{
  sub: string;          // User ID
  type: 'refresh';
  iat: number;
  exp: number;
  iss: string;
}
```

---

### Task 1.5: User Registration and Login Endpoints

**Files Created:**
- `src/services/authService.ts` - Authentication business logic
- `src/routes/auth.ts` - Authentication API endpoints

**Endpoints Implemented:**

#### POST /api/auth/register
- Email validation (format and uniqueness)
- Password strength validation (8+ chars, uppercase, number, special char)
- Bcrypt hashing with 12 salt rounds
- User record creation in PostgreSQL
- Returns JWT tokens and user details

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
  "subscription_tier": "free",
  "access_token": "jwt_token",
  "refresh_token": "refresh_jwt_token",
  "expires_in": 3600
}
```

#### POST /api/auth/login
- Email and password validation
- Password verification against bcrypt hash
- JWT token generation
- Returns tokens and user details

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
  "subscription_tier": "pro",
  "access_token": "jwt_token",
  "refresh_token": "refresh_jwt_token",
  "expires_in": 3600
}
```

**Input Validation:**
- Email format validation using regex
- Password strength requirements enforced
- Error responses with specific error codes

---

### Task 1.6: Token Refresh and Logout Endpoints

**Endpoints Implemented:**

#### POST /api/auth/refresh
- Accepts refresh token in request body
- Verifies refresh token validity
- Checks token blacklist
- Generates new access token
- Implements token rotation support

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
- Requires authentication
- Accepts refresh token
- Adds token to blacklist with TTL
- Clears session data
- Returns success response

**Request:**
```json
{
  "refresh_token": "refresh_jwt_token"
}
```

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**Additional Endpoints:**

#### GET /api/auth/me
- Returns current user profile
- Requires authentication

#### PUT /api/auth/profile
- Updates user profile (name, phone)
- Requires authentication

#### POST /api/auth/change-password
- Changes user password
- Validates old password
- Enforces new password strength requirements
- Requires authentication

---

### Task 1.7: Error Handling and Logging Infrastructure

**Files Created:**
- `src/utils/errors.ts` - Custom error classes
- `src/middleware/errorHandler.ts` - Global error handler
- `src/middleware/requestId.ts` - Request ID tracking

**Custom Error Classes:**
```typescript
- AppError (base class)
- ValidationError (400)
- AuthError (401)
- ForbiddenError (403)
- NotFoundError (404)
- ConflictError (409)
- RateLimitError (429)
- InternalServerError (500)
```

**Error Response Format:**
```json
{
  "error": "Error message",
  "errorCode": "ERROR_CODE",
  "statusCode": 400,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/login",
  "method": "POST"
}
```

**Features:**
- Request ID tracking for debugging
- Structured error logging with Winston
- Automatic error code assignment
- Environment-aware error messages (production vs development)
- Prisma error handling (unique constraints, not found)
- JWT error handling (expired, invalid)
- Async error wrapper for route handlers

**Logging:**
- Winston logger with multiple transports
- Console output with colors
- File logging (error.log, all.log)
- Structured logging with timestamps
- Request/response logging with request IDs

---

### Task 1.8: Security Headers and CORS Configuration

**Files Created:**
- `src/middleware/rateLimiter.ts` - Rate limiting middleware
- Updated `src/index.ts` - Main server with security configuration

**Security Headers (via Helmet):**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

**CORS Configuration:**
```typescript
{
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-*'],
  maxAge: 86400
}
```

**Rate Limiting:**
- Global rate limiter: 100 requests/minute per IP
- Auth rate limiter: 5 requests/15 minutes per IP (for register/login)
- API rate limiter: 100 requests/minute per user ID
- Redis-backed for distributed systems
- Graceful degradation if Redis fails

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T10:31:00Z
```

**Request Validation:**
- Input validation middleware
- JSON body size limit (10MB)
- URL-encoded body size limit (10MB)
- Content-Type validation

---

## File Structure

```
src/
├── config/
│   ├── environment.ts       (Configuration management)
│   ├── logger.ts            (Winston logger setup)
│   └── redis.ts             (Redis client initialization)
├── middleware/
│   ├── auth.ts              (JWT authentication)
│   ├── errorHandler.ts      (Global error handling)
│   ├── rateLimiter.ts       (Rate limiting)
│   └── requestId.ts         (Request ID tracking)
├── routes/
│   └── auth.ts              (Authentication endpoints)
├── services/
│   └── authService.ts       (Authentication business logic)
├── utils/
│   ├── errors.ts            (Custom error classes)
│   ├── jwt.ts               (JWT utilities)
│   ├── tokenBlacklist.ts    (Token invalidation)
│   ├── validation.ts        (Input validation)
│   ├── authService.test.ts  (Service tests)
│   ├── jwt.test.ts          (JWT tests)
│   └── validation.test.ts   (Validation tests)
├── index.ts                 (Main server file)
├── jest.config.js           (Jest configuration)
└── jest.setup.js            (Jest setup)
```

---

## Testing

### Unit Tests Created

1. **authService.test.ts**
   - User registration with valid input
   - Email validation
   - Password strength validation
   - Duplicate email rejection
   - Login with valid credentials
   - Invalid credentials rejection
   - Inactive user rejection
   - Token refresh
   - Logout and token blacklisting

2. **jwt.test.ts**
   - Access token generation
   - Refresh token generation
   - Token verification
   - Expired token handling
   - Invalid token handling
   - Token pair generation

3. **validation.test.ts**
   - Email format validation
   - Password strength validation
   - Registration input validation
   - Login input validation
   - Error message generation

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test:watch

# Generate coverage report
npm test:coverage
```

### Test Coverage Goals
- Branches: 70%+
- Functions: 70%+
- Lines: 70%+
- Statements: 70%+

---

## API Documentation

### Authentication Flow

#### Registration Flow
```
1. POST /api/auth/register
   ├─ Validate email format
   ├─ Validate password strength
   ├─ Check email uniqueness
   ├─ Hash password with bcrypt
   ├─ Create user in database
   └─ Generate and return tokens

2. Response includes:
   ├─ User ID and email
   ├─ Access token (1 hour)
   ├─ Refresh token (30 days)
   └─ Subscription tier
```

#### Login Flow
```
1. POST /api/auth/login
   ├─ Validate email format
   ├─ Find user by email
   ├─ Verify password
   ├─ Check user is active
   └─ Generate and return tokens

2. Response includes:
   ├─ User ID and email
   ├─ Access token (1 hour)
   ├─ Refresh token (30 days)
   └─ Subscription tier
```

#### Token Refresh Flow
```
1. POST /api/auth/refresh
   ├─ Validate refresh token format
   ├─ Check token blacklist
   ├─ Verify token signature
   ├─ Get user from database
   ├─ Check user is active
   └─ Generate new access token

2. Response includes:
   ├─ New access token
   └─ Expiration time
```

#### Logout Flow
```
1. POST /api/auth/logout (requires auth)
   ├─ Validate refresh token
   ├─ Verify token signature
   ├─ Add to Redis blacklist
   └─ Return success

2. Subsequent requests with this token:
   ├─ Check blacklist
   └─ Reject with 401 Unauthorized
```

---

## Security Considerations

### Password Security
- Bcrypt hashing with 12 salt rounds
- Password strength requirements enforced
- Passwords never logged or exposed
- Password change requires old password verification

### Token Security
- JWT tokens signed with HS256 algorithm
- Tokens include issuer validation
- Refresh tokens stored separately from access tokens
- Token blacklist for logout and rotation
- Tokens expire automatically

### API Security
- CORS configured with allowed origins
- Security headers via Helmet
- Rate limiting on auth endpoints
- Request ID tracking for debugging
- Input validation on all endpoints
- Error messages don't leak sensitive info

### Database Security
- Passwords hashed before storage
- User queries use parameterized statements (Prisma)
- Soft deletes for user records
- Audit logging for changes

---

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/botbazaar

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_jwt_secret_key_here
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_here
JWT_EXPIRY=3600
JWT_REFRESH_EXPIRY=2592000

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=info
```

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| VALIDATION_ERROR | 400 | Input validation failed |
| INVALID_EMAIL | 400 | Email format invalid |
| INVALID_EMAIL_FORMAT | 400 | Email format doesn't match pattern |
| WEAK_PASSWORD | 400 | Password doesn't meet strength requirements |
| INVALID_PASSWORD | 400 | Password field invalid |
| MISSING_FIELDS | 400 | Required fields missing |
| AUTH_ERROR | 401 | Authentication failed |
| NO_TOKEN | 401 | No token provided |
| INVALID_TOKEN | 401 | Token is invalid |
| TOKEN_EXPIRED | 401 | Token has expired |
| TOKEN_INVALIDATED | 401 | Token has been blacklisted |
| INVALID_CREDENTIALS | 401 | Email or password incorrect |
| ACCOUNT_INACTIVE | 401 | User account is inactive |
| FORBIDDEN | 403 | Access denied |
| NOT_FOUND | 404 | Resource not found |
| USER_NOT_FOUND | 404 | User doesn't exist |
| EMAIL_ALREADY_EXISTS | 409 | Email already registered |
| CONFLICT | 409 | Resource conflict |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INTERNAL_SERVER_ERROR | 500 | Server error |

---

## Next Steps

1. **Database Setup**: Run Prisma migrations to create tables
2. **Environment Configuration**: Set up .env file with required variables
3. **Redis Setup**: Ensure Redis is running and accessible
4. **Testing**: Run test suite to verify implementation
5. **Integration**: Integrate with bot management endpoints
6. **Frontend**: Implement authentication UI in Next.js dashboard

---

## Implementation Notes

### Design Decisions

1. **JWT over Sessions**: Stateless authentication for scalability
2. **Refresh Token Rotation**: Improves security by limiting token lifetime
3. **Redis Blacklist**: Enables immediate token invalidation
4. **Bcrypt Hashing**: Industry standard with configurable salt rounds
5. **Request IDs**: Enables request tracing across logs
6. **Rate Limiting**: Prevents brute force attacks on auth endpoints

### Performance Considerations

- Token verification is fast (no database lookup)
- Blacklist check uses Redis (in-memory)
- Password hashing is intentionally slow (security)
- Rate limiting uses Redis for distributed systems
- Logging is asynchronous (non-blocking)

### Scalability

- Stateless authentication (no session storage)
- Redis-backed rate limiting (distributed)
- Token blacklist with TTL (automatic cleanup)
- Async error handling (non-blocking)
- Connection pooling for database and Redis

---

## Troubleshooting

### Common Issues

**Issue**: "Redis client not initialized"
- **Solution**: Ensure Redis is running and REDIS_URL is correct

**Issue**: "Invalid token" errors
- **Solution**: Check JWT_SECRET and JWT_REFRESH_SECRET are set correctly

**Issue**: "Rate limit exceeded"
- **Solution**: Wait for the rate limit window to reset (check X-RateLimit-Reset header)

**Issue**: "Email already exists"
- **Solution**: Use a different email or reset the database

---

## References

- [JWT.io](https://jwt.io) - JWT specification
- [Bcrypt](https://github.com/kelektiv/node.bcrypt.js) - Password hashing
- [Express.js](https://expressjs.com) - Web framework
- [Prisma](https://www.prisma.io) - ORM
- [Redis](https://redis.io) - Cache and message queue
- [Helmet](https://helmetjs.github.io) - Security headers
- [Winston](https://github.com/winstonjs/winston) - Logging

---

**Implementation Date**: 2024-01-15
**Status**: Complete
**Version**: 1.0
