# Task 3.11: Message Retrieval Endpoints Implementation

## Overview
Successfully implemented two RESTful endpoints for retrieving conversation messages with pagination, filtering, and sorting capabilities. These endpoints allow authenticated users to view message history from conversations associated with their bots.

## Endpoints Implemented

### 1. GET /api/bots/:botId/conversations
**Purpose**: List all conversations for a specific bot with pagination and filtering

**Authentication**: Required (JWT token via `Authorization` header)

**Request Parameters**:
- `botId` (path parameter, required): UUID of the bot
- `page` (query parameter, optional): Page number (default: 1, min: 1)
- `limit` (query parameter, optional): Items per page (default: 20, min: 1, max: 100)
- `status` (query parameter, optional): Filter by status ('active', 'archived', 'closed')

**Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "botId": "uuid",
      "userPhoneNumber": "+1234567890",
      "userName": "John Doe",
      "userAvatarUrl": "https://...",
      "messageCount": 15,
      "lastMessageAt": "2024-01-15T10:30:00Z",
      "status": "active",
      "createdAt": "2024-01-15T09:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
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

**Error Responses**:
- `400 Bad Request`: Invalid pagination parameters or invalid status filter
- `404 Not Found`: Bot not found or user doesn't own the bot
- `401 Unauthorized`: Missing or invalid authentication token

### 2. GET /api/bots/:botId/conversations/:conversationId/messages
**Purpose**: Retrieve messages from a specific conversation with pagination and sorting

**Authentication**: Required (JWT token via `Authorization` header)

**Request Parameters**:
- `botId` (path parameter, required): UUID of the bot
- `conversationId` (path parameter, required): UUID of the conversation
- `page` (query parameter, optional): Page number (default: 1, min: 1)
- `limit` (query parameter, optional): Messages per page (default: 50, min: 1, max: 500)
- `sortBy` (query parameter, optional): Sort field ('createdAt' or 'status', default: 'createdAt')
- `sortOrder` (query parameter, optional): Sort direction ('asc' or 'desc', default: 'asc')

**Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "botId": "uuid",
      "senderType": "user",
      "senderPhoneNumber": "+1234567890",
      "senderName": "John Doe",
      "messageText": "Hello bot, how are you?",
      "messageType": "text",
      "mediaUrl": null,
      "mediaType": null,
      "whatsappMessageId": "wamid.xyz",
      "status": "delivered",
      "errorMessage": null,
      "processingTimeMs": null,
      "tokensUsed": null,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "uuid",
      "conversationId": "uuid",
      "botId": "uuid",
      "senderType": "bot",
      "senderPhoneNumber": null,
      "senderName": null,
      "messageText": "Hello! I'm doing great. How can I help?",
      "messageType": "text",
      "mediaUrl": null,
      "mediaType": null,
      "whatsappMessageId": "wamid.abc",
      "status": "sent",
      "errorMessage": null,
      "processingTimeMs": 1250,
      "tokensUsed": 45,
      "createdAt": "2024-01-15T10:30:05Z",
      "updatedAt": "2024-01-15T10:30:05Z"
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

**Error Responses**:
- `400 Bad Request`: Invalid pagination/sorting parameters or conversation doesn't belong to bot
- `404 Not Found`: Bot not found, conversation not found, or user doesn't own the bot
- `401 Unauthorized`: Missing or invalid authentication token

## Implementation Details

### Security Features
1. **Bot Ownership Verification**: Both endpoints verify that the authenticated user owns the bot before returning any data
2. **Conversation Association Check**: The message endpoint verifies that the conversation belongs to the specified bot
3. **Soft Delete Protection**: Deleted conversations and messages are excluded from results

### Pagination Implementation
- **Default Parameters**: Page defaults to 1, limit defaults to 20 for conversations and 50 for messages
- **Boundary Checks**: Enforces min/max limits for all pagination parameters
- **Total Count**: Accurately calculates total number of records and total pages

### Sorting Capabilities
- **Default Sort**: Messages sorted by `createdAt` in ascending order (oldest first)
- **Flexible Sorting**: Supports sorting by `createdAt` or `status` in either ascending or descending order
- **Conversation Sort**: Conversations automatically sorted by `lastMessageAt` in descending order (newest first)

### Message Metadata Included
- **Standard Fields**: id, conversationId, botId, senderType, messageText, messageType, status, createdAt, updatedAt
- **Sender Information**: senderPhoneNumber, senderName (from WhatsApp payload)
- **WhatsApp Integration**: whatsappMessageId for tracking in WhatsApp API
- **AI Processing Metrics**: processingTimeMs and tokensUsed for bot messages
- **Media Support**: mediaUrl and mediaType for media messages
- **Error Tracking**: errorMessage for failed message processing

### Error Handling
- Comprehensive validation of all input parameters
- Clear, descriptive error codes (INVALID_PAGINATION, CONVERSATION_BOT_MISMATCH, etc.)
- Proper HTTP status codes (400 for validation errors, 404 for not found, 401 for auth issues)
- Logging of all operations for debugging and monitoring

## Code Structure

### Files Modified
1. **src/routes/bots.ts**
   - Added two new route handlers
   - Integrated with existing bot ownership verification
   - Used ConversationService integration pattern
   - Followed existing error handling patterns

### Key Components Used
1. **Express Router**: Standard request/response handling
2. **Prisma ORM**: Database queries for conversations and messages
3. **Error Classes**: ValidationError, NotFoundError from utils/errors
4. **Logging**: Winston logger for operation tracking
5. **Async Handler**: asyncHandler middleware for error propagation

## Testing Scenarios Covered

### Endpoint 1: Conversations Listing
- ✅ Retrieve paginated list of conversations
- ✅ Filter conversations by status
- ✅ Validate pagination parameters
- ✅ Verify bot ownership protection
- ✅ Handle non-existent bot
- ✅ Calculate correct pagination metadata

### Endpoint 2: Message Retrieval
- ✅ Retrieve paginated list of messages
- ✅ Sort messages by createdAt (asc/desc)
- ✅ Sort messages by status
- ✅ Include message metadata (processing time, tokens)
- ✅ Verify bot ownership protection
- ✅ Verify conversation belongs to bot
- ✅ Validate all sorting parameters
- ✅ Handle non-existent conversation
- ✅ Exclude soft-deleted messages
- ✅ Include optional fields for media and error information

## Integration with Existing Code

### ConversationService
The implementation follows the existing `ConversationService` patterns:
- Uses `MessageResponse` interface defined in conversationService
- Follows same formatting approach (converting Prisma objects to response DTOs)
- Maintains consistency with existing message and conversation methods

### Bot Service
Leverages existing `verifyBotOwnership` and `getBotById` functions:
- Ensures user owns the bot before allowing access
- Maintains security boundaries across all endpoints
- Reuses existing validation patterns

### Error Handling
Consistent with existing error handling middleware:
- Throws `ValidationError` for input validation failures
- Throws `NotFoundError` for missing resources
- Uses `asyncHandler` for automatic error propagation

## API Usage Examples

### Example 1: Get First Page of Conversations
```bash
curl -X GET "http://localhost:3000/api/bots/bot-123/conversations?page=1&limit=20" \
  -H "Authorization: Bearer {jwt_token}"
```

### Example 2: Get Active Conversations Only
```bash
curl -X GET "http://localhost:3000/api/bots/bot-123/conversations?status=active&page=1&limit=20" \
  -H "Authorization: Bearer {jwt_token}"
```

### Example 3: Get Messages Sorted by Date (Newest First)
```bash
curl -X GET "http://localhost:3000/api/bots/bot-123/conversations/conv-456/messages?page=1&limit=50&sortOrder=desc" \
  -H "Authorization: Bearer {jwt_token}"
```

### Example 4: Get Messages Sorted by Status
```bash
curl -X GET "http://localhost:3000/api/bots/bot-123/conversations/conv-456/messages?page=1&limit=50&sortBy=status&sortOrder=asc" \
  -H "Authorization: Bearer {jwt_token}"
```

## Performance Considerations

### Database Queries
- Uses Prisma's `findMany` with optimized where clauses
- Implements skip/take for efficient pagination
- Counts total records in separate query for accurate pagination metadata
- Orders by `lastMessageAt` index for conversation sorting

### Scalability
- Pagination ensures constant memory usage regardless of total records
- Limit enforcement (500 messages max per request) prevents data overflow
- Efficient filtering using indexed database fields

## Future Enhancements
1. Add message search by content or date range
2. Add filtering by sender type (user/bot)
3. Add export functionality for message history
4. Implement message read receipts
5. Add real-time message updates via WebSockets

## Conclusion
The implementation successfully fulfills all requirements for Task 3.11, providing secure, paginated message retrieval with proper ownership verification, comprehensive error handling, and integration with existing codebase patterns.
