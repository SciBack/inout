from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, distinct
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from jose import JWTError, jwt
import bcrypt as _bcrypt
from collections import defaultdict
import calendar

from ..database import get_db
from ..models import AdminUser, Space, PresenceLog, Sede
from ..config import settings
from ..schemas import (
    LoginRequest, TokenResponse,
    SedeCreate, SedeUpdate, SedeResponse,
    SpaceCreate, SpaceUpdate, SpaceResponse,
    AdminUserCreate, AdminUserPasswordUpdate, AdminUserResponse,
    AnnualStatsResponse, MonthlyStatsResponse,
    MonthlyStatRow, StatsTotals, GenderBreakdown,
    DailyStatRow, CategoryCount, FacultyCount,
)

router = APIRouter(prefix="/admin", tags=["admin"])

LIMA = ZoneInfo("America/Lima")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8

def _hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()

def _verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())
bearer_scheme = HTTPBearer()

MONTH_NAMES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

DAY_NAMES = {
    0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves",
    4: "Viernes", 5: "Sábado", 6: "Domingo",
}

CATEGORY_LABELS = {
    "ESTUDI": "Estudiantes",
    "DOCEN": "Docentes",
    "ADMIN": "Administrativos",
}

FACULTY_LABELS = {
    "FCS": "Salud",
    "FCE": "Cs. Empresariales",
    "FIA": "Ingeniería",
    "FACTEO": "Teología",
    "FACIHED": "Humanidades",
    "EPG": "Posgrado",
    "COLEGIO": "Colegio Unión",
}


# ---------------------------------------------------------------------------
# Helpers JWT / auth
# ---------------------------------------------------------------------------

def _create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AdminUser:
    payload = _decode_token(credentials.credentials)
    username: str = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token sin sujeto")
    user = db.query(AdminUser).filter(AdminUser.username == username, AdminUser.active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado o inactivo")
    return user


def require_superadmin(current_user: AdminUser = Depends(get_current_user)) -> AdminUser:
    if current_user.role != "superadmin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol superadmin")
    return current_user


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(AdminUser).filter(
        AdminUser.username == body.username,
        AdminUser.active == True,
    ).first()
    if not user or not _verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )
    token = _create_token({"sub": user.username, "role": user.role})
    return TokenResponse(access_token=token, role=user.role)


# ---------------------------------------------------------------------------
# Sedes CRUD
# ---------------------------------------------------------------------------

@router.get("/sedes", response_model=list[SedeResponse])
def list_sedes(current_user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Sede).order_by(Sede.id).all()


@router.post("/sedes", response_model=SedeResponse, status_code=status.HTTP_201_CREATED)
def create_sede(body: SedeCreate, current_user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.query(Sede).filter(Sede.code == body.code.upper()).first():
        raise HTTPException(status_code=409, detail="Ya existe una sede con ese código")
    sede = Sede(**{**body.model_dump(), "code": body.code.upper()})
    db.add(sede)
    db.commit()
    db.refresh(sede)
    return sede


@router.put("/sedes/{sede_id}", response_model=SedeResponse)
def update_sede(sede_id: int, body: SedeUpdate, current_user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sede = db.query(Sede).filter(Sede.id == sede_id).first()
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(sede, field, value.upper() if field == "code" and value else value)
    db.commit()
    db.refresh(sede)
    return sede


@router.delete("/sedes/{sede_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sede(sede_id: int, current_user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sede = db.query(Sede).filter(Sede.id == sede_id).first()
    if not sede:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    sede.active = False
    db.commit()


# ---------------------------------------------------------------------------
# Spaces CRUD
# ---------------------------------------------------------------------------

@router.get("/spaces", response_model=list[SpaceResponse])
def list_spaces(
    sede_id: int = None,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Space).options(joinedload(Space.sede)).order_by(Space.sede_id, Space.id)
    if sede_id:
        q = q.filter(Space.sede_id == sede_id)
    return q.all()


@router.post("/spaces", response_model=SpaceResponse, status_code=status.HTTP_201_CREATED)
def create_space(
    body: SpaceCreate,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    space = Space(**body.model_dump())
    db.add(space)
    db.commit()
    db.refresh(space)
    return space


@router.get("/spaces/{space_id}", response_model=SpaceResponse)
def get_space(
    space_id: int,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Espacio no encontrado")
    return space


@router.put("/spaces/{space_id}", response_model=SpaceResponse)
def update_space(
    space_id: int,
    body: SpaceUpdate,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Espacio no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)
    db.commit()
    db.refresh(space)
    return space


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_space(
    space_id: int,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Espacio no encontrado")
    space.active = False
    db.commit()


# ---------------------------------------------------------------------------
# Stats — anuales
# ---------------------------------------------------------------------------

@router.get("/spaces/{space_id}/stats/annual", response_model=AnnualStatsResponse)
def annual_stats(
    space_id: int,
    year: int = None,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if year is None:
        year = datetime.now(LIMA).year

    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Espacio no encontrado")

    base_filter = and_(
        PresenceLog.space_id == space_id,
        func.extract("year", PresenceLog.timestamp) == year,
    )

    # Entradas y salidas por mes
    entries_by_month = dict(
        db.query(
            func.extract("month", PresenceLog.timestamp).label("month"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "entry")
        .group_by(func.extract("month", PresenceLog.timestamp))
        .all()
    )

    exits_by_month = dict(
        db.query(
            func.extract("month", PresenceLog.timestamp).label("month"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "exit")
        .group_by(func.extract("month", PresenceLog.timestamp))
        .all()
    )

    # Visitantes únicos por mes (solo entries)
    unique_by_month = dict(
        db.query(
            func.extract("month", PresenceLog.timestamp).label("month"),
            func.count(distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "entry")
        .group_by(func.extract("month", PresenceLog.timestamp))
        .all()
    )

    # Días con actividad por mes
    days_by_month = dict(
        db.query(
            func.extract("month", PresenceLog.timestamp).label("month"),
            func.count(distinct(func.date(PresenceLog.timestamp))).label("cnt"),
        )
        .filter(base_filter)
        .group_by(func.extract("month", PresenceLog.timestamp))
        .all()
    )

    monthly = []
    for m in range(1, 13):
        mk = float(m)
        entries = int(entries_by_month.get(mk, 0))
        exits = int(exits_by_month.get(mk, 0))
        unique = int(unique_by_month.get(mk, 0))
        days = int(days_by_month.get(mk, 0))
        if entries > 0 or exits > 0:
            monthly.append(MonthlyStatRow(
                month=m,
                month_name=MONTH_NAMES[m],
                unique_visitors=unique,
                entries=entries,
                exits=exits,
                days_with_activity=days,
            ))

    totals = StatsTotals(
        unique_visitors=sum(r.unique_visitors for r in monthly),
        entries=sum(r.entries for r in monthly),
        exits=sum(r.exits for r in monthly),
        days_with_activity=sum(r.days_with_activity for r in monthly),
    )

    # Desglose por categoría (visitantes únicos del año, solo entries)
    cat_rows = (
        db.query(
            PresenceLog.patron_category,
            func.count(distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "entry")
        .group_by(PresenceLog.patron_category)
        .order_by(func.count(distinct(PresenceLog.cardnumber)).desc())
        .all()
    )
    category_breakdown = [
        CategoryCount(
            category=row.patron_category or "OTROS",
            label=CATEGORY_LABELS.get(row.patron_category or "", row.patron_category or "Otros"),
            count=row.cnt,
        )
        for row in cat_rows
    ]

    # Desglose por facultad (visitantes únicos del año, solo entries)
    fac_rows = (
        db.query(
            PresenceLog.patron_faculty,
            func.count(distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(
            base_filter,
            PresenceLog.event_type == "entry",
            PresenceLog.patron_faculty.isnot(None),
            PresenceLog.patron_faculty != "",
        )
        .group_by(PresenceLog.patron_faculty)
        .order_by(func.count(distinct(PresenceLog.cardnumber)).desc())
        .all()
    )
    faculty_breakdown = [
        FacultyCount(
            faculty=row.patron_faculty,
            label=FACULTY_LABELS.get(row.patron_faculty, row.patron_faculty),
            count=row.cnt,
        )
        for row in fac_rows
    ]

    # Desglose por género (entradas totales del año)
    male_count = (
        db.query(func.count(PresenceLog.id))
        .filter(base_filter, PresenceLog.event_type == "entry", PresenceLog.patron_gender == "M")
        .scalar() or 0
    )
    female_count = (
        db.query(func.count(PresenceLog.id))
        .filter(base_filter, PresenceLog.event_type == "entry", PresenceLog.patron_gender == "F")
        .scalar() or 0
    )

    return AnnualStatsResponse(
        space_name=space.name,
        year=year,
        monthly=monthly,
        totals=totals,
        category_breakdown=category_breakdown,
        faculty_breakdown=faculty_breakdown,
        gender_breakdown=GenderBreakdown(male=male_count, female=female_count),
    )


# ---------------------------------------------------------------------------
# Stats — detalle mensual
# ---------------------------------------------------------------------------

@router.get("/spaces/{space_id}/stats/monthly", response_model=MonthlyStatsResponse)
def monthly_stats(
    space_id: int,
    month: str = None,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    month: formato YYYY-MM (ej. 2026-04). Por defecto mes actual.
    """
    now_lima = datetime.now(LIMA)
    if month is None:
        year = now_lima.year
        mon = now_lima.month
    else:
        try:
            year, mon = int(month[:4]), int(month[5:7])
        except (ValueError, IndexError):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Formato de mes inválido. Use YYYY-MM")

    space = db.query(Space).filter(Space.id == space_id).first()
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Espacio no encontrado")

    base_filter = and_(
        PresenceLog.space_id == space_id,
        func.extract("year", PresenceLog.timestamp) == year,
        func.extract("month", PresenceLog.timestamp) == mon,
    )

    entries_by_day = dict(
        db.query(
            func.date(PresenceLog.timestamp).label("day"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "entry")
        .group_by(func.date(PresenceLog.timestamp))
        .all()
    )

    exits_by_day = dict(
        db.query(
            func.date(PresenceLog.timestamp).label("day"),
            func.count(PresenceLog.id).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "exit")
        .group_by(func.date(PresenceLog.timestamp))
        .all()
    )

    unique_by_day = dict(
        db.query(
            func.date(PresenceLog.timestamp).label("day"),
            func.count(distinct(PresenceLog.cardnumber)).label("cnt"),
        )
        .filter(base_filter, PresenceLog.event_type == "entry")
        .group_by(func.date(PresenceLog.timestamp))
        .all()
    )

    # Generar filas solo para días con actividad
    active_days = sorted(set(entries_by_day.keys()) | set(exits_by_day.keys()))

    daily = []
    for d in active_days:
        from datetime import date as date_type
        if isinstance(d, str):
            d_obj = date_type.fromisoformat(d)
        else:
            d_obj = d
        daily.append(DailyStatRow(
            date=d_obj,
            day_name=DAY_NAMES[d_obj.weekday()],
            unique_visitors=int(unique_by_day.get(d, 0)),
            entries=int(entries_by_day.get(d, 0)),
            exits=int(exits_by_day.get(d, 0)),
        ))

    return MonthlyStatsResponse(
        space_name=space.name,
        year_month=f"{year:04d}-{mon:02d}",
        daily=daily,
    )


# ---------------------------------------------------------------------------
# Users (solo superadmin)
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    current_user: AdminUser = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    return db.query(AdminUser).order_by(AdminUser.id).all()


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    body: AdminUserCreate,
    current_user: AdminUser = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    if db.query(AdminUser).filter(AdminUser.username == body.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El usuario ya existe")
    user = AdminUser(
        username=body.username,
        password_hash=_hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/password", response_model=AdminUserResponse)
def change_password(
    user_id: int,
    body: AdminUserPasswordUpdate,
    current_user: AdminUser = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    user = db.query(AdminUser).filter(AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    user.password_hash = _hash_password(body.password)
    db.commit()
    db.refresh(user)
    return user
