"""Fusiona las personas del padrón que comparten una credencial GLOBAL.

QUÉ PASA
--------
Una credencial global (las declara el overlay en `_global_identifiers`: el
documento, un ID institucional único) identifica a la PERSONA, no al registro de
un sistema. Si dos fuentes la guardan bajo tipos distintos —el directorio como
`unique_id`, la biblioteca como `cardnumber`— y la fila de una se creó antes de
que la otra la trajera, el padrón queda con la misma humana en dos filas: cada
una con sus escaneos, y una de ellas sin facultad ni sede.

El cruce en vivo (repository.py) ya evita que se parta una persona NUEVA. Este
script repara lo que ya se partió. A diferencia de
`fusionar_identidades_partidas.py` (que agrupa por el número de la clave), aquí
se agrupa por credenciales compartidas: dos filas van juntas si tienen el mismo
valor y al menos uno de los dos lados es de un tipo global.

QUÉ HACE
--------
Para cada grupo:
  1. Superviviente = la fila de la fuente con más autoridad (`_source_precedence`).
  2. Le completa los campos que no tiene con los de las absorbidas.
  3. Le mueve las credenciales y reapunta los escaneos (presence_log).
  4. Borra las filas absorbidas.

NO FUSIONA (y lo informa) los grupos con DOS O MÁS filas de la fuente de más
autoridad: si el sistema de identidad tiene dos personas con el mismo valor, es
un dato a corregir en el origen, no algo que deba decidir este script.

REVERSIBLE
----------
Con --aplicar, antes de tocar nada vuelca a la tabla `--respaldo` las filas de
persons, person_identifiers y los id de presence_log de los grupos.

USO (dentro del contenedor backend)
---
    python3 scripts/fusionar_por_credencial_global.py --dry-run
    python3 scripts/fusionar_por_credencial_global.py --aplicar --respaldo fusion_global_20261118
"""

import argparse
import json
import sys

sys.path.insert(0, "/app")

CAMPOS = (
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "document_number", "document_type", "email",
    "home_sede_code", "home_building",
)


def agrupar(credenciales, globales, fuente_de):
    """Agrupa personas por credenciales compartidas.

    credenciales: iterable de (person_key, id_type, id_value).
    globales: tipos que identifican a la persona.
    fuente_de: {person_key: source}.

    Devuelve listas de person_key (2+ por grupo). Dos filas se unen si comparten
    un valor y al menos una de las dos lo tiene bajo un tipo global. Que dos
    carnés locales coincidan por casualidad NO une a nadie.
    """
    padre: dict[str, str] = {}

    def raiz(k):
        padre.setdefault(k, k)
        while padre[k] != k:
            padre[k] = padre[padre[k]]
            k = padre[k]
        return k

    por_valor: dict[str, list[tuple[str, str]]] = {}
    for person_key, id_type, id_value in credenciales:
        if id_value:
            por_valor.setdefault(str(id_value), []).append((person_key, id_type))
    for filas in por_valor.values():
        keys = {k for k, _ in filas}
        if len(keys) < 2 or not any(t in globales for _, t in filas):
            continue
        # Solo se unen pares en que al menos un lado es global.
        for a, ta in filas:
            for b, tb in filas:
                if a != b and (ta in globales or tb in globales):
                    padre[raiz(a)] = raiz(b)
    grupos: dict[str, set[str]] = {}
    for k in padre:
        grupos.setdefault(raiz(k), set()).add(k)
    return [sorted(g) for g in grupos.values() if len(g) > 1 and all(k in fuente_de for k in g)]


def ordenar(grupo, fuente_de, precedencia):
    orden = {s: i for i, s in enumerate(precedencia)}
    return sorted(grupo, key=lambda k: (orden.get(fuente_de.get(k) or "", len(orden)), k))


def dudoso(grupo, fuente_de, precedencia):
    """Dos o más filas de la fuente de más autoridad presente en el grupo."""
    ordenadas = ordenar(grupo, fuente_de, precedencia)
    top = fuente_de.get(ordenadas[0])
    return sum(1 for k in grupo if fuente_de.get(k) == top) > 1


def main():
    from sqlalchemy import text

    from app.database import SessionLocal
    from app.services.identity.mapping import GLOBAL_IDENTIFIERS, SOURCE_PRECEDENCE

    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--respaldo", default="")
    args = ap.parse_args()
    if args.aplicar == args.dry_run:
        ap.error("elige --dry-run o --aplicar")
    if args.aplicar and not args.respaldo.replace("_", "").isalnum():
        ap.error("--aplicar exige --respaldo <nombre_de_tabla>")
    if not GLOBAL_IDENTIFIERS:
        print("el overlay no declara _global_identifiers: nada que hacer")
        return

    db = SessionLocal()
    try:
        fuente_de = dict(db.execute(text("SELECT person_key, source FROM persons")).all())
        creds = db.execute(text("SELECT person_key, id_type, id_value FROM person_identifiers")).all()
        grupos = agrupar(creds, set(GLOBAL_IDENTIFIERS), fuente_de)
        dudosos = [g for g in grupos if dudoso(g, fuente_de, SOURCE_PRECEDENCE)]
        validos = [g for g in grupos if g not in dudosos]
        print(f"globales: {list(GLOBAL_IDENTIFIERS)} · autoridad: {list(SOURCE_PRECEDENCE)}")
        print(f"grupos: {len(grupos)} · a fusionar: {len(validos)} · dudosos (no se tocan): {len(dudosos)}")
        combos: dict[str, int] = {}
        for g in validos:
            c = " + ".join(fuente_de[k] or "?" for k in ordenar(g, fuente_de, SOURCE_PRECEDENCE))
            combos[c] = combos.get(c, 0) + 1
        print("combinaciones (superviviente primero):", json.dumps(combos, ensure_ascii=False))
        for g in dudosos[:20]:
            print("  dudoso:", g)

        absorbidas = [k for g in validos for k in ordenar(g, fuente_de, SOURCE_PRECEDENCE)[1:]]
        todas = [k for g in validos for k in g]
        eventos = db.execute(text("SELECT count(*) FROM presence_log WHERE person_key = ANY(:k)"),
                             {"k": absorbidas}).scalar() if absorbidas else 0
        print(f"filas a absorber: {len(absorbidas)} · escaneos a reapuntar: {eventos}")
        if not args.aplicar:
            print("SIMULACIÓN — nada se escribió")
            return

        t = args.respaldo
        db.execute(text(f"DROP TABLE IF EXISTS {t}"))
        db.execute(text(f"""
            CREATE TABLE {t} AS
            SELECT 'person' AS clase, p.person_key, to_jsonb(p) AS datos, NULL::integer AS evento_id
              FROM persons p WHERE p.person_key = ANY(:k)
            UNION ALL
            SELECT 'identifier', i.person_key, to_jsonb(i), NULL FROM person_identifiers i WHERE i.person_key = ANY(:k)
            UNION ALL
            SELECT 'evento', l.person_key, NULL, l.id FROM presence_log l WHERE l.person_key = ANY(:k)
        """), {"k": todas})
        print(f"respaldo → {t}: {db.execute(text(f'SELECT count(*) FROM {t}')).scalar()} filas")

        for g in validos:
            gana, *otras = ordenar(g, fuente_de, SOURCE_PRECEDENCE)
            for otra in otras:
                datos = db.execute(text(f"SELECT {', '.join(CAMPOS)} FROM persons WHERE person_key=:k"),
                                   {"k": otra}).mappings().first()
                actual = db.execute(text(f"SELECT {', '.join(CAMPOS)} FROM persons WHERE person_key=:k"),
                                    {"k": gana}).mappings().first()
                completar = {c: datos[c] for c in CAMPOS if not actual[c] and datos[c]}
                if completar:
                    sets = ", ".join(f"{c} = :{c}" for c in completar)
                    db.execute(text(f"UPDATE persons SET {sets} WHERE person_key = :k"), {**completar, "k": gana})
                db.execute(text("""
                    DELETE FROM person_identifiers i WHERE i.person_key = :o AND EXISTS (
                      SELECT 1 FROM person_identifiers j WHERE j.person_key = :g
                         AND j.id_type = i.id_type AND j.id_value = i.id_value)
                """), {"o": otra, "g": gana})
                db.execute(text("UPDATE person_identifiers SET person_key=:g WHERE person_key=:o"), {"g": gana, "o": otra})
                db.execute(text("UPDATE presence_log SET person_key=:g WHERE person_key=:o"), {"g": gana, "o": otra})
                db.execute(text("DELETE FROM persons WHERE person_key=:o"), {"o": otra})
        db.commit()
        print(f"APLICADO: {len(absorbidas)} filas absorbidas en {len(validos)} personas")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
