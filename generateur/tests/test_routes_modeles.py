"""Routes internes d'analyse et de génération : secret, erreurs lisibles (sans LibreOffice)."""

import base64

from fastapi.testclient import TestClient

from tests.fabrique import document


def b64(contenu: bytes) -> str:
    return base64.b64encode(contenu).decode()


def test_analyse_exige_le_secret(client: TestClient) -> None:
    assert client.post("/interne/modeles/analyse", json={"modele": ""}).status_code == 401


def test_analyse_renvoie_les_faits(client: TestClient, secret_test: str) -> None:
    reponse = client.post(
        "/interne/modeles/analyse",
        headers={"X-Generateur-Secret": secret_test},
        json={"modele": b64(document("Nom : {{ client.nom }}"))},
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["docx_valide"] is True
    assert corps["references"][0]["chemin"] == "client.nom"
    assert corps["references"][0]["emplacement"]["paragraphe"] == 1


def test_base64_invalide(client: TestClient, secret_test: str) -> None:
    reponse = client.post("/interne/modeles/analyse", headers={"X-Generateur-Secret": secret_test}, json={"modele": "pas du base64 !"})
    assert reponse.status_code == 422


def test_pdf_donnee_absente_422_avec_message(client: TestClient, secret_test: str) -> None:
    # La fusion échoue avant toute conversion : LibreOffice n'est pas lancé.
    reponse = client.post(
        "/interne/documents/pdf",
        headers={"X-Generateur-Secret": secret_test},
        json={"modele": b64(document("{{ souscripteur.nom }}")), "donnees": {"souscripteur": {}}, "seuil_liste": 10},
    )
    assert reponse.status_code == 422
    assert reponse.json()["detail"] == "donnée absente : « souscripteur.nom »"


def test_pdf_champ_vide_dans_un_filtre(client: TestClient, secret_test: str) -> None:
    modele = b64(document("Effet : {{ police.date_effet | date }} ; référence : {{ police.reference | date }}"))
    entetes = {"X-Generateur-Secret": secret_test}
    donnees = {"police": {"date_effet": None, "reference": None}}
    # police.reference facultatif (D19, liste envoyée par l'application) : seul date_effet est nommé.
    reponse = client.post(
        "/interne/documents/pdf",
        headers=entetes,
        json={"modele": modele, "donnees": donnees, "seuil_liste": 10, "champs_facultatifs": ["police.reference"]},
    )
    assert reponse.status_code == 422
    assert reponse.json()["detail"] == "champ obligatoire vide : « police.date_effet » (filtre date)"
    # Sans la liste, les deux champs sont nommés dans le même message.
    reponse = client.post("/interne/documents/pdf", headers=entetes, json={"modele": modele, "donnees": donnees, "seuil_liste": 10})
    assert reponse.json()["detail"] == (
        "2 points à corriger : champ obligatoire vide : « police.date_effet » (filtre date) ; "
        "champ obligatoire vide : « police.reference » (filtre date)"
    )


def test_pdf_liste_sans_annexe_possible(client: TestClient, secret_test: str) -> None:
    reponse = client.post(
        "/interne/documents/pdf",
        headers={"X-Generateur-Secret": secret_test},
        json={"modele": b64(document("x")), "donnees": {}, "seuil_liste": 10, "annexes": {"clients": b64(b"")}},
    )
    assert reponse.status_code == 422
