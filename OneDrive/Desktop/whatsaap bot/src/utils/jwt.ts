/**
 * JWT token generation and verification utilities
 */

import jwt from 'jsonwebtoken';
import config from '../config/environment';
import { AuthError } from './errors';

export interface TokenPayload {
  sub: string; // user ID
  email: string;
  subscription_tier: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

export interface RefreshTokenPayload {
  sub: string; // user ID
  type: 'refresh';
  iat?: number;
  exp?: number;
  iss?: string;
}

/**
 * Generate access token (1 hour expiry)
 */
export const generateAccessToken = (payload: Omit<TokenPayload, 'iat' | 'exp' | 'iss'>): string => {
  const tokenPayload: TokenPayload = {
    ...payload,
    iss: 'botbazaar',
  };

  return jwt.sign(tokenPayload, config.jwtSecret, {
    expiresIn: config.jwtExpiry, // 1 hour
    algorithm: 'HS256',
  });
};

/**
 * Generate refresh token (30 days expiry)
 */
export const generateRefreshToken = (userId: string): string => {
  const payload: RefreshTokenPayload = {
    sub: userId,
    type: 'refresh',
    iss: 'botbazaar',
  };

  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiry, // 30 days
    algorithm: 'HS256',
  });
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'botbazaar',
    }) as TokenPayload;

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new AuthError('Access token has expired', 'TOKEN_EXPIRED');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new AuthError('Invalid access token', 'INVALID_TOKEN');
    }
    throw new AuthError('Token verification failed', 'TOKEN_VERIFICATION_FAILED');
  }
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, config.jwtRefreshSecret, {
      algorithms: ['HS256'],
      issuer: 'botbazaar',
    }) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      throw new AuthError('Invalid refresh token type', 'INVALID_TOKEN_TYPE');
    }

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new AuthError('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new AuthError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }
    throw new AuthError('Refresh token verification failed', 'REFRESH_TOKEN_VERIFICATION_FAILED');
  }
};

/**
 * Decode token without verification (for debugging)
 */
export const decodeToken = (token: string): any => {
  return jwt.decode(token);
};

/**
 * Generate both access and refresh tokens
 */
export const generateTokenPair = (
  userId: string,
  email: string,
  subscriptionTier: string
): { accessToken: string; refreshToken: string; expiresIn: number } => {
  const accessToken = generateAccessToken({
    sub: userId,
    email,
    subscription_tier: subscriptionTier,
  });

  const refreshToken = generateRefreshToken(userId);

  return {
    accessToken,
    refreshToken,
    expiresIn: config.jwtExpiry,
  };
};
