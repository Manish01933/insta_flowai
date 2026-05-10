"""
Bot Services Package
"""
from .astrology_engine import AstrologyEngine
from .numerology_engine import NumerologyEngine
from .pdf_generator import PremiumKundliReport

# PaymentProcessor (Razorpay) is intentionally NOT imported here to avoid
# bot startup failure if the 'razorpay' dependency or Razorpay credentials
# are not configured. Import PaymentProcessor lazily when needed.
__all__ = [
    'AstrologyEngine',
    'NumerologyEngine',
    'PremiumKundliReport',
]
