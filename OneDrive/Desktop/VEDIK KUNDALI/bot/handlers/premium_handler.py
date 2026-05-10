"""
Premium Handler
Handles premium service requests and payment flow
"""
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, filters, CallbackQueryHandler
from bot.config import States, PREMIUM_PRICE, PREMIUM_FEATURES, PREMIUM_UPSELL_MESSAGE


async def premium_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle /premium command - show premium features and pricing
    """
    premium_message = """
━━━━━━━━━━━━━━━
🌟 **PREMIUM KUNDLI ANALYSIS**
━━━━━━━━━━━━━━━

✅ 99.9% Accurate Deep Analysis
✅ Career & Money Prediction
✅ Marriage & Love Life Reading
✅ Hidden Enemy & Nazar Detection
✅ Mahadasha Complete Breakdown
✅ Lucky Numbers & Lucky Dates
✅ Business Success Timing
✅ विदेश योग Analysis
✅ Personalized Remedies
✅ PDF Report + Voice Explanation

---

**💎 Premium Features:**
"""
    
    for i, feature in enumerate(PREMIUM_FEATURES, 1):
        premium_message += f"\n{i}. {feature}"
    
    premium_message += f"""

---

💰 **Price: ₹{PREMIUM_PRICE}**

To proceed with payment, click below:
"""
    
    keyboard = [
        [InlineKeyboardButton("💳 Pay Now", callback_data="pay_premium")]
    ]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        premium_message,
        reply_markup=reply_markup,
        parse_mode='Markdown'
    )


async def pay_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle payment button click
    """
    query = update.callback_query
    await query.answer()
    
    user_id = update.effective_user.id
    
    # Check if user has birth details
    if not all([
        context.user_data.get('birth_date'),
        context.user_data.get('birth_time'),
        context.user_data.get('birth_place')
    ]):
        await query.edit_message_text(
            "❌ कृपया पहले अपनी जन्म विवरण दें।\n\n/start से शुरू करें।",
            parse_mode='Markdown'
        )
        return
    
    # Set premium flow state
    context.user_data['state'] = States.PREMIUM_FLOW
    
    # Create payment instructions
    payment_message = f"""
💳 **Payment Instructions**

आपकी Premium Kundli Analysis के लिए payment process शुरू करें।

**Amount:** ₹{PREMIUM_PRICE}

---

**Payment Options:**

1. UPI
2. Credit/Debit Card
3. Net Banking
4. Wallets

---

To proceed with payment, please reply with **"PAY"** or **"भुगतान करें"**।

⏰ This offer is valid for 24 hours.
"""
    
    await query.edit_message_text(
        payment_message,
        parse_mode='Markdown'
    )


async def confirm_payment_intent(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle payment confirmation from user
    """
    user_message = update.message.text.strip().lower()
    
    if user_message in ['pay', 'भुगतान करें', 'payment', 'yes', 'हाँ']:
        await process_payment(update, context)
    else:
        await update.message.reply_text(
            "कृपया 'PAY' या 'भुगतान करें' लिखें payment शुरू करने के लिए।",
            parse_mode='Markdown'
        )


async def process_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Process payment and generate premium report
    """
    user_id = update.effective_user.id
    
    # In production, integrate with Razorpay here
    # For now, simulate successful payment
    
    payment_message = """
⏳ **Processing Your Payment...**

Please wait while we process your payment and generate your Premium Kundli Analysis report.

This may take a few moments. 🙏
"""
    
    await update.message.reply_text(
        payment_message,
        parse_mode='Markdown'
    )
    
    # Simulate payment success and generate report
    await generate_premium_report(update, context)


async def generate_premium_report(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Generate and send premium report
    """
    # Get user data
    birth_date = context.user_data.get('birth_date')
    birth_time = context.user_data.get('birth_time')
    birth_place = context.user_data.get('birth_place')
    
    # Initialize engines
    from bot.services.astrology_engine import AstrologyEngine
    from bot.services.numerology_engine import NumerologyEngine
    from bot.services.pdf_generator import PremiumKundliReport
    
    astrology = AstrologyEngine(birth_date, birth_time, birth_place)
    numerology = NumerologyEngine(birth_date)
    
    # Calculate all data
    astrology_data = {
        'rashi': astrology.calculate_rashi(),
        'lagna': astrology.calculate_lagna(),
        'nakshatra': astrology.calculate_nakshatra(),
        'mahadasha': astrology.calculate_current_dasha(),
        'yogas': astrology.detect_yogas(),
        'planetary_positions': astrology.calculate_planetary_positions()
    }
    
    numerology_data = {
        'life_path': numerology.calculate_life_path_number(),
        'destiny': numerology.calculate_destiny_number(context.user_data.get('full_name', '')),
        'soul_urge': numerology.calculate_soul_urge_number(context.user_data.get('full_name', '')),
        'lucky_numbers': numerology.get_lucky_numbers(),
        'lucky_colors': numerology.get_lucky_colors(),
        'karmic_lessons': numerology.calculate_karmic_lessons(context.user_data.get('full_name', ''))
    }
    
    user_data = {
        'user_id': update.effective_user.id,
        'username': update.effective_user.username,
        'first_name': update.effective_user.first_name,
        'birth_date': birth_date,
        'birth_time': birth_time,
        'birth_place': birth_place
    }
    
    # Generate PDF report
    try:
        pdf_generator = PremiumKundliReport(user_data, astrology_data, numerology_data)
        pdf_filename = pdf_generator.generate_report()
        
        # Send PDF to user
        with open(pdf_filename, 'rb') as pdf_file:
            await update.message.reply_document(
                document=pdf_file,
                caption="🙏 **Your Premium Kundli Analysis Report**\n\n"
                       "This comprehensive report includes:\n\n"
                       "✅ Complete Birth Chart Analysis\n"
                       "✅ 10-Year Predictions\n"
                       "✅ Personalized Remedies\n"
                       "✅ Gemstone Recommendations\n"
                       "✅ Full Numerology Profile\n\n"
                       "For personal consultation, please contact us.\n\n"
                       "🙏 **Pandit Shri Vishwanath Shastri**",
                parse_mode='Markdown'
            )
        
        # Update user status
        context.user_data['is_premium'] = True
        context.user_data['state'] = States.IDLE
        
    except Exception as e:
        await update.message.reply_text(
            f"❌ Report generation failed. Please try again or contact support.\n\n"
            f"Error: {str(e)}",
            parse_mode='Markdown'
        )


async def purva_vishleshan_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Handle 'पूर्ण विश्लेषण' command (Hindi for full analysis)
    """
    await premium_command(update, context)


def premium_handler() -> CommandHandler:
    """
    Create and return the premium command handler
    """
    return CommandHandler('premium', premium_command)


def purva_vishleshan_handler() -> CommandHandler:
    """
    Create and return the 'पूर्ण विश्लेषण' command handler
    """
    # Use ASCII alias for Telegram command registration (Telegram rejects non-ASCII commands)
    return CommandHandler('purnavishleshan', purva_vishleshan_command)



def pay_callback_handler() -> CallbackQueryHandler:
    """
    Create and return the pay button callback handler
    """
    return CallbackQueryHandler(pay_callback, pattern="^pay_premium$")


def payment_confirmation_handler() -> MessageHandler:
    """
    Create and return the payment confirmation handler
    """
    return MessageHandler(
        filters.TEXT & ~filters.COMMAND,

        confirm_payment_intent
    )
