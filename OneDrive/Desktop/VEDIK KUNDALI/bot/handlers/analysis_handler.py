"""
Analysis Handler
Generates free basic astrological analysis
"""
from telegram import Update
from telegram.ext import ContextTypes, MessageHandler, filters
from bot.config import States, PREMIUM_UPSELL_MESSAGE, BOT_NAME, BOT_TITLE
from bot.services.astrology_engine import AstrologyEngine
from bot.services.numerology_engine import NumerologyEngine
from bot.services.gemini_service import GeminiService


async def confirm_and_generate_analysis(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle user confirmation and generate free analysis
    """
    user_message = update.message.text.strip().lower()
    
    # Check for confirmation
    if user_message in ['yes', 'हाँ', 'haan', 'ok', 'ठीक है', 'theek hai']:
        await generate_free_analysis(update, context)
    elif user_message in ['no', 'ना', 'nahi', 'nahin', 'नहीं']:
        await update.message.reply_text(
            "कृपया सही जन्म विवरण भेजें:\n\n"
            "1. Date of Birth (DD-MM-YYYY)\n"
            "2. Time of Birth (HH:MM AM/PM)\n"
            "3. Place of Birth (शहर, देश)",
            parse_mode='Markdown'
        )
        context.user_data['state'] = States.IDLE
    else:
        # Try to parse as new birth details
        from bot.handlers.birth_details import collect_birth_details
        await collect_birth_details(update, context)


async def generate_free_analysis(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Generate free basic astrological analysis using Gemini AI
    """
    # Get user data
    birth_date = context.user_data.get('birth_date')
    birth_time = context.user_data.get('birth_time')
    birth_place = context.user_data.get('birth_place')
    concern = context.user_data.get('concern', '')
    
    if not all([birth_date, birth_time, birth_place]):
        await update.message.reply_text(
            "❌ जन्म विवरण अधूरा है। कृपया /start से पुनः शुरू करें।",
            parse_mode='Markdown'
        )
        return
    
    # Initialize engines
    astrology = AstrologyEngine(birth_date, birth_time, birth_place)
    numerology = NumerologyEngine(birth_date)
    gemini = GeminiService()
    
    # Calculate astrological data
    rashi = astrology.calculate_rashi()
    lagna = astrology.calculate_lagna()
    nakshatra = astrology.calculate_nakshatra()
    dasha_info = astrology.calculate_current_dasha()
    life_path = numerology.calculate_life_path_number()
    
    # Prepare data for Gemini
    birth_data = {
        'birth_date': birth_date,
        'birth_time': birth_time,
        'birth_place': birth_place,
        'rashi': rashi,
        'lagna': lagna,
        'nakshatra': nakshatra,
        'dasha_info': dasha_info,
        'concern': concern,
        'life_path': life_path
    }
    
    # Generate analysis using Gemini
    try:
        analysis_message = gemini.generate_astrology_analysis(birth_data)
    except Exception as e:
        # Fallback to traditional analysis if Gemini fails
        analysis_message = build_free_analysis_message(
            rashi=rashi,
            lagna=lagna,
            nakshatra=nakshatra,
            dasha_info=dasha_info,
            past_events=astrology.generate_past_events(),
            concern=concern,
            remedy=astrology.generate_remedy(),
            life_path=life_path,
            life_path_info=numerology.get_life_path_meaning(life_path)
        )
    
    # Add premium upsell
    full_message = analysis_message + "\n\n" + PREMIUM_UPSELL_MESSAGE
    
    # Send analysis
    await update.message.reply_text(
        full_message,
        parse_mode='Markdown'
    )
    
    # Reset state
    context.user_data['state'] = States.IDLE


def build_free_analysis_message(
    rashi: str,
    lagna: str,
    nakshatra: str,
    dasha_info: dict,
    past_events: list,
    concern: str,
    remedy: dict,
    life_path: int,
    life_path_info: dict
) -> str:
    """
    Build the free analysis message with proper formatting
    
    Args:
        rashi: Moon sign
        lagna: Ascendant
        nakshatra: Birth nakshatra
        dasha_info: Current dasha information
        past_events: List of past life events
        concern: User's current concern
        remedy: Suggested remedy
        life_path: Life path number
        life_path_info: Life path interpretation
    
    Returns:
        Formatted analysis message
    """
    message = []
    
    # 1. Introduction
    message.append(f"🙏 **Welcome to {BOT_NAME}**")
    message.append("")
    message.append(f"I am your **{BOT_TITLE}** with {BOT_EXPERIENCE_YEARS}+ years of experience in Vedic Astrology and Numerology.")
    message.append("")
    message.append("---")
    message.append("")
    
    # 2. Basic Astrological Information
    message.append("**🔮 Basic Astrological Information**")
    message.append("")
    message.append(f"• **Your Moon Sign (Rashi):** {rashi}")
    message.append(f"• **Ascendant (Lagna):** {lagna}")
    message.append(f"• **Nakshatra:** {nakshatra}")
    message.append(f"• **Current Mahadasha:** {dasha_info.get('mahadasha', 'N/A')}")
    message.append(f"• **Current Antardasha:** {dasha_info.get('antardasha', 'N/A')}")
    message.append(f"• **Life Path Number:** {life_path} ({life_path_info.get('title', '')})")
    message.append("")
    message.append("---")
    message.append("")
    
    # 3. Past Life Events
    message.append("**📜 Past Life Events**")
    message.append("")
    for i, event in enumerate(past_events[:2], 1):
        message.append(f"{i}. {event}")
    message.append("")
    message.append("---")
    message.append("")
    
    # 4. Current Situation & Challenges
    message.append("**⚡ Current Situation & Challenges**")
    message.append("")
    if concern:
        message.append(f"You have expressed concern about {concern}.")
        message.append("")
    
    # Add general current situation based on dasha
    mahadasha = dasha_info.get('mahadasha', '')
    current_situation = get_current_situation_by_dasha(mahadasha)
    message.append(current_situation)
    message.append("")
    message.append("---")
    message.append("")
    
    # 5. Short-term Remedy
    message.append("**✨ Short-term Remedy**")
    message.append("")
    message.append(f"**{remedy.get('planet', 'General')} Remedy:**")
    message.append(f"{remedy.get('description', '')}")
    message.append("")
    message.append(f"**Mantra:** {remedy.get('mantra', '')}")
    message.append(f"**Timing:** {remedy.get('timing', '')}")
    message.append("")
    message.append("---")
    
    return "\n".join(message)


def get_current_situation_by_dasha(mahadasha: str) -> str:
    """
    Get current situation description based on Mahadasha
    
    Args:
        mahadasha: Current Mahadasha planet
    
    Returns:
        Situation description
    """
    situations = {
        'Ketu': "Ketu Mahadasha brings spiritual growth, but may cause mental restlessness. This is a time for self-reflection and finding inner peace.",
        'Venus': "Venus Mahadasha brings luxury, creativity, and relationship improvements. A time for wealth and comfort.",
        'Sun': "Sun Mahadasha brings confidence, leadership abilities, and career advancement. But avoid ego.",
        'Moon': "Moon Mahadasha may bring emotional ups and downs. Focus on family and maternal relationships.",
        'Mars': "Mars Mahadasha increases energy, courage, and competition. Anger control is necessary.",
        'Rahu': "Rahu Mahadasha brings sudden changes, foreign connections, and unusual events. Maintain patience.",
        'Jupiter': "Jupiter Mahadasha is considered most auspicious. Growth in knowledge, wealth, and fortune.",
        'Saturn': "Saturn Mahadasha brings rewards for hard work. Success comes through patience and discipline.",
        'Mercury': "Mercury Mahadasha increases intelligence, business, and communication abilities. A time for professional success."
    }
    
    return situations.get(mahadasha, "Maintain patience and positivity during this time.")


def analysis_handler() -> MessageHandler:
    """
    Create and return the analysis confirmation handler
    """
    from bot.config import States
    
    # Only handle messages when user is in AWAITING_CONCERN state
    return MessageHandler(
        filters.TEXT & ~filters.COMMAND,
        confirm_and_generate_analysis
    )
