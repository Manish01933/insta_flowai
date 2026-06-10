/**
 * Unit tests for payment service - getPaymentHistory method
 */

import { PrismaClient } from '@prisma/client';
import PaymentService from './paymentService';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    payment: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

const prisma = new PrismaClient();

describe('PaymentService.getPaymentHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return payment history with default pagination', async () => {
    const userId = 'user-123';
    const mockUser = { id: userId };
    const mockPayments = [
      {
        id: 'payment-1',
        razorpayPaymentId: 'pay_123',
        amount: 99900n,
        currency: 'INR',
        status: 'captured',
        paymentMethod: 'card',
        createdAt: new Date('2024-01-15T10:30:00Z'),
      },
      {
        id: 'payment-2',
        razorpayPaymentId: 'pay_124',
        amount: 49900n,
        currency: 'INR',
        status: 'captured',
        paymentMethod: 'netbanking',
        createdAt: new Date('2024-01-14T10:30:00Z'),
      },
    ];

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
    (prisma.payment.count as jest.Mock).mockResolvedValueOnce(2);
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce(mockPayments);

    const result = await PaymentService.getPaymentHistory(userId);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('payment-1');
    expect(result.data[0].razorpay_payment_id).toBe('pay_123');
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.pages).toBe(1);
  });

  it('should return payment history with custom pagination', async () => {
    const userId = 'user-123';
    const mockUser = { id: userId };
    const mockPayments = [
      {
        id: 'payment-1',
        razorpayPaymentId: 'pay_123',
        amount: 99900n,
        currency: 'INR',
        status: 'captured',
        paymentMethod: 'card',
        createdAt: new Date('2024-01-15T10:30:00Z'),
      },
    ];

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
    (prisma.payment.count as jest.Mock).mockResolvedValueOnce(25);
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce(mockPayments);

    const result = await PaymentService.getPaymentHistory(userId, 2, 10);

    expect(result.pagination.page).toBe(2);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.pages).toBe(3);

    // Verify skip calculation
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10, // (page - 1) * limit = (2 - 1) * 10
        take: 10,
      })
    );
  });

  it('should order payments by creation date (newest first)', async () => {
    const userId = 'user-123';
    const mockUser = { id: userId };

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
    (prisma.payment.count as jest.Mock).mockResolvedValueOnce(0);
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

    await PaymentService.getPaymentHistory(userId);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: {
          createdAt: 'desc',
        },
      })
    );
  });

  it('should throw error for invalid page parameter (page < 1)', async () => {
    const userId = 'user-123';

    await expect(
      PaymentService.getPaymentHistory(userId, 0, 20)
    ).rejects.toThrow('Page must be an integer >= 1');
  });

  it('should throw error for invalid limit parameter (limit > 100)', async () => {
    const userId = 'user-123';

    await expect(
      PaymentService.getPaymentHistory(userId, 1, 101)
    ).rejects.toThrow('Limit must be an integer between 1 and 100');
  });

  it('should throw error for non-integer page parameter', async () => {
    const userId = 'user-123';

    await expect(
      PaymentService.getPaymentHistory(userId, 1.5 as any, 20)
    ).rejects.toThrow('Page must be an integer >= 1');
  });

  it('should throw error for non-existent user', async () => {
    const userId = 'user-nonexistent';

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      PaymentService.getPaymentHistory(userId)
    ).rejects.toThrow('User not found');
  });

  it('should format payment amounts as numbers', async () => {
    const userId = 'user-123';
    const mockUser = { id: userId };
    const mockPayments = [
      {
        id: 'payment-1',
        razorpayPaymentId: 'pay_123',
        amount: 5000n,
        currency: 'INR',
        status: 'captured',
        paymentMethod: 'card',
        createdAt: new Date('2024-01-15T10:30:00Z'),
      },
    ];

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
    (prisma.payment.count as jest.Mock).mockResolvedValueOnce(1);
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce(mockPayments);

    const result = await PaymentService.getPaymentHistory(userId);

    expect(result.data[0].amount).toBe(5000);
    expect(typeof result.data[0].amount).toBe('number');
  });

  it('should handle empty payment history', async () => {
    const userId = 'user-123';
    const mockUser = { id: userId };

    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
    (prisma.payment.count as jest.Mock).mockResolvedValueOnce(0);
    (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await PaymentService.getPaymentHistory(userId);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.pages).toBe(0);
  });
});
