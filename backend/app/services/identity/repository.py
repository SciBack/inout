# Persistencia del padrón local. Upsert idempotente en `persons` +
# sincronización de `person_identifiers`. Reutilizable por el sync y el resolver.

import logging
import unicodedata
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models import Person, PersonIdentifier
from .base import PersonRecord
from .mapping import GLOBAL_IDENTIFIERS, SOURCE_PRECEDENCE

logger = logging.getLogger(__name__)

# Campos del padrón que se copian desde el PersonRecord.
_PERSON_FIELDS = (
    "full_name", "first_name", "gender", "category", "faculty", "program",
    "escuela", "role", "document_number", "document_type", "email",
    "home_sede_code", "home_building",
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


def _normalizar_nombre(nombre: str | None) -> str:
    """Forma comparable de un nombre: sin tildes, sin mayúsculas y sin espacios
    de más. La misma persona llega escrita distinto según la fuente ('YAHIR
    ALEXANDER NEIRA CURO' en una, 'Yahir Alexander Neira Curo' en otra)."""
    limpio = unicodedata.normalize("NFKD", nombre or "")
    limpio = limpio.encode("ascii", "ignore").decode().lower()
    return " ".join(limpio.split())


def _conflicting_cardnumber(db: Session, person: Person, rec: PersonRecord) -> tuple | None:
    """Devuelve (credencial_existente, credencial_entrante) si son DOS PERSONAS.

    Una persona tiene VARIAS credenciales, no una: carné universitario, DNI,
    carné de extranjería, pasaporte, y a veces más de un código institucional
    —quien trabaja y además estudió lleva el de trabajador y el de alumno—. El
    directorio ya lo refleja: 28.752 DNI, 145 CE y 91 pasaportes, y Koha
    identifica a sus patrons por carné y por DNI a la vez. Rechazar un segundo
    identificador sería negar cómo funciona la institución.

    Así que un carné nuevo NO es por sí solo señal de otra persona. Lo que se
    protege es lo de verdad grave: que la fuente asigne a dos humanos el mismo
    documento (pasó, caso real) y, como el person_key se deriva de él, acaben
    fusionados en una fila. Eso se distingue por el NOMBRE, no por el número.

    - mismo nombre  → la misma persona sumando una credencial → se acepta
    - nombre distinto → dos humanos bajo un documento → se rechaza

    Se compara contra TODAS las credenciales de la fila, no contra una
    cualquiera: con varias por persona, tomar la primera que devuelva la base
    haría depender el resultado de un orden que nadie garantiza.
    """
    entrante = (rec.identifiers or {}).get("cardnumber")
    if not entrante:
        return None
    entrante = str(entrante)

    existentes = [
        row.id_value
        for row in db.query(PersonIdentifier).filter(
            PersonIdentifier.person_key == person.person_key,
            PersonIdentifier.id_type == "cardnumber",
        )
    ]
    if not existentes or entrante in existentes:
        return None

    # Sin nombre en alguno de los dos lados no hay con qué distinguirlos: se
    # mantiene el rechazo, que es el lado seguro del error.
    nombre_actual = _normalizar_nombre(person.full_name)
    nombre_entrante = _normalizar_nombre(rec.full_name)
    if nombre_actual and nombre_entrante and nombre_actual == nombre_entrante:
        return None

    return (existentes[0], entrante)


def _fuente_manda(entrante: str | None, actual: str | None) -> bool:
    """¿La fuente entrante puede sobrescribir lo que ya escribió la actual?

    Una persona la ven varios sistemas y no todos saben lo mismo de ella. El
    sistema de identidad institucional sabe dónde TRABAJA hoy; la biblioteca
    guarda dónde ESTUDIÓ, que era cierto y quedó viejo. Sin un orden de
    autoridad manda quien sincronice último —un detalle de calendario— y el
    dato del kiosko cambia según la hora a la que corrió cada proveedor.

    El orden lo declara el overlay, de más a menos autoridad, porque cuál es la
    fuente de verdad de cada dato es una decisión de la institución. Una fuente
    no declarada va al final: rellena huecos, nunca pisa. Sin overlay la lista
    va vacía y todas mandan por igual, que es el comportamiento previo.
    """
    if not SOURCE_PRECEDENCE or not actual or entrante == actual:
        return True
    orden = {nombre: i for i, nombre in enumerate(SOURCE_PRECEDENCE)}
    fuera = len(orden)
    return orden.get(entrante, fuera) <= orden.get(actual, fuera)


def _reconciliar_por_documento(db: Session, rec: PersonRecord) -> Person | None:
    """Busca a la persona por el NÚMERO de documento, cruzando nombres de campo.

    Cada fuente llama a sus columnas como quiere. El directorio publica el DNI
    en su atributo de documento; la biblioteca usa ESE MISMO NÚMERO como carné
    del lector. La reconciliación por (tipo, valor) los ve como dos credenciales
    distintas, así que la misma humana acababa partida en dos filas —1.648 casos
    medidos el 13-ago-2026—, cada una con su unidad y sus estadísticas: un
    código escaneado resolvía a una y el otro a la otra.

    Un documento de identidad identifica a la PERSONA, no al registro de un
    sistema: cuando el número coincide es la misma humana, aunque una fuente lo
    guarde bajo otro nombre de campo. Basta con que el tipo sea de documento en
    UNO de los dos lados —el entrante o el ya guardado— y por eso no vale
    comparar solo valores: dos carnés locales que coincidan por casualidad son
    dos personas, no una.

    Qué tipos cuentan como documento lo declara el overlay: cuál es el
    identificador legal de alguien depende del país y de la institución, no del
    producto. Sin overlay la lista va vacía y esta función no hace nada.
    """
    if not GLOBAL_IDENTIFIERS:
        return None
    for id_type, id_value in (rec.identifiers or {}).items():
        if not id_value:
            continue
        existente = (
            db.query(PersonIdentifier)
            .filter(PersonIdentifier.id_value == str(id_value))
            .first()
        )
        if existente is None:
            continue
        if id_type not in GLOBAL_IDENTIFIERS and existente.id_type not in GLOBAL_IDENTIFIERS:
            continue
        person = (
            db.query(Person)
            .filter(Person.person_key == existente.person_key)
            .first()
        )
        if person is not None:
            logger.info(
                "[identity] reconciliada por documento %s: '%s' (%s) se suma a la "
                "persona %s, que ya lo tenía como %s.",
                id_value, rec.person_key, id_type, person.person_key, existente.id_type,
            )
            return person
    return None


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

    # 2.bis Reconciliar por el DOCUMENTO, cruzando el nombre del campo.
    #
    #     Cada fuente llama a sus columnas como quiere. El directorio publica el
    #     DNI en su atributo de documento; la biblioteca usa ESE MISMO NÚMERO
    #     como carné del lector. El paso anterior compara (tipo, valor), así que
    #     para él son dos credenciales distintas y crea una segunda persona:
    #     la misma humana partida en dos filas, cada una con su unidad y sus
    #     estadísticas (1.648 casos medidos el 13-ago-2026). Al escanear, un
    #     código la resolvía a una fila y el otro a la otra.
    #
    #     Un documento de identidad identifica a la PERSONA, no al registro de
    #     un sistema: cuando el número coincide, es la misma humana aunque una
    #     fuente lo guarde bajo otro nombre de campo. Los tipos que valen como
    #     documento los declara el overlay (_global_identifiers), porque cuál es
    #     el identificador legal de una persona depende del país y la
    #     institución, no del producto. Sin overlay la lista va vacía y este
    #     paso no hace nada.
    if person is None:
        person = _reconciliar_por_documento(db, rec)

    if person is None:
        person = Person(person_key=rec.person_key)
        db.add(person)

    # El person_key se asigna una vez y NO se reasigna: es estable y lo referencian
    # presence_log.person_key y person_identifiers.person_key.
    effective_key = person.person_key

    entrante = source or rec.source
    manda = _fuente_manda(entrante, person.source)
    for field_name in _PERSON_FIELDS:
        val = getattr(rec, field_name)
        if val is None:
            continue
        # Una fuente menos autoritativa RELLENA huecos pero no pisa lo que ya
        # dijo una de más autoridad: si el sistema de identidad institucional
        # sabe dónde trabaja alguien, la biblioteca no debe reescribirlo con
        # dónde estudió solo por sincronizar después.
        if manda or getattr(person, field_name) in (None, ""):
            setattr(person, field_name, val)

    if manda:
        person.source = entrante
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
