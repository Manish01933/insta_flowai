/**
 * Unit tests for authentication service
 */
import { registerUser, loginUser, refreshAccessToken, logoutUser } from './authService';
import { ValidationError, AuthError, ConflictError } from '../utils/errors';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma';

// Mock Prisma using the shared prisma instance from ../utils/prisma
jest.mock('../utils/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock utilities
jest.mock('../utils/jwt');
jest.mock('../utils/tokenBlacklist');
jest.mock('bcrypt');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerUser', () => {
    it('should register a new user with valid input', async () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        first_name: 'John',
        last_name: 'Doe',
      };

      const mockUser = {
        id: 'user-123',
        email: input.email,
        passwordHash: 'hashed_password',
        firstName: input.first_name,
        lastName: input.last_name,
        subscriptionTier: 'free',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      (require('../utils/jwt').generateTokenPair as jest.Mock).mockReturnValue({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        expiresIn: 3600,
      });

      const result = await registerUser(input);

      expect(result.email).toBe(input.email);
      expect(result.access_token).toBe('access_token');
      expect(result.refresh_token).toBe('refresh_token');
    });

    it('should reject invalid email format', async () => {
      const input = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      };

      await expect(registerUser(input)).rejects.toThrow(ValidationError);
    });

    it('should reject weak password', async () => {
      const input = {
        email: 'test@example.com',
        password: 'weak',
      };

      await expect(registerUser(input)).rejects.toThrow(ValidationError);
    });

    it('should reject duplicate email', async () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-user' });

      await expect(registerUser(input)).rejects.toThrow(ConflictError);
    });
  });

  describe('loginUser', () => {
    it('should login user with valid credentials', async () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        id: 'user-123',
        email: input.email,
        passwordHash: 'hashed_password',
        isActive: true,
        subscriptionTier: 'free',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (require('../utils/jwt').generateTokenPair as jest.Mock).mockReturnValue({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        expiresIn: 3600,
      });

      const result = await loginUser(input);

      expect(result.email).toBe(input.email);
      expect(result.access_token).toBe('access_token');
    });

    it('should reject invalid credentials', async () => {
      const input = {
        email: 'test@example.com',
        password: 'WrongPassword123!',
      };

      const mockUser = {
        id: 'user-123',
        email: input.email,
        passwordHash: 'hashed_password',
        isActive: true,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(loginUser(input)).rejects.toThrow(AuthError);
    });

    it('should reject login for non-existent user', async () => {
      const input = {
        email: 'nonexistent@example.com',
        password: 'SecurePassword123!',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(loginUser(input)).rejects.toThrow(AuthError);
    });

    it('should reject login for inactive user', async () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        id: 'user-123',
        email: input.email,
        passwordHash: 'hashed_password',
        isActive: false,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(loginUser(input)).rejects.toThrow(AuthError);
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token with valid refresh token', async () => {
      const refreshToken = 'valid_refresh_token';

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        isActive: true,
        subscriptionTier: 'free',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      (require('../utils/tokenBlacklist').isTokenBlacklisted as jest.Mock).mockResolvedValue(false);
      (require('../utils/jwt').verifyRefreshToken as jest.Mock).mockReturnValue({
        sub: 'user-123',
        type: 'refresh',
      });
      (require('../utils/jwt').generateTokenPair as jest.Mock).mockReturnValue({
        accessToken: 'new_access_token',
        expiresIn: 3600,
      });

      const result = await refreshAccessToken(refreshToken);

      expect(result.access_token).toBe('new_access_token');
      expect(result.expires_in).toBe(3600);
    });

    it('should reject blacklisted refresh token', async () => {
      const refreshToken = 'blacklisted_token';

      (require('../utils/tokenBlacklist').isTokenBlacklisted as jest.Mock).mockResolvedValue(true);

      await expect(refreshAccessToken(refreshToken)).rejects.toThrow(AuthError);
    });
  });

  describe('logoutUser', () => {
    it('should logout user and blacklist refresh token', async () => {
      const refreshToken = 'valid_refresh_token';

      (require('../utils/jwt').verifyRefreshToken as jest.Mock).mockReturnValue({
        sub: 'user-123',
        type: 'refresh',
      });

      const mockBlacklist = require('../utils/tokenBlacklist').blacklistToken as jest.Mock;
      mockBlacklist.mockResolvedValue(undefined);

      await logoutUser(refreshToken);

      expect(mockBlacklist).toHaveBeenCalledWith(refreshToken, expect.any(Number));
    });
  });
});
