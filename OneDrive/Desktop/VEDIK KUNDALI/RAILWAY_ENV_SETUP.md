# Railway Environment Variables Setup

## Required Environment Variables for Railway Deployment

Copy these variables to your Railway project settings:

### 🔑 **Essential Variables**

1. **TELEGRAM_BOT_TOKEN**
   ```
   8778438196:AAEq4MIRnT4cXy-gh03PXUjyt6bBGIhTF98
   ```

2. **FLASK_SECRET_KEY**
   ```
   0c68aa30039e8906ca97e66989fe155d03ab91a6f6f54347fde707a572dd0506
   ```

3. **GEMINI_API_KEY**
   ```
   AIzaSyA6i_ia7vlaWX-VIVkH9qconWlknOnQx6s
   ```

### 💰 **Payment Variables (Optional for Premium Features)**

4. **RAZORPAY_KEY_ID**
   ```
   your_razorpay_key_id_here
   ```

5. **RAZORPAY_KEY_SECRET**
   ```
   your_razorpay_key_secret_here
   ```

### 🗄️ **Database Variable**

6. **DATABASE_URL**
   ```
   sqlite:///./vedic_kundali.db
   ```

### 💼 **Business Variables**

7. **PREMIUM_PRICE**
   ```
   999
   ```

8. **UPI_ID**
   ```
   darksecrets0unveiled@okhdfcbank
   ```

9. **WHATSAPP_NUMBER**
   ```
   9888601933
   ```

## 🚀 **Railway Setup Steps**

1. Go to your Railway project
2. Click on "Variables" tab
3. Add each variable above:
   - **Key:** Variable name (e.g., `TELEGRAM_BOT_TOKEN`)
   - **Value:** Corresponding value from above
4. Click "Add Variable" for each
5. Deploy your project

## 📝 **Important Notes**

- **FLASK_SECRET_KEY** is crucial for webhooks and security
- **TELEGRAM_BOT_TOKEN** must be the new token for @I_DecodeYourFuture_bot
- **GEMINI_API_KEY** enables AI-powered conversations
- Database will be created automatically with SQLite
- Razorpay variables are optional (needed only for payments)

## 🔧 **Verification**

After deployment, your bot should:
- Start automatically
- Respond to `/start` command
- Use Gemini AI for human-like conversations
- Handle birth details collection properly
- Generate personalized astrology analysis
