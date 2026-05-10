"""
Birth Details Handler
Collects and validates user's birth information
"""
import re
from datetime import datetime
from telegram import Update
from telegram.ext import ContextTypes, MessageHandler, filters
from bot.config import States, DOB_PATTERN, TOB_PATTERN


def validate_date_of_birth(dob_str: str) -> bool:
    """
    Validate Date of Birth format (DD-MM-YYYY)
    
    Args:
        dob_str: Date string to validate
    
    Returns:
        Boolean indicating validity
    """
    if not re.match(DOB_PATTERN, dob_str):
        return False
    
    try:
        day, month, year = map(int, dob_str.split('-'))
        datetime(year, month, day)
        return True
    except (ValueError, TypeError):
        return False


def validate_time_of_birth(tob_str: str) -> bool:
    """
    Validate Time of Birth format (HH:MM AM/PM)
    
    Args:
        tob_str: Time string to validate
    
    Returns:
        Boolean indicating validity
    """
    if not re.match(TOB_PATTERN, tob_str, re.IGNORECASE):
        return False
    
    try:
        # Normalize the time string
        tob_normalized = tob_str.strip().upper()
        
        # Extract time and period
        if 'AM' in tob_normalized or 'PM' in tob_normalized:
            time_part = tob_normalized.replace('AM', '').replace('PM', '').strip()
            hour, minute = map(int, time_part.split(':'))
            
            if not (1 <= hour <= 12 and 0 <= minute <= 59):
                return False
        else:
            # 24-hour format
            hour, minute = map(int, tob_normalized.split(':'))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                return False
        
        return True
    except (ValueError, TypeError):
        return False


def parse_birth_place(place_str: str) -> dict:
    """
    Parse place of birth string
    
    Args:
        place_str: Place string (City, Country)
    
    Returns:
        Dictionary with city and country
    """
    place_info = {
        'city': '',
        'country': '',
        'full': place_str
    }
    
    if ',' in place_str:
        parts = place_str.split(',')
        place_info['city'] = parts[0].strip()
        place_info['country'] = parts[1].strip() if len(parts) > 1 else 'India'
    else:
        place_info['city'] = place_str.strip()
        place_info['country'] = 'India'  # Default to India
    
    return place_info


async def collect_birth_details(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Collect birth details from user message
    Handles multiple formats and validates input
    """
    user_message = update.message.text.strip()
    state = context.user_data.get('state', States.IDLE)
    
    # If user is in AWAITING_CONCERN state, pass to analysis handler
    if state == States.AWAITING_CONCERN:
        from bot.handlers.analysis_handler import confirm_and_generate_analysis
        await confirm_and_generate_analysis(update, context)
        return
    
    # Try to parse all details from single message
    # Format: DD-MM-YYYY, HH:MM AM/PM, City, Country
    details = parse_multi_line_input(user_message)
    
    if details and all(details.values()):
        # All details provided in one message
        context.user_data['birth_date'] = details['date']
        context.user_data['birth_time'] = details['time']
        context.user_data['birth_place'] = details['place']
        context.user_data['state'] = States.AWAITING_CONCERN
        
        await confirm_birth_details(update, context)
        return
    
    # Step-by-step collection
    if state == States.IDLE or 'birth_date' not in context.user_data:
        await handle_birth_date(update, context, user_message)
    elif 'birth_time' not in context.user_data:
        await handle_birth_time(update, context, user_message)
    elif 'birth_place' not in context.user_data:
        await handle_birth_place(update, context, user_message)


def parse_multi_line_input(message: str) -> dict:
    """
    Try to parse all birth details from a single message
    
    Args:
        message: User's message
    
    Returns:
        Dictionary with date, time, place or empty dict
    """
    details = {'date': None, 'time': None, 'place': None}
    
    # Split by comma
    parts = [p.strip() for p in message.split(',')]
    
    if len(parts) >= 3:
        # Check if first part is a date
        if validate_date_of_birth(parts[0]):
            details['date'] = parts[0]
        
        # Check if second part is a time
        if validate_time_of_birth(parts[1]):
            details['time'] = parts[1]
        
        # Rest is place
        details['place'] = ', '.join(parts[2:])
    
    return details


async def handle_birth_date(update: Update, context: ContextTypes.DEFAULT_TYPE, message: str) -> None:
    """
    Handle Date of Birth input
    """
    # Clean the message
    dob = message.strip()
    
    # Remove any extra text, keep only date pattern
    date_match = re.search(DOB_PATTERN, dob, re.IGNORECASE)
    if date_match:
        dob = date_match.group()
    
    if validate_date_of_birth(dob):
        context.user_data['birth_date'] = dob
        context.user_data['state'] = States.AWAITING_BIRTH_TIME
        
        await update.message.reply_text(
            "✅ Date of Birth noted.\n\n"
            "अब कृपया अपना **Time of Birth** भेजें (HH:MM AM/PM)।",
            parse_mode='Markdown'
        )
    else:
        await update.message.reply_text(
            "❌ कृपया सही फॉर्मेट में Date of Birth भेजें।\n\n"
            "उदाहरण: **15-08-1990**",
            parse_mode='Markdown'
        )


async def handle_birth_time(update: Update, context: ContextTypes.DEFAULT_TYPE, message: str) -> None:
    """
    Handle Time of Birth input
    """
    tob = message.strip()
    
    # Remove any extra text, keep only time pattern
    time_match = re.search(TOB_PATTERN, tob, re.IGNORECASE)
    if time_match:
        tob = time_match.group()
    
    if validate_time_of_birth(tob):
        context.user_data['birth_time'] = tob
        context.user_data['state'] = States.AWAITING_BIRTH_PLACE
        
        await update.message.reply_text(
            "✅ Time of Birth noted.\n\n"
            "अब कृपया अपना **Place of Birth** भेजें (शहर, देश)।",
            parse_mode='Markdown'
        )
    else:
        await update.message.reply_text(
            "❌ कृपया सही फॉर्मेट में Time of Birth भेजें।\n\n"
            "उदाहरण: **10:30 AM** या **22:30**",
            parse_mode='Markdown'
        )


async def handle_birth_place(update: Update, context: ContextTypes.DEFAULT_TYPE, message: str) -> None:
    """
    Handle Place of Birth input
    """
    place = message.strip()
    
    if place and len(place) > 2:
        context.user_data['birth_place'] = place
        context.user_data['state'] = States.AWAITING_CONCERN
        
        await confirm_birth_details(update, context)
    else:
        await update.message.reply_text(
            "❌ कृपया अपना Place of Birth भेजें।\n\n"
            "उदाहरण: **Delhi, India** या **Mumbai**",
            parse_mode='Markdown'
        )


async def confirm_birth_details(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Confirm collected birth details with user
    """
    birth_date = context.user_data.get('birth_date', 'N/A')
    birth_time = context.user_data.get('birth_time', 'N/A')
    birth_place = context.user_data.get('birth_place', 'N/A')
    
    confirmation_message = f"""✅ **आपकी जन्म विवरण:**

📅 **Date of Birth:** {birth_date}
🕐 **Time of Birth:** {birth_time}
📍 **Place of Birth:** {birth_place}

---

क्या ये विवरण सही हैं? 

अगर हाँ, तो 'Yes' या 'हाँ' लिखें।
अगर कोई सुधार चाहिए, तो 'No' लिखें और सही विवरण भेजें।"""
    
    await update.message.reply_text(
        confirmation_message,
        parse_mode='Markdown'
    )


def birth_details_handler() -> MessageHandler:
    """
    Create and return the birth details message handler
    """
    return MessageHandler(
        filters.TEXT & ~filters.COMMAND,
        collect_birth_details
    )
