"""Libros más prestados.

Lee la circulación de Koha por su API REST, la guarda en tablas propias y arma
el ranking por día / últimos 7 días / últimos 30 días que muestra el dashboard.

Por qué una copia local y no consultar Koha en cada refresco: el dashboard se
refresca cada pocos segundos en varias pantallas. Con la copia, Koha se consulta
una vez cada `materials_sync_minutes` y el dashboard sigue mostrando lo último
conocido si Koha no responde.

Privacidad: de cada préstamo solo se guarda el título, la sucursal y la fecha.
Nunca quién lo pidió.

Portadas, en este orden (cada fuente se omite si no está configurada):
  1. koha        — la que la propia biblioteca cargó (cover_images). Es la mejor.
  2. openlibrary — por ISBN; con default=false responde 404 si no hay, así que
                   un 200 es una portada real.
  3. google      — endpoint viewapi (el mismo que usa Koha en GoogleJackets).
                   Solo se confía cuando informa `thumbnail_url`: el endpoint de
                   imágenes de Google devuelve un relleno gris («image not
                   available» o una tapa genérica) cuando no hay portada, y ese
                   relleno es indistinguible de una portada por tamaño o hash.
Sin portada → el dashboard dibuja una tarjeta tipográfica.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import MaterialCover, MaterialLoan, MaterialTitle

LIMA = ZoneInfo("America/Lima")
logger = logging.getLogger(__name__)

PER_PAGE = 100
MAX_PAGES = 200            # tope de seguridad contra un bucle de paginación
COVER_RETRY_DAYS = 7       # cada cuánto reintentar un título que no tenía portada
COVERS_PER_RUN = 25        # tope de búsquedas de portada por corrida
TITLES_PER_RUN = 60
MAX_COVER_BYTES = 1_500_000
MIN_COVER_BYTES = 800      # Koha responde un GIF de 43 bytes cuando no hay portada
TOP_FOR_COVERS = 12        # portadas que se aseguran por lista del ranking

PERIODS: tuple[tuple[str, str], ...] = (
    ("day", "Hoy"),
    ("week", "Últimos 7 días"),
    ("month", "Últimos 30 días"),
)

# Estado de la última sincronización, para que el dashboard muestre "actualizado
# a las". Se pierde al reiniciar (no importa: la primera corrida sale a los 20 s).
sync_state: dict = {"ok_at": None, "error": None}


# ── Periodos ────────────────────────────────────────────────────────────────

def period_starts(now: datetime | None = None) -> dict[str, datetime]:
    """Inicio de cada periodo en hora Lima. 'week' y 'month' incluyen hoy: los
    últimos 7 días son hoy y los 6 anteriores."""
    now = (now or datetime.now(LIMA)).astimezone(LIMA)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "day": today,
        "week": today - timedelta(days=6),
        "month": today - timedelta(days=29),
    }


# ── Texto de catálogo ───────────────────────────────────────────────────────

_ISBD_TAIL = re.compile(r"[\s/:;,=.]+$")
_ISBN = re.compile(r"\b(97[89]\d{10}|\d{9}[\dXx])\b")


def clean_isbd(text: str | None) -> str:
    """Quita la puntuación ISBD que MARC deja al final ('Fisiología humana /')."""
    return _ISBD_TAIL.sub("", (text or "").strip()).strip()


def compose_title(title: str | None, subtitle: str | None) -> str:
    main, sub = clean_isbd(title), clean_isbd(subtitle)
    if main and sub and sub.lower() not in main.lower():
        return f"{main}: {sub}"[:500]
    return (main or sub)[:500]


def extract_isbns(raw: str | None) -> list[str]:
    """ISBN-13 primero (más probable que la fuente de portadas lo conozca)."""
    found = _ISBN.findall((raw or "").replace("-", ""))
    return sorted(dict.fromkeys(found), key=lambda i: (len(i) != 13,))


# ── Ranking ─────────────────────────────────────────────────────────────────

def top_titles(db: Session, since: datetime, library_code: str | None, limit: int) -> list[dict]:
    """Títulos más prestados desde `since`. Desempata por el préstamo más
    reciente: ante dos títulos con los mismos préstamos gana el que se movió
    después, que es el que la gente tiene en la cabeza."""
    q = (
        db.query(
            MaterialLoan.biblio_id,
            func.count(MaterialLoan.checkout_id).label("loans"),
            func.max(MaterialLoan.checkout_date).label("last_at"),
        )
        .filter(MaterialLoan.checkout_date >= since)
    )
    if library_code:
        q = q.filter(MaterialLoan.library_code == library_code)
    rows = (
        q.group_by(MaterialLoan.biblio_id)
        .order_by(desc("loans"), desc("last_at"), MaterialLoan.biblio_id)
        .limit(limit)
        .all()
    )
    if not rows:
        return []
    titles = {
        t.biblio_id: t
        for t in db.query(MaterialTitle).filter(
            MaterialTitle.biblio_id.in_([r.biblio_id for r in rows])
        )
    }
    out = []
    for rank, r in enumerate(rows, start=1):
        t = titles.get(r.biblio_id)
        out.append({
            "rank": rank,
            "biblio_id": r.biblio_id,
            "title": (t.title if t and t.title else f"Registro {r.biblio_id}"),
            "author": (t.author if t else None) or None,
            "loans": r.loans,
            "last_loan_at": r.last_at,
            "has_cover": bool(t and t.cover_source),
        })
    return out


def total_loans(db: Session, since: datetime, library_code: str | None) -> int:
    q = db.query(func.count(MaterialLoan.checkout_id)).filter(MaterialLoan.checkout_date >= since)
    if library_code:
        q = q.filter(MaterialLoan.library_code == library_code)
    return q.scalar() or 0


# ── Koha: préstamos y fichas ────────────────────────────────────────────────

def _parse_checkout(row: dict) -> dict | None:
    """Fila de /checkouts (con el ítem embebido) → lo que se guarda. None si
    falta algo esencial."""
    try:
        biblio_id = row["item"]["biblio_id"]
        return {
            "checkout_id": row["checkout_id"],
            "biblio_id": biblio_id,
            "library_code": row.get("library_id"),
            "checkout_date": datetime.fromisoformat(row["checkout_date"]),
            "onsite": bool(row.get("onsite_checkout")),
        }
    except (KeyError, TypeError, ValueError):
        return None


async def _fetch_checkouts(
    client: httpx.AsyncClient, since: datetime, checked_in: bool
) -> list[dict]:
    """Todos los préstamos desde `since`. Koha separa los vigentes de los ya
    devueltos: sin `checked_in` solo trae los primeros."""
    rows: list[dict] = []
    q = json.dumps({"checkout_date": {">=": since.astimezone(LIMA).isoformat(timespec="seconds")}})
    for page in range(1, MAX_PAGES + 1):
        params = {"_per_page": PER_PAGE, "_page": page, "q": q}
        if checked_in:
            params["checked_in"] = "true"
        resp = await client.get("/checkouts", params=params, headers={"x-koha-embed": "item"})
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data)
        if len(data) < PER_PAGE:
            break
    return rows


def _upsert_loans(db: Session, parsed: list[dict]) -> int:
    for p in parsed:
        db.merge(MaterialLoan(**p))
    db.commit()
    return len(parsed)


async def _fetch_title(client: httpx.AsyncClient, biblio_id: int) -> dict | None:
    resp = await client.get(f"/biblios/{biblio_id}", headers={"Accept": "application/json"})
    if resp.status_code != 200:
        return None
    d = resp.json()
    if not isinstance(d, dict):
        return None
    return {
        "biblio_id": biblio_id,
        "title": compose_title(d.get("title"), d.get("subtitle")) or None,
        "author": clean_isbd(d.get("author")) or None,
        "isbn": (d.get("isbn") or "")[:300] or None,
        "item_type": d.get("item_type"),
    }


async def sync_loans(db: Session, client: httpx.AsyncClient, now: datetime | None = None) -> dict:
    """Trae los préstamos nuevos y las fichas de los títulos que aún no se conocen."""
    now = (now or datetime.now(LIMA)).astimezone(LIMA)
    first_run = db.query(func.count(MaterialLoan.checkout_id)).scalar() == 0
    days = settings.materials_backfill_days if first_run else settings.materials_overlap_days
    since = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)

    raw: list[dict] = []
    for checked_in in (False, True):
        raw.extend(await _fetch_checkouts(client, since, checked_in))
    parsed = [p for p in map(_parse_checkout, raw) if p]
    skipped = len(raw) - len(parsed)
    saved = _upsert_loans(db, parsed)

    known = {r[0] for r in db.query(MaterialTitle.biblio_id)}
    missing = sorted({p["biblio_id"] for p in parsed} - known)[:TITLES_PER_RUN]
    new_titles = 0
    for biblio_id in missing:
        try:
            ficha = await _fetch_title(client, biblio_id)
        except httpx.HTTPError as e:
            logger.warning("[materials] ficha %s: %s", biblio_id, e)
            continue
        if ficha:
            db.merge(MaterialTitle(**ficha))
            new_titles += 1
    db.commit()
    return {"loans": saved, "skipped": skipped, "titles": new_titles, "since": since.isoformat()}


# ── Portadas ────────────────────────────────────────────────────────────────

def _is_image(resp: httpx.Response) -> bool:
    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
    return (
        resp.status_code == 200
        and ctype.startswith("image/")
        and MIN_COVER_BYTES <= len(resp.content) <= MAX_COVER_BYTES
    )


async def _cover_koha(web: httpx.AsyncClient, biblio_id: int, isbns: list[str]) -> tuple[bytes, str] | None:
    base = settings.materials_opac_url.rstrip("/")
    if not base:
        return None
    url = f"{base}/cgi-bin/koha/opac-image.pl"
    for params in ({"biblionumber": biblio_id}, {"biblionumber": biblio_id, "thumbnail": 1}):
        resp = await web.get(url, params=params)
        if _is_image(resp):
            return resp.content, resp.headers["content-type"].split(";")[0]
    return None


async def _cover_openlibrary(web: httpx.AsyncClient, biblio_id: int, isbns: list[str]) -> tuple[bytes, str] | None:
    for isbn in isbns[:3]:
        resp = await web.get(
            f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg", params={"default": "false"}
        )
        if _is_image(resp):
            return resp.content, "image/jpeg"
    return None


async def _cover_google(web: httpx.AsyncClient, biblio_id: int, isbns: list[str]) -> tuple[bytes, str] | None:
    if not isbns:
        return None
    keys = ",".join(f"ISBN:{i}" for i in isbns[:3])
    resp = await web.get("https://books.google.com/books", params={"jscmd": "viewapi", "bibkeys": keys, "callback": "x"})
    if resp.status_code != 200:
        return None
    # Respuesta JSONP: x({...});  Sin `thumbnail_url` no hay portada real.
    m = re.search(r"\((\{.*\})\)", resp.text, re.S)
    if not m:
        return None
    try:
        entries = json.loads(m.group(1))
    except ValueError:
        return None
    for entry in entries.values():
        thumb = entry.get("thumbnail_url") if isinstance(entry, dict) else None
        if not thumb:
            continue
        img = await web.get(thumb.replace("&edge=curl", ""))
        if _is_image(img):
            return img.content, img.headers["content-type"].split(";")[0]
    return None


_COVER_FETCHERS = {"koha": _cover_koha, "openlibrary": _cover_openlibrary, "google": _cover_google}


async def resolve_cover(db: Session, web: httpx.AsyncClient, title: MaterialTitle) -> str | None:
    """Busca la portada de un título en las fuentes configuradas y la guarda.
    Devuelve la fuente que la dio, o None. Siempre deja constancia de que se
    buscó, para no repetir la búsqueda en cada corrida."""
    isbns = extract_isbns(title.isbn)
    found: tuple[bytes, str, str] | None = None
    for source in (s.strip() for s in settings.materials_cover_sources.split(",")):
        fetch = _COVER_FETCHERS.get(source)
        if not fetch:
            continue
        try:
            got = await fetch(web, title.biblio_id, isbns)
        except httpx.HTTPError as e:
            logger.info("[materials] portada %s vía %s: %s", title.biblio_id, source, e)
            continue
        if got:
            found = (got[0], got[1], source)
            break
    title.cover_checked_at = datetime.now(LIMA)
    title.cover_source = found[2] if found else None
    if found:
        db.merge(MaterialCover(biblio_id=title.biblio_id, data=found[0], content_type=found[1], source=found[2]))
    db.commit()
    return title.cover_source


def _aware(dt: datetime) -> datetime:
    """SQLite (pruebas) devuelve fechas sin zona; PostgreSQL, con zona."""
    return dt if dt.tzinfo else dt.replace(tzinfo=LIMA)


def covers_wanted(db: Session, now: datetime | None = None) -> list[MaterialTitle]:
    """Títulos de las cabeceras del ranking que necesitan buscarse portada."""
    now = (now or datetime.now(LIMA)).astimezone(LIMA)
    starts = period_starts(now)
    libs = [r[0] for r in db.query(MaterialLoan.library_code)
            .filter(MaterialLoan.checkout_date >= starts["month"]).distinct()]
    ids: list[int] = []
    for since in starts.values():
        for lib in [None, *libs]:
            ids += [t["biblio_id"] for t in top_titles(db, since, lib, TOP_FOR_COVERS)]
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    retry_before = now - timedelta(days=COVER_RETRY_DAYS)
    return [
        t for t in db.query(MaterialTitle).filter(MaterialTitle.biblio_id.in_(ids))
        if t.cover_checked_at is None
        or (t.cover_source is None and _aware(t.cover_checked_at) < retry_before)
    ][:COVERS_PER_RUN]


async def refresh_covers(db: Session, web: httpx.AsyncClient) -> int:
    n = 0
    for title in covers_wanted(db):
        if await resolve_cover(db, web, title):
            n += 1
    return n


# ── Corrida completa (la llama el scheduler) ────────────────────────────────

async def run_materials_sync() -> None:
    """Tolerante a fallos: nunca lanza. Si Koha no responde, el dashboard sigue
    mostrando lo último que se sincronizó."""
    if not settings.materials_enabled:
        return
    url, user, password = settings.materials_koha()
    if not url:
        logger.warning("[materials] materials_enabled sin URL de Koha: no se sincroniza")
        return
    db = SessionLocal()
    try:
        async with httpx.AsyncClient(
            base_url=url, auth=(user, password), verify=settings.koha_verify_ssl, timeout=30
        ) as koha:
            stats = await sync_loans(db, koha)
        async with httpx.AsyncClient(
            verify=True, timeout=15, follow_redirects=True,
            headers={"User-Agent": "InOut/1.0 (biblioteca universitaria)"},
        ) as web:
            stats["covers"] = await refresh_covers(db, web)
        sync_state.update(ok_at=datetime.now(LIMA), error=None)
        logger.info("[materials] sync ok: %s", stats)
    except Exception as e:  # noqa: BLE001 — el job nunca debe tumbar el scheduler
        db.rollback()
        sync_state["error"] = f"{type(e).__name__}: {e}"[:200]
        logger.exception("[materials] error en la sincronización")
    finally:
        db.close()
