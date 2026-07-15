# Mapeo declarativo de atributos fuente → campos del padrón, por proveedor.
#
# El mapa NO es parte del producto canónico: es data específica de cada
# institución (nombres de atributos LDAP, cabeceras de CSV, etc.). Se carga en
# runtime desde el JSON apuntado por settings.identity_map_path (montado por el
# overlay del cliente), mismo patrón que faculty_map.py.
#
# Formato del JSON (todas las claves opcionales):
#   {
#     "ldap": {
#       "fields":      {"cn": "full_name", "givenName": "first_name", ...},
#       "identifiers": {"uid": "uid", "sAMAccountName": "samaccountname"}
#     },
#     "csv":  { "fields": {...}, "identifiers": {...} },
#     "koha": { ... }
#   }
#
# Si no hay archivo (producto agnóstico), los mapeos quedan vacíos y se aplica
# passthrough por identidad: se toman las claves fuente que ya se llaman igual
# que un campo del padrón, y como identificadores las columnas cuyo nombre
# coincide con un tipo de credencial conocido.

import json
import os

from ...config import settings
from .base import PersonRecord

# Campos asignables a PersonRecord (excluye person_key, que se resuelve aparte).
ASSIGNABLE_FIELDS = {
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "dni", "email", "home_sede_code", "home_building",
}

# Tipos de credencial reconocidos para el passthrough sin mapa configurado.
KNOWN_ID_TYPES = {"cardnumber", "uid", "samaccountname", "dni", "email"}


def _load_identity_map() -> dict:
    path = settings.identity_map_path
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


IDENTITY_MAP = _load_identity_map()


def provider_map(provider: str) -> dict:
    """Sub-mapa del proveedor dado (o {} si no hay config)."""
    return IDENTITY_MAP.get(provider, {}) or {}


def map_fields(provider: str, raw: dict) -> dict:
    """Aplica el mapeo de campos fuente→padrón. Passthrough si no hay mapa."""
    conf = provider_map(provider)
    field_map = conf.get("fields", {})
    out: dict = {}
    if field_map:
        for src, dst in field_map.items():
            val = raw.get(src)
            if val is not None and val != "":
                out[dst] = val
    else:
        # Passthrough: claves que ya se llaman como un campo del padrón.
        for key in ASSIGNABLE_FIELDS | {"person_key"}:
            val = raw.get(key)
            if val is not None and val != "":
                out[key] = val
    return out


def map_identifiers(provider: str, raw: dict) -> dict:
    """Extrae {id_type: id_value}. Passthrough por nombre de columna si no hay mapa."""
    conf = provider_map(provider)
    id_map = conf.get("identifiers", {})
    out: dict = {}
    if id_map:
        for src, id_type in id_map.items():
            val = raw.get(src)
            if val:
                out[id_type] = str(val)
    else:
        for id_type in KNOWN_ID_TYPES:
            val = raw.get(id_type)
            if val:
                out[id_type] = str(val)
    return out


def _fallback_key(provider: str, identifiers: dict) -> str | None:
    """person_key derivado cuando la fuente no trae uno explícito."""
    for id_type in ("dni", "cardnumber", "samaccountname", "uid", "email"):
        val = identifiers.get(id_type)
        if val:
            return f"{provider}:{val}"
    return None


def record_from_raw(provider: str, raw: dict, source: str) -> PersonRecord | None:
    """Construye un PersonRecord desde el dict crudo de un proveedor aplicando
    el mapeo declarativo. Devuelve None si no se puede derivar person_key."""
    fields = map_fields(provider, raw)
    identifiers = map_identifiers(provider, raw)

    person_key = fields.pop("person_key", None) or _fallback_key(provider, identifiers)
    if not person_key:
        return None

    clean = {k: v for k, v in fields.items() if k in ASSIGNABLE_FIELDS}
    return PersonRecord(
        person_key=str(person_key),
        source=source,
        raw=raw,
        identifiers=identifiers,
        **clean,
    )
