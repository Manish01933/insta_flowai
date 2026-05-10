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
    
    # Create warm greeting message
    greeting_message = f"""🙏 **Welcome to {BOT_NAME}**

I am your **{BOT_TITLE}** with {BOT_EXPERIENCE_YEARS}+ years of experience in Vedic Astrology and Numerology. I have guided {BOT_CLIENTS_GUIDED}+ clients worldwide.

---

To analyze your Kundli, I need your birth details:

**Please provide:**

1. **Date of Birth** (DD-MM-YYYY)
2. **Time of Birth** (HH:MM AM/PM)
3. **Place of Birth** (City, Country)

---

Once you provide these details, I will analyze your Rashi, Lagna, and current Dasha to provide initial guidance. ✨

**Your destiny awaits discovery...**"""
    
    await update.message.reply_text(
        greeting_message,
        parse_mode='Markdown'
    )


def start_handler() -> CommandHandler:
    """
    Create and return the start command handler
    """
    return CommandHandler('start', start_command)
