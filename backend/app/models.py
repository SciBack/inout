from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from .database import Base


class Space(Base):
    __tablename__ = "spaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    capacity = Column(Integer, nullable=False)
    location = Column(String(100))
    active = Column(Boolean, default=True)


class PresenceLog(Base):
    __tablename__ = "presence_log"

    id = Column(Integer, primary_key=True, index=True)
    cardnumber = Column(String(50), nullable=False, index=True)
    patron_name = Column(String(200))
    patron_category = Column(String(50))
    event_type = Column(String(10), nullable=False)  # 'entry' | 'exit'
    space_id = Column(Integer, ForeignKey("spaces.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="admin")
