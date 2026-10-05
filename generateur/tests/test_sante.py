from pathlib import Path

from fastapi.testclient import TestClient

from app import __version__
from app.config import charger_parametres, obtenir_parametres
from app.main import app


def test_sante_est_degradee_sans_libreoffice(client: TestClient) -> None:
    reponse = client.get("/sante")

    assert reponse.status_code == 200
    assert reponse.json() == {
        "statut": "degrade",  # le chemin de test pointe vers un fichier absent
        "version": __version__,
        "libreoffice_trouve": False,
    }


def test_sante_signale_libreoffice_quand_le_fichier_existe(
    client: TestClient, tmp_path: Path
) -> None:
    soffice = tmp_path / "soffice.com"
    soffice.write_bytes(b"")  # simple fichier vide : LibreOffice n'est pas lancé
    app.dependency_overrides[obtenir_parametres] = lambda: charger_parametres(
        _env_file=None, libreoffice_chemin=soffice
    )

    corps = client.get("/sante").json()
    assert corps["libreoffice_trouve"] is True
    assert corps["statut"] == "ok"
