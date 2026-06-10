/**
 * Email Service Tests
 */

import sgMail from '@sendgrid/mail';
import { sendEmail, sendInvoiceEmail, sendPaymentConfirmationEmail } from './emailService';

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn(),
}));

jest.mock('../config/environment', () => ({
  sendgridApiKey: 'test-api-key',
  sendgridFromEmail: 'noreply@test.com',
  companyName: 'TestCorp',
  companyEmail: 'support@test.com',
  companyWebsite: 'https://test.com',
}));

jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('EmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test Content</p>',
      });

      expect(result).toBe(true);
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should handle email sending errors', async () => {
      (sgMail.send as jest.Mock).mockRejectedValueOnce(new Error('Send failed'));

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test Content</p>',
      });

      expect(result).toBe(false);
    });

    it('should include attachments if provided', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      const attachment = Buffer.from('test content');

      await sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test</p>',
        attachments: [
          {
            filename: 'test.pdf',
            content: attachment,
            type: 'application/pdf',
          },
        ],
      });

      expect(sgMail.send).toHaveBeenCalled();
    });
  });

  describe('sendInvoiceEmail', () => {
    it('should send invoice email with correct subject', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await sendInvoiceEmail('user@example.com', 'John Doe', {
        invoiceNumber: 'INV-00001',
        issueDate: '2024-01-15',
        dueDate: '2024-02-14',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
      });

      expect(sgMail.send).toHaveBeenCalled();
      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.subject).toContain('Invoice');
    });

    it('should include invoice details in HTML content', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await sendInvoiceEmail('user@example.com', 'John Doe', {
        invoiceNumber: 'INV-00001',
        issueDate: '2024-01-15',
        dueDate: '2024-02-14',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
      });

      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.html).toContain('INV-00001');
      expect(call.html).toContain('Pro Plan');
    });

    it('should attach PDF if provided', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      const pdfBuffer = Buffer.from('fake pdf content');

      await sendInvoiceEmail(
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
        pdfBuffer
      );

      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.attachments).toBeDefined();
      expect(call.attachments[0].filename).toBe('INV-00001.pdf');
    });

    it('should format INR currency correctly', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await sendInvoiceEmail('user@example.com', 'John Doe', {
        invoiceNumber: 'INV-00001',
        issueDate: '2024-01-15',
        dueDate: '2024-02-14',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
      });

      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.html).toContain('₹999');
    });
  });

  describe('sendPaymentConfirmationEmail', () => {
    it('should send payment confirmation email', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      const result = await sendPaymentConfirmationEmail('user@example.com', 'John Doe', {
        paymentId: 'pay-123',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
        paymentMethod: 'card',
      });

      expect(result).toBe(true);
    });

    it('should include success message in subject', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await sendPaymentConfirmationEmail('user@example.com', 'John Doe', {
        paymentId: 'pay-123',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
        paymentMethod: 'card',
      });

      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.subject).toContain('Payment Confirmation');
    });

    it('should include payment details in content', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await sendPaymentConfirmationEmail('user@example.com', 'John Doe', {
        paymentId: 'pay-123',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
        paymentMethod: 'card',
      });

      const call = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(call.html).toContain('pay-123');
      expect(call.html).toContain('Pro Plan');
      expect(call.html).toContain('card');
    });

    it('should handle payment sending failure gracefully', async () => {
      (sgMail.send as jest.Mock).mockRejectedValueOnce(new Error('Send failed'));

      const result = await sendPaymentConfirmationEmail('user@example.com', 'John Doe', {
        paymentId: 'pay-123',
        amount: 999,
        currency: 'INR',
        planName: 'Pro Plan',
        paymentMethod: 'card',
      });

      expect(result).toBe(false);
    });
  });
});
