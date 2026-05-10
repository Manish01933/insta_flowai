"""
Database Connection and Session Management
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from bot.config import DATABASE_URL
from .models import Base


# Create database engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    poolclass=StaticPool if "sqlite" in DATABASE_URL else None
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """
    Initialize database by creating all tables
    """
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    """
    Get database session
    
    Yields:
        Database session
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def save_user_data(user_id: int, **kwargs) -> None:
    """
    Save user data to database
    
    Args:
        user_id: Telegram user ID
        **kwargs: User data to save
    """
    from .models import User
    
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.user_id == user_id).first()
        
        if user:
            # Update existing user
            for key, value in kwargs.items():
                if hasattr(user, key):
                    setattr(user, key, value)
        else:
            # Create new user
            user = User(user_id=user_id, **kwargs)
            db.add(user)
        
        db.commit()
        db.refresh(user)
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


def get_user(user_id: int):
    """
    Get user by Telegram user ID
    
    Args:
        user_id: Telegram user ID
    
    Returns:
        User object or None
    """
    from .models import User
    
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.user_id == user_id).first()
        return user
    finally:
        db.close()


def update_user_last_interaction(user_id: int) -> None:
    """
    Update user's last interaction timestamp
    
    Args:
        user_id: Telegram user ID
    """
    from .models import User
    from datetime import datetime
    
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.user_id == user_id).first()
        if user:
            user.last_interaction = datetime.utcnow()
            db.commit()
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


def record_premium_purchase(
    user_id: int,
    amount: float,
    payment_id: str = None,
    order_id: str = None
) -> None:
    """
    Record a premium purchase
    
    Args:
        user_id: Telegram user ID
        amount: Purchase amount
        payment_id: Payment ID from gateway
        order_id: Order ID from gateway
    """
    from .models import PremiumPurchase, User
    
    db = SessionLocal()
    try:
        # Create purchase record
        purchase = PremiumPurchase(
            user_id=user_id,
            amount=amount,
            payment_id=payment_id,
            order_id=order_id,
            status='pending'
        )
        db.add(purchase)
        
        # Update user premium status
        user = db.query(User).filter(User.user_id == user_id).first()
        if user:
            user.is_premium = True
        
        db.commit()
        db.refresh(purchase)
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


def update_purchase_status(purchase_id: int, status: str, report_filename: str = None) -> None:
    """
    Update premium purchase status
    
    Args:
        purchase_id: Purchase ID
        status: New status
        report_filename: Generated report filename
    """
    from .models import PremiumPurchase
    from datetime import datetime
    
    db = SessionLocal()
    try:
        purchase = db.query(PremiumPurchase).filter(PremiumPurchase.id == purchase_id).first()
        if purchase:
            purchase.status = status
            if status == 'completed':
                purchase.completed_at = datetime.utcnow()
                purchase.report_sent = True
            if report_filename:
                purchase.report_filename = report_filename
            db.commit()
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


def get_user_purchases(user_id: int):
    """
    Get all purchases for a user
    
    Args:
        user_id: Telegram user ID
    
    Returns:
        List of PremiumPurchase objects
    """
    from .models import PremiumPurchase
    
    db = SessionLocal()
    try:
        purchases = db.query(PremiumPurchase).filter(
            PremiumPurchase.user_id == user_id
        ).order_by(PremiumPurchase.purchase_date.desc()).all()
        return purchases
    finally:
        db.close()


def get_total_premium_users() -> int:
    """
    Get total number of premium users
    
    Returns:
        Count of premium users
    """
    from .models import User
    
    db = SessionLocal()
    try:
        count = db.query(User).filter(User.is_premium == True).count()
        return count
    finally:
        db.close()


def get_total_users() -> int:
    """
    Get total number of users
    
    Returns:
        Count of all users
    """
    from .models import User
    
    db = SessionLocal()
    try:
        count = db.query(User).count()
        return count
    finally:
        db.close()
