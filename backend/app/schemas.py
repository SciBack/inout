from pydantic import BaseModel
from datetime import datetime, time, date
from typing import Optional


# ---------------------------------------------------------------------------
# Scan / Dashboard (existentes)
# ---------------------------------------------------------------------------

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
    program: str = ""


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
    typical_avg_stay_seconds: Optional[int] = None
    peak_hour: Optional[int] = None
    typical_peak_hour: Optional[int] = None
    category_breakdown: list[CategoryCount] = []
    entries_yesterday: int = 0
    prev_day_visitors: int = 0
    prev_day_label: str = ""
    current_male: int = 0
    current_female: int = 0
    total_male_today: int = 0
    total_female_today: int = 0
    faculty_breakdown: list[FacultyCount] = []
    faculty_no_data: int = 0
    hourly_entries: list[HourlyCount] = []
    faculty_timelines: list[FacultyTimeline] = []
    faculty_events: list[FacultyEvent] = []


# ---------------------------------------------------------------------------
# Admin — Sedes
# ---------------------------------------------------------------------------

class SedeCreate(BaseModel):
    name: str
    code: str
    city: Optional[str] = None
    active: bool = True


class SedeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    city: Optional[str] = None
    active: Optional[bool] = None


class SedeResponse(BaseModel):
    id: int
    name: str
    code: str
    city: Optional[str] = None
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Admin — Spaces
# ---------------------------------------------------------------------------

class SpaceCreate(BaseModel):
    sede_id: Optional[int] = None
    name: str
    capacity: int
    location: Optional[str] = None
    active: bool = True
    open_time: Optional[time] = None
    close_time: Optional[time] = None
    description: Optional[str] = None
    address: Optional[str] = None


class SpaceUpdate(BaseModel):
    sede_id: Optional[int] = None
    name: Optional[str] = None
    capacity: Optional[int] = None
    location: Optional[str] = None
    active: Optional[bool] = None
    open_time: Optional[time] = None
    close_time: Optional[time] = None
    description: Optional[str] = None
    address: Optional[str] = None


class SpaceResponse(BaseModel):
    id: int
    sede_id: Optional[int] = None
    sede: Optional[SedeResponse] = None
    name: str
    capacity: int
    location: Optional[str] = None
    active: bool
    open_time: Optional[time] = None
    close_time: Optional[time] = None
    description: Optional[str] = None
    address: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Admin — Auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


# ---------------------------------------------------------------------------
# Admin — Users
# ---------------------------------------------------------------------------

class AdminUserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"


class AdminUserPasswordUpdate(BaseModel):
    password: str


class AdminUserResponse(BaseModel):
    id: int
    username: str
    role: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Admin — Stats
# ---------------------------------------------------------------------------

class MonthlyStatRow(BaseModel):
    month: int
    month_name: str
    unique_visitors: int
    entries: int
    exits: int
    days_with_activity: int


class StatsTotals(BaseModel):
    unique_visitors: int
    entries: int
    exits: int
    days_with_activity: int


class GenderBreakdown(BaseModel):
    male: int
    female: int


class AnnualStatsResponse(BaseModel):
    space_name: str
    year: int
    monthly: list[MonthlyStatRow]
    totals: StatsTotals
    category_breakdown: list[CategoryCount]
    faculty_breakdown: list[FacultyCount]
    gender_breakdown: GenderBreakdown


class DailyStatRow(BaseModel):
    date: date
    day_name: str
    unique_visitors: int
    entries: int
    exits: int


class MonthlyStatsResponse(BaseModel):
    space_name: str
    year_month: str
    daily: list[DailyStatRow]
