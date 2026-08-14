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
#       "value_patterns": {"document_type": "^urn:schac:...:([^:]+):"},
#     "csv":  { "fields": {...}, "identifiers": {...} },
#     "koha": { ... }
#   }
#
# Si no hay archivo (producto agnóstico), los mapeos quedan vacíos y se aplica
# passthrough por identidad: se toman las claves fuente que ya se llaman igual
# que un campo del padrón, y como identificadores las columnas cuyo nombre
# coincide con un tipo de credencial conocido.

import json
import logging
import os
import re

from ...config import settings
from ...models import Person
from .base import PersonRecord

logger = logging.getLogger(__name__)

# Longitud máxima de cada campo, leída del propio modelo: si mañana se ensancha
# una columna, este límite la sigue solo. Declararlo a mano sería una segunda
# copia que se desincroniza en silencio.
FIELD_MAX_LEN: dict[str, int] = {
    col.name: col.type.length
    for col in Person.__table__.columns
    if getattr(col.type, "length", None)
}

# Campos asignables a PersonRecord (excluye person_key, que se resuelve aparte).
ASSIGNABLE_FIELDS = {
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "document_number", "document_type", "email",
    "home_sede_code", "home_building",
}

# Tipos de credencial reconocidos para el passthrough sin mapa configurado.
KNOWN_ID_TYPES = {"cardnumber", "uid", "samaccountname", "document_number", "email"}


def _load_identity_map() -> dict:
    path = settings.identity_map_path
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


IDENTITY_MAP = _load_identity_map()


# Tipos de credencial que identifican a la PERSONA y no al registro de un
# sistema: documento nacional, carné de extranjería, pasaporte. Cuál es el
# identificador legal de alguien depende del país y de la institución, así que
# el canónico no lo asume — lo declara el overlay. Vacío = producto agnóstico.
GLOBAL_IDENTIFIERS: tuple[str, ...] = tuple(
    IDENTITY_MAP.get("_global_identifiers", []) or []
)


# Orden de autoridad entre fuentes, de más a menos. Una persona la ven varios
# sistemas y no todos saben lo mismo de ella: el de identidad institucional sabe
# dónde trabaja hoy, la biblioteca guarda dónde estudió. Sin este orden manda
# quien sincronice último, que es un detalle de calendario. Vacío = todas mandan
# por igual (comportamiento del producto agnóstico).
SOURCE_PRECEDENCE: tuple[str, ...] = tuple(
    IDENTITY_MAP.get("_source_precedence", []) or []
)


def provider_map(provider: str) -> dict:
    """Sub-mapa del proveedor dado (o {} si no hay config)."""
    return IDENTITY_MAP.get(provider, {}) or {}


def _collapse(provider: str, field: str, val):
    """Colapsa un valor multivalor a uno solo usando la precedencia declarada.

    Ej.: eduPersonAffiliation ['faculty','student'] + precedence
    ['faculty','staff','student'] → 'faculty'. Determinista a propósito: la
    fuente puede no serlo (un híbrido resuelve distinto según qué origen ganó).

    Sin precedencia declarada NO se toma val[0]: el orden en que un directorio
    devuelve un atributo multivalor no está garantizado, así que el mismo
    registro podía resolver distinto entre dos sincronizaciones y hacer que
    una persona cambiara de programa sola. Se ordena antes de elegir: cuál
    gana es arbitrario, pero es siempre el mismo. Declarar precedencia sigue
    siendo la vía para elegir a conciencia.
    """
    if not isinstance(val, list):
        return val
    order = provider_map(provider).get("precedence", {}).get(field)
    if order:
        for candidate in order:
            if candidate in val:
                return candidate
    return sorted(val, key=str)[0] if val else None


def _fits(provider: str, field: str, val):
    """Descarta el valor que no cabe en su columna, en vez de dejar que reviente
    la fila entera.

    Las fuentes guardan texto descriptivo donde el padrón declara códigos: `ou`
    de LDAP llega con 128 caracteres, `title` con 80, `sort2` de Koha con 64. Sin
    esta guarda el INSERT falla y se pierde a la PERSONA COMPLETA por un campo
    accesorio —pasaba con 141 registros por corrida, y el mismo valor rompía el
    escaneo en vivo—. Perder un cargo es un dato menos; perder a la persona es un
    hueco en el padrón que se arrastra a diario.

    Se descarta y NO se recorta a propósito: un código truncado es un código
    distinto, y podría colisionar con uno real. Mismo criterio que value_maps,
    que descarta lo que no reconoce en vez de propagarlo crudo.
    """
    limite = FIELD_MAX_LEN.get(field)
    if limite is None or not isinstance(val, str) or len(val) <= limite:
        return val
    logger.warning(
        "[identity] proveedor=%s: '%s' descartado, %d caracteres para un campo de %d: %r",
        provider, field, len(val), limite, val[:80],
    )
    return None


def _extract(provider: str, field: str, val):
    """Extrae la parte útil de un valor compuesto, según el patrón declarado.

    Las fuentes publican identificadores estructurados: el directorio de UPeU
    dice `urn:schac:personalUniqueID:pe:DNI:PE:61093482`, donde el tipo de
    documento va incrustado en la cadena. El canónico no puede conocer ese
    formato —es de cada institución y de cada estándar—, así que el overlay
    declara un regex con UN grupo de captura y aquí solo se aplica.

    Sin coincidencia se descarta el campo en vez de guardar la cadena entera:
    propagar la URN completa como "tipo de documento" sería peor que no tenerlo.
    """
    patron = provider_map(provider).get("value_patterns", {}).get(field)
    if not patron or not isinstance(val, str):
        return val
    m = re.search(patron, val)
    if not m:
        logger.warning(
            "[identity] proveedor=%s: '%s' no casó con su patrón declarado: %r",
            provider, field, val[:80],
        )
        return None
    return m.group(1) if m.groups() else m.group(0)


def _remap_value(provider: str, field: str, val):
    """Traduce el valor con value_maps (ej. schacGender ISO 5218: 1→M, 2→F).
    Un valor fuera del mapa se descarta (None) en vez de propagarse crudo."""
    vmap = provider_map(provider).get("value_maps", {}).get(field)
    if not vmap:
        return val
    return vmap.get(str(val))


def map_fields(provider: str, raw: dict) -> dict:
    """Aplica el mapeo de campos fuente→padrón. Passthrough si no hay mapa.
    Tras renombrar, colapsa multivalores por precedencia y traduce value_maps."""
    conf = provider_map(provider)
    field_map = conf.get("fields", {})
    out: dict = {}
    if field_map:
        # Varias fuentes pueden alimentar el MISMO campo: gana la primera
        # declarada que traiga valor. Así el overlay expresa una cadena de
        # respaldo sin código — p. ej. la facultad de un estudiante viene en su
        # código de facultad, y la de un trabajador (que no tiene) en su unidad
        # organizativa. Antes ganaba la última del diccionario, que dependía del
        # orden de escritura del JSON y era invisible al leerlo.
        for src, dst in field_map.items():
            if dst in out:
                continue
            val = raw.get(src)
            if val is not None and val != "":
                out[dst] = val
    else:
        # Passthrough: claves que ya se llaman como un campo del padrón.
        for key in ASSIGNABLE_FIELDS | {"person_key"}:
            val = raw.get(key)
            if val is not None and val != "":
                out[key] = val

    for field in list(out):
        val = _collapse(provider, field, out[field])
        val = _extract(provider, field, val)
        val = _remap_value(provider, field, val)
        out[field] = _fits(provider, field, val)
        if out[field] is None:
            del out[field]
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


def _key_value(val: str) -> str:
    """Forma canónica de una credencial PARA DERIVAR LA CLAVE del padrón.

    Quita los ceros de relleno de la izquierda cuando el valor es solo dígitos:
    un documento es el mismo número lo escriba la fuente como '01261673' o
    '001261673', pero como la clave se deriva de ese texto, cada variante creaba
    una PERSONA distinta en el padrón (caso real 2026-08-12: dos filas para la
    misma persona, `ldap:01261673` y `ldap:001261673`).

    Solo se toca lo que es íntegramente numérico: recortar ceros de un correo o
    de un código alfanumérico cambiaría el identificador, no lo normalizaría.
    Y solo afecta a la CLAVE — la credencial se sigue guardando tal como vino,
    que es lo que la persona lleva impreso en el carné.
    """
    if val.isdigit():
        return val.lstrip("0") or "0"
    return val


def _fallback_key(provider: str, identifiers: dict) -> str | None:
    """person_key derivado cuando la fuente no trae uno explícito."""
    for id_type in ("document_number", "cardnumber", "samaccountname", "uid", "email"):
        val = identifiers.get(id_type)
        if val:
            return f"{provider}:{_key_value(str(val))}"
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
