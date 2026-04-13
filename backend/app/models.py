from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Time, ForeignKey
from sqlalchemy.sql import func
from .database import Base


class Space(Base):
    __tablename__ = "spaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    capacity = Column(Integer, nullable=False)
    location = Column(String(100))
    active = Column(Boolean, default=True)
    open_time = Column(Time, nullable=True)
    close_time = Column(Time, nullable=True)
    description = Column(Text, nullable=True)
    address = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PresenceLog(Base):
    __tablename__ = "presence_log"

    id = Column(Integer, primary_key=True, index=True)
    cardnumber = Column(String(50), nullable=False, index=True)
    patron_name = Column(String(200))
    patron_category = Column(String(50))
    patron_gender = Column(String(1))   # 'M' | 'F' | None
    patron_faculty = Column(String(20)) # sort1 de Koha
    event_type = Column(String(10), nullable=False)  # 'entry' | 'exit'
    space_id = Column(Integer, ForeignKey("spaces.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="admin")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
