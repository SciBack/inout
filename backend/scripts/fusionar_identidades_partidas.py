"""Fusiona en una sola las identidades que quedaron partidas entre proveedores.

QUÉ PASÓ
--------
La reconciliación del padrón comparaba (tipo de credencial, valor). El
directorio publica el DNI en su atributo de documento; la biblioteca usa ESE
MISMO NÚMERO como carné del lector. Para la comparación eran dos credenciales
distintas, así que la misma humana quedó en dos filas —1.648 medidas el
13-ago-2026—, cada una con su unidad y sus estadísticas. Al escanear, un código
resolvía a una fila y el otro a la otra.

El cruce por documento ya está arreglado en el padrón (repository.py) y evita
que vuelva a partirse. Este script repara lo que se partió antes.

QUÉ HACE
--------
Agrupa las personas cuya clave deriva del MISMO número (el sufijo del
person_key) pero de proveedores distintos. Para cada grupo:

  1. Elige la fila superviviente por autoridad de fuente (la declarada en el
     overlay: el sistema de identidad institucional antes que la biblioteca).
  2. Copia a la superviviente los campos que ella no tiene y las otras sí — no
     se pierde lo que solo sabía la fuente menos autoritativa.
  3. Mueve a la superviviente todas las credenciales de las demás.
  4. Reapunta los eventos de presencia de las demás.
  5. Borra las filas absorbidas.

REVERSIBLE
----------
Antes de tocar nada vuelca el estado previo a `fusion_identidades_<fecha>`
(persons + person_identifiers + los person_key de presence_log). Sin esa tabla
no se ejecuta.

USO
---
    python3 scripts/fusionar_identidades_partidas.py --dry-run   # solo informa
    python3 scripts/fusionar_identidades_partidas.py --aplicar
"""

import argparse
import json
import sys

from sqlalchemy import text

sys.path.insert(0, "/app")

from app.database import SessionLocal  # noqa: E402
from app.services.identity.mapping import SOURCE_PRECEDENCE  # noqa: E402

TABLA_RESPALDO = "fusion_identidades_20260813"

# Campos del padrón que se completan desde las filas absorbidas.
CAMPOS = (
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "document_number", "document_type", "email",
    "home_sede_code", "home_building",
)


def autoridad(source: str | None) -> int:
    """Posición de la fuente en el orden declarado; las no declaradas, al final."""
    orden = {nombre: i for i, nombre in enumerate(SOURCE_PRECEDENCE)}
    return orden.get(source or "", len(orden))


def grupos_partidos(db):
    """Personas cuya clave deriva del mismo número en proveedores distintos."""
    filas = db.execute(text("""
        SELECT split_part(person_key, ':', 2) AS sufijo,
               person_key, source, full_name
          FROM persons
         WHERE split_part(person_key, ':', 2) IN (
                   SELECT split_part(person_key, ':', 2)
                     FROM persons
                 GROUP BY 1
                   HAVING count(DISTINCT split_part(person_key, ':', 1)) > 1
               )
      ORDER BY sufijo, person_key
    """)).mappings().all()
    grupos: dict[str, list[dict]] = {}
    for f in filas:
        grupos.setdefault(f["sufijo"], []).append(dict(f))
    return grupos


def respaldar(db):
    db.execute(text(f"DROP TABLE IF EXISTS {TABLA_RESPALDO}"))
    db.execute(text(f"""
        CREATE TABLE {TABLA_RESPALDO} AS
        SELECT 'person' AS clase, p.person_key, p.source,
               to_jsonb(p) AS datos, NULL::integer AS evento_id
          FROM persons p
         WHERE split_part(p.person_key, ':', 2) IN (
                   SELECT split_part(person_key, ':', 2) FROM persons
                 GROUP BY 1 HAVING count(DISTINCT split_part(person_key, ':', 1)) > 1)
         UNION ALL
        SELECT 'identifier', i.person_key, NULL, to_jsonb(i), NULL
          FROM person_identifiers i
         WHERE split_part(i.person_key, ':', 2) IN (
                   SELECT split_part(person_key, ':', 2) FROM persons
                 GROUP BY 1 HAVING count(DISTINCT split_part(person_key, ':', 1)) > 1)
         UNION ALL
        SELECT 'evento', l.person_key, NULL, NULL, l.id
          FROM presence_log l
         WHERE l.person_key IS NOT NULL
           AND split_part(l.person_key, ':', 2) IN (
                   SELECT split_part(person_key, ':', 2) FROM persons
                 GROUP BY 1 HAVING count(DISTINCT split_part(person_key, ':', 1)) > 1)
    """))
    n = db.execute(text(f"SELECT count(*) FROM {TABLA_RESPALDO}")).scalar()
    print(f"respaldo → {TABLA_RESPALDO}: {n} filas")


def fusionar(db, aplicar: bool) -> dict:
    grupos = grupos_partidos(db)
    stats = {"grupos": len(grupos), "absorbidas": 0, "credenciales": 0, "eventos": 0, "campos": 0}
    for sufijo, filas in grupos.items():
        filas.sort(key=lambda f: (autoridad(f["source"]), f["person_key"]))
        gana, absorbidas = filas[0], filas[1:]
        for otra in absorbidas:
            # Completar solo lo que la superviviente no sabe.
            faltantes = db.execute(text(f"""
                SELECT {', '.join(CAMPOS)} FROM persons WHERE person_key = :k
            """), {"k": otra["person_key"]}).mappings().first()
            actual = db.execute(text(f"""
                SELECT {', '.join(CAMPOS)} FROM persons WHERE person_key = :k
            """), {"k": gana["person_key"]}).mappings().first()
            completar = {
                c: faltantes[c] for c in CAMPOS
                if not actual[c] and faltantes[c]
            }
            if completar and aplicar:
                sets = ", ".join(f"{c} = :{c}" for c in completar)
                db.execute(text(f"UPDATE persons SET {sets} WHERE person_key = :k"),
                           {**completar, "k": gana["person_key"]})
            stats["campos"] += len(completar)

            if aplicar:
                # Las credenciales que la superviviente ya tenga (mismo tipo y
                # valor) se descartan: la restricción de unicidad es por
                # (tipo, valor), así que moverlas chocaría.
                db.execute(text("""
                    DELETE FROM person_identifiers i
                     WHERE i.person_key = :otra
                       AND EXISTS (SELECT 1 FROM person_identifiers j
                                    WHERE j.person_key = :gana
                                      AND j.id_type = i.id_type
                                      AND j.id_value = i.id_value)
                """), {"otra": otra["person_key"], "gana": gana["person_key"]})
            movidas = db.execute(text("""
                SELECT count(*) FROM person_identifiers WHERE person_key = :k
            """), {"k": otra["person_key"]}).scalar()
            eventos = db.execute(text("""
                SELECT count(*) FROM presence_log WHERE person_key = :k
            """), {"k": otra["person_key"]}).scalar()
            if aplicar:
                db.execute(text("UPDATE person_identifiers SET person_key = :g WHERE person_key = :o"),
                           {"g": gana["person_key"], "o": otra["person_key"]})
                db.execute(text("UPDATE presence_log SET person_key = :g WHERE person_key = :o"),
                           {"g": gana["person_key"], "o": otra["person_key"]})
                db.execute(text("DELETE FROM persons WHERE person_key = :k"), {"k": otra["person_key"]})
            stats["absorbidas"] += 1
            stats["credenciales"] += movidas
            stats["eventos"] += eventos
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.aplicar and not args.dry_run:
        ap.error("elige --dry-run o --aplicar")

    db = SessionLocal()
    try:
        print(f"autoridad declarada: {SOURCE_PRECEDENCE or '(ninguna)'}")
        if args.aplicar:
            respaldar(db)
        stats = fusionar(db, aplicar=args.aplicar)
        if args.aplicar:
            db.commit()
        else:
            db.rollback()
        print(json.dumps(stats, indent=2, ensure_ascii=False))
        print("APLICADO" if args.aplicar else "SIMULACIÓN — nada se escribió")
    finally:
        db.close()


if __name__ == "__main__":
    main()
