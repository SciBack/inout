"""
Migración: corregir patron_faculty en presence_log histórico.

Reglas:
  1. Si patron_faculty ya es un código válido (FACTEO, FCS, etc.) → no tocar.
  2. Si patron_faculty es NULL, vacío o un valor inválido (ej. DNI) →
       a. Si patron_program tiene mapeo en PROGRAM_TO_FACULTY → actualizar.
       b. Si no → dejar NULL (el dashboard lo resuelve como "Sin Facultad").
"""

import sys
import os

# Asegurar que el módulo de la app esté en el path
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text
from app.config import settings
from app.services.faculty_map import PROGRAM_TO_FACULTY, VALID_FACULTY_CODES

engine = create_engine(settings.database_url)

with engine.connect() as conn:
    # ── 1. Diagnóstico previo ────────────────────────────────────────────────
    total = conn.execute(text("SELECT COUNT(*) FROM presence_log")).scalar()
    dirty = conn.execute(text("""
        SELECT COUNT(*) FROM presence_log
        WHERE patron_faculty IS NULL
           OR patron_faculty = ''
           OR patron_faculty NOT IN :valid
    """), {"valid": tuple(VALID_FACULTY_CODES)}).scalar()

    print(f"Total filas:          {total:,}")
    print(f"Con facultad inválida: {dirty:,}")
    print()

    # ── 2. Distribución de patron_program en filas sucias ───────────────────
    rows = conn.execute(text("""
        SELECT patron_program, COUNT(*) as cnt
        FROM presence_log
        WHERE patron_faculty IS NULL
           OR patron_faculty = ''
           OR patron_faculty NOT IN :valid
        GROUP BY patron_program
        ORDER BY cnt DESC
    """), {"valid": tuple(VALID_FACULTY_CODES)}).fetchall()

    print("Programas en filas sucias:")
    mapped = 0
    unmapped = 0
    for prog, cnt in rows:
        resolved = PROGRAM_TO_FACULTY.get(prog or "", None)
        mark = f"→ {resolved}" if resolved else "→ NULL (Sin Facultad)"
        print(f"  {str(prog or 'NULL'):25} {cnt:6,}  {mark}")
        if resolved:
            mapped += cnt
        else:
            unmapped += cnt

    print()
    print(f"  Serán corregidos: {mapped:,}")
    print(f"  Quedarán NULL:    {unmapped:,}")
    print()

    # ── 3. Ejecutar actualización ────────────────────────────────────────────
    confirm = input("¿Proceder con la migración? [s/N]: ").strip().lower()
    if confirm != "s":
        print("Cancelado.")
        sys.exit(0)

    updated = 0
    for prog_code, faculty in PROGRAM_TO_FACULTY.items():
        result = conn.execute(text("""
            UPDATE presence_log
            SET patron_faculty = :faculty
            WHERE (patron_faculty IS NULL
                   OR patron_faculty = ''
                   OR patron_faculty NOT IN :valid)
              AND patron_program = :prog
        """), {
            "faculty": faculty,
            "prog": prog_code,
            "valid": tuple(VALID_FACULTY_CODES),
        })
        if result.rowcount > 0:
            print(f"  {prog_code:25} → {faculty:10}  ({result.rowcount:,} filas)")
            updated += result.rowcount

    # Dejar NULL los que no tienen mapeo (limpiar DNIs u otros valores inválidos)
    result = conn.execute(text("""
        UPDATE presence_log
        SET patron_faculty = NULL
        WHERE patron_faculty IS NOT NULL
          AND patron_faculty != ''
          AND patron_faculty NOT IN :valid
    """), {"valid": tuple(VALID_FACULTY_CODES)})
    if result.rowcount > 0:
        print(f"  {'(inválidos → NULL)':25}             ({result.rowcount:,} filas)")
        updated += result.rowcount

    conn.commit()
    print()
    print(f"Migración completada. Total actualizadas: {updated:,} filas.")

    # ── 4. Verificación final ────────────────────────────────────────────────
    print()
    print("Estado final por facultad:")
    final = conn.execute(text("""
        SELECT COALESCE(patron_faculty, 'NULL') as fac, COUNT(*) as cnt
        FROM presence_log
        GROUP BY patron_faculty
        ORDER BY cnt DESC
    """)).fetchall()
    for fac, cnt in final:
        print(f"  {fac:20} {cnt:8,}")
