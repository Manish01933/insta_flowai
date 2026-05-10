"""
Start Command Handler
Handles /start command and initial user greeting
"""
from telegram import Update
from telegram.ext import ContextTypes, CommandHandler
from bot.config import BOT_NAME, BOT_TITLE, BOT_EXPERIENCE_YEARS, BOT_CLIENTS_GUIDED, States


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle /start command with warm greeting and introduction
    """
    # Set initial state
    context.user_data[States.IDLE] = True
    context.user_data['state'] = States.IDLE
    
    # Clear any previous data
    context.user_data.pop('birth_date', None)
    context.user_data.pop('birth_time', None)
    context.user_data.pop('birth_place', None)
    context.user_data.pop('full_name', None)
    context.user_data.pop('concern', None)
    
    # Create professional greeting message
    greeting_message = f"""🙏 **Welcome to {BOT_NAME}**

I am **{BOT_TITLE}** with {BOT_EXPERIENCE_YEARS}+ years of expertise in Vedic Astrology and Numerology. Having served {BOT_CLIENTS_GUIDED}+ distinguished clients globally, I provide precise astrological guidance based on ancient Vedic principles.

---

**To commence your astrological analysis, please provide:**

📅 **Date of Birth:** DD-MM-YYYY format
🕐 **Time of Birth:** HH:MM AM/PM format  
📍 **Place of Birth:** City, Country

---

Upon receiving your complete birth details, I shall conduct a comprehensive analysis of your Rashi, Lagna, and current Dasha periods to deliver personalized insights and guidance.

**Begin your journey of self-discovery through Vedic wisdom...**"""
    
    await update.message.reply_text(
        greeting_message,
        parse_mode='Markdown'
    )


def start_handler() -> CommandHandler:
    """
    Create and return the start command handler
    """
    return CommandHandler('start', start_command)
