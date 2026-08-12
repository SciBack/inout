# Contrato neutral de proveedores de identidad.
#
# PersonRecord es un DTO agnóstico al ORM: todo proveedor (Koha, LDAP, CSV, ...)
# devuelve PersonRecord y la capa de repositorio lo persiste en `persons`.
# Así los proveedores no dependen de SQLAlchemy.

from dataclasses import dataclass, field
from typing import Iterable, Protocol, runtime_checkable


@dataclass
class PersonRecord:
    """Superset de los campos del padrón + identificadores. DTO neutral."""

    person_key: str
    full_name: str | None = None
    first_name: str | None = None
    gender: str | None = None
    category: str | None = None
    faculty: str | None = None
    program: str | None = None
    escuela: str | None = None
    role: str | None = None
    document_number: str | None = None
    document_type: str | None = None
    email: str | None = None
    home_sede_code: str | None = None
    home_building: str | None = None
    source: str | None = None
    # Payload original del proveedor (para auditoría / debugging).
    raw: dict | None = None
    # Credenciales por las que se puede resolver a esta persona.
    # {id_type: id_value}, p. ej. {"cardnumber": "12345", "document_number": "70000000"}.
    identifiers: dict[str, str] = field(default_factory=dict)


@runtime_checkable
class IdentityProvider(Protocol):
    """Interfaz que implementa cada adaptador de fuente de identidad.

    Los métodos son asíncronos porque el hot path del escaneo es async y
    algunos proveedores (Koha REST) hacen I/O de red.

    Las dos rutas tratan el fallo distinto, a propósito:

    - `lookup` / `health` (hot path del escaneo): NUNCA lanzan. Ante fallo
      devuelven None / False y el aforo sigue contando, degradando a
      "Sin identificar". No hay dónde reportar el error sin frenar el kiosko.
    - `fetch_all` (sync del padrón): SÍ puede lanzar, y debe hacerlo si la
      fuente falla o trunca. `sync_provider` lo captura y marca la corrida en
      'error'. Devolver [] ante un fallo sería indistinguible de "la fuente no
      tiene a nadie" y registraría la corrida como 'ok' con 0 registros — un
      padrón silenciosamente incompleto es peor que un fallo declarado.
    """

    name: str
    priority: int
    enabled: bool

    async def fetch_all(self) -> Iterable[PersonRecord]:
        """Volcado completo para el sync del padrón.

        Devuelve [] solo si la fuente legítimamente no tiene registros (o no
        soporta volcado masivo). Lanza si falla o trunca.
        """
        ...

    async def lookup(
        self, id_type: str, id_value: str, sede_code: str = ""
    ) -> "PersonRecord | None":
        """Relleno perezoso en vivo por credencial.

        `sede_code` permite a fuentes multi-sede (p. ej. Koha por campus) dirigir
        la consulta a la instancia correcta; las fuentes globales lo ignoran.
        """
        ...

    async def health(self) -> bool:
        """True si la fuente responde."""
        ...
