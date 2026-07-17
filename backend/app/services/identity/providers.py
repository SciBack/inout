# Registro de proveedores: construye la lista de proveedores habilitados desde
# settings, ordenada por prioridad ascendente (menor priority = se consulta antes).

import json
import logging

from ...config import settings as default_settings
from .base import IdentityProvider
from .koha_provider import KohaProvider
from .koha_db_provider import KohaDbProvider
from .ldap_provider import LdapProvider
from .csv_provider import CsvProvider

logger = logging.getLogger(__name__)

# Adaptadores de instancia única (Fase 1). Fase 2 añadirá Midpoint/SQL.
_PROVIDER_CLASSES = (KohaProvider, KohaDbProvider, CsvProvider)


def _ldap_branches(settings) -> list[dict]:
    """Ramas LDAP extra declaradas en LDAP_BRANCHES (JSON).

    Un directorio puede servir a su población en varias ramas (activos y
    egresados en sub-árboles distintos). Cada una es una instancia con su
    base_dn/filtro/prioridad; host, bind y mapeo se heredan.

    Config malformada se ignora con warning: una rama secundaria mal declarada
    no puede tumbar el arranque ni la rama principal.
    """
    raw = (getattr(settings, "ldap_branches", "") or "").strip()
    if not raw:
        return []
    try:
        branches = json.loads(raw)
    except ValueError:
        logger.warning("LDAP_BRANCHES no es JSON válido; se ignora")
        return []
    if not isinstance(branches, list):
        logger.warning("LDAP_BRANCHES debe ser una lista de objetos; se ignora")
        return []

    valid = []
    for b in branches:
        if not isinstance(b, dict) or not b.get("name") or not b.get("base_dn"):
            logger.warning(f"Rama LDAP inválida (requiere name y base_dn), se ignora: {b!r}")
            continue
        valid.append(b)
    return valid


def build_enabled_providers(settings=default_settings) -> list[IdentityProvider]:
    """Proveedores con *_enabled=True, ordenados por priority ascendente."""
    providers = [cls(settings) for cls in _PROVIDER_CLASSES]
    if settings.ldap_enabled:
        providers.append(LdapProvider(settings))
        providers.extend(
            LdapProvider(settings, branch=b) for b in _ldap_branches(settings)
        )
    enabled = [p for p in providers if p.enabled]
    enabled.sort(key=lambda p: p.priority)
    return enabled
