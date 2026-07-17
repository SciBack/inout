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
    ldap_user_filter: str = ""
    # Atributos LDAP contra los que se busca el valor escaneado (coma-separados).
    # Permite que carné o documento resuelvan a la misma persona.
    ldap_id_attrs: str = ""
    ldap_page_size: int = 500

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
