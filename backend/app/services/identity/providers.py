# Registro de proveedores: construye la lista de proveedores habilitados desde
# settings, ordenada por prioridad ascendente (menor priority = se consulta antes).

from ...config import settings as default_settings
from .base import IdentityProvider
from .koha_provider import KohaProvider
from .koha_db_provider import KohaDbProvider
from .ldap_provider import LdapProvider
from .csv_provider import CsvProvider

# Todos los adaptadores conocidos (Fase 1). Fase 2 añadirá Midpoint/SQL.
_PROVIDER_CLASSES = (KohaProvider, KohaDbProvider, LdapProvider, CsvProvider)


def build_enabled_providers(settings=default_settings) -> list[IdentityProvider]:
    """Proveedores con *_enabled=True, ordenados por priority ascendente."""
    providers = [cls(settings) for cls in _PROVIDER_CLASSES]
    enabled = [p for p in providers if p.enabled]
    enabled.sort(key=lambda p: p.priority)
    return enabled
