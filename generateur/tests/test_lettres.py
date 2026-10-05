from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.lettres import MontantInvalide, montant_en_lettres


@pytest.mark.parametrize(
    ("montant", "attendu"),
    [
        ("11592000", "onze millions cinq cent quatre-vingt-douze mille francs CFA"),  # exemple du CDC §8.6
        ("288000", "deux cent quatre-vingt-huit mille francs CFA"),
        ("15888000", "quinze millions huit cent quatre-vingt-huit mille francs CFA"),
        ("15600000", "quinze millions six cent mille francs CFA"),
        ("15000000", "quinze millions de francs CFA"),
        ("1000000", "un million de francs CFA"),
        ("2000000000", "deux milliards de francs CFA"),
        ("2898000", "deux millions huit cent quatre-vingt-dix-huit mille francs CFA"),
        ("200", "deux cents francs CFA"),
        ("80", "quatre-vingts francs CFA"),
        ("1809", "mille huit cent neuf francs CFA"),
        ("1", "un franc CFA"),
        ("0", "zéro franc CFA"),
        ("-1500", "moins mille cinq cents francs CFA"),
        ("1809.00", "mille huit cent neuf francs CFA"),  # zéro décimale : accepté
    ],
)
def test_montant_en_lettres(montant: str, attendu: str) -> None:
    assert montant_en_lettres(montant) == attendu
    assert montant_en_lettres(Decimal(montant)) == attendu


@pytest.mark.parametrize("montant", ["1809.50", "abc", "", "NaN", "Infinity", "1,5"])
def test_refuse_un_montant_non_entier_ou_illisible(montant: str) -> None:
    with pytest.raises(MontantInvalide):
        montant_en_lettres(montant)


def test_route_interne_protegee_par_le_secret(client: TestClient, secret_test: str) -> None:
    corps = {"montant": "11592000"}

    assert client.post("/interne/montant-en-lettres", json=corps).status_code == 401
    reponse = client.post("/interne/montant-en-lettres", json=corps, headers={"X-Generateur-Secret": secret_test})
    assert reponse.status_code == 200
    assert reponse.json() == {"lettres": "onze millions cinq cent quatre-vingt-douze mille francs CFA"}


def test_route_refuse_un_nombre_json_et_un_montant_avec_centimes(client: TestClient, secret_test: str) -> None:
    entetes = {"X-Generateur-Secret": secret_test}

    # Un nombre JSON (flottant potentiel) est refusé : le montant doit être un texte.
    assert client.post("/interne/montant-en-lettres", json={"montant": 1809.5}, headers=entetes).status_code == 422
    assert client.post("/interne/montant-en-lettres", json={"montant": "1809.5"}, headers=entetes).status_code == 422
