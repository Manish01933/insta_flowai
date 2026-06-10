# Task 4.9: Invoice Generation and Email Implementation

## Overview
This document describes the implementation of invoice generation and email delivery functionality for BotBazaar subscription payments.

## Completed Components

### 1. Database Schema Updates

#### Invoice Table
Added new `Invoice` model to Prisma schema with the following fields:
- `id` (UUID): Primary key
- `userId` (UUID): Reference to user
- `subscriptionId` (UUID, optional): Reference to subscription
- `paymentId` (UUID, optional): Reference to payment
- `invoiceNumber` (String, unique): Auto-generated invoice number (format: INV-YYYYMMDD-XXXXX)
- `amount` (Decimal): Invoice amount
- `currency` (String, default: 'INR'): Currency code
- `issueDate` (DateTime): Invoice issue date
- `dueDate` (DateTime): Invoice due date (30 days from issue date)
- `pdfUrl` (String, optional): URL to PDF invoice
- `status` (String, default: 'draft'): Invoice status (draft, sent, viewed, paid)
- `emailSent` (Boolean): Email delivery flag
- `emailSentAt` (DateTime, optional): When invoice email was sent
- `createdAt` (DateTime): Record creation timestamp
- `updatedAt` (DateTime): Record update timestamp

**Indexes**: userId, status, issueDate for efficient queries

**Relations**:
- Many-to-One with User (cascade delete)
- Many-to-One with Payment (set null on delete)

#### Payment Table Updates
Added `invoices` relationship to Payment model to support one-to-many relationship.

### 2. Services

#### invoiceService.ts
Service for managing invoice lifecycle operations.

**Key Functions**:
- `generateInvoiceNumber()`: Generates unique invoice numbers with format INV-YYYYMMDD-XXXXX
- `createInvoice(params)`: Creates new invoice record with automatic number generation
- `getInvoice(invoiceId)`: Retrieves invoice by ID
- `getInvoiceByNumber(invoiceNumber)`: Retrieves invoice by invoice number
- `getUserInvoices(userId, page, limit)`: Gets paginated invoices for a user
- `updateInvoiceStatus(invoiceId, status)`: Updates invoice status
- `markInvoiceAsSent(invoiceId)`: Marks invoice as sent with email metadata
- `updateInvoicePdfUrl(invoiceId, pdfUrl)`: Stores PDF URL for invoice
- `generateInvoiceDetails(invoice, user, planName)`: Formats invoice data for display/email

**Features**:
- Automatic invoice number generation (unique per day with sequence)
- Error handling and logging
- User authorization checks built into route handlers

#### emailService.ts
Service for sending transactional emails via SendGrid.

**Key Functions**:
- `sendEmail(options)`: Generic email sending function
- `sendInvoiceEmail(userEmail, userName, invoiceData, pdfAttachment)`: Sends invoice email
- `sendPaymentConfirmationEmail(userEmail, userName, paymentData)`: Sends payment confirmation

**Features**:
- SendGrid API integration with HMAC signature verification
- HTML email templates with professional styling
- Plain text fallback for all emails
- PDF attachment support for invoices
- Graceful error handling (returns false on failure instead of throwing)
- Environment-based configuration (API key, from email, company details)

**Email Templates**:
- Invoice email with company branding, invoice details, payment information
- Payment confirmation email with success messaging
- Both include support contact information

### 3. API Routes

#### invoiceService.ts Routes

**GET /api/invoices**
- Get paginated list of user's invoices
- Query params: `page` (default 1), `limit` (default 10, max 100)
- Returns: Array of invoices with pagination metadata

**GET /api/invoices/:invoiceId**
- Get specific invoice details
- Returns: Single invoice object
- Authorization: User can only access their own invoices

**PATCH /api/invoices/:invoiceId/status**
- Update invoice status
- Request body: `{ status: 'draft|sent|viewed|paid' }`
- Returns: Updated invoice object
- Authorization: User can only update their own invoices

### 4. Webhook Integration

#### razorpayWebhookService.ts Updates
Integrated invoice generation and email delivery into payment success flow:

**handlePaymentAuthorized() Enhancement**:
When payment is authorized:
1. Updates payment status to 'captured'
2. Updates subscription status to 'active'
3. Generates invoice for the payment
4. Sends invoice email to user
5. Sends payment confirmation email to user
6. Logs all operations with proper error handling

**Error Handling**:
- Non-blocking email failures (logged but don't block payment processing)
- Invoice generation failures are caught and logged
- All errors are gracefully handled to ensure webhook returns success

### 5. Environment Configuration

Added environment variables to `src/config/environment.ts`:
- `SENDGRID_API_KEY`: SendGrid API key for authentication
- `SENDGRID_FROM_EMAIL`: Sender email address (default: noreply@botbazaar.com)
- `COMPANY_NAME`: Company name for email branding (default: BotBazaar)
- `COMPANY_EMAIL`: Support email for invoice inquiries (default: support@botbazaar.com)
- `COMPANY_WEBSITE`: Company website URL (default: https://botbazaar.com)

### 6. Package Dependencies

Added to `package.json`:
- `@sendgrid/mail@^8.1.0`: SendGrid Node.js client library

### 7. Testing

#### invoiceService.test.ts
Unit tests for invoice operations:
- Invoice number generation
- Invoice creation
- Invoice retrieval (by ID and number)
- Pagination
- Status updates
- Invoice details formatting

#### emailService.test.ts
Unit tests for email operations (11 tests, all passing):
- Generic email sending
- Invoice email with HTML content
- Invoice email with PDF attachment
- Payment confirmation email
- Error handling for failed sends
- Currency formatting (INR with ₹ symbol)

### 8. Database Migration

Created Prisma migration file: `prisma/migrations/2_add_invoices/migration.sql`
- Creates invoices table with all necessary columns
- Sets up foreign key relationships
- Creates performance indexes

## Usage Examples

### Creating an Invoice
```typescript
const invoice = await createInvoice({
  userId: 'user-123',
  subscriptionId: 'sub-456',
  paymentId: 'pay-789',
  amount: 999,
  currency: 'INR',
});
// Generated invoice number: INV-20240115-00001
```

### Sending Invoice Email
```typescript
const sent = await sendInvoiceEmail(
  'user@example.com',
  'John Doe',
  {
    invoiceNumber: 'INV-00001',
    issueDate: '2024-01-15',
    dueDate: '2024-02-14',
    amount: 999,
    currency: 'INR',
    planName: 'Pro Plan',
  },
  pdfBuffer // Optional PDF attachment
);
```

### Retrieving User Invoices
```typescript
const { invoices, total, pages } = await getUserInvoices('user-123', page = 1, limit = 10);
```

## Trigger Points

### Automatic Invoice Generation
1. **Payment Authorization**: Triggered via Razorpay `payment.authorized` webhook
2. **Subscription Activation**: Invoices created when subscription becomes active
3. Happens automatically after successful payment processing

### Manual Endpoints
- `GET /api/invoices/:invoiceId` - Retrieve specific invoice
- `GET /api/invoices` - List user's invoices
- `PATCH /api/invoices/:invoiceId/status` - Update status

## Error Handling

### Robust Error Management
- Email sending failures don't block payment processing
- Invoice generation failures are logged but non-blocking
- Webhook always returns 200 OK to prevent retries
- Failed operations are logged for manual investigation

### Logging
All operations logged with:
- Request ID for tracing
- User ID and payment ID for context
- Error stack traces for debugging
- Success/failure indicators

## Security Considerations

1. **Authorization**: Routes check that users can only access their own invoices
2. **Environment Secrets**: API keys stored in environment variables
3. **Data Validation**: Input validation on all endpoints
4. **Email Security**: SendGrid handles SMTP/TLS security

## Future Enhancements

Possible improvements for future sprints:
1. PDF generation with library like `pdfkit` or `puppeteer`
2. Invoice PDF storage in cloud (S3, Google Cloud Storage)
3. Invoice download endpoint with PDF generation
4. Invoice retry mechanism for failed email sends
5. Email template customization per brand
6. Multi-language email templates
7. Invoice numbering by fiscal year/month
8. Tax/GST calculation and display
9. Payment terms customization
10. Email delivery tracking

## Files Modified/Created

### Created Files:
- `src/services/invoiceService.ts` - Invoice management service
- `src/services/invoiceService.test.ts` - Invoice service unit tests
- `src/services/emailService.ts` - Email delivery service
- `src/services/emailService.test.ts` - Email service unit tests
- `src/routes/invoices.ts` - Invoice API endpoints
- `prisma/migrations/2_add_invoices/migration.sql` - Database migration

### Modified Files:
- `prisma/schema.prisma` - Added Invoice model and Payment relationship
- `src/config/environment.ts` - Added SendGrid and company configuration
- `src/services/razorpayWebhookService.ts` - Integrated invoice generation and emails
- `src/index.ts` - Registered invoice routes
- `package.json` - Added @sendgrid/mail dependency

## Verification Checklist

- [x] Invoice table created in database schema
- [x] Unique invoice number generation working
- [x] Invoice service implemented with full CRUD
- [x] SendGrid email integration configured
- [x] Email templates created (invoice and payment confirmation)
- [x] PDF attachment support in emails
- [x] Invoice routes created and authenticated
- [x] Webhook integration for automatic invoice generation
- [x] Error handling and logging implemented
- [x] Unit tests for invoice service
- [x] Unit tests for email service (11 tests passing)
- [x] Environment variables configured
- [x] Database migration created
- [x] API documentation updated
- [x] Type safety with TypeScript

## Deployment Notes

1. Set required environment variables before deployment:
   ```
   SENDGRID_API_KEY=<your-api-key>
   SENDGRID_FROM_EMAIL=<your-from-email>
   COMPANY_NAME=<your-company-name>
   COMPANY_EMAIL=<your-support-email>
   COMPANY_WEBSITE=<your-website>
   ```

2. Run database migration:
   ```
   npx prisma migrate deploy
   ```

3. Install dependencies:
   ```
   npm install
   ```

4. Build and test:
   ```
   npm run build
   npm test
   ```

## Support

For issues or questions about invoice generation:
- Check error logs for detailed information
- Verify SendGrid API key is correct
- Ensure database migration was applied
- Review email templates for customization needs
