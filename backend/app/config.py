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

    def koha_for_sede(self, sede_code: str) -> tuple[str, str, str]:
        """Devuelve (url, user, pass) del Koha REST para la sede dada.
        Si no están configurados, usa el global."""
        code = sede_code.upper()
        url  = getattr(self, f"koha_{code.lower()}_api_url",  "") or self.koha_api_url
        user = getattr(self, f"koha_{code.lower()}_api_user", "") or self.koha_api_user
        pass_ = getattr(self, f"koha_{code.lower()}_api_pass", "") or self.koha_api_pass
        return url, user, pass_

    def koha_db_for_sede(self, sede_code: str) -> tuple[str, str, str, str]:
        """Devuelve (host, user, pass, name) del Koha DB para la sede dada."""
        code = sede_code.upper()
        if code == "BUL":
            return self.koha_db_host, self.koha_db_user, self.koha_db_pass, self.koha_db_name
        host  = getattr(self, f"koha_{code.lower()}_db_host",  "") or self.koha_db_host
        user  = getattr(self, f"koha_{code.lower()}_db_user",  "") or self.koha_db_user
        pass_ = getattr(self, f"koha_{code.lower()}_db_pass",  "") or self.koha_db_pass
        name  = getattr(self, f"koha_{code.lower()}_db_name",  "") or self.koha_db_name
        return host, user, pass_, name

    class Config:
        env_file = ".env"


settings = Settings()
