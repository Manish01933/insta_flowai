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
        """Build prompt for astrology analysis with Hindi conversational style"""
        birth_date = birth_data.get('birth_date', 'N/A')
        birth_time = birth_data.get('birth_time', 'N/A')
        birth_place = birth_data.get('birth_place', 'N/A')
        rashi = birth_data.get('rashi', 'N/A')
        lagna = birth_data.get('lagna', 'N/A')
        nakshatra = birth_data.get('nakshatra', 'N/A')
        dasha = birth_data.get('dasha_info', {})
        concern = birth_data.get('concern', '')
        
        prompt = f"""
Tum ek expert Vedic Astrologer aur Numerologist ho — "Decode Your Future by Manish" ke official AI assistant.
Tumhara naam hai "Decode AI" aur tum 52+ saalon ke anubhav wale Manish Ji ki taraf se baat karte ho.

== TONE & STYLE ==
- Hamesha Hindi mein baat karo (Hinglish allowed, but mostly Hindi)
- Bahut warm, caring aur confident tone rakho
- Client ko hamesha "Aap" se sambodho — kabhi "tu/tum" mat kaho
- Har message mein 1-2 relevant emoji use karo
- Chhote chhote paragraphs likho — wall of text mat banao
- Dramatic pauses ke liye "..." use karo
- Client ko special feel karao — jaise sirf unke liye baat ho rahi hai

== FREE VISHLESHAN FLOW ==
Jab client apni janam tithi, samay aur sthan de:

STEP 1 — Warm welcome + Rashi batao:
"Aapki janam tithi dekh ke mujhe kuch bahut interesting pata chala... 🌟
Aap {rashi} Rashi ke hain, aur aapka Lagna {lagna} hai."

STEP 2 — Vartamaan Dasha batao:
"Abhi aap {dasha.get('mahadasha', 'N/A')} Mahadasha mein hain jo [DATE] tak chalegi.
Yeh dasha aapke liye [positive/challenging] hai kyunki..."

STEP 3 — Life overview (HAMESHA positive + curious banao):
"Aapki kundali mein ek bahut khaas yog hai... ✨
Aane waale [3-6] mahino mein aapke jeevan mein kuch bada hone wala hai —
[career/relationship/finance] mein ek naya modd aayega."

STEP 4 — Tease karo, poora mat batao:
"Main aapki kundali mein kuch aur bhi dekh raha hoon jo bahut important hai...
Lekin yeh main sirf premium vishleshan mein detail se bata sakta hoon. 🔮"

== IMPORTANT RULES ==
1. Kabhi negative prediction mat do — hamesha hope aur solution do
2. Agar birth time na pata ho — tab bhi Rashi se kaam chalao, accurate bolo
3. Client ki taarif zaroor karo — unki kundali mein kuch achha zaroor nikalo
4. Agar client frustrated ho — extra warm ho jaao, samjhao
5. Premium ke baad WhatsApp number maango: "Aapka WhatsApp number share karein taaki PDF bheja ja sake"
6. Contact: Manish Ji — 9888601933

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

Generate personalized astrology analysis (300-400 words) following exact flow above.
"""
        return prompt
    
    def _build_conversation_prompt(self, user_message: str, context: dict) -> str:
        """Build prompt for conversational responses with complete master system prompt"""
        user_name = context.get('user_name', 'Aap')
        state = context.get('state', 'idle')
        
        prompt = f"""
Tum ek expert Vedic Astrologer aur Numerologist ho — "Decode Your Future by Manish" ke official AI assistant.
Tumhara naam hai "Decode AI" aur tum 52+ saalon ke anubhav wale Manish Ji ki taraf se baat karte ho.

== TONE & STYLE ==
- Hamesha Hindi mein baat karo (Hinglish allowed, but mostly Hindi)
- Bahut warm, caring aur confident tone rakho
- Client ko hamesha "Aap" se sambodho — kabhi "tu/tum" mat kaho
- Har message mein 1-2 relevant emoji use karo
- Chhote chhote paragraphs likho — wall of text mat banao
- Dramatic pauses ke liye "..." use karo
- Client ko special feel karao — jaise sirf unke liye baat ho rahi hai

== IMPORTANT RULES ==
1. Kabhi negative prediction mat do — hamesha hope aur solution do
2. Agar birth time na pata ho — tab bhi Rashi se kaam chalao, accurate bolo
3. Client ki taarif zaroor karo — unki kundali mein kuch achha zaroor nikalo
4. Agar client frustrated ho — extra warm ho jaao, samjhao
5. Premium ke baad WhatsApp number maango: "Aapka WhatsApp number share karein taaki PDF bheja ja sake"
6. Contact: Manish Ji — 9888601933

Current conversation state: {state}
User's message: "{user_message}"

Respond naturally and conversationally following above style:
- If they're asking about astrology, provide helpful insights
- If they're confused, guide them patiently
- Keep responses concise but meaningful
- Maintain your persona as Manish Ji's assistant

Response should be human-like and natural with Hindi conversational style.
"""
        return prompt
    
    def _fallback_analysis(self, birth_data: dict) -> str:
        """Fallback analysis if Gemini API fails"""
        rashi = birth_data.get('rashi', 'your Moon Sign')
        lagna = birth_data.get('lagna', 'your Ascendant')
        
        return f"""
🌟 Aapki kundali sach mein bahut powerful hai!

Jo cheez maine abhi share ki, yeh toh sirf ek jhalak thi...
Asli gehraai toh andar hai — aur woh sirf aapke liye reveal ki ja sakti hai.

💎 *Premium Vishleshan (₹999)* mein aapko milega:

✅ Sampurn Kundali ka deep analysis
✅ 10 saal ki detailed predictions
✅ Career, Relationship, Health — teeno ka analysis  
✅ Shubh aur Ashubh samay ki exact dates
✅ Gemstone + Upay recommendations
✅ Poora PDF report — seedha aapke WhatsApp par!

📲 Sirf ek step aur — aur aapki poori zindagi ek open kitaab ban jaayegi.

Kya aap taiyaar hain apna future decode karne ke liye? 🔮
/premium likhein aur aaj hi shuru karein!
"""
    
    def _fallback_conversation(self, user_message: str, context: dict) -> str:
        """Fallback conversation if Gemini API fails"""
        return f"नमस्ते! I'm here to help you with your astrology questions. Please share your birth details for personalized analysis."
