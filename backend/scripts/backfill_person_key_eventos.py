"""Asocia cada evento de presencia pasado a la persona que lo generó.

QUÉ PASÓ
--------
`presence_log.person_key` se añadió después de que el sistema llevara meses
registrando, así que 361.257 de 361.662 eventos (13-ago-2026) solo guardan el
CÓDIGO escaneado. Los desgloses agrupan por visitante único, y sin la persona
tienen que agrupar por ese código: alguien que lleva varias credenciales —carné
de trabajador, carné de alumno, DNI— cuenta como varios visitantes distintos.

QUÉ HACE
--------
Para cada evento sin persona, resuelve su código contra el índice de
credenciales del padrón (`person_identifiers`, por VALOR, como hace el escaneo)
y escribe el `person_key` que le corresponde.

Un código que no está en el padrón se deja como está: es alguien no
identificado —una visita externa—, que se sigue contando por su código.

NO reescribe los eventos que YA tienen persona: esos los resolvió el escaneo en
su momento, con el padrón de entonces, y esa es la verdad del momento.

REVERSIBLE
----------
Vuelca los ids afectados a `backfill_person_key_<fecha>` antes de escribir.
Revertir es un UPDATE que pone NULL donde esa tabla dice.

USO
---
    python3 scripts/backfill_person_key_eventos.py --dry-run
    python3 scripts/backfill_person_key_eventos.py --aplicar
"""

import argparse
import json
import sys

from sqlalchemy import text

sys.path.insert(0, "/app")

from app.database import SessionLocal  # noqa: E402

TABLA_RESPALDO = "backfill_person_key_20260813"


def medir(db) -> dict:
    fila = db.execute(text("""
        SELECT count(*) AS total,
               count(person_key) AS ya_tienen,
               count(*) FILTER (
                   WHERE person_key IS NULL
                     AND EXISTS (SELECT 1 FROM person_identifiers i
                                  WHERE i.id_value = presence_log.cardnumber)
               ) AS resolubles
          FROM presence_log
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
        antes = medir(db)
        print(json.dumps({"antes": antes}, indent=2, ensure_ascii=False))

        if args.aplicar:
            db.execute(text(f"DROP TABLE IF EXISTS {TABLA_RESPALDO}"))
            db.execute(text(f"""
                CREATE TABLE {TABLA_RESPALDO} AS
                SELECT id, cardnumber FROM presence_log
                 WHERE person_key IS NULL
                   AND EXISTS (SELECT 1 FROM person_identifiers i
                                WHERE i.id_value = presence_log.cardnumber)
            """))
            n = db.execute(text(f"SELECT count(*) FROM {TABLA_RESPALDO}")).scalar()
            print(f"respaldo → {TABLA_RESPALDO}: {n} filas")

            # Un código puede tener varias filas en el índice (el mismo número
            # como carné y como documento); tras la fusión todas apuntan a la
            # misma persona, así que basta una.
            actualizados = db.execute(text("""
                UPDATE presence_log l
                   SET person_key = sub.person_key
                  FROM (SELECT DISTINCT ON (id_value) id_value, person_key
                          FROM person_identifiers
                      ORDER BY id_value, person_key) sub
                 WHERE l.person_key IS NULL
                   AND l.cardnumber = sub.id_value
            """)).rowcount
            db.commit()
            print(f"eventos asociados: {actualizados}")
            print(json.dumps({"despues": medir(db)}, indent=2, ensure_ascii=False))
        else:
            db.rollback()
            print("SIMULACIÓN — nada se escribió")
    finally:
        db.close()


if __name__ == "__main__":
    main()
