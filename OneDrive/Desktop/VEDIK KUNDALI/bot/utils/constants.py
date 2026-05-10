"""
Bot Constants
"""

# Rashi (Moon Sign) Names
RASHI_NAMES = {
    0: ('Mesha', 'मेष', 'Aries'),
    1: ('Vrishabha', 'वृषभ', 'Taurus'),
    2: ('Mithuna', 'मिथुन', 'Gemini'),
    3: ('Karka', 'कर्क', 'Cancer'),
    4: ('Simha', 'सिंह', 'Leo'),
    5: ('Kanya', 'कन्या', 'Virgo'),
    6: ('Tula', 'तुला', 'Libra'),
    7: ('Vrishchika', 'वृश्चिक', 'Scorpio'),
    8: ('Dhanu', 'धनु', 'Sagittarius'),
    9: ('Makara', 'मकर', 'Capricorn'),
    10: ('Kumbha', 'कुंभ', 'Aquarius'),
    11: ('Meena', 'मीन', 'Pisces')
}

# Nakshatra Names
NAKSHATRA_NAMES = [
    'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira',
    'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha',
    'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra',
    'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula',
    'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta',
    'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
]

# Planet Names
PLANET_NAMES = {
    'Sun': ('Surya', 'सूर्य'),
    'Moon': ('Chandra', 'चंद्र'),
    'Mars': ('Mangal', 'मंगल'),
    'Mercury': ('Budh', 'बुध'),
    'Jupiter': ('Guru', 'गुरु'),
    'Venus': ('Shukra', 'शुक्र'),
    'Saturn': ('Shani', 'शनि'),
    'Rahu': ('Rahu', 'राहु'),
    'Ketu': ('Ketu', 'केतु')
}

# Dasha Durations (Vimshottari)
DASHA_DURATIONS = {
    'Ketu': 7,
    'Venus': 20,
    'Sun': 6,
    'Moon': 10,
    'Mars': 7,
    'Rahu': 18,
    'Jupiter': 16,
    'Saturn': 19,
    'Mercury': 17
}

# Dasha Sequence
DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']

# Element Names
ELEMENTS = {
    'Fire': ('Agni', 'अग्नि'),
    'Earth': ('Prithvi', 'पृथ्वी'),
    'Air': ('Vayu', 'वायु'),
    'Water': ('Jala', 'जल')
}

# Quality Names
QUALITIES = {
    'Cardinal': ('Chara', 'चर'),
    'Fixed': ('Sthira', 'स्थिर'),
    'Mutable': ('Dwiswabhava', 'द्विस्वभाव')
}

# House Names
HOUSE_NAMES = {
    1: ('Lagna', 'लग्न', 'Self'),
    2: ('Dhana', 'धन', 'Wealth'),
    3: ('Sahaja', 'सहज', 'Effort'),
    4: ('Sukha', 'सुख', 'Happiness'),
    5: ('Punya', 'पुण्य', 'Children'),
    6: ('Ripu', 'रिपु', 'Enemies'),
    7: ('Kalatra', 'कलात्र', 'Spouse'),
    8: ('Ayur', 'आयु', 'Longevity'),
    9: ('Dharma', 'धर्म', 'Fortune'),
    10: ('Karma', 'कर्म', 'Career'),
    11: ('Labha', 'लाभ', 'Gains'),
    12: ('Vidha', 'विध', 'Loss')
}

# Gemstone Names
GEMSTONES = {
    'Sun': ('Ruby', 'मणि', 'Manikya'),
    'Moon': ('Pearl', 'मोती', 'Moti'),
    'Mars': ('Red Coral', 'मोonga', 'Moonga'),
    'Mercury': ('Emerald', 'पन्ना', 'Panna'),
    'Jupiter': ('Yellow Sapphire', 'पुखराज', 'Pukhraj'),
    'Venus': ('Diamond', 'हीरा', 'Heera'),
    'Saturn': ('Blue Sapphire', 'नीलम', 'Neelam'),
    'Rahu': ('Gomed', 'गोमेद', 'Gomed'),
    'Ketu': ('Cat\'s Eye', 'लेसुनिया', 'Lesunia')
}

# Mantras
MANTRAS = {
    'Sun': 'ॐ घृणि सूर्याय नमः',
    'Moon': 'ॐ शं चंद्राय नमः',
    'Mars': 'ॐ क्रां क्रीं क्रौं सः भौमाय नमः',
    'Mercury': 'ॐ बुं बुधाय नमः',
    'Jupiter': 'ॐ ग्रां ग्रीं ग्रौं सः गुरवे नमः',
    'Venus': 'ॐ शुं शुक्राय नमः',
    'Saturn': 'ॐ शं शनैश्चराय नमः',
    'Rahu': 'ॐ रां राहवे नमः',
    'Ketu': 'ॐ केम केतवे नमः'
}

# Days of Week
DAYS_OF_WEEK = {
    0: ('Sunday', 'रविवार', 'Sun'),
    1: ('Monday', 'सोमवार', 'Moon'),
    2: ('Tuesday', 'मंगलवार', 'Mars'),
    3: ('Wednesday', 'बुधवार', 'Mercury'),
    4: ('Thursday', 'गुरुवार', 'Jupiter'),
    5: ('Friday', 'शुक्रवार', 'Venus'),
    6: ('Saturday', 'शनिवार', 'Saturn')
}

# Colors
COLORS = {
    'Sun': ['Red', 'Orange', 'Saffron'],
    'Moon': ['White', 'Cream', 'Silver'],
    'Mars': ['Red', 'Scarlet'],
    'Mercury': ['Green', 'Light Green'],
    'Jupiter': ['Yellow', 'Gold', 'Orange'],
    'Venus': ['White', 'Pink', 'Light Blue'],
    'Saturn': ['Black', 'Dark Blue', 'Purple'],
    'Rahu': ['Black', 'Dark Grey'],
    'Ketu': ['Red', 'Orange']
}

# Numbers
LUCKY_NUMBERS = {
    'Sun': [1, 10, 19],
    'Moon': [2, 11, 20],
    'Mars': [9, 18, 27],
    'Mercury': [5, 14, 23],
    'Jupiter': [3, 12, 21],
    'Venus': [6, 15, 24],
    'Saturn': [8, 17, 26],
    'Rahu': [4, 13, 22],
    'Ketu': [7, 16, 25]
}
