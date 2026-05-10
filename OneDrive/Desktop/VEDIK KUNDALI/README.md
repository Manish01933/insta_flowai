# 🙏 Vedic Astrology Telegram Bot

**Pandit Shri Vishwanath Shastri** - Professional Vedic Astrology & Numerology Bot

A professional Telegram bot that provides Vedic Astrology and Numerology consultations, operating as an experienced Pandit with 52+ years of experience.

---

## 🌟 Features

### Free Analysis
- Moon Sign (Rashi) calculation
- Ascendant (Lagna) calculation
- Current Mahadasha & Antardasha
- Past life events prediction
- Current situation analysis
- Simple remedy suggestions

### Premium Analysis (₹999)
- Complete Kundli with all Yogas
- Full Dasha & Mahadasha breakdown
- 10-year detailed predictions
- Personalized remedies
- Gemstone recommendations
- Complete Numerology Profile
- Lucky numbers, dates, colors
- PDF report generation

---

## 📋 Prerequisites

- Python 3.9 or higher
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Razorpay API Keys (for payment integration)

---

## 🚀 Installation

### 1. Clone the repository

```bash
cd "VEDIC KUNDALI"
```

### 2. Create virtual environment

```bash
python -m venv venv
venv\Scripts\activate  # Windows
# or
source venv/bin/activate  # Linux/Mac
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy `.env.example` to `.env` and update the values:

```bash
copy .env.example .env  # Windows
# or
cp .env.example .env  # Linux/Mac
```

Edit `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
RAZORPAY_KEY_ID=your_razorpay_key_id_here
RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
DATABASE_URL=sqlite:///./vedic_kundali.db
PREMIUM_PRICE=999
FLASK_SECRET_KEY=your_flask_secret_key_here
```

### 5. Get Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the bot token and add it to `.env`

---

## 🎯 Running the Bot

### Development

```bash
python bot/main.py
```

### Production (using systemd)

Create a service file `/etc/systemd/system/vedic-bot.service`:

```ini
[Unit]
Description=Vedic Astrology Telegram Bot
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/VEDIC_KUNDALI
Environment="PATH=/path/to/venv/bin"
ExecStart=/path/to/venv/bin/python bot/main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable vedic-bot
sudo systemctl start vedic-bot
sudo systemctl status vedic-bot
```

---

## 📁 Project Structure

```
VEDIC_KUNDALI/
├── bot/
│   ├── __init__.py
│   ├── main.py                 # Bot entry point
│   ├── config/
│   │   ├── __init__.py
│   │   └── settings.py         # Configuration
│   ├── handlers/
│   │   ├── __init__.py
│   │   ├── start_handler.py    # /start command
│   │   ├── birth_details.py    # Birth info collection
│   │   ├── analysis_handler.py # Analysis generation
│   │   └── premium_handler.py  # Premium requests
│   └── services/
│       ├── __init__.py
│       ├── astrology_engine.py # Astrology calculations
│       ├── numerology_engine.py # Numerology calculations
│       └── pdf_generator.py    # PDF report generation
├── plans/
│   ├── vedic-astrology-bot-architecture.md
│   ├── implementation-plan.md
│   └── detailed-technical-specs.md
├── requirements.txt
├── .env.example
└── README.md
```

---

## 🤖 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Begin a new Kundli analysis |
| `/premium` | Get Premium Kundli Analysis |
| `/help` | Show help message |
| `/cancel` | Cancel current conversation |

---

## 💬 Usage Flow

1. User sends `/start`
2. Bot greets and asks for birth details
3. User provides:
   - Date of Birth (DD-MM-YYYY)
   - Time of Birth (HH:MM AM/PM)
   - Place of Birth (City, Country)
4. Bot confirms details
5. User confirms with "Yes" or "हाँ"
6. Bot generates free basic analysis
7. Bot shows premium upsell
8. User can request premium with `/premium` or "पूर्ण विश्लेषण"

---

## 🔮 Astrology Features

### Calculations
- Moon Sign (Rashi)
- Ascendant (Lagna)
- Nakshatra
- Vimshottari Dasha
- Planetary positions
- Yoga detection

### Numerology
- Life Path Number
- Destiny Number
- Soul Urge Number
- Personality Number
- Karmic Lessons
- Lucky numbers, colors, days

---

## 💎 Premium Features

- Complete 9-section PDF report
- 10-year predictions
- All major Yogas analysis
- Personalized remedies
- Gemstone recommendations
- Full numerology profile
- Career, marriage, health timing

---

## 🔒 Security

- User data stored encrypted
- Payment processing via Razorpay
- No personal data shared
- Session-based state management

---

## 📊 Configuration

### Bot Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `PREMIUM_PRICE` | 999 | Premium service price in INR |
| `FREE_ANALYSIS_MAX_WORDS` | 400 | Maximum words in free analysis |
| `PANDIT_NAME` | Pandit Shri Vishwanath Shastri | Bot persona name |

---

## 🛠️ Development

### Adding New Features

1. Create handler in `bot/handlers/`
2. Add service in `bot/services/` if needed
3. Register in `bot/main.py`
4. Update documentation

### Testing

```bash
# Run with debug logging
python bot/main.py

# Check logs
tail -f bot.log
```

---

## 📝 License

This project is for educational and commercial use.

---

## 📞 Support

For support and queries:
- Telegram: @YourBotUsername
- Email: support@example.com

---

## 🙏 Credits

**Pandit Shri Vishwanath Shastri**
- 52+ Years of Experience
- 18,000+ Clients Guided
- Varanasi, India

---

## 🔄 Version History

- **1.0.0** - Initial release
  - Free basic analysis
  - Premium PDF reports
  - Payment integration
  - Complete numerology

---

**🙏 Jai Shri Krishna 🙏**
