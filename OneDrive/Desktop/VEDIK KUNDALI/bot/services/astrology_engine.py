"""
Astrology Engine
Handles all Vedic astrology calculations
"""
from datetime import datetime
from typing import Dict, List, Optional


class AstrologyEngine:
    """
    Vedic Astrology Calculation Engine
    """
    
    # Rashi (Moon Sign) boundaries in degrees
    RASHI_NAMES = {
        0: 'Mesha (Aries) - मेष',
        1: 'Vrishabha (Taurus) - वृषभ',
        2: 'Mithuna (Gemini) - मिथुन',
        3: 'Karka (Cancer) - कर्क',
        4: 'Simha (Leo) - सिंह',
        5: 'Kanya (Virgo) - कन्या',
        6: 'Tula (Libra) - तुला',
        7: 'Vrishchika (Scorpio) - वृश्चिक',
        8: 'Dhanu (Sagittarius) - धनु',
        9: 'Makara (Capricorn) - मकर',
        10: 'Kumbha (Aquarius) - कुंभ',
        11: 'Meena (Pisces) - मीन'
    }
    
    # Nakshatras (27 lunar mansions)
    NAKSHATRAS = [
        'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira',
        'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha',
        'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra',
        'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula',
        'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta',
        'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
    ]
    
    # Dasha lords for each Nakshatra
    NAKSHATRA_DASHA_LORDS = {
        'Ashwini': 'Ketu', 'Bharani': 'Venus', 'Krittika': 'Sun',
        'Rohini': 'Moon', 'Mrigashira': 'Mars', 'Ardra': 'Rahu',
        'Punarvasu': 'Jupiter', 'Pushya': 'Saturn', 'Ashlesha': 'Mercury',
        'Magha': 'Ketu', 'Purva Phalguni': 'Venus', 'Uttara Phalguni': 'Sun',
        'Hasta': 'Moon', 'Chitra': 'Mars', 'Swati': 'Rahu',
        'Vishakha': 'Jupiter', 'Anuradha': 'Saturn', 'Jyeshtha': 'Mercury',
        'Mula': 'Ketu', 'Purva Ashadha': 'Venus', 'Uttara Ashadha': 'Sun',
        'Shravana': 'Moon', 'Dhanishta': 'Mars', 'Shatabhisha': 'Rahu',
        'Purva Bhadrapada': 'Jupiter', 'Uttara Bhadrapada': 'Saturn',
        'Revati': 'Mercury'
    }
    
    # Vimshottari Dasha durations in years
    DASHA_DURATIONS = {
        'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10,
        'Mars': 7, 'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17
    }
    
    # Dasha sequence
    DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
    
    def __init__(self, birth_date: str, birth_time: str, birth_place: str):
        """
        Initialize Astrology Engine
        
        Args:
            birth_date: Date of birth (DD-MM-YYYY)
            birth_time: Time of birth (HH:MM AM/PM)
            birth_place: Place of birth (City, Country)
        """
        self.birth_date = birth_date
        self.birth_time = birth_time
        self.birth_place = birth_place
        
        # Parse birth date
        day, month, year = map(int, birth_date.split('-'))
        self.birth_datetime = datetime(year, month, day)
        
        # Parse birth time
        self.birth_hour, self.birth_minute = self._parse_time(birth_time)
        
        # Calculate moon position (simplified)
        self.moon_longitude = self._calculate_moon_longitude()
        
        # Calculate nakshatra
        self.nakshatra_index = int(self.moon_longitude / 13.333) % 27
        self.nakshatra = self.NAKSHATRAS[self.nakshatra_index]
    
    def _parse_time(self, time_str: str) -> tuple:
        """
        Parse time string to hour and minute
        
        Args:
            time_str: Time string (HH:MM AM/PM)
        
        Returns:
            Tuple of (hour, minute) in 24-hour format
        """
        time_str = time_str.strip().upper()
        
        # Extract period
        is_pm = 'PM' in time_str
        time_part = time_str.replace('AM', '').replace('PM', '').strip()
        
        hour, minute = map(int, time_part.split(':'))
        
        # Convert to 24-hour format
        if is_pm and hour != 12:
            hour += 12
        elif not is_pm and hour == 12:
            hour = 0
        
        return hour, minute
    
    def _calculate_moon_longitude(self) -> float:
        """
        Calculate Moon's longitude (simplified algorithm)
        
        In production, use swephys library for accurate calculations
        
        Returns:
            Moon longitude in degrees (0-360)
        """
        # Simplified calculation based on birth date
        # This is a placeholder - use swephys for production
        
        days_since_epoch = (self.birth_datetime - datetime(1900, 1, 1)).days
        
        # Moon moves approximately 13.176 degrees per day
        moon_position = (days_since_epoch * 13.176 + self.birth_hour * 0.545) % 360
        
        return moon_position
    
    def calculate_rashi(self) -> str:
        """
        Calculate Moon Sign (Rashi)
        
        Returns:
            Rashi name
        """
        rashi_index = int(self.moon_longitude // 30)
        return self.RASHI_NAMES.get(rashi_index, 'Unknown')
    
    def calculate_lagna(self) -> str:
        """
        Calculate Ascendant (Lagna)
        
        Returns:
            Lagna sign
        """
        # Simplified calculation
        # In production, use proper sidereal time calculation
        
        # Approximate lagna based on birth hour
        hour_offset = (self.birth_hour + self.birth_minute / 60) / 24 * 360
        day_offset = (self.birth_datetime.day * 0.9856) % 360
        
        lagna_degree = (hour_offset + day_offset + 180) % 360
        lagna_index = int(lagna_degree // 30)
        
        return self.RASHI_NAMES.get(lagna_index, 'Unknown')
    
    def calculate_nakshatra(self) -> str:
        """
        Calculate Birth Nakshatra
        
        Returns:
            Nakshatra name
        """
        return self.nakshatra
    
    def calculate_current_dasha(self) -> Dict[str, str]:
        """
        Calculate current Mahadasha and Antardasha
        
        Returns:
            Dictionary with mahadasha and antardasha
        """
        # Get Mahadasha lord from nakshatra
        mahadasha_lord = self.NAKSHATRA_DASHA_LORDS.get(self.nakshatra, 'Ketu')
        
        # Calculate years elapsed since birth
        current_date = datetime.now()
        years_elapsed = (current_date - self.birth_datetime).days / 365.25
        
        # Simplified dasha calculation
        # In production, calculate exact nakshatra balance
        
        # Determine current mahadasha
        start_index = self.DASHA_SEQUENCE.index(mahadasha_lord)
        
        # Calculate which dasha we're in
        total_years = 0
        current_mahadasha = mahadasha_lord
        
        for i in range(len(self.DASHA_SEQUENCE)):
            idx = (start_index + i) % len(self.DASHA_SEQUENCE)
            dasha = self.DASHA_SEQUENCE[idx]
            duration = self.DASHA_DURATIONS[dasha]
            
            if total_years <= years_elapsed < total_years + duration:
                current_mahadasha = dasha
                break
            
            total_years += duration
        
        # Calculate antardasha (simplified)
        antardasha = self._calculate_antardasha(current_mahadasha, years_elapsed)
        
        return {
            'mahadasha': current_mahadasha,
            'antardasha': antardasha
        }
    
    def _calculate_antardasha(self, mahadasha: str, years_elapsed: float) -> str:
        """
        Calculate current Antardasha within Mahadasha
        
        Args:
            mahadasha: Current Mahadasha planet
            years_elapsed: Years since birth
        
        Returns:
            Antardasha planet name
        """
        mahadasha_duration = self.DASHA_DURATIONS[mahadasha]
        
        # Find position within current mahadasha
        mahadasha_start = years_elapsed - (years_elapsed % mahadasha_duration)
        years_in_mahadasha = years_elapsed - mahadasha_start
        
        # Calculate antardasha
        mahadasha_index = self.DASHA_SEQUENCE.index(mahadasha)
        
        for i, antardasha in enumerate(self.DASHA_SEQUENCE):
            antardasha_duration = (self.DASHA_DURATIONS[antardasha] / 9)
            
            if years_in_mahadasha < antardasha_duration:
                return antardasha
            
            years_in_mahadasha -= antardasha_duration
        
        return self.DASHA_SEQUENCE[0]
    
    def generate_past_events(self) -> List[str]:
        """
        Generate believable past life events based on birth details
        
        Returns:
            List of past event descriptions
        """
        events = []
        
        # Calculate age
        current_year = datetime.now().year
        birth_year = self.birth_datetime.year
        age = current_year - birth_year
        
        # Generate events based on age and dasha periods
        if age > 25:
            events.append(
                f"{current_year - 5} के आसपास आपको करियर या जीवन में एक महत्वपूर्ण बदलाव हुआ होगा, "
                f"जिसने आपके जीवन की दिशा बदल दी।"
            )
        
        if age > 20:
            events.append(
                f"2020-2022 के दौरान आपको मानसिक तनाव या परिवार के साथ कुछ चुनौतियां आई होंगी, "
                f"लेकिन आपने उनका सामना अच्छे से किया।"
            )
        
        if age > 18:
            events.append(
                f"आपकी {18}-{22} की उम्र में शिक्षा या करियर के संदर्भ में कुछ महत्वपूर्ण निर्णय लिए होंगे।"
            )
        
        # Add relationship event
        events.append(
            "आपने अपने जीवन में कुछ ऐसे रिश्ते देखे हैं जो शुरू में अच्छे लगे लेकिन बाद में चुनौतीपूर्ण बने।"
        )
        
        return events[:2]  # Return only 2 events for free analysis
    
    def generate_remedy(self) -> Dict[str, str]:
        """
        Generate a simple remedy based on current dasha
        
        Returns:
            Dictionary with remedy details
        """
        dasha_info = self.calculate_current_dasha()
        mahadasha = dasha_info['mahadasha']
        
        remedies = {
            'Ketu': {
                'planet': 'केतु',
                'description': 'गुरुवार को गाय को हरा चारा खिलाएं और '
                              'ॐ केम केतवे नमः का जाप करें।',
                'mantra': 'ॐ केम केतवे नमः',
                'timing': 'हर गुरुवार सुबह'
            },
            'Venus': {
                'planet': 'शुक्र',
                'description': 'शुक्रवार को सफेद वस्त्र धारण करें और '
                              'शुद्ध गाय का दूध देवता को अर्पित करें।',
                'mantra': 'ॐ शुं शुक्राय नमः',
                'timing': 'हर शुक्रवार सुबह'
            },
            'Sun': {
                'planet': 'सूर्य',
                'description': 'रविवार को सूर्य देवता को जल अर्पित करें और '
                              'सूर्य नमस्कार करें।',
                'mantra': 'ॐ घृणि सूर्याय नमः',
                'timing': 'हर रविवार सुबह सूर्योदय के समय'
            },
            'Moon': {
                'planet': 'चंद्र',
                'description': 'सोमवार को सफेद फूल और दूध चंद्र देवता को अर्पित करें।',
                'mantra': 'ॐ शं शनैश्चराय नमः',
                'timing': 'हर सोमवार शाम'
            },
            'Mars': {
                'planet': 'मंगल',
                'description': 'मंगलवार को लाल वस्त्र धारण करें और '
                              'मक्खन या घी का दीपक जलाएं।',
                'mantra': 'ॐ क्रां क्रीं क्रौं सः भौमाय नमः',
                'timing': 'हर मंगलवार सुबह'
            },
            'Rahu': {
                'planet': 'राहु',
                'description': 'शनिवार को काले तिल का दान करें और '
                              'बुज्जुओं की सेवा करें।',
                'mantra': 'ॐ रां राहवे नमः',
                'timing': 'हर शनिवार शाम'
            },
            'Jupiter': {
                'planet': 'बृहस्पति',
                'description': 'गुरुवार को पीले वस्त्र धारण करें और '
                              'हल्दी-चने का दान करें।',
                'mantra': 'ॐ ग्रां ग्रीं ग्रौं सः गुरवे नमः',
                'timing': 'हर गुरुवार सुबह'
            },
            'Saturn': {
                'planet': 'शनि',
                'description': 'शनिवार को सरसों के तेल का दीपक जलाएं और '
                              'काले कुत्ते को खाना खिलाएं।',
                'mantra': 'ॐ शं शनैश्चराय नमः',
                'timing': 'हर शनिवार शाम'
            },
            'Mercury': {
                'planet': 'बुध',
                'description': 'बुधवार को हरे रंग के वस्त्र धारण करें और '
                              'हरी सब्जियां खाएं।',
                'mantra': 'ॐ बुं बुधाय नमः',
                'timing': 'हर बुधवार सुबह'
            }
        }
        
        return remedies.get(mahadasha, remedies['Jupiter'])
    
    def detect_yogas(self) -> List[Dict[str, str]]:
        """
        Detect major Yogas in the chart
        
        Returns:
            List of detected Yogas with descriptions
        """
        yogas = []
        
        # Simplified yoga detection
        # In production, use proper planetary position analysis
        
        rashi_index = int(self.moon_longitude // 30)
        
        # Gaja Kesari Yoga - Jupiter in Kendra from Moon
        if rashi_index % 3 == 0:
            yogas.append({
                'name': 'Gaja Kesari Yoga',
                'description': 'This yoga brings wisdom, prosperity, and good reputation.',
                'strength': 'Medium'
            })
        
        # Richa Yoga - Benefic planets in Kendra
        if rashi_index % 2 == 0:
            yogas.append({
                'name': 'Dhana Yoga',
                'description': 'Indicates wealth accumulation and financial stability.',
                'strength': 'Medium'
            })
        
        # Add a general positive yoga
        yogas.append({
            'name': 'Punya Yoga',
            'description': 'Indicates past life merits and spiritual inclination.',
            'strength': 'Strong'
        })
        
        return yogas
    
    def calculate_planetary_positions(self) -> Dict[str, str]:
        """
        Calculate positions of all planets
        
        Returns:
            Dictionary with planetary positions
        """
        # Simplified - in production use swephys
        planets = {
            'Sun': 'In favorable position',
            'Moon': f'In {self.calculate_rashi()}',
            'Mars': 'Active',
            'Mercury': 'Strong',
            'Jupiter': 'Benefic',
            'Venus': 'Favorable',
            'Saturn': 'In transit',
            'Rahu': 'Influence present',
            'Ketu': 'Spiritual influence'
        }
        
        return planets
