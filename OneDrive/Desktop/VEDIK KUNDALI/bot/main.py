"""
Vedic Astrology Telegram Bot - Main Entry Point
Pandit Shri Vishwanath Shastri - 52+ Years Experience
"""
import logging
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
    ConversationHandler
)
from bot.config import TELEGRAM_BOT_TOKEN, States
from bot.handlers.start_handler import start_handler
from bot.handlers.birth_details import birth_details_handler
from bot.handlers.analysis_handler import analysis_handler
from bot.handlers.premium_handler import (
    premium_handler,
    purva_vishleshan_handler,
    pay_callback_handler,
    payment_confirmation_handler
)


# Enable logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a message when the command /start is issued."""
    from bot.handlers.start_handler import start_command
    await start_command(update, context)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a message when the command /help is issued."""
    help_text = """
🙏 **नमस्कार**,

मैं **Pandit Shri Vishwanath Shastri** हूँ - Vedic Astrology और Numerology में आपकी सेवा करने के लिए।

**Available Commands:**

/start - Begin a new Kundli analysis
/premium - Get Premium Kundli Analysis
/help - Show this help message

**How to use:**

1. Send /start to begin
2. Provide your birth details:
   - Date of Birth (DD-MM-YYYY)
   - Time of Birth (HH:MM AM/PM)
   - Place of Birth (City, Country)
3. Receive your free basic analysis
4. Upgrade to Premium for complete analysis

**Premium Features:**
- Full detailed Kundli with all Yogas
- Complete Dasha & Mahadasha analysis
- Year-wise predictions for next 10 years
- Personalized remedies & Gemstone recommendation
- Numerology Profile + Lucky numbers, dates, colours
- Health, Career, Marriage, Finance timing
- Personal consultation option

For Premium Service, send 'Premium' or 'पूर्ण विश्लेषण'
"""
    await update.message.reply_text(help_text, parse_mode='Markdown')


async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Log errors caused by Updates."""
    # Avoid noisy replies for polling conflicts (e.g., multiple bot instances running).
    try:
        from telegram.error import Conflict
        if isinstance(context.error, Conflict):
            logger.warning(
                "Telegram polling conflict (another getUpdates request detected). "
                "Ensure only one bot instance is running."
            )
            return
    except Exception:
        # If import/check fails, continue to default error logging/reply.
        pass

    logger.error("Exception while handling an update:", exc_info=context.error)

    # Notify user of error (only for real update-handling errors)
    if update and update.effective_message:
        await update.effective_message.reply_text(
            "🙏 An error occurred while processing your request. "
            "Please try again or contact support.",
            parse_mode='Markdown'
        )


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Cancel the current conversation."""
    context.user_data.clear()
    await update.message.reply_text(
        "Conversation cancelled. Send /start to begin again.",
        parse_mode='Markdown'
    )


def main() -> None:
    """Start the bot."""
    
    # Create the Application
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Add command handlers
    application.add_handler(start_handler())
    application.add_handler(CommandHandler('help', help_command))
    application.add_handler(CommandHandler('cancel', cancel_command))
    application.add_handler(premium_handler())
    application.add_handler(purva_vishleshan_handler())
    
    # Add message handlers
    application.add_handler(birth_details_handler())
    application.add_handler(analysis_handler())
    application.add_handler(pay_callback_handler())
    application.add_handler(payment_confirmation_handler())
    
    # Add error handler
    application.add_error_handler(error_handler)
    
    # Start the Bot
    logger.info("🙏 Pandit Shri Vishwanath Shastri Bot is starting...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()
