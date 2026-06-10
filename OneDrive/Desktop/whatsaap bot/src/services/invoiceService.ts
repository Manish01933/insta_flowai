/**
 * Invoice Service
 * Handles invoice generation and management
 */

import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../config/logger';

const prisma = new PrismaClient();

export interface CreateInvoiceParams {
  userId: string;
  subscriptionId?: string;
  paymentId?: string;
  amount: number;
  currency?: string;
  planName?: string;
  paymentMethod?: string;
}

export interface Invoice {
  id: string;
  userId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  pdfUrl?: string;
  emailSent: boolean;
  emailSentAt?: Date;
}

/**
 * Generate a unique invoice number
 * Format: INV-YYYYMMDD-XXXXX (e.g., INV-20240115-00001)
 */
async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

  // Find the last invoice for today
  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: `INV-${dateStr}`,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  });

  let sequence = 1;
  if (lastInvoice) {
    // Extract sequence number from last invoice
    const parts = lastInvoice.invoiceNumber.split('-');
    const lastSequence = parseInt(parts[2], 10);
    sequence = lastSequence + 1;
  }

  const invoiceNumber = `INV-${dateStr}-${String(sequence).padStart(5, '0')}`;
  return invoiceNumber;
}

/**
 * Create an invoice for a payment
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  const {
    userId,
    subscriptionId,
    paymentId,
    amount,
    currency = 'INR',
  } = params;

  try {
    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Generate unique invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Calculate dates
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30); // 30 days due date

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        userId,
        subscriptionId,
        paymentId,
        invoiceNumber,
        amount: new Prisma.Decimal(amount),
        currency,
        issueDate,
        dueDate,
        status: 'draft',
        emailSent: false,
      },
    });

    logger.info(`Invoice created: ${invoiceNumber}`, {
      invoiceId: invoice.id,
      userId,
      amount,
    });

    return invoice as unknown as Invoice;
  } catch (error: any) {
    logger.error(`Failed to create invoice: ${error.message}`, {
      userId,
      amount,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Get invoice by ID
 */
export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    return invoice as unknown as Invoice | null;
  } catch (error: any) {
    logger.error(`Failed to get invoice: ${error.message}`, {
      invoiceId,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Get invoice by invoice number
 */
export async function getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
    });

    return invoice as unknown as Invoice | null;
  } catch (error: any) {
    logger.error(`Failed to get invoice by number: ${error.message}`, {
      invoiceNumber,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Get user's invoices with pagination
 */
export async function getUserInvoices(
  userId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ invoices: Invoice[]; total: number; pages: number }> {
  try {
    const skip = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { userId },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.invoice.count({
        where: { userId },
      }),
    ]);

    const pages = Math.ceil(total / limit);

    return {
      invoices: invoices as unknown as Invoice[],
      total,
      pages,
    };
  } catch (error: any) {
    logger.error(`Failed to get user invoices: ${error.message}`, {
      userId,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Update invoice status
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: string
): Promise<Invoice> {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status },
    });

    logger.info(`Invoice status updated: ${invoiceId}`, {
      status,
    });

    return invoice as unknown as Invoice;
  } catch (error: any) {
    logger.error(`Failed to update invoice status: ${error.message}`, {
      invoiceId,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Mark invoice as sent (email)
 */
export async function markInvoiceAsSent(invoiceId: string): Promise<Invoice> {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        emailSent: true,
        emailSentAt: new Date(),
        status: 'sent',
      },
    });

    logger.info(`Invoice marked as sent: ${invoiceId}`, {
      invoiceNumber: invoice.invoiceNumber,
    });

    return invoice as unknown as Invoice;
  } catch (error: any) {
    logger.error(`Failed to mark invoice as sent: ${error.message}`, {
      invoiceId,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Update invoice PDF URL
 */
export async function updateInvoicePdfUrl(
  invoiceId: string,
  pdfUrl: string
): Promise<Invoice> {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl },
    });

    logger.info(`Invoice PDF URL updated: ${invoiceId}`, {
      pdfUrl,
    });

    return invoice as unknown as Invoice;
  } catch (error: any) {
    logger.error(`Failed to update invoice PDF URL: ${error.message}`, {
      invoiceId,
      error: error.stack,
    });
    throw error;
  }
}

/**
 * Generate invoice details object for email templates
 */
export function generateInvoiceDetails(
  invoice: Invoice,
  user: any,
  planName: string = 'BotBazaar Subscription'
) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toLocaleDateString('en-IN'),
    dueDate: invoice.dueDate.toLocaleDateString('en-IN'),
    customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    customerEmail: user.email,
    amount: parseFloat(invoice.amount.toString()),
    currency: invoice.currency,
    planName,
    invoiceUrl: `/invoices/${invoice.id}`,
  };
}

// Re-export Prisma for use in other modules
export { PrismaClient, Prisma } from '@prisma/client';
