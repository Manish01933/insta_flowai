# Vedic Astrology Telegram Bot - Implementation Plan

## 🎯 Project Summary

Build a professional Vedic Astrology Telegram Bot that operates as "Pandit Shri Vishwanath Shastri" - a 52+ years experienced astrologer from Varanasi. The bot will provide free basic analysis and convert users to premium services.

---

## 📦 Phase 1: Project Setup & Core Bot

### Task 1.1: Initialize Project Structure
- Create project directory structure
- Set up virtual environment
- Create requirements.txt with dependencies
- Configure .env file for secrets

**Dependencies:**
```
python-telegram-bot==20.7
python-dotenv==1.0.0
swephys==1.0.0
reportlab==4.0.7
sqlalchemy==2.0.23
razorpay==1.4.1
```

### Task 1.2: Create Bot Configuration
- Set up Telegram Bot Token (via BotFather)
- Configure environment variables
- Create settings.py for centralized config

### Task 1.3: Implement Bot Entry Point
- Create main.py with bot initialization
- Set up error handlers
- Configure bot commands (/start, /help, /premium)

---

## 🔄 Phase 2: Conversation Flow & State Management

### Task 2.1: State Management System
- Create ConversationHandler states
- Implement user session tracking
- Build state transition logic

**States:**
```
IDLE → AWAITING_BIRTH_DATE → AWAITING_BIRTH_TIME → AWAITING_BIRTH_PLACE → ANALYSIS_COMPLETE
```

### Task 2.2: Start Handler
- Implement /start command handler
- Create warm greeting message (Hindi-English mix)
- Add introduction with 52+ years experience
- Request birth details

### Task 2.3: Birth Details Collection
- Parse and validate Date of Birth (DD-MM-YYYY)
- Parse and validate Time of Birth (HH:MM AM/PM)
- Parse and validate Place of Birth (City, Country)
- Store user data in database

---

## 🔮 Phase 3: Astrology Engine

### Task 3.1: Panchang Calculation
- Integrate swephys library for planetary positions
- Calculate Moon Sign (Rashi)
- Calculate Ascendant (Lagna)
- Determine Nakshatra

### Task 3.2: Dasha Calculation
- Implement Vimshottari Dasha system
- Calculate current Mahadasha
- Calculate current Antardasha
- Calculate Pratyantardasha

### Task 3.3: Yoga Detection
- Implement major Yoga detection logic
- Identify Raj Yoga, Dhana Yoga, etc.
- Calculate planetary strengths

### Task 3.4: Past Event Prediction
- Create algorithm for believable past events
- Base predictions on Dasha periods
- Generate 1-2 accurate-sounding past events

---

## 🔢 Phase 4: Numerology Engine

### Task 4.1: Life Path Number
- Calculate from Date of Birth
- Provide basic interpretation

### Task 4.2: Destiny Number
- Calculate from full name
- Analyze name vibrations

### Task 4.3: Soul Urge Number
- Calculate from vowels in name
- Provide personality insights

### Task 4.4: Lucky Elements
- Generate lucky numbers
- Suggest lucky colors
- Recommend lucky days

---

## 📝 Phase 5: Free Analysis Generator

### Task 5.1: Analysis Template
- Create structured analysis template
- Implement Introduction section
- Add Basic Astrological Information section
- Add Past Life Events section
- Add Current Situation & Challenges section
- Add Short-term Remedy section

### Task 5.2: Message Formatting
- Implement Hindi-English mix formatting
- Add proper line breaks for Telegram
- Limit to 350-400 words
- Add 1-2 spiritual emojis (🙏 ✨)

### Task 5.3: Mandatory Ending
- Add exact Premium upsell message
- Ensure consistent wording every time

---

## 💎 Phase 6: Premium System

### Task 6.1: Premium Handler
- Handle "Premium" or "पूर्ण विश्लेषण" commands
- Display premium features list
- Show pricing information

### Task 6.2: Payment Integration
- Integrate Razorpay payment gateway
- Create payment invoice
- Handle payment callbacks
- Verify payment success

### Task 6.3: Premium Report Generation
- Generate comprehensive Kundli analysis
- Include all Yogas and Dasha details
- Add 10-year predictions
- Include personalized remedies
- Add gemstone recommendations

### Task 6.4: PDF Report Generator
- Create professional PDF layout
- Add user details and chart
- Include all analysis sections
- Add Pandit's signature
- Send PDF to user

---

## 🗄️ Phase 7: Database & User Management

### Task 7.1: Database Schema
```sql
Users:
  - user_id (PK)
  - username
  - first_name
  - birth_date
  - birth_time
  - birth_place
  - created_at
  - is_premium

PremiumPurchases:
  - purchase_id (PK)
  - user_id (FK)
  - amount
  - payment_id
  - purchase_date
  - report_sent
```

### Task 7.2: User Data Storage
- Save birth details securely
- Track conversation history
- Store premium purchase records

### Task 7.3: Session Management
- Maintain user state across conversations
- Remember birth details for follow-up
- Clear session after timeout

---

## 🧪 Phase 8: Testing

### Task 8.1: Unit Tests
- Test astrology calculations
- Test numerology calculations
- Test state transitions
- Test message formatting

### Task 8.2: Integration Tests
- Test complete conversation flow
- Test payment flow
- Test PDF generation
- Test database operations

### Task 8.3: User Acceptance Testing
- Test with real users
- Gather feedback
- Refine responses

---

## 🚀 Phase 9: Deployment

### Task 9.1: Server Setup
- Choose hosting (AWS/DigitalOcean/VPS)
- Set up Python environment
- Configure systemd service

### Task 9.2: Bot Deployment
- Deploy bot code
- Set up environment variables
- Configure logging
- Set up auto-restart

### Task 9.3: Monitoring
- Set up error tracking (Sentry)
- Configure uptime monitoring
- Set up analytics

---

## 📋 Implementation Checklist

### Core Bot
- [ ] Project structure created
- [ ] Dependencies installed
- [ ] Bot token configured
- [ ] Main bot file created
- [ ] Error handlers implemented

### Conversation Flow
- [ ] State management system
- [ ] /start command handler
- [ ] Birth date collection
- [ ] Birth time collection
- [ ] Birth place collection
- [ ] Data validation

### Astrology Engine
- [ ] Panchang calculation
- [ ] Moon Sign calculation
- [ ] Ascendant calculation
- [ ] Mahadasha calculation
- [ ] Antardasha calculation
- [ ] Yoga detection
- [ ] Past event generation

### Numerology Engine
- [ ] Life Path Number
- [ ] Destiny Number
- [ ] Soul Urge Number
- [ ] Lucky elements

### Free Analysis
- [ ] Analysis template
- [ ] Message formatting
- [ ] Word count limit
- [ ] Premium upsell message

### Premium System
- [ ] Premium command handler
- [ ] Payment integration
- [ ] Payment verification
- [ ] Premium report generation
- [ ] PDF generation

### Database
- [ ] Database schema
- [ ] User model
- [ ] Purchase model
- [ ] Data encryption

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] UAT completed

### Deployment
- [ ] Server configured
- [ ] Bot deployed
- [ ] Monitoring setup
- [ ] Documentation

---

## 🔑 Key Files to Create

| File | Purpose |
|------|---------|
| `bot/main.py` | Bot entry point |
| `bot/handlers/start_handler.py` | /start command |
| `bot/handlers/birth_details.py` | Collect birth info |
| `bot/handlers/analysis_handler.py` | Generate analysis |
| `bot/handlers/premium_handler.py` | Premium requests |
| `bot/services/astrology_engine.py` | Astrology calculations |
| `bot/services/numerology_engine.py` | Numerology calculations |
| `bot/services/pdf_generator.py` | PDF reports |
| `bot/utils/formatter.py` | Message formatting |
| `bot/config/settings.py` | Configuration |
| `database/models.py` | Database models |
| `requirements.txt` | Dependencies |
| `.env` | Environment variables |

---

## 🎯 Success Criteria

1. Bot responds to /start with proper greeting
2. Bot collects all birth details correctly
3. Free analysis is generated within 350-400 words
4. Premium upsell message appears after every free analysis
5. Premium payment flow works correctly
6. PDF reports are generated and sent
7. User data is stored securely
8. Bot handles errors gracefully

---

## 📞 Support & Maintenance

- Regular bot monitoring
- User feedback collection
- Feature updates
- Bug fixes
- Content refinement
