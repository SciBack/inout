from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://inout:inout@db:5432/inout"
    koha_api_url: str = ""
    koha_api_user: str = ""
    koha_api_pass: str = ""
    koha_verify_ssl: bool = False
    default_space_id: int = 1
    default_space_capacity: int = 150
    default_space_name: str = "Biblioteca"
    secret_key: str = "changeme"
    koha_db_host: str = ""
    koha_db_user: str = ""
    koha_db_pass: str = ""
    koha_db_name: str = ""
    admin_initial_password: str = "admin123"

    class Config:
        env_file = ".env"


settings = Settings()
