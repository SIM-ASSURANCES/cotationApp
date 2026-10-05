"""Préparation commune des tests.

Les tests ne dépendent ni du fichier .env du poste, ni de la présence de
LibreOffice : toutes les variables sont fixées ici, avec des valeurs inventées.
Les variables d'environnement l'emportant sur le fichier .env, il suffit de les
poser AVANT d'importer app.main, qui valide la configuration à l'import.
"""

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SECRET_TEST = "secret-de-test-invente-0123456789-abcdefghij"
DOSSIER_TEST = Path(tempfile.gettempdir()) / "sim-documents-tests"

os.environ.update(
    {
        "GENERATEUR_SECRET": SECRET_TEST,
        # Fichier volontairement absent : LibreOffice n'est jamais lancé par les tests.
        "LIBREOFFICE_CHEMIN": str(DOSSIER_TEST / "soffice-absent.com"),
        "DOSSIER_SORTIE": str(DOSSIER_TEST / "sortie"),
        "PROFIL_LIBREOFFICE": str(DOSSIER_TEST / "profil-libreoffice"),
        "DELAI_CONVERSION_S": "60",
        "GENERATEUR_HOTE": "127.0.0.1",
        "GENERATEUR_PORT": "8001",
    }
)

from app.main import app  # noqa: E402  (import après la configuration ci-dessus)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as client_test:
        yield client_test
    app.dependency_overrides.clear()


@pytest.fixture
def secret_test() -> str:
    return SECRET_TEST
