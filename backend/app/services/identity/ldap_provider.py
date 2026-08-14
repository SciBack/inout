# Adaptador LDAP/AD (ldap3, pure-python). Mismo adaptador para OpenLDAP y AD.
# - fetch_all: búsqueda paginada por ldap_base_dn + ldap_user_filter.
# - lookup:    filtro por el atributo que mapea al id_type consultado.
# Mapea atributos (eduPerson/SCHAC/AD) → padrón vía mapping.py.
# Ante conexión caída devuelve [] / None y health()=False, sin lanzar.
#
# Una instancia = una RAMA del directorio. Un directorio puede servir a su
# población en varias ramas (p. ej. activos y egresados en sub-árboles
# distintos), cada una con su propio base_dn, filtro y prioridad, pero
# compartiendo host, bind y mapeo de atributos. Ver `branch` en __init__.

import asyncio
import logging

from ...config import settings
from .base import PersonRecord
from .mapping import provider_map, record_from_raw

logger = logging.getLogger(__name__)

# Atributo LDAP por defecto para cada tipo de credencial, si el mapa del
# overlay no define uno explícito en identity_map.json → ldap → identifiers.
_DEFAULT_ATTR_FOR_ID_TYPE = {
    "uid": "uid",
    "samaccountname": "sAMAccountName",
    "document_number": "employeeNumber",
    "cardnumber": "employeeNumber",
    "email": "mail",
}


class LdapProvider:
    def __init__(self, cfg=settings, branch: dict | None = None):
        """`branch` describe una rama adicional del mismo directorio:
        {"name", "base_dn", "user_filter", "priority", "map_key"}. Lo que no
        declare se hereda de la config global (host, bind, id_attrs, page_size).

        `name` identifica la INSTANCIA (traza los sync runs por rama); `map_key`
        elige el sub-mapa del identity_map y, con él, el namespace del
        person_key. Por defecto ambas ramas comparten map_key="ldap": son el
        mismo directorio, así que la misma persona deriva la misma clave y
        colapsa a una sola fila del padrón en vez de duplicarse.
        """
        branch = branch or {}
        self.name = branch.get("name") or "ldap"
        self.map_key = branch.get("map_key") or "ldap"
        self.priority = branch.get("priority", cfg.ldap_priority)
        self.enabled = cfg.ldap_enabled
        self.host = cfg.ldap_host
        self.bind_dn = cfg.ldap_bind_dn
        self.bind_pass = cfg.ldap_bind_pass
        self.base_dn = branch.get("base_dn") or cfg.ldap_base_dn
        # Filtro base: acota a la población viva/gobernada de la institución.
        # UPeU: "(eduPersonAffiliation=member)" — excluye egresados y fósiles.
        self.user_filter = branch.get("user_filter") or cfg.ldap_user_filter or "(objectClass=person)"
        self.page_size = cfg.ldap_page_size
        self.raw_exclude = {
            a.strip().lower() for a in (cfg.ldap_raw_exclude or "").split(",") if a.strip()
        }
        # Atributos contra los que se busca el valor escaneado. Una persona
        # puede presentar cualquiera de sus credenciales (carné o documento) y
        # debe resolver al mismo registro.
        self.id_attrs = [a.strip() for a in (cfg.ldap_id_attrs or "").split(",") if a.strip()]

    # ── helpers de mapeo ────────────────────────────────────────────────
    def _attr_for_id_type(self, id_type: str) -> str | None:
        id_map = provider_map(self.map_key).get("identifiers", {})
        for attr, mapped_type in id_map.items():
            if mapped_type == id_type:
                return attr
        return _DEFAULT_ATTR_FOR_ID_TYPE.get(id_type)

    def _flatten(self, entry_attrs: dict) -> dict:
        """Aplana valores LDAP (listas) a str; coacciona no-serializables.

        Descarta los atributos de `raw_exclude` ANTES de construir el registro,
        para que no lleguen a `persons.raw`. Son binarios y credenciales
        (fotos, certificados, hashes) que el aforo no usa: guardarlos multiplica
        el peso del padrón y nos haría custodios de datos que no necesitamos.
        """
        raw = {}
        for key, val in entry_attrs.items():
            if key.lower() in self.raw_exclude:
                continue
            if isinstance(val, list):
                val = val[0] if len(val) == 1 else [str(v) for v in val]
            if isinstance(val, (bytes, bytearray)):
                val = val.decode("utf-8", errors="replace")
            raw[key] = val if isinstance(val, (str, list)) else str(val)
        return raw

    # ── operaciones de red (bloqueantes, se corren en thread) ───────────
    def _connect(self):
        import ldap3

        server = ldap3.Server(self.host, get_info=ldap3.NONE)
        conn = ldap3.Connection(
            server,
            user=self.bind_dn or None,
            password=self.bind_pass or None,
            auto_bind=True,
        )
        return conn

    def _cargar_unidades(self, conn) -> dict[str, str]:
        """Catálogo `código de unidad → nombre` del subárbol organizativo.

        La persona trae solo `departmentNumber` (un número); el nombre legible
        vive en el árbol de organización del directorio. Sin resolverlo, un
        trabajador aparece sin unidad en los reportes aunque el dato exista.

        Se lee una vez por corrida y se cachea: son ~100 entradas frente a
        decenas de miles de personas, y hacerlo por persona sería absurdo.
        """
        base = getattr(settings, "ldap_org_base_dn", "") or ""
        if not base:
            return {}
        catalogo: dict[str, str] = {}
        try:
            entradas = conn.extend.standard.paged_search(
                search_base=base,
                search_filter="(objectClass=*)",
                attributes=["ou", "description"],
                paged_size=self.page_size,
                generator=True,
            )
            for e in entradas:
                if e.get("type") != "searchResEntry":
                    continue
                a = self._flatten(e.get("attributes", {}))
                codigo = str(a.get("ou") or "").strip()
                nombre = str(a.get("description") or "").strip()
                if codigo and nombre:
                    catalogo[codigo] = nombre
        except Exception:
            # El catálogo es un extra: si falla, las personas se sincronizan
            # igual y solo se quedan sin nombre de unidad.
            logger.warning("[ldap] no se pudo leer el catálogo de unidades", exc_info=True)
        return catalogo

    @staticmethod
    def _resolver_unidad(raw: dict, unidades: dict[str, str]) -> None:
        """Traduce el código de unidad de la persona a su nombre, in situ.

        Se hace ANTES de mapear para que el overlay reciba el dato ya legible y
        no tenga que conocer el árbol organizativo del directorio.

        El atributo es MULTIVALOR: una persona puede pertenecer a varias
        unidades (225 de 2.765 medidas el 13-ago-2026, hasta 3 cada una).
        Tratarlo como escalar lo perdía entero —str(['4','136']) no casa con
        ningún código— y esas personas se quedaban sin área sin que nada
        fallara. Se traducen todas las que el catálogo reconoce y el colapso
        determinista del mapeo elige una: cuál es arbitrario, pero es siempre la
        misma entre corridas.

        Un código que el catálogo no tiene se ignora: es un hueco de la fuente
        (56 códigos, 899 personas el 13-ago-2026) y esas personas quedan sin
        unidad, igual que antes de existir esta traducción.
        """
        codigos = raw.get("departmentNumber")
        if not isinstance(codigos, list):
            codigos = [codigos]
        nombres = [
            unidades[c] for c in (str(v or "").strip() for v in codigos)
            if c and c in unidades
        ]
        if nombres:
            raw["_unidad"] = nombres if len(nombres) > 1 else nombres[0]

    def _search(self, search_filter: str) -> list[PersonRecord]:
        import ldap3

        records: list[PersonRecord] = []
        conn = None
        try:
            conn = self._connect()
            unidades = self._cargar_unidades(conn)
            entries = conn.extend.standard.paged_search(
                search_base=self.base_dn,
                search_filter=search_filter,
                attributes=ldap3.ALL_ATTRIBUTES,
                paged_size=self.page_size,
                generator=True,
            )
            for entry in entries:
                if entry.get("type") != "searchResEntry":
                    continue
                raw = self._flatten(entry.get("attributes", {}))
                self._resolver_unidad(raw, unidades)
                # map_key elige el mapeo y el namespace del person_key (común a
                # todas las ramas); name registra de qué rama vino el dato.
                rec = record_from_raw(self.map_key, raw, self.name)
                if rec is not None:
                    records.append(rec)
            # Guarda anti-truncado: el servidor puede cortar la búsqueda por
            # sizelimit y devolver resultado PARCIAL sin error (resultCode 4).
            # Un padrón silenciosamente incompleto es peor que un fallo: se
            # trata como error para no sincronizar datos a medias.
            result = getattr(conn, "result", None) or {}
            if result.get("result") == 4:  # sizeLimitExceeded
                raise RuntimeError(
                    f"LDAP sizeLimitExceeded: la búsqueda se truncó en {len(records)} "
                    f"entries. Subir el sizelimit del bind o paginar por rangos."
                )
        finally:
            if conn is not None:
                try:
                    conn.unbind()
                except Exception:
                    pass
        return records

    # ── interfaz IdentityProvider ───────────────────────────────────────
    async def fetch_all(self):
        # A propósito NO se captura: el sync necesita distinguir "la fuente no
        # tiene a nadie" de "la fuente falló o truncó". Devolver [] ante un
        # fallo hace que la corrida se registre como 'ok' con 0 registros y el
        # operador crea que el padrón está completo. `sync_provider` captura y
        # marca la corrida en 'error'. (El hot path del escaneo es `lookup`, y
        # ese sí degrada en silencio.)
        return await asyncio.to_thread(self._search, self.user_filter)

    async def lookup(
        self, id_type: str, id_value: str, sede_code: str = ""
    ) -> PersonRecord | None:
        # El valor escaneado puede ser cualquier credencial de la persona
        # (carné o documento): se busca contra todos los id_attrs configurados
        # y se acota al filtro de población viva. Si no hay id_attrs, se cae al
        # comportamiento por id_type (producto agnóstico).
        attrs = self.id_attrs or [a for a in [self._attr_for_id_type(id_type)] if a]
        if not attrs:
            return None
        # Escapar el valor para evitar romper el filtro LDAP.
        try:
            from ldap3.utils.conv import escape_filter_chars

            safe = escape_filter_chars(id_value)
        except Exception:
            safe = id_value
        ors = "".join(f"({attr}={safe})" for attr in attrs)
        by_id = ors if len(attrs) == 1 else f"(|{ors})"
        search_filter = f"(&{self.user_filter}{by_id})"
        try:
            records = await asyncio.to_thread(self._search, search_filter)
        except Exception as e:
            logger.warning(f"LdapProvider.lookup falló para {id_type}={id_value}: {e}")
            return None
        return records[0] if records else None

    async def health(self) -> bool:
        def _ping() -> bool:
            conn = None
            try:
                conn = self._connect()
                return bool(conn.bound)
            except Exception:
                return False
            finally:
                if conn is not None:
                    try:
                        conn.unbind()
                    except Exception:
                        pass

        try:
            return await asyncio.to_thread(_ping)
        except Exception:
            return False
