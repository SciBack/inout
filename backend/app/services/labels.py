# Normalización y etiquetado de códigos para el dashboard.
#
# Los códigos de categoría son data de cada institución (y cambian con el
# tiempo: una migración de fuente deja el histórico con códigos viejos y los
# eventos nuevos con otros). Por eso NO viven en el canónico: se cargan del
# JSON apuntado por settings.labels_config_path (montado por el overlay).
#
# Dos pasos distintos a propósito:
#   1. normalizar: código crudo → perfil canónico ("ESTUDI" y "student" → "student")
#      Sin esto el dashboard mostraría el mismo perfil dos veces, una por familia.
#   2. etiquetar:  perfil canónico → texto ("student" → "Estudiantes")
#
# Formato del JSON (todas las claves opcionales):
#   {
#     "category_map":    {"ESTUDI": "student", "student": "student", ...},
#     "category_labels": {"student": "Estudiantes", ...},
#     "faculty_labels":  {"FCS": "Ciencias de la Salud", ...},
#     "program_labels":  {"31300211": "Psicología", ...}
#   }
#
# Sin archivo (producto agnóstico) no se normaliza ni traduce: se muestra el
# código crudo, que es el comportamiento honesto por defecto.

import json
import os

from ..config import settings


def _load() -> dict:
    path = settings.labels_config_path
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


LABELS = _load()
CATEGORY_MAP: dict[str, str] = LABELS.get("category_map", {}) or {}
CATEGORY_LABELS: dict[str, str] = LABELS.get("category_labels", {}) or {}
FACULTY_LABELS: dict[str, str] = LABELS.get("faculty_labels", {}) or {}
PROGRAM_LABELS: dict[str, str] = LABELS.get("program_labels", {}) or {}


def normalize_category(raw: str | None) -> str:
    """Código crudo → perfil canónico. Sensible a mayúsculas a propósito:
    'STAFF' (personal de biblioteca, histórico) y 'staff' (administrativo,
    eduPerson) son perfiles distintos."""
    code = (raw or "").strip()
    if not code:
        return "OTROS"
    return CATEGORY_MAP.get(code, code)


def category_label(canon: str) -> str:
    return CATEGORY_LABELS.get(canon, canon if canon != "OTROS" else "Otros")


def faculty_label(code: str) -> str:
    return FACULTY_LABELS.get(code, code)


def program_label(code: str) -> str:
    return PROGRAM_LABELS.get(code, code)
