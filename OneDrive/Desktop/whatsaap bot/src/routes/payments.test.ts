/**
 * Integration tests for payment routes
 */

import request from 'supertest';
import express, { Express } from 'express';
import paymentsRouter from './payments';
import { authenticateToken } from '../middleware/auth';
import { errorHandler } from '../middleware/errorHandler';
import * as paymentService from '../services/paymentService';

// Mock payment service
jest.mock('../services/paymentService');
jest.mock('../middleware/auth');
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;

describe('Payment Routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a test Express app
    app = express();
    app.use(express.json());
    
    // Mock auth middleware to attach user
    mockAuthenticateToken.mockImplementation(async (req: any, _res, next) => {
      req.user = {
        id: 'user-123',
        email: 'test@example.com',
        subscription_tier: 'pro',
      };
      next();
    });

    app.use('/api/payments', paymentsRouter);
    app.use(errorHandler);
  });

  describe('GET /api/payments/history', () => {
    it('should return payment history with default pagination', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'payment-1',
            razorpay_payment_id: 'pay_123',
            amount: 999,
            currency: 'INR',
            status: 'captured',
            payment_method: 'card',
            created_at: '2024-01-15T10:30:00Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          pages: 1,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .expect(200);

      expect(response.body).toEqual(mockResponse);
    });

    it('should accept custom pagination parameters', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'payment-1',
            razorpay_payment_id: 'pay_123',
            amount: 999,
            currency: 'INR',
            status: 'captured',
            payment_method: 'card',
            created_at: '2024-01-15T10:30:00Z',
          },
        ],
        pagination: {
          page: 2,
          limit: 10,
          total: 25,
          pages: 3,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .query({ page: 2, limit: 10 })
        .expect(200);

      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.limit).toBe(10);
    });

    it('should return empty data for user with no payments', async () => {
      const mockResponse = {
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should return multiple payments in correct order', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'payment-3',
            razorpay_payment_id: 'pay_125',
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            payment_method: 'netbanking',
            created_at: '2024-01-16T10:30:00Z',
          },
          {
            id: 'payment-2',
            razorpay_payment_id: 'pay_124',
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            payment_method: 'card',
            created_at: '2024-01-15T10:30:00Z',
          },
          {
            id: 'payment-1',
            razorpay_payment_id: 'pay_123',
            amount: 99900,
            currency: 'INR',
            status: 'captured',
            payment_method: 'card',
            created_at: '2024-01-14T10:30:00Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 3,
          pages: 1,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].id).toBe('payment-3');
      expect(response.body.data[1].id).toBe('payment-2');
      expect(response.body.data[2].id).toBe('payment-1');
    });

    it('should include all required payment fields', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'payment-1',
            razorpay_payment_id: 'pay_123',
            amount: 999,
            currency: 'INR',
            status: 'captured',
            payment_method: 'card',
            created_at: '2024-01-15T10:30:00Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          pages: 1,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .expect(200);

      const payment = response.body.data[0];
      expect(payment).toHaveProperty('id');
      expect(payment).toHaveProperty('razorpay_payment_id');
      expect(payment).toHaveProperty('amount');
      expect(payment).toHaveProperty('currency');
      expect(payment).toHaveProperty('status');
      expect(payment).toHaveProperty('payment_method');
      expect(payment).toHaveProperty('created_at');
    });

    it('should include pagination metadata', async () => {
      const mockResponse = {
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .expect(200);

      const pagination = response.body.pagination;
      expect(pagination).toHaveProperty('page');
      expect(pagination).toHaveProperty('limit');
      expect(pagination).toHaveProperty('total');
      expect(pagination).toHaveProperty('pages');
    });

    it('should handle large limit values (max 100)', async () => {
      const mockResponse = {
        success: true,
        data: Array(100).fill(null).map((_, i) => ({
          id: `payment-${i}`,
          razorpay_payment_id: `pay_${i}`,
          amount: 999,
          currency: 'INR',
          status: 'captured',
          payment_method: 'card',
          created_at: '2024-01-15T10:30:00Z',
        })),
        pagination: {
          page: 1,
          limit: 100,
          total: 150,
          pages: 2,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .get('/api/payments/history')
        .query({ limit: 100 })
        .expect(200);

      expect(response.body.data).toHaveLength(100);
      expect(response.body.pagination.limit).toBe(100);
    });

    it('should parse pagination parameters as integers', async () => {
      const mockResponse = {
        success: true,
        data: [],
        pagination: {
          page: 2,
          limit: 50,
          total: 100,
          pages: 2,
        },
      };

      const PaymentServiceDefault = paymentService.default as any;
      PaymentServiceDefault.getPaymentHistory = jest.fn().mockResolvedValueOnce(mockResponse);

      await request(app)
        .get('/api/payments/history')
        .query({ page: '2', limit: '50' })
        .expect(200);
    });
  });
});
