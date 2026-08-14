# Resolución de identidad en el escaneo. Implementa el flujo del diseño:
#   1. Buscar en person_identifiers → padrón local (instantáneo, sin red).
#   2. Si no está → relleno perezoso: lookup en vivo por proveedores en orden
#      de prioridad, con timeout corto; upsert al padrón y devolver.
#   3. Si nada responde/encuentra → (None, "unidentified").
#
# NUNCA lanza excepción hacia arriba: el conteo de aforo no se detiene.

import asyncio
import logging

from sqlalchemy.orm import Session

from ...config import settings
from ...models import Person
from .providers import build_enabled_providers
from .repository import esta_de_baja, find_person_by_value, upsert_person

logger = logging.getLogger(__name__)

# Timeout por proveedor en el relleno perezoso (hot path del kiosko).
LOOKUP_TIMEOUT = 2.0


async def resolve_person(
    db: Session, id_type: str, id_value: str, sede_code: str = ""
) -> tuple[Person | None, str]:
    """Resuelve la persona de un escaneo. Devuelve (Person|None, origen).

    origen ∈ {"local", <nombre_proveedor>, "unidentified"}.

    `sede_code` se propaga al relleno perezoso para que las fuentes multi-sede
    (Koha por campus) consulten la instancia correcta.
    """
    id_value = (id_value or "").strip()
    if not id_value:
        return None, "unidentified"

    # (1) Padrón local: se busca por VALOR, no por tipo — la persona pudo
    # presentar cualquiera de sus credenciales (carné o documento).
    try:
        person = find_person_by_value(db, id_value)
        if person is not None:
            return person, "local"
    except Exception:
        logger.exception("resolve_person: fallo consultando el padrón local")

    # (1.bis) Baja conocida: no se pregunta a nadie más.
    #
    #   Si el padrón ya dijo que esta persona causó baja, consultar en vivo a
    #   los proveedores la resucitaría de hecho: las fuentes con menos autoridad
    #   la conservan mucho después —la biblioteca no borra a sus lectores— y
    #   devolverían una ficha perfectamente válida. Quien causó baja dejó de ser
    #   comunidad: si aparece por el edificio se cuenta como visita.
    try:
        if esta_de_baja(db, id_value):
            return None, "unidentified"
    except Exception:
        logger.exception("resolve_person: fallo comprobando la baja")

    # (2) Relleno perezoso en vivo, por prioridad.
    try:
        providers = build_enabled_providers(settings)
    except Exception:
        logger.exception("resolve_person: fallo construyendo proveedores")
        providers = []

    for provider in providers:
        try:
            rec = await asyncio.wait_for(
                provider.lookup(id_type, id_value, sede_code), timeout=LOOKUP_TIMEOUT
            )
        except Exception:
            logger.warning(f"resolve_person: lookup en '{provider.name}' falló", exc_info=True)
            continue
        if rec is None:
            continue

        # Asegurar que la credencial consultada quede indexada al padrón.
        rec.identifiers.setdefault(id_type, id_value)
        try:
            person = upsert_person(db, rec, rec.source or provider.name)
            return person, provider.name
        except Exception:
            db.rollback()
            logger.exception(f"resolve_person: upsert falló tras lookup en '{provider.name}'")
            continue

    # (3) Sin identificar — el aforo sigue registrando aguas arriba.
    return None, "unidentified"
