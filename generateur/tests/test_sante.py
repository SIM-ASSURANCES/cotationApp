from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import __version__
from app.config import charger_parametres, obtenir_parametres
from app.main import app
from app.polices import analyser_fc_list, analyser_registre, est_installee, polices_absentes
from app.routes.sante import obtenir_familles

TOUTES = frozenset({"Calibri", "Tahoma", "Carlito", "DejaVu Sans"})


@pytest.fixture
def libreoffice_present(tmp_path: Path) -> None:
    soffice = tmp_path / "soffice.com"
    soffice.write_bytes(b"")  # simple fichier vide : LibreOffice n'est pas lancé
    app.dependency_overrides[obtenir_parametres] = lambda: charger_parametres(
        _env_file=None, libreoffice_chemin=soffice
    )


def polices(familles: frozenset[str] | None) -> None:
    app.dependency_overrides[obtenir_familles] = lambda: familles


def test_sante_est_degradee_sans_libreoffice(client: TestClient) -> None:
    polices(TOUTES)
    reponse = client.get("/sante")

    assert reponse.status_code == 200
    assert reponse.json() == {
        "statut": "degrade",  # le chemin de test pointe vers un fichier absent
        "version": __version__,
        "libreoffice_trouve": False,
        "polices_manquantes": [],
    }


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_ok_avec_libreoffice_et_polices(client: TestClient) -> None:
    polices(TOUTES)
    corps = client.get("/sante").json()
    assert corps["libreoffice_trouve"] is True
    assert corps["polices_manquantes"] == []
    assert corps["statut"] == "ok"


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_degradee_si_tahoma_ou_calibri_absente(client: TestClient) -> None:
    # Image construite sans les polices Microsoft : Carlito remplace Calibri, Tahoma n'a pas d'équivalent.
    polices(frozenset({"Carlito", "DejaVu Sans", "Liberation Sans"}))
    corps = client.get("/sante").json()
    assert corps["statut"] == "degrade"
    assert corps["polices_manquantes"] == ["Calibri", "Tahoma"]


@pytest.mark.usefixtures("libreoffice_present")
def test_sante_degradee_si_liste_des_polices_impossible(client: TestClient) -> None:
    polices(None)  # fc-list absent
    corps = client.get("/sante").json()
    assert corps["statut"] == "degrade"
    assert corps["polices_manquantes"] is None


def test_lecture_de_fc_list() -> None:
    sortie = "Tahoma\nMS Gothic,ＭＳ ゴシック\nCarlito\n\nDejaVu Sans\n"
    familles = analyser_fc_list(sortie)
    assert familles == {"Tahoma", "MS Gothic", "ＭＳ ゴシック", "Carlito", "DejaVu Sans"}
    # Correspondance exacte : Carlito ne passe pas pour Calibri.
    assert polices_absentes(("Tahoma", "Calibri"), familles) == ["Calibri"]


def test_lecture_du_registre_windows() -> None:
    familles = analyser_registre(
        ["Calibri Bold (TrueType)", "MS Gothic & MS UI Gothic & MS PGothic (TrueType)", "Tahoma (TrueType)"]
    )
    assert {"Calibri Bold", "MS Gothic", "MS UI Gothic", "Tahoma"} <= familles
    assert est_installee("ms gothic", familles)
