// Jest setup file
// Add any global test setup here

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.JWT_REFRESH_SECRET = 'test_jwt_refresh_secret';
process.env.JWT_EXPIRY = '3600';
process.env.JWT_REFRESH_EXPIRY = '2592000';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/botbazaar_test';
process.env.CLAUDE_API_KEY = 'test_claude_api_key';
process.env.WHATSAPP_WEBHOOK_SECRET = 'test_whatsapp_webhook_secret';
process.env.WHATSAPP_API_VERSION = 'v18.0';
process.env.RAZORPAY_KEY_ID = 'test_razorpay_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_razorpay_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_razorpay_webhook_secret';
