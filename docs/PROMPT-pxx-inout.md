# Prompt — InOut: incorporar el P-code del programa

> Pegar al abrir una sesión nueva sobre `~/proyectos/productos/inout`.
> **Depende de la sesión MidPoint+LDAP** (`iga/canonico/docs/PROMPT-pxx-midpoint-ldap.md`):
> InOut lee de LDAP, así que no hay nada que hacer hasta que el P-code esté publicado ahí.

---

## La regla

UPeU identifica el programa académico por su **P-code / SEG-code** (`P30`, `SEG61`…) en todos sus
sistemas. El **código INEI queda solo para el repositorio de tesis**.

Decisión: [`ADR-005`](../../../vocbench/instituciones/upeu/docs/decisiones/ADR-005-pxx-identificador-institucional.md)
del tesauro (09-ago-2026).

**Fuente de verdad de los programas:** `/Users/alberto/Downloads/programas pxx upeu` — Formatos
A4/A8 2026-1, **183 programas**. Cualquier cosa distinta está mal.

---

## Punto de partida (verificado)

InOut consume hoy de LDAP —contrato en
[`iga/canonico/docs/specs/inout-ldap-identity-map.md`](../../../iga/canonico/docs/specs/inout-ldap-identity-map.md)—
tres atributos: `scibackDocumentNumber`, `scibackFacultyCode` y `scibackCampusCode`.

**El programa NO está entre ellos.** Hoy el aforo del CRAI se puede desglosar por facultad y por
sede, pero no por programa. Añadir el P-code es lo que lo habilita.

---

## La tarea

1. **Esperar** a que la sesión MidPoint+LDAP publique el P-code en LDAP. Va en un **atributo
   nuevo y multi-valor** de `scibackOrgUnit` — no en `scibackAcademicProgramCode`, que es
   `SINGLE-VALUE` y lleva el `EP-XXX` interno.
2. **Extender el mapa de identidad de InOut** con el programa, siguiendo el patrón de
   `scibackFacultyCode` / `scibackCampusCode` en el spec (§ tabla de atributos y el dict de
   mapeo ~línea 32).
3. **Índice `eq`** para el atributo nuevo, como se hizo con los otros tres
   (`iga/canonico/upeu/ldap/rims-iga-contract/07-index-inout.ldif`). Sin índice, el filtro de
   aforo hace scan completo.
4. **Aforo por programa** en el frontend/reportes, si Alberto lo pide. Puede quedar para después:
   publicar el dato ya es valor por sí solo.

---

## Cuatro cosas que evitan repetir errores conocidos

**Sin default, como `scibackCampusCode`.** Si el programa no mapea, el atributo va **ausente**;
InOut reporta *«sin programa»*, **no imputa**. Es la regla que ya rige campus, y por buenas
razones: un valor inventado contamina el aforo en silencio.

**Cobertura esperada ≈ 88 %, no 100 %.** El P-code que viene del tesauro cubre el 88,44 % de la
matrícula. Lo que falta son idiomas, CEPRE y Conservatorio — **no son programas licenciados**
(Ley 30220 art. 46 y 54) y su cobertura correcta es 0 %. No es un fallo que haya que tapar.

**Solo estudiantes.** Igual que `scibackFacultyCode`: docentes y staff no tienen programa. El
aforo por programa de no-estudiantes vendrá vacío — reportarlo, no imputarlo.

**El P-code depende de la MODALIDAD.** Administración es `P04` presencial, `P05` semipresencial y
`P95` a distancia: tres programas distintos ante SUNEDU. MidPoint ya lo resuelve; InOut solo
consume. **No agregar los tres bajo un mismo rótulo sin decirlo** — si el informe quiere
«Administración» como una sola línea, esa agregación se hace explícita, no por accidente.

---

## Verificación

Una vez publicado, todo valor del atributo nuevo debe existir en el A4/A8:

```bash
python3 - <<'PY'
import openpyxl, glob, re
ofi = set()
for f, s in [(glob.glob("/Users/alberto/Downloads/programas pxx upeu/*A4*.xlsx")[0], "A4_2026-1"),
             (glob.glob("/Users/alberto/Downloads/programas pxx upeu/*A8*.xlsx")[0], "A8_2026-1")]:
    for r in openpyxl.load_workbook(f, data_only=True)[s].iter_rows(values_only=True):
        for v in (r or ()):
            if isinstance(v, str) and re.fullmatch(r"(P|SEG)\d+", v.strip()):
                ofi.add(v.strip())
print(f"P-codes oficiales: {len(ofi)}")
PY
```

**Si aparece un código que no está en esa lista, el mapping está mal.** No inventarle equivalencia.

## Ojo con la LAN
Los hosts `192.168.x` (LDAP `.168`/`.169`) solo responden con la VPN de UPeU levantada o el túnel
WireGuard vía el jumphost OCI. Si no responde ninguno, es la red — no el servidor.
