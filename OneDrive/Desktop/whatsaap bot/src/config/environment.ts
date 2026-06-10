import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key_here',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret_key_here',
  jwtExpiry: parseInt(process.env.JWT_EXPIRY || '3600', 10),
  jwtRefreshExpiry: parseInt(process.env.JWT_REFRESH_EXPIRY || '2592000', 10),

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),

  // WhatsApp
  whatsappWebhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',

  // Claude API
  claudeApiKey: process.env.CLAUDE_API_KEY || '',

  // Razorpay
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',

  // SendGrid
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@botbazaar.com',

  // Company details
  companyName: process.env.COMPANY_NAME || 'BotBazaar',
  companyEmail: process.env.COMPANY_EMAIL || 'support@botbazaar.com',
  companyWebsite: process.env.COMPANY_WEBSITE || 'https://botbazaar.com',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

export default config;
