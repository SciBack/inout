import asyncio

from app.models import PersonIdentifier
from app.routers import photo as photo_mod


def test_foto_usa_otro_carnet_de_la_misma_persona(db, monkeypatch):
    db.add_all([
        PersonIdentifier(
            id_type="cardnumber",
            id_value="9610165",
            person_key="ldap:10867326",
        ),
        PersonIdentifier(
            id_type="cardnumber",
            id_value="10867326",
            person_key="ldap:10867326",
        ),
    ])
    db.commit()

    consultas = []

    def foto_koha(cardnumber):
        consultas.append(cardnumber)
        if cardnumber == "10867326":
            return (b"foto", "image/jpeg")
        return None

    monkeypatch.setattr(photo_mod, "_fetch_photo_by_cardnumber", foto_koha)
    photo_mod._photo_cache.clear()

    response = asyncio.run(photo_mod.patron_photo_by_card("9610165", db))

    assert response.body == b"foto"
    assert response.media_type == "image/jpeg"
    assert consultas == ["9610165", "10867326"]

