"""
Gemini AI Service
Integrates Google Gemini API for human-like conversations and astrology analysis
"""
import google.generativeai as genai
from bot.config import GEMINI_API_KEY, BOT_NAME, BOT_TITLE, BOT_EXPERIENCE_YEARS


class GeminiService:
    """
    Gemini AI Service for enhanced bot conversations
    """
    
    def __init__(self):
        """Initialize Gemini AI with API key"""
        genai.configure(api_key=GEMINI_API_KEY)
        self.model = genai.GenerativeModel('gemini-pro')
        
    def generate_astrology_analysis(self, birth_data: dict) -> str:
        """
        Generate personalized astrology analysis using Gemini AI
        
        Args:
            birth_data: Dictionary containing birth details and astrological info
            
        Returns:
            Personalized astrology analysis text
        """
        prompt = self._build_astrology_prompt(birth_data)
        
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            return self._fallback_analysis(birth_data)
    
    def generate_conversational_response(self, user_message: str, context: dict) -> str:
        """
        Generate human-like conversational response
        
        Args:
            user_message: User's input message
            context: Conversation context and user data
            
        Returns:
            Natural conversational response
        """
        prompt = self._build_conversation_prompt(user_message, context)
        
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            return self._fallback_conversation(user_message, context)
    
    def _build_astrology_prompt(self, birth_data: dict) -> str:
        """Build prompt for astrology analysis"""
        birth_date = birth_data.get('birth_date', 'N/A')
        birth_time = birth_data.get('birth_time', 'N/A')
        birth_place = birth_data.get('birth_place', 'N/A')
        rashi = birth_data.get('rashi', 'N/A')
        lagna = birth_data.get('lagna', 'N/A')
        nakshatra = birth_data.get('nakshatra', 'N/A')
        dasha = birth_data.get('dasha_info', {})
        concern = birth_data.get('concern', '')
        
        prompt = f"""
You are {BOT_NAME}, a distinguished {BOT_TITLE} with {BOT_EXPERIENCE_YEARS}+ years of expertise in Vedic Astrology and Numerology.
You are providing a complimentary astrological consultation. Maintain a professional, insightful, and dignified tone throughout.

Client Birth Details:
- Date of Birth: {birth_date}
- Time of Birth: {birth_time}
- Place of Birth: {birth_place}
- Moon Sign (Rashi): {rashi}
- Ascendant (Lagna): {lagna}
- Nakshatra: {nakshatra}
- Current Mahadasha: {dasha.get('mahadasha', 'N/A')}
- Current Antardasha: {dasha.get('antardasha', 'N/A')}
- Client's Concern: {concern}

Generate a personalized astrological analysis (300-400 words) encompassing:
1. Professional introduction to their astrological constitution
2. Key personality characteristics based on Rashi and Lagna
3. Current life phase analysis based on Mahadasha periods
4. Significant past life influences (general patterns, not specific events)
5. Current challenges and emerging opportunities
6. Practical remedial measures for present circumstances

Communication guidelines:
- Employ sophisticated and encouraging language
- Incorporate selective Hindi terminology for cultural resonance
- Provide specific insights without making deterministic predictions
- Maintain professional boundaries and ethical standards
- Deliver concise yet comprehensive guidance
- Preserve the dignified persona of an experienced Vedic astrologer

The analysis should reflect professional expertise and spiritual wisdom.
"""
        return prompt
    
    def _build_conversation_prompt(self, user_message: str, context: dict) -> str:
        """Build prompt for conversational responses"""
        user_name = context.get('user_name', 'Friend')
        state = context.get('state', 'idle')
        
        prompt = f"""
You are {BOT_NAME}, a friendly and wise {BOT_TITLE} with {BOT_EXPERIENCE_YEARS}+ years of experience.
You are having a conversation with {user_name}.

Current conversation state: {state}
User's message: "{user_message}"

Respond naturally and conversationally:
- Be warm, friendly, and encouraging
- Use mix of English and Hindi phrases naturally
- If they're asking about astrology, provide helpful insights
- If they're confused, guide them patiently
- Keep responses concise but meaningful
- Maintain your persona as an experienced astrologer

Response should be human-like and natural.
"""
        return prompt
    
    def _fallback_analysis(self, birth_data: dict) -> str:
        """Fallback analysis if Gemini API fails"""
        rashi = birth_data.get('rashi', 'your Moon Sign')
        lagna = birth_data.get('lagna', 'your Ascendant')
        
        return f"""
🙏 **Welcome to {BOT_NAME}**

I am your {BOT_TITLE} with {BOT_EXPERIENCE_YEARS}+ years of experience.

**🔮 Basic Astrological Information:**
• Your Moon Sign (Rashi): {rashi}
• Ascendant (Lagna): {lagna}

Based on your birth chart, you have a unique combination of energies that influence your personality and life path. Your current planetary period suggests this is a time for growth and new opportunities.

**✨ Simple Remedy:**
Start your day with a positive affirmation and light a diya (lamp) for mental clarity.

For complete detailed analysis with predictions, consider our premium service.

This is only a preliminary analysis. For complete Kundli with all details, type 'Premium'.
"""
    
    def _fallback_conversation(self, user_message: str, context: dict) -> str:
        """Fallback conversation if Gemini API fails"""
        return f"नमस्ते! I'm here to help you with your astrology questions. Please share your birth details for personalized analysis."
