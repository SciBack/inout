"""Libros más prestados (services/materials.py + routers/materials.py).

Koha y las fuentes de portadas se simulan con httpx.MockTransport: ningún test
sale a la red."""

import asyncio
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.config import settings
from app.models import MaterialCover, MaterialLoan, MaterialTitle, Space
from app.routers.materials import get_material_cover, get_materials_top
from app.services import materials as svc

LIMA = ZoneInfo("America/Lima")
NOW = datetime(2026, 10, 28, 10, 0, tzinfo=LIMA)   # miércoles


def run(coro):
    return asyncio.run(coro)


def loan(cid, biblio, when, lib="BUL"):
    return MaterialLoan(checkout_id=cid, biblio_id=biblio, library_code=lib, checkout_date=when)


# ── Periodos ────────────────────────────────────────────────────────────────

class TestPeriodStarts:
    def test_limites_en_hora_lima(self):
        s = svc.period_starts(NOW)
        assert s["day"] == datetime(2026, 10, 28, 0, 0, tzinfo=LIMA)
        assert s["week"] == datetime(2026, 10, 22, 0, 0, tzinfo=LIMA)    # hoy + 6 anteriores = 7 días
        assert s["month"] == datetime(2026, 9, 29, 0, 0, tzinfo=LIMA)    # hoy + 29 anteriores = 30 días

    def test_a_las_23_59_lima_sigue_siendo_el_mismo_dia(self):
        tarde = datetime(2026, 10, 28, 23, 59, tzinfo=LIMA)
        assert svc.period_starts(tarde)["day"] == datetime(2026, 10, 28, 0, 0, tzinfo=LIMA)

    def test_una_hora_en_utc_se_convierte_a_lima(self):
        # 02:00 UTC del 29 = 21:00 Lima del 28: todavía es 28 para el CRAI.
        utc = datetime(2026, 10, 29, 2, 0, tzinfo=ZoneInfo("UTC"))
        assert svc.period_starts(utc)["day"].date().isoformat() == "2026-10-28"


# ── Texto de catálogo ───────────────────────────────────────────────────────

class TestTextoDeCatalogo:
    @pytest.mark.parametrize("crudo,limpio", [
        ("Fisiología humana /", "Fisiología humana"),
        ("Santa Biblia :", "Santa Biblia"),
        ("Faber, Nancy,", "Faber, Nancy"),
        ("  Derecho penal ;  ", "Derecho penal"),
        (None, ""),
    ])
    def test_clean_isbd(self, crudo, limpio):
        assert svc.clean_isbd(crudo) == limpio

    def test_titulo_con_subtitulo(self):
        assert svc.compose_title("Piano adventures /", "El método básico ") == "Piano adventures: El método básico"

    def test_no_repite_un_subtitulo_ya_incluido(self):
        assert svc.compose_title("Atlas de anatomía humana", "anatomía humana") == "Atlas de anatomía humana"

    def test_isbn_13_primero_y_sin_guiones(self):
        raw = "8491131027 | 978-84-9113-102-1 | 6071513359 (obra completa)"
        assert svc.extract_isbns(raw)[0] == "9788491131021"
        assert "6071513359" in svc.extract_isbns(raw)

    def test_sin_isbn(self):
        assert svc.extract_isbns(None) == [] and svc.extract_isbns("") == []


# ── Ranking ─────────────────────────────────────────────────────────────────

class TestTopTitles:
    def _datos(self, db):
        db.add_all([
            MaterialTitle(biblio_id=1, title="Fisiología humana", author="Costanzo", cover_source="koha"),
            MaterialTitle(biblio_id=2, title="Derecho penal"),
            MaterialTitle(biblio_id=3, title="Atlas de anatomía"),
        ])
        db.add_all([
            loan(1, 1, NOW - timedelta(hours=1)), loan(2, 1, NOW - timedelta(hours=2)),
            loan(3, 1, NOW - timedelta(days=3)),
            loan(4, 2, NOW - timedelta(hours=3)),
            loan(5, 3, NOW - timedelta(days=20)),
            loan(6, 2, NOW - timedelta(hours=1), lib="BUJ"),
        ])
        db.commit()

    def test_ordena_por_prestamos(self, db):
        self._datos(db)
        top = svc.top_titles(db, svc.period_starts(NOW)["month"], None, 10)
        assert [t["biblio_id"] for t in top] == [1, 2, 3]
        assert [t["loans"] for t in top] == [3, 2, 1]
        assert [t["rank"] for t in top] == [1, 2, 3]

    def test_el_periodo_recorta(self, db):
        self._datos(db)
        hoy = svc.top_titles(db, svc.period_starts(NOW)["day"], None, 10)
        assert {t["biblio_id"] for t in hoy} == {1, 2}            # el 3 es de hace 20 días
        assert next(t for t in hoy if t["biblio_id"] == 1)["loans"] == 2

    def test_filtra_por_biblioteca(self, db):
        self._datos(db)
        solo_buj = svc.top_titles(db, svc.period_starts(NOW)["month"], "BUJ", 10)
        assert [(t["biblio_id"], t["loans"]) for t in solo_buj] == [(2, 1)]

    def test_empate_gana_el_prestamo_mas_reciente(self, db):
        db.add_all([MaterialTitle(biblio_id=10, title="A"), MaterialTitle(biblio_id=11, title="B")])
        db.add_all([loan(1, 10, NOW - timedelta(hours=5)), loan(2, 11, NOW - timedelta(hours=1))])
        db.commit()
        top = svc.top_titles(db, svc.period_starts(NOW)["day"], None, 10)
        assert [t["biblio_id"] for t in top] == [11, 10]

    def test_limite(self, db):
        self._datos(db)
        assert len(svc.top_titles(db, svc.period_starts(NOW)["month"], None, 2)) == 2

    def test_titulo_sin_ficha_no_rompe(self, db):
        db.add(loan(1, 999, NOW - timedelta(hours=1)))
        db.commit()
        [t] = svc.top_titles(db, svc.period_starts(NOW)["day"], None, 5)
        assert t["title"] == "Registro 999" and t["has_cover"] is False

    def test_total_de_prestamos_incluye_los_que_no_entran_al_top(self, db):
        self._datos(db)
        assert svc.total_loans(db, svc.period_starts(NOW)["month"], None) == 6
        assert svc.total_loans(db, svc.period_starts(NOW)["month"], "BUL") == 5

    def test_sin_prestamos(self, db):
        assert svc.top_titles(db, svc.period_starts(NOW)["month"], None, 5) == []


# ── Koha simulado ───────────────────────────────────────────────────────────

def checkout(cid, biblio, when, lib="BUL", onsite=False, con_item=True):
    row = {"checkout_id": cid, "library_id": lib, "checkout_date": when.isoformat(timespec="seconds"),
           "onsite_checkout": onsite}
    if con_item:
        row["item"] = {"item_id": cid + 1000, "biblio_id": biblio}
    return row


def koha(vigentes=(), devueltos=(), fichas=None):
    """Cliente httpx contra un Koha simulado. Registra las peticiones en .calls."""
    fichas = fichas if fichas is not None else {}
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if req.url.path == "/checkouts":
            lista = devueltos if req.url.params.get("checked_in") == "true" else vigentes
            pagina, por_pagina = int(req.url.params["_page"]), int(req.url.params["_per_page"])
            return httpx.Response(200, json=list(lista)[(pagina - 1) * por_pagina: pagina * por_pagina])
        if req.url.path.startswith("/biblios/"):
            bid = int(req.url.path.rsplit("/", 1)[1])
            return httpx.Response(200, json=fichas[bid]) if bid in fichas else httpx.Response(404, json={})
        return httpx.Response(500)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://koha.test")
    client.calls = calls
    return client


class TestSyncLoans:
    def test_trae_vigentes_y_devueltos_y_las_fichas(self, db):
        c = koha(
            vigentes=[checkout(1, 100, NOW - timedelta(hours=2))],
            devueltos=[checkout(2, 100, NOW - timedelta(days=1)), checkout(3, 200, NOW - timedelta(hours=4), lib="BUJ")],
            fichas={100: {"title": "Fisiología humana /", "subtitle": None, "author": "Costanzo, Linda,",
                          "isbn": "9786071503497", "item_type": "BK"},
                    200: {"title": "Derecho penal :", "subtitle": "parte general", "author": "Welzel,", "isbn": None}},
        )
        stats = run(svc.sync_loans(db, c, NOW))
        assert stats["loans"] == 3 and stats["titles"] == 2
        assert db.query(MaterialLoan).count() == 3
        t = db.get(MaterialTitle, 100)
        assert (t.title, t.author) == ("Fisiología humana", "Costanzo, Linda")
        assert db.get(MaterialTitle, 200).title == "Derecho penal: parte general"

    def test_dos_corridas_no_duplican(self, db):
        c = koha(vigentes=[checkout(1, 100, NOW)], fichas={100: {"title": "X"}})
        run(svc.sync_loans(db, c, NOW))
        run(svc.sync_loans(db, c, NOW))
        assert db.query(MaterialLoan).count() == 1

    def test_la_segunda_corrida_no_vuelve_a_pedir_fichas_conocidas(self, db):
        c = koha(vigentes=[checkout(1, 100, NOW)], fichas={100: {"title": "X"}})
        run(svc.sync_loans(db, c, NOW))
        antes = sum(r.url.path.startswith("/biblios/") for r in c.calls)
        run(svc.sync_loans(db, c, NOW))
        assert sum(r.url.path.startswith("/biblios/") for r in c.calls) == antes

    def test_primera_corrida_trae_el_historial_y_las_siguientes_solo_el_solape(self, db):
        c = koha(vigentes=[checkout(1, 100, NOW)], fichas={100: {"title": "X"}})
        run(svc.sync_loans(db, c, NOW))
        primera = json.loads(next(r for r in c.calls if r.url.path == "/checkouts").url.params["q"])
        assert primera["checkout_date"][">="].startswith("2026-06-30")          # 120 días atrás
        c.calls.clear()
        run(svc.sync_loans(db, c, NOW))
        segunda = json.loads(next(r for r in c.calls if r.url.path == "/checkouts").url.params["q"])
        assert segunda["checkout_date"][">="].startswith("2026-10-25")          # 3 días atrás

    def test_pagina_hasta_agotar(self, db, monkeypatch):
        monkeypatch.setattr(svc, "PER_PAGE", 2)
        c = koha(vigentes=[checkout(i, 100, NOW) for i in range(1, 6)], fichas={100: {"title": "X"}})
        run(svc.sync_loans(db, c, NOW))
        assert db.query(MaterialLoan).count() == 5

    def test_un_prestamo_sin_item_se_cuenta_como_omitido(self, db):
        c = koha(vigentes=[checkout(1, 100, NOW, con_item=False), checkout(2, 100, NOW)], fichas={100: {"title": "X"}})
        stats = run(svc.sync_loans(db, c, NOW))
        assert stats["skipped"] == 1 and db.query(MaterialLoan).count() == 1

    def test_ficha_inexistente_no_corta_la_corrida(self, db):
        c = koha(vigentes=[checkout(1, 100, NOW), checkout(2, 200, NOW)], fichas={200: {"title": "Y"}})
        stats = run(svc.sync_loans(db, c, NOW))
        assert stats["loans"] == 2 and stats["titles"] == 1

    def test_koha_caido_propaga_el_error_para_que_el_job_lo_registre(self, db):
        def caido(req):
            return httpx.Response(503)
        c = httpx.AsyncClient(transport=httpx.MockTransport(caido), base_url="http://koha.test")
        with pytest.raises(httpx.HTTPStatusError):
            run(svc.sync_loans(db, c, NOW))
        assert db.query(MaterialLoan).count() == 0

    def test_no_guarda_quien_pidio_el_libro(self, db):
        fila = checkout(1, 100, NOW)
        fila["patron_id"] = 4242
        run(svc.sync_loans(db, koha(vigentes=[fila], fichas={100: {"title": "X"}}), NOW))
        columnas = {c.name for c in MaterialLoan.__table__.columns}
        assert not any("patron" in c or "borrower" in c for c in columnas)


# ── Portadas ────────────────────────────────────────────────────────────────

GIF_43 = b"GIF89a" + b"\x00" * 37                  # lo que Koha responde sin portada
JPEG = b"\xff\xd8\xff" + b"x" * 5000


def web(rutas: dict):
    """Cliente "internet" simulado: rutas = {fragmento_de_url: (status, content_type, bytes)}."""
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(str(req.url))
        for fragmento, (status, ctype, body) in rutas.items():
            if fragmento in str(req.url):
                return httpx.Response(status, headers={"content-type": ctype}, content=body)
        return httpx.Response(404)

    c = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    c.calls = calls
    return c


@pytest.fixture
def con_fuentes(monkeypatch):
    monkeypatch.setattr(settings, "materials_opac_url", "https://opac.test")
    monkeypatch.setattr(settings, "materials_cover_sources", "koha,openlibrary,google")


class TestPortadas:
    def _titulo(self, db, isbn="9788491131021"):
        t = MaterialTitle(biblio_id=7, title="X", isbn=isbn)
        db.add(t); db.commit()
        return t

    def test_koha_local_gana_y_corta_la_busqueda(self, db, con_fuentes):
        t = self._titulo(db)
        w = web({"opac-image.pl": (200, "image/jpeg", JPEG)})
        assert run(svc.resolve_cover(db, w, t)) == "koha"
        assert len(w.calls) == 1                       # no consultó Open Library ni Google
        assert db.get(MaterialCover, 7).data == JPEG

    def test_el_gif_de_43_bytes_de_koha_no_es_una_portada(self, db, con_fuentes):
        t = self._titulo(db)
        w = web({"opac-image.pl": (200, "image/gif", GIF_43), "openlibrary": (200, "image/jpeg", JPEG)})
        assert run(svc.resolve_cover(db, w, t)) == "openlibrary"

    def test_open_library_404_pasa_a_google(self, db, con_fuentes):
        t = self._titulo(db)
        jsonp = 'x({"ISBN:9788491131021":{"thumbnail_url":"https://books.google.com/books/content?id=A&zoom=5&edge=curl"}});'
        w = web({"opac-image.pl": (200, "image/gif", GIF_43),
                 "viewapi": (200, "text/javascript", jsonp.encode()),
                 "books/content": (200, "image/jpeg", JPEG)})
        assert run(svc.resolve_cover(db, w, t)) == "google"
        assert not any("edge=curl" in u for u in w.calls)

    def test_google_sin_thumbnail_no_baja_ninguna_imagen(self, db, con_fuentes):
        # Si viewapi no informa portada, el endpoint de imágenes devolvería un
        # relleno gris: no hay que pedirlo.
        t = self._titulo(db)
        w = web({"viewapi": (200, "text/javascript", b'x({"ISBN:9788491131021":{"bib_key":"ISBN:9788491131021"}});'),
                 "books/content": (200, "image/jpeg", JPEG)})
        assert run(svc.resolve_cover(db, w, t)) is None
        assert not any("books/content" in u for u in w.calls)

    def test_sin_portada_queda_registrado_y_sin_bytes(self, db, con_fuentes):
        t = self._titulo(db)
        assert run(svc.resolve_cover(db, web({}), t)) is None
        assert t.cover_checked_at is not None and t.cover_source is None
        assert db.get(MaterialCover, 7) is None

    def test_sin_isbn_solo_puede_venir_de_koha(self, db, con_fuentes):
        t = self._titulo(db, isbn=None)
        w = web({"opac-image.pl": (200, "image/gif", GIF_43)})
        assert run(svc.resolve_cover(db, w, t)) is None
        assert not any("openlibrary" in u or "google" in u for u in w.calls)

    def test_una_fuente_caida_no_impide_probar_la_siguiente(self, db, con_fuentes):
        t = self._titulo(db)

        def handler(req):
            if "opac-image" in str(req.url):
                raise httpx.ConnectError("opac caído")
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=JPEG)

        w = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        assert run(svc.resolve_cover(db, w, t)) == "openlibrary"

    def test_una_imagen_enorme_se_descarta(self, db, con_fuentes):
        t = self._titulo(db)
        w = web({"opac-image.pl": (200, "image/jpeg", b"\xff" * (svc.MAX_COVER_BYTES + 1))})
        assert run(svc.resolve_cover(db, w, t)) is None

    def test_respeta_las_fuentes_configuradas(self, db, monkeypatch):
        monkeypatch.setattr(settings, "materials_cover_sources", "openlibrary")
        t = self._titulo(db)
        w = web({"opac-image.pl": (200, "image/jpeg", JPEG)})
        assert run(svc.resolve_cover(db, w, t)) is None
        assert not any("opac-image" in u for u in w.calls)


class TestCoversWanted:
    def _preparar(self, db, **titulo):
        db.add(MaterialTitle(biblio_id=1, title="X", **titulo))
        db.add(loan(1, 1, datetime.now(LIMA) - timedelta(hours=1)))
        db.commit()

    def test_pide_los_que_nunca_se_buscaron(self, db):
        self._preparar(db)
        assert [t.biblio_id for t in svc.covers_wanted(db)] == [1]

    def test_no_repite_los_que_ya_tienen_portada(self, db):
        self._preparar(db, cover_source="koha", cover_checked_at=datetime.now(LIMA))
        assert svc.covers_wanted(db) == []

    def test_un_titulo_sin_portada_se_reintenta_solo_pasados_7_dias(self, db):
        self._preparar(db, cover_checked_at=datetime.now(LIMA) - timedelta(days=2))
        assert svc.covers_wanted(db) == []
        db.get(MaterialTitle, 1).cover_checked_at = datetime.now(LIMA) - timedelta(days=8)
        db.commit()
        assert [t.biblio_id for t in svc.covers_wanted(db)] == [1]

    def test_solo_busca_portada_de_lo_que_esta_en_el_ranking(self, db):
        db.add(MaterialTitle(biblio_id=1, title="Viejo"))
        db.add(loan(1, 1, datetime.now(LIMA) - timedelta(days=200)))   # fuera de los 30 días
        db.commit()
        assert svc.covers_wanted(db) == []


# ── Endpoint ────────────────────────────────────────────────────────────────

class TestEndpoint:
    def _activar(self, monkeypatch):
        monkeypatch.setattr(settings, "materials_enabled", True)

    def test_apagado_responde_enabled_false_y_nada_mas(self, db, monkeypatch):
        monkeypatch.setattr(settings, "materials_enabled", False)
        r = get_materials_top(space_id=None, limit=8, db=db)
        assert r.enabled is False and r.periods == []

    def test_forma_del_contrato(self, db, monkeypatch):
        self._activar(monkeypatch)
        db.add(MaterialTitle(biblio_id=1, title="Fisiología humana", author="Costanzo", cover_source="koha"))
        db.add(loan(1, 1, datetime.now(LIMA) - timedelta(minutes=5)))
        db.commit()
        r = get_materials_top(space_id=None, limit=8, db=db)
        assert [p.key for p in r.periods] == ["day", "week", "month"]
        assert [p.label for p in r.periods] == ["Hoy", "Últimos 7 días", "Últimos 30 días"]
        item = r.periods[0].items[0]
        assert (item.rank, item.title, item.loans) == (1, "Fisiología humana", 1)
        assert item.cover_url == "/api/materials/cover/1"
        assert r.periods[0].total_loans == 1

    def test_la_biblioteca_sale_del_espacio(self, db, monkeypatch):
        self._activar(monkeypatch)
        db.add(Space(id=1, name="CRAI Lima", capacity=10, library_code="BUL"))
        db.add(Space(id=2, name="CRAI Juliaca", capacity=10, library_code="BUJ"))
        db.add(MaterialTitle(biblio_id=1, title="A")); db.add(MaterialTitle(biblio_id=2, title="B"))
        ahora = datetime.now(LIMA) - timedelta(minutes=5)
        db.add_all([loan(1, 1, ahora, "BUL"), loan(2, 2, ahora, "BUJ")])
        db.commit()
        lima = get_materials_top(space_id=1, limit=8, db=db)
        assert lima.library_code == "BUL"
        assert [i.title for i in lima.periods[0].items] == ["A"]
        juliaca = get_materials_top(space_id=2, limit=8, db=db)
        assert [i.title for i in juliaca.periods[0].items] == ["B"]

    def test_sin_portada_cover_url_es_null(self, db, monkeypatch):
        self._activar(monkeypatch)
        db.add(MaterialTitle(biblio_id=1, title="A"))
        db.add(loan(1, 1, datetime.now(LIMA) - timedelta(minutes=5)))
        db.commit()
        assert get_materials_top(space_id=None, limit=8, db=db).periods[0].items[0].cover_url is None

    def test_limite_acotado(self, db, monkeypatch):
        self._activar(monkeypatch)
        ahora = datetime.now(LIMA) - timedelta(minutes=5)
        for i in range(1, 31):
            db.add(MaterialTitle(biblio_id=i, title=f"T{i}")); db.add(loan(i, i, ahora))
        db.commit()
        assert len(get_materials_top(space_id=None, limit=500, db=db).periods[0].items) == 20

    def test_portada_servida_con_cache(self, db):
        db.add(MaterialCover(biblio_id=1, content_type="image/jpeg", data=JPEG, source="koha"))
        db.commit()
        resp = get_material_cover(1, db)
        assert resp.body == JPEG and resp.media_type == "image/jpeg"
        assert "max-age" in resp.headers["cache-control"]

    def test_portada_inexistente_es_404(self, db):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as e:
            get_material_cover(99, db)
        assert e.value.status_code == 404
