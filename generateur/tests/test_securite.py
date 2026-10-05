from fastapi.testclient import TestClient

EN_TETE = "X-Generateur-Secret"


def test_ping_sans_en_tete_refuse_401(client: TestClient) -> None:
    reponse = client.get("/interne/ping")

    assert reponse.status_code == 401
    assert reponse.json() == {"detail": "Unauthorized"}  # aucun détail


def test_ping_avec_un_mauvais_secret_refuse_401(client: TestClient) -> None:
    reponse = client.get("/interne/ping", headers={EN_TETE: "mauvais-secret-" + "x" * 32})

    assert reponse.status_code == 401
    assert reponse.json() == {"detail": "Unauthorized"}


def test_ping_avec_un_secret_non_ascii_refuse_401_sans_planter(client: TestClient) -> None:
    # Des octets non ASCII ne doivent pas provoquer d'erreur 500 dans la comparaison.
    reponse = client.get("/interne/ping", headers={EN_TETE: "é".encode("latin-1")})

    assert reponse.status_code == 401


def test_ping_avec_le_bon_secret_repond_200(client: TestClient, secret_test: str) -> None:
    reponse = client.get("/interne/ping", headers={EN_TETE: secret_test})

    assert reponse.status_code == 200
    assert reponse.json() == {"pong": True}
