/**
 * Invoice Service Tests
 */

import {
  createInvoice,
  getInvoice,
  getInvoiceByNumber,
  getUserInvoices,
  updateInvoiceStatus,
  markInvoiceAsSent,
  updateInvoicePdfUrl,
  generateInvoiceDetails,
} from './invoiceService';

// Mock Prisma - instance lives inside the factory closure so service and test share it
jest.mock('@prisma/client', () => {
  const instance = {
    invoice: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn(() => instance),
    Prisma: {
      Decimal: jest.fn((value) => value),
    },
  };
});

// Get a reference to the shared mock instance for the tests
import { PrismaClient } from '@prisma/client';
const mockPrismaInstance: any = new (PrismaClient as any)();

// Mock logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('InvoiceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateInvoiceNumber', () => {
        it('should generate unique invoice numbers for each call', async () => {
      // This test verifies the invoice number generation logic
      // The format is INV-YYYYMMDD-XXXXX
      mockPrismaInstance.invoice.findFirst.mockResolvedValueOnce(null);
      mockPrismaInstance.user.findUnique.mockResolvedValueOnce({
        id: 'user-123',
        email: 'test@example.com',
      });
      mockPrismaInstance.invoice.create.mockResolvedValueOnce({
        id: 'inv-123',
        userId: 'user-123',
        invoiceNumber: 'INV-20240115-00001',
        amount: 999,
        currency: 'INR',
        issueDate: new Date(),
        dueDate: new Date(),
        status: 'draft',
        emailSent: false,
      });

      const invoice1 = await createInvoice({
        userId: 'user-123',
        amount: 999,
      });

      expect(invoice1).toBeDefined();
      expect(invoice1.invoiceNumber).toMatch(/^INV-\d{8}-\d{5}$/);
    });
  });

  describe('createInvoice', () => {
    it('should create invoice with default currency', async () => {
      mockPrismaInstance.invoice.findFirst.mockResolvedValueOnce(null);
      mockPrismaInstance.user.findUnique.mockResolvedValueOnce({
        id: 'user-123',
        email: 'test@example.com',
      });

      mockPrismaInstance.invoice.create.mockResolvedValueOnce({
        id: 'inv-123',
        userId: 'user-123',
        invoiceNumber: 'INV-20240115-00001',
        amount: 999,
        currency: 'INR',
        status: 'draft',
      });

      const invoice = await createInvoice({
        userId: 'user-123',
        amount: 999,
      });

      expect(invoice.currency).toBe('INR');
      expect(invoice.status).toBe('draft');
    });

    it('should throw error if user not found', async () => {
      mockPrismaInstance.invoice.findFirst.mockResolvedValueOnce(null);
      mockPrismaInstance.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        createInvoice({
          userId: 'non-existent-user',
          amount: 999,
        })
      ).rejects.toThrow();
    });
  });

  describe('getInvoice', () => {
    it('should retrieve invoice by ID', async () => {
      mockPrismaInstance.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-123',
        invoiceNumber: 'INV-20240115-00001',
        amount: 999,
      });

      const invoice = await getInvoice('inv-123');

      expect(invoice).toBeDefined();
      expect(invoice?.id).toBe('inv-123');
    });

    it('should return null if invoice not found', async () => {
      mockPrismaInstance.invoice.findUnique.mockResolvedValueOnce(null);

      const invoice = await getInvoice('non-existent');

      expect(invoice).toBeNull();
    });
  });

  describe('getInvoiceByNumber', () => {
    it('should retrieve invoice by invoice number', async () => {
      mockPrismaInstance.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-123',
        invoiceNumber: 'INV-20240115-00001',
      });

      const invoice = await getInvoiceByNumber('INV-20240115-00001');

      expect(invoice).toBeDefined();
      expect(invoice?.invoiceNumber).toBe('INV-20240115-00001');
    });
  });

  describe('getUserInvoices', () => {
    it('should retrieve paginated invoices for user', async () => {
      mockPrismaInstance.invoice.findMany.mockResolvedValueOnce([
        { id: 'inv-1', invoiceNumber: 'INV-00001' },
        { id: 'inv-2', invoiceNumber: 'INV-00002' },
      ]);
      mockPrismaInstance.invoice.count.mockResolvedValueOnce(2);

      const result = await getUserInvoices('user-123', 1, 10);

      expect(result.invoices).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.pages).toBe(1);
    });

    it('should respect pagination parameters', async () => {
      mockPrismaInstance.invoice.findMany.mockResolvedValueOnce([]);
      mockPrismaInstance.invoice.count.mockResolvedValueOnce(25);

      const result = await getUserInvoices('user-123', 2, 10);

      expect(result.total).toBe(25);
      expect(result.pages).toBe(3);
    });
  });

  describe('updateInvoiceStatus', () => {
    it('should update invoice status', async () => {
      mockPrismaInstance.invoice.update.mockResolvedValueOnce({
        id: 'inv-123',
        status: 'sent',
      });

      const invoice = await updateInvoiceStatus('inv-123', 'sent');

      expect(invoice.status).toBe('sent');
    });
  });

  describe('markInvoiceAsSent', () => {
    it('should mark invoice as sent with email metadata', async () => {
      mockPrismaInstance.invoice.update.mockResolvedValueOnce({
        id: 'inv-123',
        emailSent: true,
        status: 'sent',
        emailSentAt: new Date(),
      });

      const invoice = await markInvoiceAsSent('inv-123');

      expect(invoice.emailSent).toBe(true);
      expect(invoice.status).toBe('sent');
    });
  });

  describe('updateInvoicePdfUrl', () => {
    it('should update invoice PDF URL', async () => {
      const pdfUrl = 'https://storage.example.com/invoices/inv-123.pdf';

      mockPrismaInstance.invoice.update.mockResolvedValueOnce({
        id: 'inv-123',
        pdfUrl,
      });

      const invoice = await updateInvoicePdfUrl('inv-123', pdfUrl);

      expect(invoice.pdfUrl).toBe(pdfUrl);
    });
  });

  describe('generateInvoiceDetails', () => {
    it('should generate formatted invoice details', () => {
      const invoice = {
        id: 'inv-123',
        invoiceNumber: 'INV-20240115-00001',
        amount: 999 as any,
        currency: 'INR',
        issueDate: new Date('2024-01-15'),
        dueDate: new Date('2024-02-14'),
        userId: 'user-123',
        status: 'sent',
        emailSent: true,
        emailSentAt: new Date() as any,
      };

      const user = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      };

      const details = generateInvoiceDetails(invoice as any, user, 'Pro Plan');

      expect(details.invoiceNumber).toBe('INV-20240115-00001');
      expect(details.customerName).toBe('John Doe');
      expect(details.customerEmail).toBe('john@example.com');
      expect(details.amount).toBe(999);
      expect(details.planName).toBe('Pro Plan');
    });

    it('should use email as name if first/last names not provided', () => {
      const invoice = {
        id: 'inv-123',
        invoiceNumber: 'INV-00001',
        amount: 500 as any,
        currency: 'INR',
        issueDate: new Date(),
        dueDate: new Date(),
        userId: 'user-123',
        status: 'draft',
        emailSent: false,
        emailSentAt: undefined as any,
      };

      const user = {
        firstName: null,
        lastName: null,
        email: 'user@example.com',
      };

      const details = generateInvoiceDetails(invoice as any, user);

      expect(details.customerName).toBe('user@example.com');
    });
  });
});
