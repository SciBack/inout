# Tests del backend

```bash
# Desde canonico/ (no requiere instalar nada local: corre en Docker)
docker run --rm -v "$PWD/backend:/app" -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest"
```

La BD de los tests es SQLite en memoria: lo que se cubre es lógica del padrón
(reconciliación, precedencia, resolución), no dialecto SQL. No tocan red ni
PostgreSQL ni LDAP — los proveedores se inyectan como dobles.

## Qué cubre y por qué

| Archivo | Cubre |
|---|---|
| `test_mapping.py` | Mapeo declarativo fuente→padrón: precedencia de multivalores, `value_maps`, y que un atributo **ausente** quede vacío en vez de inventarse un valor. |
| `test_repository.py` | Padrón: upsert idempotente, estabilidad del `person_key` y la **reconciliación cross-proveedor**. |
| `test_resolver.py` | Escaneo: padrón local primero, relleno perezoso por prioridad, y que **el aforo nunca se detenga** ante fuentes caídas, colgadas o vacías. |
| `test_providers.py` | Registro de proveedores: el canónico arranca agnóstico y el orden lo manda la prioridad, no el código. |

Los dos invariantes que más importan:

- **La reconciliación cross-proveedor** (`test_repository.py`) es lo único que
  impide duplicar el padrón cuando dos fuentes —o dos ramas del mismo LDAP,
  como `ou=people` y `ou=alumni`— traen a la misma persona con `person_key`
  distinto. El `person_key` no se reasigna nunca: `presence_log` lo referencia y
  reasignarlo huerfanaría el histórico.
- **El aforo nunca se detiene** (`test_resolver.py`). Un proveedor que revienta o
  se cuelga degrada a "Sin identificar"; jamás propaga la excepción al kiosko.

## Nota sobre el identity_map

El canónico no debe depender del contenido del `identity_map.json` — ese JSON es
data del overlay de cada institución. Por eso los tests instalan su propio mapa
con la fixture `identity_map` y usan códigos de ejemplo, no los de ningún cliente.
