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
    faculty: str = ""


class ScanResponse(BaseModel):
    event_type: str  # 'entry' | 'exit'
    patron: PatronInfo
    timestamp: datetime
    message: str
    duration: Optional[str] = None  # solo en salida, solo visual
    from_cache: bool = False


class PresenceEntry(BaseModel):
    id: int
    cardnumber: str
    patron_name: str
    patron_category: str
    patron_gender: Optional[str] = ""
    event_type: str
    timestamp: datetime

    class Config:
        from_attributes = True


class CategoryCount(BaseModel):
    category: str
    label: str
    count: int


class FacultyCount(BaseModel):
    faculty: str
    label: str
    count: int


class HourlyCount(BaseModel):
    hour: int
    count: int


class FacultyTimeline(BaseModel):
    faculty: str
    label: str
    data: list[HourlyCount]


class FacultyEvent(BaseModel):
    faculty: str
    label: str
    event_type: str   # 'entry' | 'exit'
    ts: str           # ISO timestamp — el frontend convierte a hora local


class DashboardStats(BaseModel):
    space_name: str
    capacity: int
    current_occupancy: int
    occupancy_percent: float
    entries_today: int
    exits_today: int
    recent_events: list[PresenceEntry]
    unique_visitors_today: int = 0
    avg_stay_seconds: Optional[int] = None
    peak_hour: Optional[int] = None
    category_breakdown: list[CategoryCount] = []
    entries_yesterday: int = 0
    current_male: int = 0
    current_female: int = 0
    faculty_breakdown: list[FacultyCount] = []
    hourly_entries: list[HourlyCount] = []
    faculty_timelines: list[FacultyTimeline] = []
    faculty_events: list[FacultyEvent] = []
