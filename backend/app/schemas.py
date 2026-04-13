from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class ScanRequest(BaseModel):
    cardnumber: str
    space_id: Optional[int] = None


class PatronInfo(BaseModel):
    cardnumber: str
    name: str
    firstname: str
    first_name: str = ""
    surname: str
    gender: str  # 'M' | 'F' | ''
    category: str
    patron_id: Optional[int] = None


class ScanResponse(BaseModel):
    event_type: str  # 'entry' | 'exit'
    patron: PatronInfo
    timestamp: datetime
    message: str
    from_cache: bool = False


class PresenceEntry(BaseModel):
    id: int
    cardnumber: str
    patron_name: str
    patron_category: str
    event_type: str
    timestamp: datetime

    class Config:
        from_attributes = True


class DashboardStats(BaseModel):
    space_name: str
    capacity: int
    current_occupancy: int
    occupancy_percent: float
    entries_today: int
    exits_today: int
    recent_events: list[PresenceEntry]
