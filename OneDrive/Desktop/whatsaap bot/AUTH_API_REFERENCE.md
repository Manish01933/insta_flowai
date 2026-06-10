# BotBazaar Authentication API Reference

## Quick Start

### Base URL
```
http://localhost:3000/api/auth
```

### Headers
```
Content-Type: application/json
Authorization: Bearer <access_token>  (for protected endpoints)
X-Request-ID: <uuid>                  (optional, for tracing)
```

---

## Endpoints

### 1. Register User

**POST** `/register`

Create a new user account.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+91-9876543210"
  }'
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "subscription_tier": "free",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

**Error (400):**
```json
{
  "error": "Email already registered",
  "errorCode": "EMAIL_ALREADY_EXISTS",
  "statusCode": 409,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/register",
  "method": "POST"
}
```

**Password Requirements:**
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*()_+-=[]{}';:"\\|,.<>/?

---

### 2. Login User

**POST** `/login`

Authenticate user and get tokens.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "subscription_tier": "free",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

**Error (401):**
```json
{
  "error": "Invalid email or password",
  "errorCode": "INVALID_CREDENTIALS",
  "statusCode": 401,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/login",
  "method": "POST"
}
```

---

### 3. Refresh Access Token

**POST** `/refresh`

Get a new access token using refresh token.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

**Error (401):**
```json
{
  "error": "Refresh token has expired",
  "errorCode": "REFRESH_TOKEN_EXPIRED",
  "statusCode": 401,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/refresh",
  "method": "POST"
}
```

---

### 4. Logout User

**POST** `/logout`

Invalidate refresh token and logout.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**Error (401):**
```json
{
  "error": "No token provided",
  "errorCode": "NO_TOKEN",
  "statusCode": 401,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/logout",
  "method": "POST"
}
```

---

### 5. Get Current User

**GET** `/me`

Get current user profile.

**Request:**
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+91-9876543210",
  "avatar_url": null,
  "subscription_tier": "free",
  "subscription_status": "active",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

---

### 6. Update User Profile

**PUT** `/profile`

Update user profile information.

**Request:**
```bash
curl -X PUT http://localhost:3000/api/auth/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "first_name": "Jane",
    "last_name": "Smith",
    "phone": "+91-9876543211"
  }'
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "first_name": "Jane",
  "last_name": "Smith",
  "phone": "+91-9876543211",
  "subscription_tier": "free",
  "updated_at": "2024-01-15T10:35:00Z"
}
```

---

### 7. Change Password

**POST** `/change-password`

Change user password.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "old_password": "SecurePassword123!",
    "new_password": "NewSecurePassword456!"
  }'
```

**Response (200):**
```json
{
  "message": "Password changed successfully"
}
```

**Error (401):**
```json
{
  "error": "Current password is incorrect",
  "errorCode": "INVALID_PASSWORD",
  "statusCode": 401,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/change-password",
  "method": "POST"
}
```

---

## Rate Limiting

### Limits by Endpoint

| Endpoint | Limit | Window |
|----------|-------|--------|
| /register | 5 | 15 minutes |
| /login | 5 | 15 minutes |
| /refresh | 100 | 1 minute |
| /logout | 100 | 1 minute |
| /me | 100 | 1 minute |
| /profile | 100 | 1 minute |
| /change-password | 100 | 1 minute |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T10:31:00Z
```

### Rate Limit Error (429)

```json
{
  "error": "Too many requests, please try again later",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "statusCode": 429,
  "requestId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/login",
  "method": "POST"
}
```

---

## Authentication

### Using Access Token

Include the access token in the Authorization header:

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Token Expiration

Access tokens expire after 1 hour. Use the refresh token to get a new one:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

### Token Payload

Access tokens contain:
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "subscription_tier": "free",
  "iat": 1705315800,
  "exp": 1705319400,
  "iss": "botbazaar"
}
```

---

## Error Handling

### Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| VALIDATION_ERROR | 400 | Input validation failed |
| INVALID_EMAIL_FORMAT | 400 | Email format invalid |
| WEAK_PASSWORD | 400 | Password too weak |
| INVALID_CREDENTIALS | 401 | Wrong email/password |
| NO_TOKEN | 401 | Missing authorization header |
| TOKEN_EXPIRED | 401 | Access token expired |
| TOKEN_INVALIDATED | 401 | Token was blacklisted |
| EMAIL_ALREADY_EXISTS | 409 | Email already registered |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INTERNAL_SERVER_ERROR | 500 | Server error |

### Error Response Format

```json
{
  "error": "Error message",
  "errorCode": "ERROR_CODE",
  "statusCode": 400,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/login",
  "method": "POST"
}
```

---

## Examples

### Complete Authentication Flow

#### 1. Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePassword123!",
    "first_name": "John",
    "last_name": "Doe"
  }'
```

#### 2. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePassword123!"
  }'
```

#### 3. Use Access Token
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <access_token_from_login>"
```

#### 4. Refresh Token (after 1 hour)
```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "<refresh_token_from_login>"
  }'
```

#### 5. Logout
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "refresh_token": "<refresh_token>"
  }'
```

---

## JavaScript/TypeScript Examples

### Using Fetch API

```typescript
// Register
const registerResponse = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePassword123!',
    first_name: 'John',
    last_name: 'Doe'
  })
});

const { access_token, refresh_token } = await registerResponse.json();

// Get current user
const meResponse = await fetch('http://localhost:3000/api/auth/me', {
  headers: { 'Authorization': `Bearer ${access_token}` }
});

const user = await meResponse.json();
console.log(user);

// Refresh token
const refreshResponse = await fetch('http://localhost:3000/api/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token })
});

const { access_token: newAccessToken } = await refreshResponse.json();

// Logout
await fetch('http://localhost:3000/api/auth/logout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${access_token}`
  },
  body: JSON.stringify({ refresh_token })
});
```

---

## Health Check

**GET** `/health`

Check if the server is running.

**Request:**
```bash
curl http://localhost:3000/health
```

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "environment": "development"
}
```

---

## Support

For issues or questions:
1. Check the error code in the response
2. Review the AUTHENTICATION_IMPLEMENTATION.md for detailed documentation
3. Check logs in `logs/error.log` for server-side errors
4. Ensure Redis and PostgreSQL are running
5. Verify environment variables are set correctly

---

**Last Updated**: 2024-01-15
**API Version**: 1.0
