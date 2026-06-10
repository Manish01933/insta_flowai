/**
 * Payment Service
 * Handles payment processing, tracking, and management
 */

import { PrismaClient } from '@prisma/client';
import { PaymentStatus, PaymentResponseDTO } from '../types/subscription';
import { PaymentCreateDTO, PaymentUpdateDTO } from '../types/payment';
import logger from '../config/logger';

const prisma = new PrismaClient();

export class PaymentService {
  /**
   * Create a new payment record
   */
  async createPayment(data: PaymentCreateDTO): Promise<PaymentResponseDTO> {
    try {
      const payment = await prisma.payment.create({
        data: {
          userId: data.userId,
          subscriptionId: data.subscriptionId,
          razorpayPaymentId: data.razorpayPaymentId,
          razorpayOrderId: data.razorpayOrderId,
          amount: data.amount,
          currency: data.currency,
          status: data.status || PaymentStatus.PENDING,
          paymentMethod: data.paymentMethod,
          errorMessage: data.errorMessage,
        },
      });

      logger.info(`Payment created for user ${data.userId}: ${payment.id}`);

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error creating payment: ${error}`);
      throw error;
    }
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(paymentId: string): Promise<PaymentResponseDTO | null> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        return null;
      }

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error getting payment: ${error}`);
      throw error;
    }
  }

  /**
   * Get payment by Razorpay payment ID
   */
  async getPaymentByRazorpayId(razorpayPaymentId: string): Promise<PaymentResponseDTO | null> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { razorpayPaymentId },
      });

      if (!payment) {
        return null;
      }

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error getting payment by Razorpay ID: ${error}`);
      throw error;
    }
  }

  /**
   * Get all payments for a user
   */
  async getPaymentsByUserId(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ payments: PaymentResponseDTO[]; total: number }> {
    try {
      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: { userId },
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.payment.count({ where: { userId } }),
      ]);

      return {
        payments: payments.map((payment) => this.mapPaymentToDTO(payment)),
        total,
      };
    } catch (error) {
      logger.error(`Error getting user payments: ${error}`);
      throw error;
    }
  }

  /**
   * Get payments by status
   */
  async getPaymentsByStatus(
    status: PaymentStatus,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ payments: PaymentResponseDTO[]; total: number }> {
    try {
      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: { status },
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.payment.count({ where: { status } }),
      ]);

      return {
        payments: payments.map((payment) => this.mapPaymentToDTO(payment)),
        total,
      };
    } catch (error) {
      logger.error(`Error getting payments by status: ${error}`);
      throw error;
    }
  }

  /**
   * Get payments for a subscription
   */
  async getPaymentsBySubscriptionId(
    subscriptionId: string
  ): Promise<PaymentResponseDTO[]> {
    try {
      const payments = await prisma.payment.findMany({
        where: { subscriptionId },
        orderBy: { createdAt: 'desc' },
      });

      return payments.map((payment) => this.mapPaymentToDTO(payment));
    } catch (error) {
      logger.error(`Error getting subscription payments: ${error}`);
      throw error;
    }
  }

  /**
   * Update payment status
   */
  async updatePayment(
    paymentId: string,
    data: PaymentUpdateDTO
  ): Promise<PaymentResponseDTO> {
    try {
      const payment = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: data.status,
          razorpayPaymentId: data.razorpayPaymentId,
          errorMessage: data.errorMessage,
        },
      });

      logger.info(`Payment updated: ${paymentId}`);

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error updating payment: ${error}`);
      throw error;
    }
  }

  /**
   * Mark payment as captured
   */
  async capturePayment(paymentId: string): Promise<PaymentResponseDTO> {
    try {
      const payment = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.CAPTURED },
      });

      logger.info(`Payment captured: ${paymentId}`);

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error capturing payment: ${error}`);
      throw error;
    }
  }

  /**
   * Mark payment as failed
   */
  async failPayment(paymentId: string, errorMessage: string): Promise<PaymentResponseDTO> {
    try {
      const payment = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          errorMessage,
        },
      });

      logger.info(`Payment failed: ${paymentId}`);

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error failing payment: ${error}`);
      throw error;
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(paymentId: string): Promise<PaymentResponseDTO> {
    try {
      const payment = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.REFUNDED },
      });

      logger.info(`Payment refunded: ${paymentId}`);

      return this.mapPaymentToDTO(payment);
    } catch (error) {
      logger.error(`Error refunding payment: ${error}`);
      throw error;
    }
  }

  /**
   * Get total revenue for a date range
   */
  async getTotalRevenue(
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      const result = await prisma.payment.aggregate({
        where: {
          status: PaymentStatus.CAPTURED,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _sum: { amount: true },
      });

      return result._sum.amount ? Number(result._sum.amount) : 0;
    } catch (error) {
      logger.error(`Error calculating revenue: ${error}`);
      throw error;
    }
  }

  /**
   * Get payment count by status
   */
  async getPaymentCountByStatus(): Promise<Record<string, number>> {
    try {
      const statuses = Object.values(PaymentStatus);
      const counts: Record<string, number> = {};

      for (const status of statuses) {
        const count = await prisma.payment.count({
          where: { status },
        });
        counts[status] = count;
      }

      return counts;
    } catch (error) {
      logger.error(`Error getting payment counts: ${error}`);
      throw error;
    }
  }

  /**
   * Get payment history for user with pagination (for API endpoint)
   */
  async getPaymentHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    success: boolean;
    data: Array<{
      id: string;
      razorpay_payment_id: string | null;
      amount: number;
      currency: string;
      status: string;
      payment_method: string | null;
      created_at: string;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    try {
      // Validate pagination parameters
      if (!Number.isInteger(page) || page < 1) {
        throw new Error('Page must be an integer >= 1');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Limit must be an integer between 1 and 100');
      }

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Calculate skip value for pagination
      const skip = (page - 1) * limit;

      // Get total count of payments for this user
      const total = await prisma.payment.count({
        where: { userId },
      });

      // Get paginated payments ordered by creation date (newest first)
      const payments = await prisma.payment.findMany({
        where: { userId },
        select: {
          id: true,
          razorpayPaymentId: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      });

      // Format payment records
      const data = payments.map((payment) => ({
        id: payment.id,
        razorpay_payment_id: payment.razorpayPaymentId,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
        payment_method: payment.paymentMethod,
        created_at: payment.createdAt.toISOString(),
      }));

      // Calculate total pages
      const totalPages = Math.ceil(total / limit);

      logger.info(`Retrieved payment history for user ${userId}: page ${page}, limit ${limit}, total ${total}`);

      return {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      };
    } catch (error: any) {
      logger.error(`Error retrieving payment history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Map Prisma payment to DTO
   */
  private mapPaymentToDTO(payment: any): PaymentResponseDTO {
    return {
      id: payment.id,
      userId: payment.userId,
      subscriptionId: payment.subscriptionId,
      razorpayPaymentId: payment.razorpayPaymentId,
      razorpayOrderId: payment.razorpayOrderId,
      amount: payment.amount.toNumber?.() || Number(payment.amount),
      currency: payment.currency,
      status: payment.status as PaymentStatus,
      paymentMethod: payment.paymentMethod,
      errorMessage: payment.errorMessage,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}

export default new PaymentService();
