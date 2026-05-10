"""
Database Models
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, Text, ForeignKey
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class User(Base):
    """
    User model for storing user information
    """
    __tablename__ = 'users'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, unique=True, index=True, nullable=False)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    
    # Birth details
    birth_date = Column(String(10), nullable=True)  # DD-MM-YYYY
    birth_time = Column(String(10), nullable=True)  # HH:MM AM/PM
    birth_place = Column(String(255), nullable=True)
    
    # Astrology data (cached)
    rashi = Column(String(50), nullable=True)
    lagna = Column(String(50), nullable=True)
    nakshatra = Column(String(50), nullable=True)
    
    # Numerology data (cached)
    life_path_number = Column(Integer, nullable=True)
    
    # User status
    is_premium = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_interaction = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship to premium purchases
    purchases = relationship('PremiumPurchase', back_populates='user')
    
    def __repr__(self):
        return f"<User(user_id={self.user_id}, username={self.username})>"
    
    def to_dict(self):
        """Convert user to dictionary"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': self.username,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'birth_date': self.birth_date,
            'birth_time': self.birth_time,
            'birth_place': self.birth_place,
            'rashi': self.rashi,
            'lagna': self.lagna,
            'nakshatra': self.nakshatra,
            'life_path_number': self.life_path_number,
            'is_premium': self.is_premium,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class PremiumPurchase(Base):
    """
    Premium purchase model for tracking premium subscriptions
    """
    __tablename__ = 'premium_purchases'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.user_id'), nullable=False)
    
    # Payment details
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default='INR')
    payment_id = Column(String(255), nullable=True)
    order_id = Column(String(255), nullable=True)
    
    # Purchase status
    status = Column(String(50), default='pending')  # pending, completed, failed, refunded
    report_sent = Column(Boolean, default=False)
    report_filename = Column(String(255), nullable=True)
    
    # Timestamps
    purchase_date = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    refunded_at = Column(DateTime, nullable=True)
    
    # Relationship to user
    user = relationship('User', back_populates='purchases')
    
    def __repr__(self):
        return f"<PremiumPurchase(id={self.id}, user_id={self.user_id}, amount={self.amount})>"
    
    def to_dict(self):
        """Convert purchase to dictionary"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'amount': self.amount,
            'currency': self.currency,
            'payment_id': self.payment_id,
            'order_id': self.order_id,
            'status': self.status,
            'report_sent': self.report_sent,
            'report_filename': self.report_filename,
            'purchase_date': self.purchase_date.isoformat() if self.purchase_date else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None
        }


class AnalysisHistory(Base):
    """
    Analysis history model for tracking generated analyses
    """
    __tablename__ = 'analysis_history'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.user_id'), nullable=False)
    
    # Analysis type
    analysis_type = Column(String(50), nullable=False)  # free, premium
    
    # Analysis data
    analysis_data = Column(Text, nullable=True)  # JSON string
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship to user
    user = relationship('User')
    
    def __repr__(self):
        return f"<AnalysisHistory(id={self.id}, user_id={self.user_id}, type={self.analysis_type})>"


class BotSettings(Base):
    """
    Bot settings model for storing configurable settings
    """
    __tablename__ = 'bot_settings'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    description = Column(String(255), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<BotSettings(key={self.key}, value={self.value})>"
