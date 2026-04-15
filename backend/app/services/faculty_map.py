# Mapeo programa académico (statistics_2 de Koha) → facultad
# Construido desde la tabla borrowers de Koha BUL (2026-04-15)
# Para cada programa se usa la facultad con mayor cantidad de registros.
# Códigos de facultad válidos: FACTEO, FCS, FIA, FCE, FACIHED, EPG

PROGRAM_TO_FACULTY: dict[str, str] = {
    # FCS — Ciencias de la Salud
    "P22": "FCS", "P30": "FCS", "P31": "FCS", "P33": "FCS",
    "P153": "FCS", "P154": "FCS",
    "Taller de Toma de Muestras Biológicas": "FCS",
    # FCE — Ciencias Empresariales
    "P01": "FCE", "P04": "FCE", "P05": "FCE", "P08": "FCE",
    "P09": "FCE", "P29": "FCE", "P96": "FCE",
    "EP Digital Business": "FCE",
    "Cont. - Proesad Lima": "FCE",
    # FIA — Ingeniería y Arquitectura
    "P06": "FIA", "P24": "FIA", "P25": "FIA", "P26": "FIA",
    "P27": "FIA", "P149": "FIA", "P152": "FIA",
    "EP Computer Science": "FIA",
    "ING. INDUSTRIAL": "FIA", "ING. SOFTWARE": "FIA", "SEG57": "FIA",
    # FACIHED — Ciencias Humanas y Educación
    "P07": "FACIHED", "P12": "FACIHED", "P14": "FACIHED",
    "P143": "FACIHED", "P147": "FACIHED", "P17": "FACIHED",
    "P19": "FACIHED", "P20": "FACIHED", "P99": "FACIHED",
    "Psic.": "FACIHED",
    # FACTEO — Teología
    "P35": "FACTEO",
    # EPG — Posgrado
    "P58": "EPG", "P82": "EPG", "P85": "EPG", "P86": "EPG",
    "P94": "EPG", "P104": "EPG", "P106": "EPG", "P120": "EPG",
    "P132": "EPG", "P156": "EPG",
    "SEG43": "EPG", "SEG04": "EPG", "SEG10": "EPG", "SEG11": "EPG",
    "SEG12": "EPG", "SEG19": "EPG", "SEG22": "EPG", "SEG26": "EPG",
    "SEG65": "EPG", "DIAGGEC": "EPG", "DIAGIAL": "EPG",
    "Mgs.Edu.IDU.": "EPG", "Cui.Int": "EPG",
}

# Códigos de facultad reconocidos como válidos.
# Si patron_faculty no está en este set se trata como ausente.
VALID_FACULTY_CODES = {"FACTEO", "FCS", "FIA", "FCE", "FACIHED", "EPG", "CC"}


def resolve_faculty(patron_faculty: str | None, patron_program: str | None) -> str:
    """
    Devuelve la facultad efectiva:
    1. Si patron_faculty es un código válido → lo usa.
    2. Si no, busca patron_program en PROGRAM_TO_FACULTY.
    3. Si tampoco → "Sin Facultad".
    """
    fac = (patron_faculty or "").strip()
    if fac in VALID_FACULTY_CODES:
        return fac
    prog = (patron_program or "").strip()
    return PROGRAM_TO_FACULTY.get(prog, "Sin Facultad")
