from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://inout:inout@db:5432/inout"

    # Koha global (fallback si no hay config por sede)
    koha_api_url: str = ""
    koha_api_user: str = ""
    koha_api_pass: str = ""
    koha_verify_ssl: bool = False

    # Koha por sede — si están vacíos usa el global
    koha_bul_api_url: str = ""
    koha_bul_api_user: str = ""
    koha_bul_api_pass: str = ""

    koha_but_api_url: str = ""
    koha_but_api_user: str = ""
    koha_but_api_pass: str = ""

    koha_buj_api_url: str = ""
    koha_buj_api_user: str = ""
    koha_buj_api_pass: str = ""

    koha_cia_api_url: str = ""
    koha_cia_api_user: str = ""
    koha_cia_api_pass: str = ""

    # Categoría con la que se registra a quien no está en ningún padrón.
    # InOut NO controla acceso (no hay molinete ni restricción): solo mide. Un
    # desconocido ocupa el edificio igual, así que se cuenta — pero como visita,
    # no con categoría vacía, que en el dashboard caía en "OTROS" junto con
    # códigos legítimos sin mapear y volvía invisible el dato.
    unidentified_category: str = "visitor"

    default_space_id: int = 1
    default_space_capacity: int = 150
    default_space_name: str = "Biblioteca"
    secret_key: str = "changeme"

    # ── Config por institución (overlay) ───────────────────────────────────
    # Rutas a JSON montados por el overlay del cliente. Vacío = producto
    # agnóstico (sin dimensión facultad, sin sedes sembradas).
    faculty_config_path: str = ""   # JSON con valid_faculty_codes + program_to_faculty
    sedes_config_path: str = ""     # JSON con lista [{code, name, city}]
    default_sede_code: str = ""     # código de sede para el espacio por defecto

    # Proveedor Koha por BD directa (lee borrowers vía MariaDB, reusa koha_db_*).
    koha_db_enabled: bool = False
    koha_db_priority: int = 40
    # Código del atributo extendido de Koha que guarda el documento del patron
    # (borrower_attributes.code). Cada institución lo nombra a su manera, así
    # que el canónico no lo asume: vacío = no se consulta y el patron se indexa
    # solo por su carné, que es el comportamiento histórico.
    koha_document_attribute: str = ""

    # Koha DB directa (fotos) — por sede también
    koha_db_host: str = ""
    koha_db_user: str = ""
    koha_db_pass: str = ""
    koha_db_name: str = ""

    koha_but_db_host: str = ""
    koha_but_db_user: str = ""
    koha_but_db_pass: str = ""
    koha_but_db_name: str = ""

    koha_buj_db_host: str = ""
    koha_buj_db_user: str = ""
    koha_buj_db_pass: str = ""
    koha_buj_db_name: str = ""

    koha_cia_db_host: str = ""
    koha_cia_db_user: str = ""
    koha_cia_db_pass: str = ""
    koha_cia_db_name: str = ""

    admin_initial_password: str = "admin123"

    # ── Libros más prestados (circulación de Koha por REST) ────────────────
    # Apagado por defecto: el producto agnóstico no asume que la institución
    # tenga Koha. La credencial es APARTE de la de identidad a propósito: solo
    # necesita leer préstamos y catálogo, y conviene que sea un usuario de
    # servicio con esos permisos y nada más. Vacía = usa koha_api_*.
    materials_enabled: bool = False
    materials_api_url: str = ""
    materials_api_user: str = ""
    materials_api_pass: str = ""
    materials_sync_minutes: int = 10
    # Primera corrida (tabla vacía): cuántos días hacia atrás traer.
    materials_backfill_days: int = 120
    # Corridas siguientes: se re-leen los últimos N días, por si Koha registra
    # un préstamo con fecha atrasada o se corrige uno.
    materials_overlap_days: int = 3
    # URL pública del OPAC de Koha: de ahí sale la portada que la propia
    # biblioteca cargó (cover_images). Vacía = esa fuente se omite.
    materials_opac_url: str = ""
    # Orden de búsqueda de portadas, separado por comas.
    materials_cover_sources: str = "koha,openlibrary,google"

    # ── Proveedores de identidad (padrón local pluggable) ──────────────────
    # Todo con default vacío/False → producto agnóstico: sin proveedores
    # configurados el arranque no se rompe y el aforo degrada a "sin identificar".
    # Mapeo declarativo de atributos fuente→padrón por proveedor (JSON en /config).
    identity_map_path: str = ""
    # JSON con category_map / category_labels / faculty_labels del dashboard.
    labels_config_path: str = ""

    # Koha como proveedor de identidad (la config REST vive arriba en koha_*)
    koha_enabled: bool = False
    koha_priority: int = 50

    # LDAP / Active Directory (mismo adaptador para OpenLDAP y AD)
    ldap_enabled: bool = False
    ldap_priority: int = 100
    ldap_host: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_pass: str = ""
    ldap_base_dn: str = ""
    # Subárbol con el catálogo de unidades organizativas (facultades y áreas).
    # La persona trae solo el código en departmentNumber; el nombre vive aquí.
    # Vacío = no se consulta y la unidad de los trabajadores queda sin resolver,
    # que es el comportamiento previo.
    ldap_org_base_dn: str = ""
    ldap_user_filter: str = ""
    # Atributos LDAP contra los que se busca el valor escaneado (coma-separados).
    # Permite que carné o documento resuelvan a la misma persona.
    ldap_id_attrs: str = ""
    ldap_page_size: int = 500
    # Atributos que NUNCA se guardan en el padrón (coma-separados, case-insensitive).
    # Un sistema de aforo no necesita fotos ni credenciales y no debe custodiarlas:
    # se descartan al leer, así no llegan ni a `persons.raw`. Vaciar la variable
    # guarda todo lo que sirva el directorio — decisión explícita del cliente.
    ldap_raw_exclude: str = (
        "jpegPhoto,thumbnailPhoto,photo,userCertificate,"
        "userPassword,userSMIMECertificate,userPKCS12"
    )
    # Ramas adicionales del MISMO directorio, como JSON. Un directorio puede
    # servir a su población en sub-árboles distintos (p. ej. activos y
    # egresados): cada rama declara su base_dn/filtro/prioridad y hereda host,
    # bind y mapeo. Vacío = una sola rama (ldap_base_dn).
    #   [{"name": "ldap-alumni", "base_dn": "ou=alumni,dc=...",
    #     "user_filter": "(&(objectClass=inetOrgPerson)(eduPersonAffiliation=alum))",
    #     "priority": 35}]
    ldap_branches: str = ""

    # CSV (volumen /config) — testing sin LDAP real y clientes sin directorio
    csv_enabled: bool = False
    csv_priority: int = 200
    csv_path: str = ""

    def koha_for_sede(self, sede_code: str) -> tuple[str, str, str]:
        """Devuelve (url, user, pass) del Koha REST para la sede dada.
        Si no están configurados, usa el global."""
        code = sede_code.upper()
        url  = getattr(self, f"koha_{code.lower()}_api_url",  "") or self.koha_api_url
        user = getattr(self, f"koha_{code.lower()}_api_user", "") or self.koha_api_user
        pass_ = getattr(self, f"koha_{code.lower()}_api_pass", "") or self.koha_api_pass
        return url, user, pass_

    def materials_koha(self) -> tuple[str, str, str]:
        """(url, user, pass) del Koha REST que alimenta "libros más prestados"."""
        return (
            self.materials_api_url or self.koha_api_url,
            self.materials_api_user or self.koha_api_user,
            self.materials_api_pass or self.koha_api_pass,
        )

    def koha_db_for_sede(self, sede_code: str) -> tuple[str, str, str, str]:
        """Devuelve (host, user, pass, name) del Koha DB para la sede dada.
        Sin overrides por sede (koha_<code>_db_*) usa la config global koha_db_*."""
        code = sede_code.upper()
        host  = getattr(self, f"koha_{code.lower()}_db_host",  "") or self.koha_db_host
        user  = getattr(self, f"koha_{code.lower()}_db_user",  "") or self.koha_db_user
        pass_ = getattr(self, f"koha_{code.lower()}_db_pass",  "") or self.koha_db_pass
        name  = getattr(self, f"koha_{code.lower()}_db_name",  "") or self.koha_db_name
        return host, user, pass_, name

    class Config:
        env_file = ".env"


settings = Settings()
