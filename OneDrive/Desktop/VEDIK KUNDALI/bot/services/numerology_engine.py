"""
Numerology Engine
Handles all numerology calculations and interpretations
"""
from typing import Dict, List, Optional


class NumerologyEngine:
    """
    Numerology Calculation Engine
    """
    
    # Pythagorean numerology letter values
    LETTER_VALUES = {
        'A': 1, 'J': 1, 'S': 1,
        'B': 2, 'K': 2, 'T': 2,
        'C': 3, 'L': 3, 'U': 3,
        'D': 4, 'M': 4, 'V': 4,
        'E': 5, 'N': 5, 'W': 5,
        'F': 6, 'O': 6, 'X': 6,
        'G': 7, 'P': 7, 'Y': 7,
        'H': 8, 'Q': 8, 'Z': 8,
        'I': 9, 'R': 9
    }
    
    # Vowels for Soul Urge calculation
    VOWELS = {'A', 'E', 'I', 'O', 'U', 'Y'}
    
    # Life Path Number meanings
    LIFE_PATH_MEANINGS = {
        1: {
            'title': 'The Leader',
            'strengths': ['Independent', 'Ambitious', 'Innovative', 'Courageous'],
            'challenges': ['Can be domineering', 'Impatient', 'Self-centered'],
            'career': ['Entrepreneur', 'Manager', 'Leader', 'Inventor'],
            'love': 'Needs independence in relationships',
            'lucky_numbers': [1, 10, 19, 28],
            'lucky_colors': ['Red', 'Orange'],
            'lucky_days': ['Sunday', 'Monday']
        },
        2: {
            'title': 'The Peacemaker',
            'strengths': ['Diplomatic', 'Sensitive', 'Cooperative', 'Intuitive'],
            'challenges': ['Overly sensitive', 'Indecisive', 'Dependent'],
            'career': ['Counselor', 'Mediator', 'Artist', 'Healer'],
            'love': 'Seeks harmony and partnership',
            'lucky_numbers': [2, 11, 20, 29],
            'lucky_colors': ['White', 'Cream', 'Pink'],
            'lucky_days': ['Monday', 'Friday']
        },
        3: {
            'title': 'The Creative',
            'strengths': ['Expressive', 'Optimistic', 'Artistic', 'Social'],
            'challenges': ['Scattered', 'Superficial', 'Moody'],
            'career': ['Writer', 'Actor', 'Designer', 'Entertainer'],
            'love': 'Romantic and expressive',
            'lucky_numbers': [3, 12, 21, 30],
            'lucky_colors': ['Yellow', 'Gold'],
            'lucky_days': ['Thursday', 'Sunday']
        },
        4: {
            'title': 'The Builder',
            'strengths': ['Practical', 'Disciplined', 'Loyal', 'Hardworking'],
            'challenges': ['Rigid', 'Stubborn', 'Overly serious'],
            'career': ['Engineer', 'Accountant', 'Architect', 'Manager'],
            'love': 'Values stability and commitment',
            'lucky_numbers': [4, 13, 22, 31],
            'lucky_colors': ['Green', 'Brown'],
            'lucky_days': ['Saturday', 'Wednesday']
        },
        5: {
            'title': 'The Freedom Seeker',
            'strengths': ['Adventurous', 'Versatile', 'Curious', 'Adaptable'],
            'challenges': ['Restless', 'Irresponsible', 'Impulsive'],
            'career': ['Travel', 'Sales', 'Marketing', 'Journalism'],
            'love': 'Needs freedom and variety',
            'lucky_numbers': [5, 14, 23, 32],
            'lucky_colors': ['Blue', 'Turquoise'],
            'lucky_days': ['Wednesday', 'Friday']
        },
        6: {
            'title': 'The Nurturer',
            'strengths': ['Responsible', 'Caring', 'Protective', 'Harmonious'],
            'challenges': ['Interfering', 'Self-righteous', 'Worrying'],
            'career': ['Teacher', 'Nurse', 'Counselor', 'Social Worker'],
            'love': 'Devoted and family-oriented',
            'lucky_numbers': [6, 15, 24, 33],
            'lucky_colors': ['Pink', 'Violet'],
            'lucky_days': ['Friday', 'Monday']
        },
        7: {
            'title': 'The Seeker',
            'strengths': ['Analytical', 'Spiritual', 'Introspective', 'Wise'],
            'challenges': ['Aloof', 'Secretive', 'Pessimistic'],
            'career': ['Researcher', 'Philosopher', 'Scientist', 'Spiritual Guide'],
            'love': 'Needs intellectual connection',
            'lucky_numbers': [7, 16, 25, 34],
            'lucky_colors': ['Purple', 'Violet'],
            'lucky_days': ['Sunday', 'Monday']
        },
        8: {
            'title': 'The Powerhouse',
            'strengths': ['Ambitious', 'Authoritative', 'Successful', 'Confident'],
            'challenges': ['Materialistic', 'Workaholic', 'Controlling'],
            'career': ['Business', 'Finance', 'Executive', 'Lawyer'],
            'love': 'Values success and status',
            'lucky_numbers': [8, 17, 26, 35],
            'lucky_colors': ['Black', 'Grey'],
            'lucky_days': ['Saturday', 'Tuesday']
        },
        9: {
            'title': 'The Humanitarian',
            'strengths': ['Compassionate', 'Generous', 'Idealistic', 'Wise'],
            'challenges': ['Emotional', 'Unrealistic', 'Self-pitying'],
            'career': ['Humanitarian', 'Artist', 'Teacher', 'Healer'],
            'love': 'Gives deeply and unconditionally',
            'lucky_numbers': [9, 18, 27, 36],
            'lucky_colors': ['Red', 'Orange'],
            'lucky_days': ['Tuesday', 'Sunday']
        },
        11: {
            'title': 'The Master Intuitive',
            'strengths': ['Intuitive', 'Inspiring', 'Visionary', 'Spiritual'],
            'challenges': ['Anxious', 'Impractical', 'Overly sensitive'],
            'career': ['Spiritual Leader', 'Inspirational Speaker', 'Artist'],
            'love': 'Seeks soul connection',
            'lucky_numbers': [11, 20, 29, 38],
            'lucky_colors': ['Silver', 'White'],
            'lucky_days': ['Monday', 'Friday']
        },
        22: {
            'title': 'The Master Builder',
            'strengths': ['Practical Visionary', 'Powerful', 'Successful', 'Disciplined'],
            'challenges': ['Overwhelming pressure', 'Workaholic', 'Stress'],
            'career': ['Architect', 'Developer', 'CEO', 'Builder'],
            'love': 'Builds lasting relationships',
            'lucky_numbers': [22, 31, 40, 49],
            'lucky_colors': ['Gold', 'Brown'],
            'lucky_days': ['Saturday', 'Wednesday']
        },
        33: {
            'title': 'The Master Teacher',
            'strengths': ['Nurturing', 'Healing', 'Teaching', 'Compassionate'],
            'challenges': ['Self-sacrificing', 'Overly giving', 'Burnout'],
            'career': ['Teacher', 'Healer', 'Counselor', 'Spiritual Guide'],
            'love': 'Loves unconditionally',
            'lucky_numbers': [33, 42, 51, 60],
            'lucky_colors': ['Pink', 'Gold'],
            'lucky_days': ['Friday', 'Thursday']
        }
    }
    
    # Karmic lesson meanings
    KARMIC_LESSONS = {
        1: 'Need to develop independence and leadership',
        2: 'Need to develop cooperation and sensitivity',
        3: 'Need to develop self-expression and creativity',
        4: 'Need to develop discipline and practicality',
        5: 'Need to develop adaptability and freedom',
        6: 'Need to develop responsibility and nurturing',
        7: 'Need to develop spiritual awareness and analysis',
        8: 'Need to develop material success and authority',
        9: 'Need to develop compassion and humanitarianism'
    }
    
    def __init__(self, birth_date: str):
        """
        Initialize Numerology Engine
        
        Args:
            birth_date: Date of birth (DD-MM-YYYY)
        """
        self.birth_date = birth_date
        day, month, year = map(int, birth_date.split('-'))
        self.birth_day = day
        self.birth_month = month
        self.birth_year = year
    
    def reduce_number(self, num: int) -> int:
        """
        Reduce number to single digit (except master numbers 11, 22, 33)
        
        Args:
            num: Number to reduce
        
        Returns:
            Reduced number
        """
        master_numbers = {11, 22, 33}
        
        while num > 9 and num not in master_numbers:
            num = sum(int(digit) for digit in str(num))
        
        return num
    
    def calculate_life_path_number(self) -> int:
        """
        Calculate Life Path Number from Date of Birth
        
        Example: 15-08-1990
        Day: 15 → 1+5 = 6
        Month: 08 → 8
        Year: 1990 → 1+9+9+0 = 19 → 1+9 = 10 → 1+0 = 1
        Life Path: 6+8+1 = 15 → 1+5 = 6
        
        Returns:
            Life Path Number
        """
        day_reduced = self.reduce_number(self.birth_day)
        month_reduced = self.reduce_number(self.birth_month)
        year_reduced = self.reduce_number(self.birth_year)
        
        life_path = day_reduced + month_reduced + year_reduced
        
        return self.reduce_number(life_path)
    
    def calculate_destiny_number(self, full_name: str) -> int:
        """
        Calculate Destiny Number (Expression Number) from full name
        
        Each letter is converted to its numerical value
        Then reduced to single digit
        
        Args:
            full_name: Full name of the person
        
        Returns:
            Destiny Number
        """
        if not full_name:
            return 0
        
        name = full_name.upper().replace(' ', '').replace('-', '')
        total = sum(self.LETTER_VALUES.get(letter, 0) for letter in name)
        
        return self.reduce_number(total)
    
    def calculate_soul_urge_number(self, full_name: str) -> int:
        """
        Calculate Soul Urge Number from vowels in name
        
        Represents inner desires and motivations
        
        Args:
            full_name: Full name of the person
        
        Returns:
            Soul Urge Number
        """
        if not full_name:
            return 0
        
        name = full_name.upper()
        vowel_total = sum(
            self.LETTER_VALUES.get(letter, 0) 
            for letter in name if letter in self.VOWELS
        )
        
        if vowel_total == 0:
            return 0
        
        return self.reduce_number(vowel_total)
    
    def calculate_personality_number(self, full_name: str) -> int:
        """
        Calculate Personality Number from consonants in name
        
        Represents outer personality and how others see you
        
        Args:
            full_name: Full name of the person
        
        Returns:
            Personality Number
        """
        if not full_name:
            return 0
        
        consonants = set(self.LETTER_VALUES.keys()) - self.VOWELS
        name = full_name.upper()
        
        consonant_total = sum(
            self.LETTER_VALUES.get(letter, 0) 
            for letter in name if letter in consonants
        )
        
        if consonant_total == 0:
            return 0
        
        return self.reduce_number(consonant_total)
    
    def calculate_karmic_lessons(self, full_name: str) -> Dict[int, str]:
        """
        Identify missing numbers in name (1-9)
        
        Missing numbers indicate karmic lessons to learn
        
        Args:
            full_name: Full name of the person
        
        Returns:
            Dictionary of missing numbers and their meanings
        """
        if not full_name:
            return {}
        
        name = full_name.upper().replace(' ', '').replace('-', '')
        present_numbers = set()
        
        for letter in name:
            if letter in self.LETTER_VALUES:
                present_numbers.add(self.LETTER_VALUES[letter])
        
        all_numbers = set(range(1, 10))
        missing_numbers = all_numbers - present_numbers
        
        return {num: self.KARMIC_LESSONS[num] for num in missing_numbers}
    
    def get_life_path_meaning(self, life_path: int) -> Dict[str, any]:
        """
        Get detailed meaning of Life Path Number
        
        Args:
            life_path: Life Path Number
        
        Returns:
            Dictionary with life path interpretation
        """
        return self.LIFE_PATH_MEANINGS.get(life_path, {
            'title': 'Unique Path',
            'strengths': ['Adaptable', 'Versatile'],
            'challenges': ['Finding direction'],
            'career': ['Multiple paths possible'],
            'love': 'Seeks meaningful connection',
            'lucky_numbers': [life_path],
            'lucky_colors': ['White'],
            'lucky_days': ['Sunday']
        })
    
    def get_lucky_numbers(self) -> List[int]:
        """
        Get lucky numbers based on Life Path
        
        Returns:
            List of lucky numbers
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('lucky_numbers', [life_path])
    
    def get_lucky_colors(self) -> List[str]:
        """
        Get lucky colors based on Life Path
        
        Returns:
            List of lucky colors
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('lucky_colors', ['White'])
    
    def get_lucky_days(self) -> List[str]:
        """
        Get lucky days based on Life Path
        
        Returns:
            List of lucky days
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('lucky_days', ['Sunday'])
    
    def get_career_suggestions(self) -> List[str]:
        """
        Get career suggestions based on Life Path
        
        Returns:
            List of career suggestions
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('career', ['Various options available'])
    
    def get_strengths(self) -> List[str]:
        """
        Get strengths based on Life Path
        
        Returns:
            List of strengths
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('strengths', ['Adaptable'])
    
    def get_challenges(self) -> List[str]:
        """
        Get challenges based on Life Path
        
        Returns:
            List of challenges
        """
        life_path = self.calculate_life_path_number()
        meaning = self.get_life_path_meaning(life_path)
        return meaning.get('challenges', ['Finding balance'])
