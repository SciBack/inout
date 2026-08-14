"""Rellena la facultad de los eventos que quedaron SIN dato, nunca los que lo tienen.

QUÉ PASÓ
--------
Cada evento guarda un snapshot de la facultad en el momento del escaneo. Antes
del 13-ago-2026 InOut no sabía leer la unidad organizativa del trabajador —el
directorio la publica partida entre `departmentNumber` y el árbol `ou=org`—, así
que a quien no era estudiante se le grababa "Sin Facultad" o nada.

QUÉ HACE
--------
Rellena esos huecos con la unidad que la persona tiene HOY en el padrón.

QUÉ NO HACE — y es lo importante
--------------------------------
No toca ningún evento que YA traiga una facultad. Un trabajador que además
estudió tiene eventos grabados con la facultad donde estudiaba: eso era cierto
cuando entró y reescribirlo con su unidad actual borraría que en ese momento
también era estudiante. El snapshot existe justamente para eso.

El criterio es "no había dato", no "el dato no me gusta": solo entran los
eventos con `patron_faculty` NULL, vacío o "Sin Facultad".

REVERSIBLE
----------
Vuelca los ids afectados y su valor previo a `relleno_facultad_<fecha>`.

USO
---
    python3 scripts/rellenar_facultad_sin_dato.py --dry-run
    python3 scripts/rellenar_facultad_sin_dato.py --aplicar
"""

import argparse
import json
import sys

from sqlalchemy import text

sys.path.insert(0, "/app")

from app.database import SessionLocal  # noqa: E402

TABLA_RESPALDO = "relleno_facultad_20260814"

# Eventos sin dato de facultad cuya persona hoy sí tiene una.
CONDICION = """
    l.person_key IS NOT NULL
    AND coalesce(nullif(trim(l.patron_faculty), ''), 'Sin Facultad') = 'Sin Facultad'
    AND coalesce(trim(p.faculty), '') <> ''
"""


def medir(db) -> dict:
    fila = db.execute(text(f"""
        SELECT count(*) AS eventos,
               count(DISTINCT l.person_key) AS personas
          FROM presence_log l
          JOIN persons p ON p.person_key = l.person_key
         WHERE {CONDICION}
    """)).mappings().first()
    return dict(fila)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.aplicar and not args.dry_run:
        ap.error("elige --dry-run o --aplicar")

    db = SessionLocal()
    try:
        print(json.dumps({"antes": medir(db)}, indent=2, ensure_ascii=False))

        # Cuántos eventos SÍ traen facultad y por tanto NO se tocan — se imprime
        # a propósito: es la garantía de que esto rellena y no reescribe.
        intactos = db.execute(text("""
            SELECT count(*) FROM presence_log
             WHERE coalesce(nullif(trim(patron_faculty), ''), 'Sin Facultad') <> 'Sin Facultad'
        """)).scalar()
        print(f"eventos con facultad propia que NO se tocan: {intactos}")

        if not args.aplicar:
            db.rollback()
            print("SIMULACIÓN — nada se escribió")
            return

        db.execute(text(f"DROP TABLE IF EXISTS {TABLA_RESPALDO}"))
        db.execute(text(f"""
            CREATE TABLE {TABLA_RESPALDO} AS
            SELECT l.id, l.patron_faculty AS valor_previo
              FROM presence_log l
              JOIN persons p ON p.person_key = l.person_key
             WHERE {CONDICION}
        """))
        n = db.execute(text(f"SELECT count(*) FROM {TABLA_RESPALDO}")).scalar()
        print(f"respaldo → {TABLA_RESPALDO}: {n} filas")

        actualizados = db.execute(text(f"""
            UPDATE presence_log l
               SET patron_faculty = p.faculty
              FROM persons p
             WHERE p.person_key = l.person_key
               AND {CONDICION}
        """)).rowcount
        db.commit()
        print(f"eventos rellenados: {actualizados}")
        print(json.dumps({"despues": medir(db)}, indent=2, ensure_ascii=False))
    finally:
        db.close()


if __name__ == "__main__":
    main()
