"""Cierre automático por identidad canónica, no por credencial."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.models import PresenceLog, Space

LIMA = ZoneInfo("America/Lima")


def test_auto_exit_cierra_una_vez_a_la_persona_con_dos_credenciales(db, monkeypatch):
    from app.services import scheduler as scheduler_mod

    db.add(Space(id=1, name="Biblioteca CIA", capacity=60, active=True))
    db.add_all([
        PresenceLog(
            cardnumber="10867326",
            person_key="ldap:10867326",
            patron_name="Juan Alberto Sanchez Condor",
            event_type="entry",
            space_id=1,
            timestamp=datetime.now(LIMA),
        ),
        PresenceLog(
            cardnumber="9610165",
            person_key="ldap:10867326",
            patron_name="Juan Alberto Sanchez Condor",
            event_type="entry",
            space_id=1,
            timestamp=datetime.now(LIMA),
        ),
    ])
    db.commit()
    monkeypatch.setattr(scheduler_mod, "SessionLocal", lambda: db)

    scheduler_mod._auto_exit_space(1, 22, 0)

    exits = db.query(PresenceLog).filter(PresenceLog.event_type == "exit").all()
    assert len(exits) == 1
    assert exits[0].person_key == "ldap:10867326"
