# Mapeo programa académico (statistics_2 de Koha) → facultad.
#
# El mapa NO es parte del producto canónico: es data específica de cada
# institución. Se carga en runtime desde el JSON apuntado por
# settings.faculty_config_path (montado por el overlay del cliente).
#
# Formato del JSON:
#   {
#     "valid_faculty_codes": ["FCS", "FIA", ...],
#     "program_to_faculty":  {"P22": "FCS", "P01": "FCE", ...}
#   }
#
# Si no hay archivo (producto agnóstico), el mapa queda vacío: resolve_faculty
# devuelve el patron_faculty tal cual si viene informado, o "Sin Facultad".

import json
import os

from ..config import settings
from .labels import normalize_program


def _load_faculty_config() -> tuple[dict[str, str], set[str]]:
    path = settings.faculty_config_path
    if not path or not os.path.exists(path):
        return {}, set()
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    program_to_faculty = dict(data.get("program_to_faculty", {}))
    valid_faculty_codes = set(data.get("valid_faculty_codes", []))
    return program_to_faculty, valid_faculty_codes


PROGRAM_TO_FACULTY, VALID_FACULTY_CODES = _load_faculty_config()


def resolve_faculty(patron_faculty: str | None, patron_program: str | None) -> str:
    """
    Devuelve la facultad efectiva:
    1. Si patron_faculty es un código válido → lo usa.
    2. Si no, busca patron_program en PROGRAM_TO_FACULTY — primero con el
       código crudo y, si no está, con el canónico de normalize_program().
       El segundo intento evita que el overlay tenga que repetir aquí cada
       alias que program_map ya declara (dos copias que se desincronizan).
    3. Si no hay whitelist configurada (producto agnóstico) y patron_faculty
       viene informado → lo usa tal cual.
    4. Si nada aplica → "Sin Facultad".
    """
    fac = (patron_faculty or "").strip()
    if fac and fac in VALID_FACULTY_CODES:
        return fac
    prog = (patron_program or "").strip()
    mapped = PROGRAM_TO_FACULTY.get(prog)
    if not mapped and prog:
        mapped = PROGRAM_TO_FACULTY.get(normalize_program(prog))
    if mapped:
        return mapped
    # Sin whitelist configurada: aceptar el valor informado tal cual.
    if not VALID_FACULTY_CODES and fac:
        return fac
    return "Sin Facultad"
