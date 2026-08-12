"""Padrón local: upsert idempotente + índice de credenciales (repository.py).

Lo crítico aquí es la reconciliación: la misma persona vista por dos proveedores
(o por dos ramas del mismo LDAP) debe colapsar a UNA fila, y el person_key debe
ser estable una vez asignado porque presence_log lo referencia.
"""

import pytest

from app.models import Person, PersonIdentifier
from app.services.identity.base import PersonRecord
from app.services.identity.repository import (
    IdentityCollision,
    find_person_by_identifier,
    find_person_by_value,
    upsert_person,
)


def rec(person_key, identifiers, **campos):
    return PersonRecord(person_key=person_key, identifiers=identifiers, **campos)


class TestUpsertBasico:
    def test_crea_persona_e_indexa_credenciales(self, db):
        upsert_person(
            db,
            rec("ldap:40390492", {"cardnumber": "201913085", "document_number": "40390492"}, full_name="Ada"),
            source="ldap",
        )
        assert db.query(Person).count() == 1
        assert db.query(PersonIdentifier).count() == 2

    def test_es_idempotente(self, db):
        r = rec("ldap:40390492", {"cardnumber": "201913085", "document_number": "40390492"}, full_name="Ada")
        upsert_person(db, r, source="ldap")
        upsert_person(db, r, source="ldap")
        assert db.query(Person).count() == 1
        assert db.query(PersonIdentifier).count() == 2

    def test_actualiza_campos_informados(self, db):
        upsert_person(db, rec("k", {"document_number": "1"}, full_name="Ada", faculty="FIA"), source="ldap")
        upsert_person(db, rec("k", {"document_number": "1"}, full_name="Ada Lovelace"), source="ldap")
        p = db.query(Person).one()
        assert p.full_name == "Ada Lovelace"

    def test_no_borra_data_previa_con_none(self, db):
        """Un proveedor que no trae facultad no debe vaciar la que ya había:
        las fuentes tienen coberturas distintas (p. ej. la rama de egresados no
        sirve campus ni género)."""
        upsert_person(db, rec("k", {"document_number": "1"}, full_name="Ada", faculty="FIA"), source="ldap")
        upsert_person(db, rec("k", {"document_number": "1"}, full_name="Ada", faculty=None), source="ldap")
        assert db.query(Person).one().faculty == "FIA"


class TestBusqueda:
    def test_por_valor_sin_conocer_el_tipo(self, db):
        """D-11.bis: la persona presenta carné O documento y el lector no sabe
        cuál es cuál. Se busca por VALOR, no por id_type."""
        upsert_person(
            db,
            rec("ldap:40390492", {"cardnumber": "201913085", "document_number": "40390492"}, full_name="Ada"),
            source="ldap",
        )
        por_carne = find_person_by_value(db, "201913085")
        por_dni = find_person_by_value(db, "40390492")
        assert por_carne is not None
        assert por_carne.id == por_dni.id

    def test_valor_desconocido_devuelve_none(self, db):
        assert find_person_by_value(db, "999") is None

    def test_por_tipo_y_valor(self, db):
        upsert_person(db, rec("k", {"cardnumber": "201913085"}, full_name="Ada"), source="ldap")
        assert find_person_by_identifier(db, "cardnumber", "201913085") is not None
        assert find_person_by_identifier(db, "document_number", "201913085") is None


class TestReconciliacionCrossProveedor:
    """La red de seguridad que impide duplicar el padrón cuando dos fuentes
    (o dos ramas LDAP) traen a la misma persona con person_key distinto."""

    def test_misma_persona_dos_proveedores_una_sola_fila(self, db):
        upsert_person(
            db,
            rec("ldap:40390492", {"cardnumber": "201913085", "document_number": "40390492"}, full_name="Ada"),
            source="ldap",
        )
        # Otro proveedor deriva otra clave para la MISMA persona (comparte DNI).
        upsert_person(
            db,
            rec("koha:9999", {"document_number": "40390492"}, full_name="Ada L."),
            source="koha_db",
        )
        assert db.query(Person).count() == 1

    def test_el_person_key_no_se_reasigna(self, db):
        """presence_log referencia person_key: reasignarlo huerfanaría el
        histórico. La fila existente manda."""
        upsert_person(db, rec("ldap:40390492", {"document_number": "40390492"}, full_name="Ada"), source="ldap")
        upsert_person(db, rec("koha:9999", {"document_number": "40390492"}, full_name="Ada"), source="koha_db")
        p = db.query(Person).one()
        assert p.person_key == "ldap:40390492"

    def test_las_credenciales_nuevas_se_suman_a_la_fila_existente(self, db):
        upsert_person(db, rec("ldap:40390492", {"document_number": "40390492"}, full_name="Ada"), source="ldap")
        upsert_person(
            db,
            rec("koha:9999", {"document_number": "40390492", "cardnumber": "201913085"}, full_name="Ada"),
            source="koha_db",
        )
        # El carné que trajo el segundo proveedor resuelve a la persona original.
        assert find_person_by_value(db, "201913085").person_key == "ldap:40390492"
        assert db.query(PersonIdentifier).count() == 2

    def test_credencial_reapuntada_no_duplica_la_fila_de_indice(self, db):
        """Si una credencial ya existía apuntando a otra persona, se reapunta en
        vez de violar el unique (id_type, id_value)."""
        upsert_person(db, rec("p:1", {"cardnumber": "111"}, full_name="Ada"), source="ldap")
        upsert_person(db, rec("p:2", {"cardnumber": "111"}, full_name="Grace"), source="ldap")
        assert db.query(PersonIdentifier).filter_by(id_value="111").count() == 1

    def test_clave_derivada_cambia_al_aparecer_el_dni(self, db):
        """Una fila que antes solo tenía carné y luego trae DNI cambia la clave
        derivada: debe reconciliar por el carné compartido, no crear otra."""
        upsert_person(db, rec("ldap:201913085", {"cardnumber": "201913085"}, full_name="Ada"), source="ldap")
        upsert_person(
            db,
            rec("ldap:40390492", {"cardnumber": "201913085", "document_number": "40390492"}, full_name="Ada"),
            source="ldap",
        )
        assert db.query(Person).count() == 1
        assert db.query(Person).one().person_key == "ldap:201913085"

    def test_no_fusiona_dos_personas_con_el_mismo_documento(self, db):
        """Caso real (MidPoint 2026-07-18): un bug de deduplicación aguas arriba
        asignó a una persona el documento de OTRA. Como el person_key se deriva
        del documento, ambas colapsan a la misma clave.

        Fusionarlas haría que una entre al aforo registrada como la otra, sin
        traza. Se rechaza el upsert."""
        upsert_person(
            db,
            rec("ldap:14586255", {"cardnumber": "323100145", "document_number": "14586255"}, full_name="Yasmani"),
            source="ldap",
        )
        # Otra persona, con el MISMO documento por el bug → misma clave derivada.
        with pytest.raises(IdentityCollision):
            upsert_person(
                db,
                rec("ldap:14586255", {"cardnumber": "202211927", "document_number": "14586255"}, full_name="Otra"),
                source="ldap",
            )
        p = db.query(Person).one()
        assert p.full_name == "Yasmani"
        assert find_person_by_value(db, "323100145").full_name == "Yasmani"
        # La credencial de la otra persona NO quedó apuntando a Yasmani.
        assert find_person_by_value(db, "202211927") is None

    def test_el_cambio_legitimo_de_documento_sigue_reconciliando(self, db):
        """La guarda no debe romper el caso que sí queremos: mismo carné,
        documento corregido (los 24 de MidPoint con uid estable)."""
        upsert_person(db, rec("ldap:02306947", {"cardnumber": "9610165", "document_number": "02306947"}, full_name="Ada"), source="ldap")
        upsert_person(db, rec("ldap:02416310", {"cardnumber": "9610165", "document_number": "02416310"}, full_name="Ada"), source="ldap")
        assert db.query(Person).count() == 1

    def test_la_guarda_no_aplica_sin_carne_entrante(self, db):
        """Una fuente que no trae carné (p. ej. un CSV con solo DNI) no puede
        disparar la guarda: sin carné no hay con qué comparar."""
        upsert_person(db, rec("k", {"cardnumber": "111", "document_number": "1"}, full_name="Ada"), source="ldap")
        upsert_person(db, rec("k", {"document_number": "1"}, full_name="Ada"), source="csv")
        assert db.query(Person).count() == 1

    def test_personas_distintas_no_se_mezclan(self, db):
        upsert_person(db, rec("ldap:1", {"document_number": "1", "cardnumber": "10"}, full_name="Ada"), source="ldap")
        upsert_person(db, rec("ldap:2", {"document_number": "2", "cardnumber": "20"}, full_name="Grace"), source="ldap")
        assert db.query(Person).count() == 2
        assert find_person_by_value(db, "10").full_name == "Ada"
        assert find_person_by_value(db, "20").full_name == "Grace"


class TestUnaPersonaTieneVariasCredenciales:
    """Una persona NO tiene un solo identificador. Lleva carné universitario,
    DNI, y según el caso carné de extranjería o pasaporte; quien trabaja y
    además estudió arrastra el código de trabajador y el de alumno.

    Medido en el directorio de UPeU (2026-08-12): 28.752 DNI, 145 CE y 91
    pasaportes. Y Koha identifica a sus patrons por carné Y por DNI a la vez
    (18.710 con ambos). Rechazar la segunda credencial negaba cómo funciona
    la institución: 7 personas al día quedaban fuera del padrón y escaneaban
    como "Sin identificar" con su carné vigente.
    """

    def test_acepta_un_segundo_carne_de_la_misma_persona(self, db):
        upsert_person(
            db,
            rec("ldap:70596558", {"cardnumber": "70596558", "document_number": "70596558"},
                full_name="Gonzalo Reymundo Soto"),
            source="koha_db",
        )
        # El directorio trae su código institucional, distinto del DNI.
        upsert_person(
            db,
            rec("ldap:70596558", {"cardnumber": "202622857", "document_number": "70596558"},
                full_name="Gonzalo Reymundo Soto"),
            source="ldap",
        )
        assert db.query(Person).count() == 1, "no debe duplicar a la persona"
        # Cualquiera de las dos credenciales resuelve a la misma persona.
        assert find_person_by_value(db, "70596558").full_name == "Gonzalo Reymundo Soto"
        assert find_person_by_value(db, "202622857").full_name == "Gonzalo Reymundo Soto"

    def test_el_nombre_se_compara_sin_tildes_ni_mayusculas(self, db):
        """La misma persona llega escrita distinto según la fuente."""
        upsert_person(
            db,
            rec("ldap:60233598", {"cardnumber": "324110503", "document_number": "60233598"},
                full_name="YAHIR ALEXANDER NEIRA CURO"),
            source="ldap",
        )
        upsert_person(
            db,
            rec("ldap:60233598", {"cardnumber": "202623077", "document_number": "60233598"},
                full_name="Yahir Alexander Neira Curo"),
            source="ldap",
        )
        assert db.query(Person).count() == 1

    def test_dos_humanos_bajo_un_documento_siguen_rechazandose(self, db):
        """Lo que la guarda sí debe seguir atrapando."""
        upsert_person(
            db,
            rec("ldap:14586255", {"cardnumber": "323100145", "document_number": "14586255"},
                full_name="Yasmani Vargas"),
            source="ldap",
        )
        with pytest.raises(IdentityCollision):
            upsert_person(
                db,
                rec("ldap:14586255", {"cardnumber": "202211927", "document_number": "14586255"},
                    full_name="Persona Distinta"),
                source="ldap",
            )

    def test_sin_nombre_se_mantiene_el_rechazo(self, db):
        """Sin nombre no hay con qué distinguirlos: se elige el lado seguro."""
        upsert_person(
            db,
            rec("ldap:99999999", {"cardnumber": "111", "document_number": "99999999"}),
            source="ldap",
        )
        with pytest.raises(IdentityCollision):
            upsert_person(
                db,
                rec("ldap:99999999", {"cardnumber": "222", "document_number": "99999999"}),
                source="ldap",
            )

    def test_compara_contra_todas_las_credenciales_no_contra_una(self, db):
        """Con varias credenciales por persona, mirar solo la primera que
        devuelva la base haría depender el resultado de un orden que nadie
        garantiza: la tercera credencial debe reconocer a las dos anteriores."""
        for carne in ("70596558", "202622857"):
            upsert_person(
                db,
                rec("ldap:70596558", {"cardnumber": carne, "document_number": "70596558"},
                    full_name="Gonzalo Reymundo Soto"),
                source="ldap",
            )
        # Reenviar la PRIMERA credencial no debe verse como conflicto.
        upsert_person(
            db,
            rec("ldap:70596558", {"cardnumber": "70596558", "document_number": "70596558"},
                full_name="Gonzalo Reymundo Soto"),
            source="ldap",
        )
        assert db.query(Person).count() == 1
        carnes = {
            i.id_value for i in db.query(PersonIdentifier)
            .filter(PersonIdentifier.id_type == "cardnumber")
        }
        assert carnes == {"70596558", "202622857"}
