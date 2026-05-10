"""
Payment Processor
Handles Razorpay payment integration
"""
import os
import hashlib
import hmac
from datetime import datetime
from typing import Dict, Optional

from bot.config import RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, PREMIUM_PRICE


class PaymentProcessor:
    """
    Razorpay Payment Processor
    """

    def __init__(self):
        """Initialize Razorpay client (lazy import to avoid startup crash)."""
        if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
            raise RuntimeError(
                "Razorpay is not configured. Missing RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET."
            )

        try:
            import razorpay  # lazy import: prevents bot startup failure if razorpay isn't installed
        except ModuleNotFoundError as e:
            raise RuntimeError(
                "Razorpay SDK is not installed. Install 'razorpay' to enable premium payments."
            ) from e

        self._razorpay = razorpay
        self.client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    
    def create_payment_order(
        self,
        user_id: int,
        amount: int = None,
        currency: str = 'INR'
    ) -> Dict:
        """
        Create Razorpay payment order
        
        Args:
            user_id: Telegram user ID
            amount: Payment amount in INR (default: PREMIUM_PRICE)
            currency: Currency code
        
        Returns:
            Order details dictionary
        """
        if amount is None:
            amount = PREMIUM_PRICE
        
        receipt = f'PREMIUM_{user_id}_{datetime.now().strftime("%Y%m%d%H%M%S")}'
        
        payment_data = {
            'amount': amount * 100,  # Convert to paise
            'currency': currency,
            'receipt': receipt,
            'notes': {
                'user_id': str(user_id),
                'service': 'Premium Kundli Analysis',
                'bot': 'Pandit Shri Vishwanath Shastri'
            }
        }
        
        try:
            order = self.client.order.create(data=payment_data)
            
            return {
                'order_id': order['id'],
                'amount': amount,
                'currency': currency,
                'receipt': receipt,
                'status': order['status']
            }
        except self._razorpay.errors.Error as e:
            raise Exception(f"Failed to create payment order: {str(e)}")
    
    def verify_payment_signature(
        self,
        order_id: str,
        payment_id: str,
        signature: str
    ) -> bool:
        """
        Verify Razorpay payment signature
        
        Args:
            order_id: Razorpay order ID
            payment_id: Razorpay payment ID
            signature: Razorpay signature
        
        Returns:
            Boolean indicating verification result
        """
        try:
            razorpay.utility.verify_payment_signature({
                'razorpay_order_id': order_id,
                'razorpay_payment_id': payment_id,
                'razorpay_signature': signature
            })
            return True
        except self._razorpay.errors.SignatureVerificationError:
            return False
    
    def verify_webhook_signature(
        self,
        payload: str,
        signature: str
    ) -> bool:
        """
        Verify Razorpay webhook signature
        
        Args:
            payload: Webhook payload
            signature: Webhook signature header
        
        Returns:
            Boolean indicating verification result
        """
        expected_signature = self._generate_signature(payload)
        return hmac.compare_digest(expected_signature, signature)
    
    def _generate_signature(self, payload: str) -> str:
        """
        Generate webhook signature
        
        Args:
            payload: Webhook payload
        
        Returns:
            Expected signature
        """
        secret = f"{RAZORPAY_KEY_SECRET}-webhook"
        h = hmac.new(
            secret.encode('utf-8'),
            payload.encode('utf-8'),
            digestmod=hashlib.sha256
        )
        return h.hexdigest()
    
    def get_payment_details(self, payment_id: str) -> Optional[Dict]:
        """
        Get payment details from Razorpay
        
        Args:
            payment_id: Razorpay payment ID
        
        Returns:
            Payment details or None
        """
        try:
            payment = self.client.payment.fetch(payment_id)
            return payment
        except self._razorpay.errors.Error:
            return None
    
    def get_order_details(self, order_id: str) -> Optional[Dict]:
        """
        Get order details from Razorpay
        
        Args:
            order_id: Razorpay order ID
        
        Returns:
            Order details or None
        """
        try:
            order = self.client.order.fetch(order_id)
            return order
        except self._razorpay.errors.Error:
            return None
    
    def refund_payment(
        self,
        payment_id: str,
        amount: int = None,
        reason: str = None
    ) -> Dict:
        """
        Refund a payment
        
        Args:
            payment_id: Razorpay payment ID
            amount: Refund amount in paise (None for full refund)
            reason: Refund reason
        
        Returns:
            Refund details
        """
        refund_data = {
            'receipt': f'REFUND_{payment_id}_{datetime.now().strftime("%Y%m%d%H%M%S")}'
        }
        
        if amount:
            refund_data['amount'] = amount
        
        if reason:
            refund_data['notes'] = {'reason': reason}
        
        try:
            refund = self.client.refund.create(
                {'payment_id': payment_id},
                refund_data
            )
            return refund
        except self._razorpay.errors.Error as e:
            raise Exception(f"Failed to process refund: {str(e)}")


# Singleton instance
_payment_processor = None


def get_payment_processor() -> PaymentProcessor:
    """
    Get payment processor instance
    
    Returns:
        PaymentProcessor instance
    """
    global _payment_processor
    if _payment_processor is None:
        _payment_processor = PaymentProcessor()
    return _payment_processor
