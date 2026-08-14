# Cómo se identifica a un visitante al agregar estadísticas.

from sqlalchemy import func

from ..models import PresenceLog


def visitante_unico():
    """Expresión que identifica a un visitante para contarlo UNA vez.

    Se cuenta la PERSONA, no el código que presentó. Alguien lleva varias
    credenciales —carné de trabajador, carné de alumno, DNI, carné de
    extranjería— y las usa indistintamente: agrupando por el código escaneado,
    la misma humana entra dos veces en el desglose y el aforo del día suma de
    más. Caso real (13-ago-2026): un trabajador que además estudió aparecía dos
    veces, una por cada carné.

    `person_key` es la identidad del padrón; el código escaneado queda de
    respaldo para quien no está identificado —una visita externa no tiene
    persona y aun así ocupa el edificio, así que se cuenta— y para los eventos
    anteriores a que la columna existiera.
    """
    return func.coalesce(PresenceLog.person_key, PresenceLog.cardnumber).label("visitante")
