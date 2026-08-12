"""Sync del padrón (sync.py).

Un padrón silenciosamente incompleto es peor que un fallo declarado: si la
fuente falla o trunca, la corrida debe quedar en 'error' y NO reportar éxito
con 0 registros.
"""

import asyncio

import pytest

from app.services.identity.base import PersonRecord
from app.services.sync import sync_provider


class FakeProvider:
    def __init__(self, name="fuente", records=None, *, raises=None):
        self.name = name
        self.priority = 30
        self.enabled = True
        self._records = records or []
        self._raises = raises

    async def fetch_all(self):
        if self._raises:
            raise self._raises
        return self._records

    async def lookup(self, id_type, id_value, sede_code=""):
        return None

    async def health(self):
        return True


def registro(person_key, **kw):
    kw.setdefault("identifiers", {"document_number": person_key.split(":")[-1]})
    return PersonRecord(person_key=person_key, source="fuente", **kw)


class TestCorridaFeliz:
    def test_cuenta_altas(self, db):
        p = FakeProvider(records=[registro("ldap:1", full_name="Ada"), registro("ldap:2", full_name="Grace")])
        run = asyncio.run(sync_provider(db, p))
        assert (run.status, run.created, run.updated, run.errors) == ("ok", 2, 0, 0)

    def test_segunda_corrida_cuenta_cambios_no_altas(self, db):
        p = FakeProvider(records=[registro("ldap:1", full_name="Ada")])
        asyncio.run(sync_provider(db, p))
        run = asyncio.run(sync_provider(db, p))
        assert (run.status, run.created, run.updated) == ("ok", 0, 1)


class TestFalloDeclarado:
    """Lo que este módulo no puede hacer nunca: decir 'ok' cuando la fuente
    falló. El operador lee el status para saber si el padrón está completo."""

    def test_fuente_que_falla_marca_error(self, db):
        p = FakeProvider(raises=RuntimeError("LDAP sizeLimitExceeded: se truncó en 10000 entries"))
        run = asyncio.run(sync_provider(db, p))
        assert run.status == "error"
        assert run.errors == 1

    def test_fuente_que_falla_no_reporta_exito_vacio(self, db):
        p = FakeProvider(raises=RuntimeError("conexión caída"))
        run = asyncio.run(sync_provider(db, p))
        assert run.status != "ok"

    def test_fuente_vacia_de_verdad_es_ok(self, db):
        """Vacío legítimo ≠ fallo: un proveedor sin volcado masivo reporta ok."""
        run = asyncio.run(sync_provider(db, FakeProvider(records=[])))
        assert (run.status, run.created, run.errors) == ("ok", 0, 0)

    def test_registra_el_nombre_de_la_instancia(self, db):
        """Con varias ramas del mismo directorio, la corrida debe decir de cuál
        vino para poder auditarlas por separado."""
        run = asyncio.run(sync_provider(db, FakeProvider(name="ldap-alumni")))
        assert run.provider == "ldap-alumni"


class TestUnRegistroMaloNoTumbaLaCorrida:
    """Bug de producción (visto 2026-07-23): el sync de ou=people quedaba en
    'running' con 0/0/0 TODOS los días, mientras alumni sincronizaba bien.

    Causa: si el upsert de UN registro falla, la transacción de PostgreSQL
    queda abortada. Sin rollback, cada operación siguiente falla también y el
    commit final —el que guarda el estado de la corrida— revienta. El registro
    queda congelado en 'running' y el padrón nunca se replica.

    Un registro malo debe costar ESE registro, no la corrida entera.
    """

    def test_sigue_tras_un_registro_que_falla(self, db):
        primero = PersonRecord(
            person_key="ldap:1", full_name="Ada", source="fuente",
            identifiers={"cardnumber": "111", "document_number": "1"},
        )
        # Misma clave (mismo documento) pero OTRO carné → son dos personas.
        malo = PersonRecord(
            person_key="ldap:1", full_name="Impostor", source="fuente",
            identifiers={"cardnumber": "999", "document_number": "1"},
        )
        ultimo = PersonRecord(
            person_key="ldap:2", full_name="Grace", source="fuente",
            identifiers={"cardnumber": "222", "document_number": "2"},
        )
        p = FakeProvider(records=[primero, malo, ultimo])

        run = asyncio.run(sync_provider(db, p))

        # La corrida TERMINA (no queda 'running') y contabiliza el fallo.
        assert run.status == "error"
        assert run.errors == 1
        # Y los registros buenos posteriores al malo sí entraron.
        assert run.created == 2

    def test_el_registro_de_la_corrida_nunca_queda_en_running(self, db):
        malo = PersonRecord(
            person_key="ldap:x", full_name="A", source="fuente", identifiers={},
        )
        run = asyncio.run(sync_provider(db, FakeProvider(records=[malo])))
        assert run.status != "running", "la corrida quedó colgada en 'running'"
        assert run.finished_at is not None

    def test_hace_rollback_tras_un_registro_fallido(self, db, monkeypatch):
        """La guarda real contra el bug de producción.

        SQLite NO reproduce el fallo (tolera seguir operando tras un error);
        PostgreSQL aborta la transacción entera. Verificado contra PostgreSQL
        real: sin este rollback la corrida quedaba en 'running' con 0/0/0 y
        todos los registros posteriores al malo se perdían.

        Como el test corre en SQLite, se verifica el CONTRATO —que se llame
        rollback— en vez del síntoma, que aquí no se manifestaría.
        """
        from app.services.identity import repository

        llamadas = {"rollback": 0}
        original = db.rollback
        monkeypatch.setattr(
            db, "rollback",
            lambda: (llamadas.__setitem__("rollback", llamadas["rollback"] + 1), original())[1],
        )

        def upsert_que_falla(_db, rec, source):
            raise RuntimeError("simula un error de SQL (dato que no entra en su columna)")

        monkeypatch.setattr("app.services.sync.upsert_person", upsert_que_falla)

        run = asyncio.run(sync_provider(db, FakeProvider(records=[registro("ldap:1")])))

        assert llamadas["rollback"] >= 1, (
            "sync_provider no hizo rollback tras un registro fallido: en PostgreSQL "
            "la transacción queda abortada y la corrida entera se pierde"
        )
        assert run.status == "error"
        assert run.errors == 1


class TestFetchAllPropagaElFallo:
    """El sync es la capa que tiene dónde registrar el error; el proveedor no
    debe tragárselo y devolver [] (eso se lee como 'ok, 0 registros')."""

    def test_ldap_propaga_el_truncado(self, monkeypatch):
        from app.config import Settings
        from app.services.identity.ldap_provider import LdapProvider

        p = LdapProvider(Settings(ldap_enabled=True, ldap_base_dn="ou=x,dc=y"))

        def _boom(search_filter):
            raise RuntimeError("LDAP sizeLimitExceeded: la búsqueda se truncó en 10000 entries")

        monkeypatch.setattr(p, "_search", _boom)

        with pytest.raises(RuntimeError, match="sizeLimitExceeded"):
            asyncio.run(p.fetch_all())

    def test_ldap_lookup_en_cambio_nunca_lanza(self, monkeypatch):
        """El escaneo es el hot path del kiosko: ahí sí se degrada en silencio."""
        from app.config import Settings
        from app.services.identity.ldap_provider import LdapProvider

        p = LdapProvider(Settings(ldap_enabled=True, ldap_base_dn="ou=x,dc=y", ldap_id_attrs="uid"))

        def _boom(search_filter):
            raise RuntimeError("conexión caída")

        monkeypatch.setattr(p, "_search", _boom)

        assert asyncio.run(p.lookup("cardnumber", "1")) is None


class TestNoBloqueaElEventLoop:
    """`sync_all` corre como BackgroundTask de FastAPI, o sea DENTRO del event
    loop. El bucle de upserts es I/O de base síncrono y largo: si se ejecuta en
    la corrutina, bloquea el loop entero y la API deja de responder mientras
    dura el sync.

    Incidente real (2026-08-11): 25 min sin servicio tras disparar /admin/sync
    con tráfico en curso — peticiones con la transacción abierta, pool agotado,
    y solo se recuperó reiniciando el backend. El sync de las 03:00 nunca lo
    destapó porque a esa hora no compite con nadie.
    """

    def test_el_loop_sigue_atendiendo_mientras_el_sync_corre(self, db):
        """Lo que importa NO es cuántas peticiones se atienden al final —con el
        bucle bloqueante también acaban atendiéndose, solo que después—, sino
        cuántas se atienden MIENTRAS el sync sigue en curso. Bloqueado, son 0.
        """
        import time

        registros = [registro(f"ldap:{i}") for i in range(20)]

        import app.services.sync as sync_mod
        original = sync_mod.upsert_person

        def lento(db_, rec, source):
            time.sleep(0.01)          # bloqueante, como el viaje real a la BD
            return original(db_, rec, source)

        sync_mod.upsert_person = lento
        try:
            async def escenario():
                sync_terminado = False
                atendidas_durante = 0

                async def sync():
                    nonlocal sync_terminado
                    await sync_provider(db, FakeProvider(records=registros))
                    sync_terminado = True

                async def api_simulada():
                    nonlocal atendidas_durante
                    for _ in range(40):
                        await asyncio.sleep(0.005)
                        if sync_terminado:
                            break
                        atendidas_durante += 1

                await asyncio.gather(sync(), api_simulada())
                return atendidas_durante

            atendidas = asyncio.run(escenario())
        finally:
            sync_mod.upsert_person = original

        assert atendidas > 0, (
            "el event loop quedó bloqueado: no se atendió NINGUNA petición "
            "mientras el sync corría. El bucle de upserts debe ejecutarse en un "
            "hilo (asyncio.to_thread), no dentro de la corrutina."
        )


class TestNoApilaCorridas:
    """Dos syncs a la vez duplican trabajo y carga sobre la BD sin adelantar
    nada. Pero el guard no puede ser absoluto: una corrida que muere de golpe
    (reinicio, OOM) deja su fila en 'running' para siempre, y sin ventana de
    obsolescencia un solo corte bloquearía el sync a perpetuidad.
    """

    class _Tareas:
        def __init__(self):
            self.lanzadas = []

        def add_task(self, fn, *a, **kw):
            self.lanzadas.append(fn)

    @staticmethod
    def _corrida(db, *, hace, status="running"):
        from datetime import datetime, timedelta, timezone
        from app.models import ProviderSyncRun

        run = ProviderSyncRun(
            provider="ldap", status=status, created=0, updated=0, errors=0,
            started_at=datetime.now(timezone.utc) - hace,
        )
        db.add(run)
        db.commit()
        return run

    @pytest.fixture(autouse=True)
    def _con_proveedores(self, monkeypatch):
        import app.routers.admin as admin_mod
        monkeypatch.setattr(admin_mod, "build_enabled_providers",
                            lambda: [FakeProvider(name="ldap")])

    def _llamar(self, db):
        import app.routers.admin as admin_mod
        tareas = self._Tareas()
        resp = admin_mod.trigger_sync(background_tasks=tareas, current_user=None, db=db)
        return resp, tareas

    def test_rechaza_si_ya_hay_una_en_curso(self, db):
        from datetime import timedelta
        self._corrida(db, hace=timedelta(minutes=5))
        resp, tareas = self._llamar(db)
        assert resp["status"] == "ya-en-curso"
        assert tareas.lanzadas == [], "lanzó un sync habiendo otro en curso"

    def test_una_corrida_muerta_no_bloquea_para_siempre(self, db):
        from datetime import timedelta
        self._corrida(db, hace=timedelta(hours=5))   # más allá de SYNC_STALE_AFTER
        resp, tareas = self._llamar(db)
        assert resp["status"] == "aceptado"
        assert len(tareas.lanzadas) == 1

    def test_una_corrida_ya_cerrada_no_bloquea(self, db):
        from datetime import timedelta
        self._corrida(db, hace=timedelta(minutes=5), status="ok")
        resp, tareas = self._llamar(db)
        assert resp["status"] == "aceptado"
        assert len(tareas.lanzadas) == 1

    def test_sin_corridas_previas_lanza(self, db):
        resp, tareas = self._llamar(db)
        assert resp["status"] == "aceptado"
        assert len(tareas.lanzadas) == 1


class TestDeteccionDeDegradacionSilenciosa:
    """InOut consume 11 de los 34 atributos que publica el directorio. Si la
    fuente renombra uno o deja de aprovisionarlo, el campo llega vacío: nada
    lanza, nada se registra, y los reportes salen incompletos hasta que alguien
    nota algo raro semanas después.

    Medir la cobertura por corrida convierte eso en un número comparable.
    """

    def test_mide_cuantos_registros_traen_cada_campo(self, db):
        from app.services.sync import _medir_cobertura

        registros = [
            registro("ldap:1", full_name="Ada", faculty="FIA"),
            registro("ldap:2", full_name="Bob"),                # sin facultad
            registro("ldap:3", full_name="Cid", faculty="FCS"),
        ]
        cob = _medir_cobertura(registros)
        assert cob["_total"] == 3
        assert cob["full_name"] == 3
        assert cob["faculty"] == 2
        assert cob["id:document_number"] == 3

    def test_un_campo_que_deja_de_venir_queda_en_cero(self, db):
        from app.services.sync import _medir_cobertura

        cob = _medir_cobertura([registro("ldap:1", full_name="Ada")])
        assert cob.get("faculty", 0) == 0

    def test_avisa_cuando_un_campo_se_desploma(self, db, caplog):
        from app.services.sync import _avisar_desplome

        previa = {"_total": 1000, "faculty": 900}
        actual = {"_total": 1000, "faculty": 3}   # la fuente dejó de publicarlo
        with caplog.at_level("WARNING"):
            _avisar_desplome("ldap", actual, previa)
        assert "faculty" in caplog.text
        assert "desplomó" in caplog.text

    def test_una_baja_gradual_no_dispara_ruido(self, db, caplog):
        """Gente que se matricula o cuyo vínculo expira mueve los números todo
        el tiempo: solo interesa el corte seco."""
        from app.services.sync import _avisar_desplome

        with caplog.at_level("WARNING"):
            _avisar_desplome("ldap", {"_total": 1000, "faculty": 850}, {"_total": 1000, "faculty": 900})
        assert caplog.text == ""

    def test_un_campo_ya_marginal_no_dispara_ruido(self, db, caplog):
        """Lo que solo traían 20 de 1000 no merece alarma al bajar a 5."""
        from app.services.sync import _avisar_desplome

        with caplog.at_level("WARNING"):
            _avisar_desplome("ldap", {"_total": 1000, "raro": 5}, {"_total": 1000, "raro": 20})
        assert caplog.text == ""

    def test_la_primera_corrida_no_avisa(self, db, caplog):
        from app.services.sync import _avisar_desplome

        with caplog.at_level("WARNING"):
            _avisar_desplome("ldap", {"_total": 10, "faculty": 0}, None)
        assert caplog.text == ""

    def test_la_corrida_guarda_su_cobertura(self, db):
        run = asyncio.run(sync_provider(db, FakeProvider(records=[
            registro("ldap:1", full_name="Ada", faculty="FIA"),
        ])))
        assert run.field_coverage["_total"] == 1
        assert run.field_coverage["faculty"] == 1
