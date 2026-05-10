"""
Run Script for Vedic Astrology Telegram Bot
This script initializes the database and starts the bot
"""
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def check_environment():
    """Check if required environment variables are set"""
    required_vars = [
        'TELEGRAM_BOT_TOKEN'
    ]
    
    missing = []
    for var in required_vars:
        if not os.getenv(var):
            missing.append(var)
    
    if missing:
        print("❌ Missing required environment variables:")
        for var in missing:
            print(f"   - {var}")
        print("\nPlease create a .env file from .env.example and configure it.")
        sys.exit(1)
    
    print("✅ Environment variables configured")


def init_database():
    """Initialize database"""
    try:
        from database import init_db
        init_db()
        print("✅ Database initialized")
    except Exception as e:
        print(f"⚠️  Database initialization warning: {e}")
        print("   Continuing without database...")


def main():
    """Main entry point"""
    print("=" * 50)
    print("🙏 Pandit Shri Vishwanath Shastri Bot")
    print("   Vedic Astrology & Numerology")
    print("=" * 50)
    print()
    
    # Check environment
    check_environment()
    print()
    
    # Initialize database
    init_database()
    print()
    
    # Start bot
    print("🚀 Starting bot...")
    print()
    
    from bot.main import main as bot_main
    bot_main()


if __name__ == '__main__':
    main()
