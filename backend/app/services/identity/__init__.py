# Paquete de proveedores de identidad pluggable (padrón local + relleno en vivo).
#
# API pública que consumen las capas superiores (sync, scan):
#   - PersonRecord / IdentityProvider  → contrato neutral de proveedor
#   - build_enabled_providers(settings) → proveedores habilitados por prioridad
#   - upsert_person(db, rec, source)    → upsert idempotente al padrón
#   - resolve_person(db, id_type, id_value) → resolución del escaneo (nunca lanza)

from .base import PersonRecord, IdentityProvider
from .providers import build_enabled_providers
from .repository import upsert_person, find_person_by_identifier
from .resolver import resolve_person

__all__ = [
    "PersonRecord",
    "IdentityProvider",
    "build_enabled_providers",
    "upsert_person",
    "find_person_by_identifier",
    "resolve_person",
]
