/**
 * Authentication service for user registration, login, and token management
 */

import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt';
import { blacklistToken, isTokenBlacklisted } from '../utils/tokenBlacklist';
import { validateEmail, validatePasswordStrength } from '../utils/validation';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import logger from '../config/logger';
import config from '../config/environment';

export interface RegisterInput {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  subscription_tier: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Register a new user
 */
export const registerUser = async (input: RegisterInput): Promise<AuthResponse> => {
  try {
    // Validate email format
    if (!validateEmail(input.email)) {
      throw new ValidationError('Invalid email format', 'INVALID_EMAIL_FORMAT');
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(input.password);
    if (!passwordValidation.valid) {
      throw new ValidationError(
        `Password does not meet requirements: ${passwordValidation.errors.join(', ')}`,
        'WEAK_PASSWORD'
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new ConflictError('Email already registered', 'EMAIL_ALREADY_EXISTS');
    }

    // Hash password with bcrypt (12 salt rounds)
    const passwordHash = await bcrypt.hash(input.password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: passwordHash,
        firstName: input.first_name,
        lastName: input.last_name,
        phone: input.phone,
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        isActive: true,
      },
    });

    logger.info(`User registered: ${user.email}`);

    // Generate tokens
    const { accessToken, refreshToken, expiresIn } = generateTokenPair(
      user.id,
      user.email,
      user.subscriptionTier
    );

    return {
      id: user.id,
      email: user.email,
      first_name: user.firstName || undefined,
      last_name: user.lastName || undefined,
      subscription_tier: user.subscriptionTier,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    };
  } catch (error: any) {
    logger.error(`Registration error: ${error.message}`);
    throw error;
  }
};

/**
 * Login user with email and password
 */
export const loginUser = async (input: LoginInput): Promise<AuthResponse> => {
  try {
    // Validate email format
    if (!validateEmail(input.email)) {
      throw new ValidationError('Invalid email format', 'INVALID_EMAIL_FORMAT');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthError('User account is inactive', 'ACCOUNT_INACTIVE');
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatch) {
      throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    logger.info(`User logged in: ${user.email}`);

    // Generate tokens
    const { accessToken, refreshToken, expiresIn } = generateTokenPair(
      user.id,
      user.email,
      user.subscriptionTier
    );

    return {
      id: user.id,
      email: user.email,
      first_name: user.firstName || undefined,
      last_name: user.lastName || undefined,
      subscription_tier: user.subscriptionTier,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    };
  } catch (error: any) {
    logger.error(`Login error: ${error.message}`);
    throw error;
  }
};

/**
 * Refresh access token using refresh token
 */
export const refreshAccessToken = async (refreshToken: string): Promise<RefreshTokenResponse> => {
  try {
    // Check if refresh token is blacklisted
    const blacklisted = await isTokenBlacklisted(refreshToken);
    if (blacklisted) {
      throw new AuthError('Refresh token has been invalidated', 'TOKEN_INVALIDATED');
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      throw new AuthError('User account is inactive', 'ACCOUNT_INACTIVE');
    }

    logger.info(`Token refreshed for user: ${user.email}`);

    // Generate new access token
    const { accessToken, expiresIn } = generateTokenPair(
      user.id,
      user.email,
      user.subscriptionTier
    );

    return {
      access_token: accessToken,
      expires_in: expiresIn,
    };
  } catch (error: any) {
    logger.error(`Token refresh error: ${error.message}`);
    throw error;
  }
};

/**
 * Logout user by invalidating refresh token
 */
export const logoutUser = async (refreshToken: string): Promise<void> => {
  try {
    // Verify refresh token is valid before blacklisting
    const decoded = verifyRefreshToken(refreshToken);

    // Add to blacklist with TTL equal to token expiry
    const expiresIn = config.jwtRefreshExpiry;
    await blacklistToken(refreshToken, expiresIn);

    logger.info(`User logged out: ${decoded.sub}`);
  } catch (error: any) {
    logger.error(`Logout error: ${error.message}`);
    throw error;
  }
};

/**
 * Get user by ID
 */
export const getUserById = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    return user;
  } catch (error: any) {
    logger.error(`Get user error: ${error.message}`);
    throw error;
  }
};

/**
 * Update user profile
 */
export const updateUserProfile = async (
  userId: string,
  data: Partial<RegisterInput>
) => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        subscriptionTier: true,
        updatedAt: true,
      },
    });

    logger.info(`User profile updated: ${user.email}`);
    return user;
  } catch (error: any) {
    logger.error(`Update user error: ${error.message}`);
    throw error;
  }
};

/**
 * Change user password
 */
export const changePassword = async (
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<void> => {
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Verify old password
    const passwordMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!passwordMatch) {
      throw new AuthError('Current password is incorrect', 'INVALID_PASSWORD');
    }

    // Validate new password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(
        `New password does not meet requirements: ${passwordValidation.errors.join(', ')}`,
        'WEAK_PASSWORD'
      );
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    logger.info(`Password changed for user: ${user.email}`);
  } catch (error: any) {
    logger.error(`Change password error: ${error.message}`);
    throw error;
  }
};
