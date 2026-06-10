/**
 * Unit tests for JWT utilities
 */

import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
} from './jwt';
import { AuthError } from './errors';
import jwt from 'jsonwebtoken';

jest.mock('jsonwebtoken');

describe('JWT Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateAccessToken', () => {
    it('should generate valid access token', () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        subscription_tier: 'pro',
      };

      (jwt.sign as jest.Mock).mockReturnValue('access_token_xyz');

      const token = generateAccessToken(payload);

      expect(token).toBe('access_token_xyz');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          ...payload,
          iss: 'botbazaar',
        }),
        expect.any(String),
        expect.objectContaining({
          expiresIn: expect.any(Number),
          algorithm: 'HS256',
        })
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate valid refresh token', () => {
      const userId = 'user-123';

      (jwt.sign as jest.Mock).mockReturnValue('refresh_token_xyz');

      const token = generateRefreshToken(userId);

      expect(token).toBe('refresh_token_xyz');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: userId,
          type: 'refresh',
          iss: 'botbazaar',
        }),
        expect.any(String),
        expect.objectContaining({
          expiresIn: expect.any(Number),
          algorithm: 'HS256',
        })
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify valid access token', () => {
      const token = 'valid_access_token';
      const decoded = {
        sub: 'user-123',
        email: 'test@example.com',
        subscription_tier: 'pro',
        iss: 'botbazaar',
      };

      (jwt.verify as jest.Mock).mockReturnValue(decoded);

      const result = verifyAccessToken(token);

      expect(result).toEqual(decoded);
      expect(jwt.verify).toHaveBeenCalledWith(
        token,
        expect.any(String),
        expect.objectContaining({
          algorithms: ['HS256'],
          issuer: 'botbazaar',
        })
      );
    });

    it('should throw error for expired token', () => {
      const token = 'expired_token';
      const error = new Error('Token expired');
      (error as any).name = 'TokenExpiredError';

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      expect(() => verifyAccessToken(token)).toThrow(AuthError);
    });

    it('should throw error for invalid token', () => {
      const token = 'invalid_token';
      const error = new Error('Invalid token');
      (error as any).name = 'JsonWebTokenError';

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw error;
      });

      expect(() => verifyAccessToken(token)).toThrow(AuthError);
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token', () => {
      const token = 'valid_refresh_token';
      const decoded = {
        sub: 'user-123',
        type: 'refresh',
        iss: 'botbazaar',
      };

      (jwt.verify as jest.Mock).mockReturnValue(decoded);

      const result = verifyRefreshToken(token);

      expect(result).toEqual(decoded);
    });

    it('should throw error for invalid token type', () => {
      const token = 'invalid_type_token';
      const decoded = {
        sub: 'user-123',
        type: 'access',
        iss: 'botbazaar',
      };

      (jwt.verify as jest.Mock).mockReturnValue(decoded);

      expect(() => verifyRefreshToken(token)).toThrow(AuthError);
    });
  });

  describe('generateTokenPair', () => {
    it('should generate both access and refresh tokens', () => {
      const userId = 'user-123';
      const email = 'test@example.com';
      const subscriptionTier = 'pro';

      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('access_token')
        .mockReturnValueOnce('refresh_token');

      const result = generateTokenPair(userId, email, subscriptionTier);

      expect(result.accessToken).toBe('access_token');
      expect(result.refreshToken).toBe('refresh_token');
      expect(typeof result.expiresIn).toBe('number');
      expect(result.expiresIn).toBeGreaterThan(0);
    });
  });
});
