from pydantic import BaseModel
from datetime import datetime, time, date
from typing import Optional


# ---------------------------------------------------------------------------
# Scan / Dashboard (existentes)
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    cardnumber: str
    space_id: Optional[int] = None
    # Fase 4 (cola offline): hora real de captura en el kiosko, no de reenvío.
    # Ausente = comportamiento de hoy (server_default now()).
    scanned_at: Optional[datetime] = None
    # Identificador generado por el kiosko para reenvío idempotente: reenviar
    # el mismo evento dos veces no debe duplicarlo. Ausente = escaneo en vivo.
    client_event_id: Optional[str] = None


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
    # False = no se encontró en ningún padrón. El evento SÍ se registró (InOut
    # mide ocupación, no controla acceso); el kiosko lo usa para avisarle a la
    # persona, no para negarle nada.
    identified: bool = True


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


class ProgramCount(BaseModel):
    program: str
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


class HomeSedeCount(BaseModel):
    home_sede_code: Optional[str] = None   # null = "origen no registrado"
    label: str                              # nombre de la sede, o "Origen no registrado"
    count: int                              # visitantes ÚNICOS hoy (por cardnumber) con ese origen


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
    cross_campus_breakdown: list[HomeSedeCount] = []


# ---------------------------------------------------------------------------
# Público — Spaces (kiosko, sin autenticación)
# ---------------------------------------------------------------------------

class PublicSpaceResponse(BaseModel):
    id: int
    name: str
    capacity: int
    sede_code: Optional[str] = None
    sede_name: Optional[str] = None
    # Coordenadas de la SEDE (no del space): alimentan el cálculo de
    # amanecer/atardecer real del kiosko (modo día/noche). None mientras el
    # admin no las haya cargado — el kiosko cae a un modo por defecto.
    sede_latitude: Optional[float] = None
    sede_longitude: Optional[float] = None


# ---------------------------------------------------------------------------
# Público — Dashboard multi-edificio (página de inicio, sin autenticación)
# ---------------------------------------------------------------------------

class BuildingOverview(BaseModel):
    id: int
    name: str
    sede_id: Optional[int] = None
    sede_code: Optional[str] = None
    sede_name: Optional[str] = None
    capacity: int
    current_occupancy: int
    occupancy_percent: float
    entries_today: int
    exits_today: int


class OverviewTotals(BaseModel):
    capacity: int
    current_occupancy: int
    occupancy_percent: float
    buildings: int


class SpacesOverviewResponse(BaseModel):
    as_of: datetime
    totals: OverviewTotals
    buildings: list[BuildingOverview]


# ---------------------------------------------------------------------------
# Admin — Sedes
# ---------------------------------------------------------------------------

class SedeCreate(BaseModel):
    name: str
    code: str
    city: Optional[str] = None
    active: bool = True
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SedeUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    city: Optional[str] = None
    active: Optional[bool] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SedeResponse(BaseModel):
    id: int
    name: str
    code: str
    city: Optional[str] = None
    active: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
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
    library_code: Optional[str] = None


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
    library_code: Optional[str] = None


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
    library_code: Optional[str] = None
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


class StatsFilters(BaseModel):
    """Filtros efectivamente aplicados — el frontend los usa para reflejar el
    ámbito activo (breadcrumb, chips) sin tener que reconstruirlo él mismo."""
    sede_id: Optional[int] = None
    space_id: Optional[int] = None
    category: Optional[str] = None
    faculty: Optional[str] = None
    program: Optional[str] = None


class AnnualStatsResponse(BaseModel):
    scope_label: str  # "Todo el sistema" | "Lima" | "CRAI Lima"
    year: int
    monthly: list[MonthlyStatRow]
    totals: StatsTotals
    category_breakdown: list[CategoryCount]
    faculty_breakdown: list[FacultyCount]
    program_breakdown: list[ProgramCount]
    gender_breakdown: GenderBreakdown
    filters: StatsFilters


class DailyStatRow(BaseModel):
    date: date
    day_name: str
    unique_visitors: int
    entries: int
    exits: int


class MonthlyStatsResponse(BaseModel):
    scope_label: str
    year_month: str
    daily: list[DailyStatRow]
    filters: StatsFilters


class StatsFilterOptions(BaseModel):
    """Catálogo para poblar los selects de filtro — independiente de qué haya
    en el rango de fechas actual, así las opciones no 'desaparecen' al mover
    el filtro de fecha."""
    sedes: list[SedeResponse]
    spaces: list[SpaceResponse]
    categories: list[CategoryCount]  # perfil canónico conocido por el overlay; count siempre 0 (catálogo, no medición)
    faculties: list[str]
    programs: list[str]


# ---------------------------------------------------------------------------
# Admin — Identidad (padrón local y proveedores)
# ---------------------------------------------------------------------------

class PersonResponse(BaseModel):
    id: int
    person_key: str
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    gender: Optional[str] = None
    category: Optional[str] = None
    faculty: Optional[str] = None
    program: Optional[str] = None
    escuela: Optional[str] = None
    role: Optional[str] = None
    document_number: Optional[str] = None
    email: Optional[str] = None
    home_sede_code: Optional[str] = None
    home_building: Optional[str] = None
    source: Optional[str] = None
    synced_at: Optional[datetime] = None
    active: bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProviderSyncRunResponse(BaseModel):
    id: int
    provider: str
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created: int = 0
    updated: int = 0
    errors: int = 0
    status: Optional[str] = None

    class Config:
        from_attributes = True
