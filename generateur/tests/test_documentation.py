"""Audit m13 : la documentation OpenAPI n'est servie que sur demande explicite (GENERATEUR_DOCS=oui)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import obtenir_parametres
from app.main import creer_app

ADRESSES_DE_DOCUMENTATION = ("/docs", "/redoc", "/openapi.json")


@pytest.fixture
def parametres_neufs() -> Iterator[None]:
    """Les paramètres sont lus une fois (cache) : on les relit avec l'environnement du test, puis on rétablit."""
    obtenir_parametres.cache_clear()
    yield
    obtenir_parametres.cache_clear()


@pytest.mark.parametrize("adresse", ADRESSES_DE_DOCUMENTATION)
def test_documentation_absente_par_defaut(client: TestClient, adresse: str) -> None:
    # L'application des tests ne définit pas GENERATEUR_DOCS : valeur par défaut « non ».
    assert client.get(adresse).status_code == 404


def test_documentation_absente_quand_la_variable_vaut_non(monkeypatch: pytest.MonkeyPatch, parametres_neufs: None) -> None:
    monkeypatch.setenv("GENERATEUR_DOCS", "non")
    with TestClient(creer_app()) as client:
        assert [client.get(a).status_code for a in ADRESSES_DE_DOCUMENTATION] == [404, 404, 404]


def test_documentation_servie_seulement_avec_oui(monkeypatch: pytest.MonkeyPatch, parametres_neufs: None) -> None:
    monkeypatch.setenv("GENERATEUR_DOCS", "oui")
    with TestClient(creer_app()) as client:
        assert [client.get(a).status_code for a in ADRESSES_DE_DOCUMENTATION] == [200, 200, 200]
        assert client.get("/openapi.json").json()["info"]["title"] == "SIM Documents : générateur"

