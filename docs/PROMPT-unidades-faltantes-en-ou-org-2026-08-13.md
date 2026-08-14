# Hueco en `ou=org`: 56 códigos de unidad sin entrada en el catálogo

**Para:** equipo de MidPoint / IGA
**De:** InOut (medición sobre LDAP de producción, 192.168.15.168)
**Fecha de la medición:** 13-ago-2026
**Alcance:** población viva, filtro `(eduPersonAffiliation=member)`

---

## Qué se pide

Que la proyección `OrgType` de MidPoint hacia `ou=org,dc=upeu,dc=edu,dc=pe`
**incluya las 56 unidades listadas abajo**, que hoy no existen en el árbol pero
sí se referencian desde `departmentNumber` de las personas.

No se pide cambiar nada en las personas: el atributo `departmentNumber` ya viene
correctamente poblado. El hueco está en el **catálogo**, no en el eje de la persona.

## Por qué importa

El área de trabajo de una persona viaja partida en dos ramas del directorio:

| Dónde | Qué trae | Ejemplo |
|---|---|---|
| `ou=people` → `departmentNumber` | el **código** de la unidad | `18` |
| `ou=org` → `ou` + `description` | el **nombre** de esa unidad | `18` → `Dirección de Tecnologías de Información` |

InOut consume ambas y las une. Cuando el código no tiene entrada en `ou=org` no
hay nada que mostrar, así que esa persona queda sin área en los reportes de aforo.

## Cifras exactas

| Métrica | Valor |
|---|---|
| Unidades hoy publicadas en `ou=org` | **104** |
| Personas vivas con `departmentNumber` | **2.765** |
| Códigos distintos referenciados por esas personas | **126** |
| Códigos **sin** entrada en `ou=org` | **56** |
| Personas que **no resuelven ninguna** unidad | **899** |
| Personas que sí resuelven | 1.866 |

`departmentNumber` es **multivalor**: 225 personas traen 2 o 3 códigos. Por eso las
dos últimas columnas de la tabla difieren — alguien puede referenciar un código
huérfano y aun así resolver por su otro código.

## Observación aparte: dos convenciones de código conviviendo

Seis códigos llegan con el prefijo `area.` (`area.63`, `area.68`, `area.206`,
`area.444`, `area.776`, `area.957`) mientras el resto son numéricos puros. Puede
ser un identificador interno que se escapó del mapeo de salida — vale la pena
revisarlo aunque afecte a pocas personas.

## Los 56 códigos

- **personas**: cuántas referencian ese código.
- **sin ninguna unidad**: de esas, cuántas quedan sin área porque *ningún* código suyo resuelve. Es el impacto real.
- **cargos**: los `title` más frecuentes, para ayudar a identificar de qué unidad se trata.

| código | personas | sin ninguna unidad | cargos más frecuentes | ejemplos (uid) |
|---|---:|---:|---|---|
| `86` | 139 | 138 | Supervisor de Internado (34), Supervisor de Práctica (27), Egresado (24) | 200810490, 9910307 |
| `8081` | 129 | 126 | Personal Administrativo (43), Mercaderista (19), Impulsadora (14) | 43090710, 202410410 |
| `85` | 105 | 102 | Supervisor de Internado (20), Supervisor de Práctica (18), Docente Contratado (15) | 201810041, 48121442 |
| `97` | 59 | 46 | Personal Administrativo (17), Docente de Primaria (11), Auxiliar de Limpieza (7) | 70633537, 200410871 |
| `4` | 50 | 45 | Personal Administrativo (27), Psicólogo Tutor (6), Asistenta Social (3) | 200510279, 75789335 |
| `107` | 49 | 48 | Docente Contratado (14), Egresado (10), Jefe de Prácticas (8) | 201310191, 201620266 |
| `136` | 45 | 45 | Personal Administrativo (19), Egresado (15), Capellán (4) | 200510279, 200920304 |
| `68` | 40 | 40 | Personal Administrativo (22), Diseñador Instruccional (3), Asistente de Diseño Instruccional (3) | 201510454, 9310412 |
| `52` | 40 | 40 | Auxiliar de Ornato (26), Operario de Ornato (5), Personal Administrativo (3) | 05860612, 01045049 |
| `717` | 34 | 34 | Docente de Secundaria (25), Personal Administrativo (6), Psicólogo(a) (1) | 202014209, 202110719 |
| `718` | 31 | 31 | Docente de Primaria (22), Egresado (3), Estudiante (3) | 202513590, 202011275 |
| `709` | 20 | 13 | Personal Administrativo (9), Sectorista de Finanzas (3), Egresado (2) | 202011154, 202122334 |
| `23` | 19 | 18 | Personal Administrativo (10), Egresado (2), Secretario Académico de Filial (1) | 10150521, 45373639 |
| `695` | 18 | 18 | Auxiliar de Limpieza (7), Personal Administrativo (5), Cajero(a) (1) | 201321371, 71522155 |
| `5` | 18 | 18 | Personal Administrativo (5), Egresado (4), Estudiante (2) | 200810066, 201713145 |
| `8232` | 17 | 3 | Personal Administrativo (10), Practicante (3), Asesor Comercial Posgrado (2) | 76910555, 202012363 |
| `70` | 15 | 15 | Personal Administrativo (6), Egresado (4), Auxiliar logístico de aulas (1) | 202210241, 200810066 |
| `239` | 15 | 6 | Docente Ordinario Asociado (5), Docente Ordinario Auxiliar (3), Docente Ordinario Principal (3) | 200920042, 200611326 |
| `143` | 13 | 13 | Docente Contratado (5), Personal Administrativo (2), Coordinador de Investigación (1) | 46558156, 9810173 |
| `99` | 12 | 12 | Personal Administrativo (5), Docente de Inicial (4), Egresado (2) | 200711059, 201713021 |
| `112` | 12 | 12 | Egresado (4), Docente Ordinario Asociado (4), Asistente de Sistemas de Información (1) | 73684343, 9820028 |
| `719` | 11 | 11 | Docente de Inicial (7), Personal Administrativo (3), Auxiliar Docente (1) | 47151620, 201712159 |
| `24` | 10 | 10 | Personal Administrativo (7), Coordinador de Gestión de la Calidad (1), Coordinador de Procesos y Proyectos (1) | 201210340, 9910022 |
| `8177` | 9 | 4 | Personal Administrativo (4), Secretaria Administrativa (1), Analista de Sostenibilidad Ambiental (1) | 10274936, 201420181 |
| `8208` | 8 | 7 | Personal Administrativo (3), Docente de Inicial (3), Instructor Biblico OYIM (1) | 201321806, 009513078 |
| `7948` | 8 | 8 | Docente Contratado (4), Egresado (1), Coordinador de Carrera Profesional (1) | 200010359, 17998262 |
| `131` | 8 | 3 | Docente Contratado (4), Personal Administrativo (2), Egresado (1) | 200611323, 201121545 |
| `69` | 7 | 7 | Director General de Investigación (2), Coordinador de Investigación (1), Traductor de Publicaciones Científicas (1) | 200710629, 08694981 |
| `65` | 6 | 6 | Asesor Legal (2), Egresado (1), Personal Administrativo (1) | 201620265, 22474745 |
| `145` | 6 | 6 | Docente de taller vacacional (2), Personal Administrativo (1), Operario de Piscina (1) | 48519538, 09761214 |
| `66` | 6 | 6 | Auditor Interno (3), Personal Administrativo (2), Auditor Interno Filial (1) | 201420623, 200510143 |
| `297` | 6 | 3 | Personal Administrativo (3), Coordinador de Escuela Profesional (1), Egresado (1) | 9010129, 76762511 |
| `78` | 5 | 5 | Docente Contratado (3), Personal Administrativo (1), Docente Investigador (1) | 10149502, 200620175 |
| `681` | 5 | 5 | Personal Administrativo (3), Docente Investigador (1), Coordinador Académico (1) | 10149502, 200620175 |
| `7920` | 4 | 4 | Personal Administrativo (2), Asistente de beca 18 (1), Director de Cooperación y Desarrollo (1) | 201811259, 09728818 |
| `55` | 4 | 4 | Personal Administrativo (3), Conductor (1) | 02442043, 02440945 |
| `20` | 3 | 3 | Personal Administrativo (1), Instructor Bíblico (1), Director de IDEC (1) | 25647123, 009879845 |
| `3` | 3 | 3 | Personal Administrativo (2), Rector (1) | 200920012, 9010243 |
| `135` | 2 | 2 | Personal Administrativo (1), Ministerial (1) | 200511000, 8910009 |
| `7867` | 2 | 2 | Personal Administrativo (2) | 80670949015, 77777777 |
| `7997` | 2 | 1 | Camarografos (1), Jefe de Marketing Digital (1) | 201810316, 75240132 |
| `6` | 2 | 2 | Personal Administrativo (1), Vicerrector Administrativo (1) | 200310555, 9710259 |
| `2219` | 2 | 2 | Personal Administrativo (1), Auxiliar de Ventas a Provincias (1) | 202012509, 201310320 |
| `147` | 2 | 2 | Docente Extraordinario (1), Coordinador de Educación Para la Vida (1) | 10830066, 201620319 |
| `area.206` | 2 | 0 | Docente Contratado (1), Jefe de Práctica Medicina (1) | 17835746, 72849690 |
| `7996` | 1 | 0 | Community Managers (1) | 201222262 |
| `8223` | 1 | 1 | Entrenador (1) | 202510221 |
| `26` | 1 | 1 | (sin cargo) (1) | 76648946 |
| `819` | 1 | 0 | Jefe de Créditos y Cobranzas (1) | 09761971 |
| `8027` | 1 | 1 | Asesor de Integración Corporativa (1) | 201410954 |
| `area.776` | 1 | 0 | Analista de Tesorería (1) | 201410687 |
| `area.957` | 1 | 1 | Docente de Inicial (1) | 201911801 |
| `4342` | 1 | 0 | Secretario Regional (1) | 200210314 |
| `area.444` | 1 | 1 | Jefe de Prácticas (1) | 29602459 |
| `area.63` | 1 | 0 | Docente Contratado de Medicina (1) | 45598296 |
| `area.68` | 1 | 1 | Asistente de Centro de Simulación (1) | 75609890 |

---

## Cómo verificar que quedó resuelto

```bash
ldapsearch -x -LLL -o ldif-wrap=no -H ldap://192.168.15.168 \
  -D 'cn=rims-reader,ou=services,dc=upeu,dc=edu,dc=pe' -w '<pass>' \
  -b 'ou=org,dc=upeu,dc=edu,dc=pe' '(ou=*)' ou description | grep -c '^ou: '
```

Debe pasar de **104** a **160**. Cada unidad nueva necesita `ou` (el código, tal
cual aparece en `departmentNumber`) y `description` (el nombre legible), igual que
las 104 existentes.

## Qué NO se pide

- No hace falta tocar `departmentNumber` de las personas.
- No hace falta un atributo nuevo: InOut ya resuelve el código contra el catálogo.
- Las 1.617 personas vivas que no traen `departmentNumber` **ni** `scibackFacultyCode`
  son un asunto distinto, no cubierto por este pedido.
