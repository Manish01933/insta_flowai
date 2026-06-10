# 🚂 Deploy BotBazaar to Railway

## 🚀 Quick Start

1. Go to **https://railway.app/new**
2. Click **"Deploy from GitHub repo"**
3. Select `thenutritionhut33-png/botbazaar`
4. Railway auto-detects `nixpacks.toml` and starts building

## 🗄️ Add Database & Redis

In your Railway project:
1. **+ New** → **Database** → **PostgreSQL**
2. **+ New** → **Database** → **Redis**

Railway auto-injects `DATABASE_URL` and `REDIS_URL` into your service.

## 🔐 Environment Variables

In BotBazaar service → **Variables**:

```env
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 64>
JWT_REFRESH_SECRET=<openssl rand -base64 64>
ANTHROPIC_API_KEY=sk-ant-...
WHATSAPP_WEBHOOK_SECRET=<your-secret>
WHATSAPP_API_VERSION=v18.0
WHATSAPP_BUSINESS_ACCOUNT_ID=<your-id>
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=<your-secret>
RAZORPAY_WEBHOOK_SECRET=<your-webhook-secret>
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
COMPANY_NAME=BotBazaar
COMPANY_EMAIL=support@yourdomain.com
ALLOWED_ORIGINS=https://your-railway-url.up.railway.app
```

## 🌐 Public URL

Settings → Networking → **Generate Domain**

## ✅ Verify

```bash
curl https://<your-url>/health
```
