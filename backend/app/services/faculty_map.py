# Mapeo programa académico (statistics_2 de Koha) → facultad.
#
# El mapa NO es parte del producto canónico: es data específica de cada
# institución. Se carga en runtime desde el JSON apuntado por
# settings.faculty_config_path (montado por el overlay del cliente).
#
# Formato del JSON:
#   {
#     "valid_faculty_codes": ["FCS", "FIA", ...],
#     "valid_org_units":     ["Dirección de Tecnologías de Información", ...],
#     "program_to_faculty":  {"P22": "FCS", "P01": "FCE", ...}
#   }
#
# Son DOS whitelists porque son dos ejes distintos de la misma institución: el
# académico se identifica por código de facultad y solo lo tiene quien estudia;
# el laboral, por nombre de unidad organizativa. Sin la segunda, un trabajador
# resolvía a "Sin Facultad" —cierto pero inútil— aunque el directorio publicara
# su área.
#
# Si no hay archivo (producto agnóstico), el mapa queda vacío: resolve_faculty
# devuelve el patron_faculty tal cual si viene informado, o "Sin Facultad".

import json
import os

from ..config import settings
from .labels import normalize_program


def _load_faculty_config() -> tuple[dict[str, str], set[str], set[str]]:
    path = settings.faculty_config_path
    if not path or not os.path.exists(path):
        return {}, set(), set()
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    program_to_faculty = dict(data.get("program_to_faculty", {}))
    valid_faculty_codes = set(data.get("valid_faculty_codes", []))
    valid_org_units = set(data.get("valid_org_units", []))
    return program_to_faculty, valid_faculty_codes, valid_org_units


PROGRAM_TO_FACULTY, VALID_FACULTY_CODES, VALID_ORG_UNITS = _load_faculty_config()

# Valor de PRESENTACIÓN para el desglose cuando no se pudo determinar la unidad.
# No es un dato: significa "no se sabe". Guardarlo en el padrón lo convierte en
# un hueco que ya no parece hueco, y entonces ninguna otra fuente lo rellena
# —la cadena de respaldo solo completa lo que está vacío—. Los proveedores deben
# traducirlo a None antes de persistir.
SIN_FACULTAD = "Sin Facultad"


def resolve_faculty(patron_faculty: str | None, patron_program: str | None) -> str:
    """
    Devuelve la unidad de desglose efectiva:
    1. Si patron_faculty es un código de facultad válido → lo usa.
    2. Si es una unidad organizativa declarada → la usa. Los trabajadores no
       tienen facultad; su área sí está en el directorio y con el paso 1 solo
       caían en "Sin Facultad" (2.332 personas medidas en 2026-08-13).
    3. Si no, busca patron_program en PROGRAM_TO_FACULTY — primero con el
       código crudo y, si no está, con el canónico de normalize_program().
       El segundo intento evita que el overlay tenga que repetir aquí cada
       alias que program_map ya declara (dos copias que se desincronizan).
    4. Si no hay whitelist configurada (producto agnóstico) y patron_faculty
       viene informado → lo usa tal cual.
    5. Si nada aplica → "Sin Facultad".
    """
    fac = (patron_faculty or "").strip()
    if fac and (fac in VALID_FACULTY_CODES or fac in VALID_ORG_UNITS):
        return fac
    prog = (patron_program or "").strip()
    mapped = PROGRAM_TO_FACULTY.get(prog)
    if not mapped and prog:
        mapped = PROGRAM_TO_FACULTY.get(normalize_program(prog))
    if mapped:
        return mapped
    # Sin whitelist configurada: aceptar el valor informado tal cual.
    if not VALID_FACULTY_CODES and not VALID_ORG_UNITS and fac:
        return fac
    return SIN_FACULTAD
