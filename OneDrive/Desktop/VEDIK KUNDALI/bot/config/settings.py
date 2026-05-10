"""
Bot Configuration and Settings
"""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

# Razorpay Payment Configuration
RAZORPAY_KEY_ID = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')

# Database Configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./vedic_kundali.db')

# Premium Service Configuration
PREMIUM_PRICE = int(os.getenv('PREMIUM_PRICE', 999))

# Payment Configuration
UPI_ID = os.getenv('UPI_ID', 'darksecrets0unveiled@okhdfcbank')
WHATSAPP_NUMBER = os.getenv('WHATSAPP_NUMBER', '9888601933')

# Flask Configuration
FLASK_SECRET_KEY = os.getenv('FLASK_SECRET_KEY', 'default-secret-key-change-in-production')

# Gemini AI Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyA6i_ia7vlaWX-VIVkH9qconWlknOnQx6s')

# Bot Persona Settings
BOT_NAME = "DECODE YOUR FUTURE"
BOT_TITLE = "Astrologer and Numerologist Analysist"
BOT_EXPERIENCE_YEARS = 52
BOT_CLIENTS_GUIDED = 18000

# Free Analysis Settings
FREE_ANALYSIS_MAX_WORDS = 400
FREE_ANALYSIS_MIN_WORDS = 350

# Conversation States
class States:
    IDLE = "idle"
    AWAITING_BIRTH_DATE = "awaiting_birth_date"
    AWAITING_BIRTH_TIME = "awaiting_birth_time"
    AWAITING_BIRTH_PLACE = "awaiting_birth_place"
    AWAITING_CONCERN = "awaiting_concern"
    PREMIUM_FLOW = "premium_flow"
    AWAITING_PAYMENT_CONFIRMATION = "awaiting_payment_confirmation"

# Validation Patterns
DOB_PATTERN = r"^\d{2}-\d{2}-\d{4}$"  # DD-MM-YYYY
TOB_PATTERN = r"^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?$"  # HH:MM AM/PM

# Mandatory Premium Upsell Message
PREMIUM_UPSELL_MESSAGE = """This is only a preliminary analysis.

If you want your complete Kundli, detailed Dasha-Mahadasha, all major Yogas, career, marriage, finance, health, foreign travel, and accurate predictions for the next 10 years with 99.9% accuracy, then take **Premium Kundli Analysis**.

To get Premium Service, just type 'Premium' or 'Full Analysis'."""

# Premium Features List
PREMIUM_FEATURES = [
    "Full detailed Kundli with all Yogas",
    "Complete Dasha & Mahadasha analysis",
    "Year-wise predictions for next 10 years",
    "Personalized remedies & Gemstone recommendation",
    "Numerology Profile + Lucky numbers, dates, colours",
    "Health, Career, Marriage, Finance timing",
    "Personal consultation option"
]
