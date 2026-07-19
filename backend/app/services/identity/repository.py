# Persistencia del padrón local. Upsert idempotente en `persons` +
# sincronización de `person_identifiers`. Reutilizable por el sync y el resolver.

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models import Person, PersonIdentifier
from .base import PersonRecord

logger = logging.getLogger(__name__)

# Campos del padrón que se copian desde el PersonRecord.
_PERSON_FIELDS = (
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "dni", "email", "home_sede_code", "home_building",
)


def find_person_by_identifier(db: Session, id_type: str, id_value: str) -> Person | None:
    """Resuelve una persona del padrón por una de sus credenciales."""
    ident = (
        db.query(PersonIdentifier)
        .filter(
            PersonIdentifier.id_type == id_type,
            PersonIdentifier.id_value == id_value,
        )
        .first()
    )
    if ident is None:
        return None
    return db.query(Person).filter(Person.person_key == ident.person_key).first()


def find_person_by_value(db: Session, id_value: str) -> Person | None:
    """Resuelve una persona por el VALOR de cualquiera de sus credenciales.

    La persona puede presentar cualquiera de sus identificadores (carné,
    documento, ...) y debe resolver al mismo registro, sin que el lector tenga
    que saber cuál presentó. Equivale a la resolución en cascada por
    identificadores únicos que hacen los sistemas de biblioteca.
    """
    ident = (
        db.query(PersonIdentifier)
        .filter(PersonIdentifier.id_value == id_value)
        .first()
    )
    if ident is None:
        return None
    return db.query(Person).filter(Person.person_key == ident.person_key).first()


def _sync_identifiers(db: Session, person_key: str, identifiers: dict) -> None:
    """Asegura filas (id_type, id_value)→person_key sin duplicar la credencial."""
    for id_type, id_value in (identifiers or {}).items():
        if not id_value:
            continue
        id_value = str(id_value)
        existing = (
            db.query(PersonIdentifier)
            .filter(
                PersonIdentifier.id_type == id_type,
                PersonIdentifier.id_value == id_value,
            )
            .first()
        )
        if existing is None:
            db.add(PersonIdentifier(id_type=id_type, id_value=id_value, person_key=person_key))
        elif existing.person_key != person_key:
            # La credencial se reasignó a otra persona (p. ej. carnet reciclado).
            existing.person_key = person_key


class IdentityCollision(Exception):
    """Dos personas distintas caen en el mismo person_key.

    Ocurre cuando la fuente asigna a una persona un documento que ya es el de
    otra (p. ej. por un bug de deduplicación aguas arriba): como el person_key
    se deriva del documento, ambas colapsan a la misma clave y se fusionarían
    en una sola fila.

    Se lanza en vez de fusionar. Los dos consumidores ya la manejan: el sync la
    cuenta como error de ese registro, y el escaneo degrada a "Sin identificar".
    Contar a alguien como no identificado es un hueco de dato; contarlo como
    OTRA PERSONA es un fallo de identidad, y en aforo además queda sin traza.
    """


def _conflicting_cardnumber(db: Session, person: Person, rec: PersonRecord) -> tuple | None:
    """Devuelve (carné_existente, carné_entrante) si son personas distintas.

    El carné es el identificador institucional: una persona tiene exactamente
    uno. Dos registros que comparten person_key pero declaran carnés distintos
    son dos humanos, no dos vistas del mismo.

    No se compara el documento a propósito: que cambie con el carné estable es
    justo el caso legítimo (corrección de DNI) que sí debe reconciliar.
    """
    entrante = (rec.identifiers or {}).get("cardnumber")
    if not entrante:
        return None
    existente = (
        db.query(PersonIdentifier)
        .filter(
            PersonIdentifier.person_key == person.person_key,
            PersonIdentifier.id_type == "cardnumber",
        )
        .first()
    )
    if existente is None or existente.id_value == str(entrante):
        return None
    return (existente.id_value, str(entrante))


def upsert_person(db: Session, rec: PersonRecord, source: str) -> Person:
    """Upsert idempotente en `persons` por person_key + sincroniza credenciales.

    Hace commit y devuelve la fila persistida. Solo actualiza los campos que el
    record trae informados (no borra data previa con None).

    Lanza IdentityCollision si el registro entrante y la fila existente son
    personas distintas (ver _conflicting_cardnumber)."""
    now = datetime.now(timezone.utc)

    # 1. Buscar por person_key.
    person = db.query(Person).filter(Person.person_key == rec.person_key).first()

    # 1.bis Guarda de identidad: la clave coincide, pero ¿es la misma persona?
    if person is not None:
        choque = _conflicting_cardnumber(db, person, rec)
        if choque:
            existente, entrante = choque
            logger.error(
                "[identity] COLISIÓN person_key=%s: la fila existente tiene carné %s "
                "y el registro entrante trae %s. Son personas distintas — se rechaza "
                "el upsert en vez de fusionarlas. Origen probable: documento duplicado "
                "en la fuente '%s'.",
                rec.person_key, existente, entrante, source,
            )
            raise IdentityCollision(
                f"person_key={rec.person_key} compartido por carné {existente} y {entrante}"
            )

    # 2. Reconciliar por identificadores: si el person_key derivado cambió (p. ej.
    #    una fila que antes no tenía DNI y ahora sí, cambiando la clave de mayor
    #    prioridad), o si otro proveedor ya trajo a la misma persona, evitamos
    #    crear un duplicado reutilizando la fila existente que comparte credencial.
    if person is None:
        for id_type, id_value in (rec.identifiers or {}).items():
            if not id_value:
                continue
            person = find_person_by_identifier(db, id_type, str(id_value))
            if person is not None:
                break

    if person is None:
        person = Person(person_key=rec.person_key)
        db.add(person)

    # El person_key se asigna una vez y NO se reasigna: es estable y lo referencian
    # presence_log.person_key y person_identifiers.person_key.
    effective_key = person.person_key

    for field_name in _PERSON_FIELDS:
        val = getattr(rec, field_name)
        if val is not None:
            setattr(person, field_name, val)

    person.source = source or rec.source
    person.raw = rec.raw
    person.synced_at = now
    if person.active is None:
        person.active = True

    # Persistir person antes de tocar identifiers (garantiza person_key estable).
    db.flush()
    _sync_identifiers(db, effective_key, rec.identifiers)

    db.commit()
    db.refresh(person)
    return person
