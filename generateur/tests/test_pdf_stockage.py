"""QR code, filigrane, assemblage, stockage en ajout seul (sans LibreOffice)."""

import base64
import hashlib
import io
import stat
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader, PdfWriter

from app import stockage
from app.config import charger_parametres, obtenir_parametres
from app.main import app
from app.pdf import assembler, filigraner, qr_png


def pdf_texte(*pages: str) -> bytes:
    """PDF de test : une page par texte (police standard, sans LibreOffice)."""
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    redacteur = PdfWriter()
    for texte in pages:
        page = redacteur.add_blank_page(595, 842)
        flux = DecodedStreamObject()
        flux.set_data(f"BT /F1 14 Tf 72 760 Td ({texte}) Tj ET".encode("latin-1"))
        page[NameObject("/Contents")] = redacteur._add_object(flux)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})})}
        )
    sortie = io.BytesIO()
    redacteur.write(sortie)
    return sortie.getvalue()


def textes(pdf: bytes) -> list[str]:
    return [p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages]


def test_qr_png() -> None:
    image = Image.open(io.BytesIO(qr_png("https://exemple.ci/verif/" + "a" * 43)))
    assert image.format == "PNG"
    assert image.width == image.height and image.width >= 200


def test_filigrane_sur_chaque_page() -> None:
    resultat = filigraner(pdf_texte("Page un", "Page deux"), "EXPIRÉE")
    pages = textes(resultat)
    assert len(pages) == 2
    assert all("EXPIRÉE" in t for t in pages)
    assert "Page un" in pages[0] and "Page deux" in pages[1]


def test_assemblage_dans_l_ordre() -> None:
    resultat = assembler([pdf_texte("CP"), pdf_texte("Annexe"), pdf_texte("CS"), pdf_texte("CG")])
    assert [t.strip() for t in textes(resultat)] == ["CP", "Annexe", "CS", "CG"]


# ------------------------------------------------------------------ Stockage


def test_stockage_ajout_seul(tmp_path: Path) -> None:
    empreinte = stockage.ecrire(tmp_path, "PRD/2026/10/COTATION/COT-2026-10-0001_v1.pdf", b"%PDF-1")
    assert empreinte == hashlib.sha256(b"%PDF-1").hexdigest()
    with pytest.raises(stockage.DejaStocke):
        stockage.ecrire(tmp_path, "PRD/2026/10/COTATION/COT-2026-10-0001_v1.pdf", b"autre contenu")
    assert stockage.lire(tmp_path, "PRD/2026/10/COTATION/COT-2026-10-0001_v1.pdf") == b"%PDF-1"
    fichier = tmp_path / "PRD/2026/10/COTATION/COT-2026-10-0001_v1.pdf"
    assert not fichier.stat().st_mode & stat.S_IWUSR  # lecture seule
    assert [p.name for p in fichier.parent.iterdir()] == [fichier.name]  # aucun fichier provisoire restant


@pytest.mark.parametrize("chemin", ["../hors.pdf", "a/../../b.pdf", "/absolu.pdf", "a//b.pdf", "", "a/.cache", "C:\\x.pdf"])
def test_stockage_refuse_les_chemins_douteux(tmp_path: Path, chemin: str) -> None:
    with pytest.raises(stockage.CheminInvalide):
        stockage.ecrire(tmp_path, chemin, b"x")


def test_zip(tmp_path: Path) -> None:
    stockage.ecrire(tmp_path, "A/un.pdf", b"1")
    stockage.ecrire(tmp_path, "B/deux.pdf", b"22")
    with zipfile.ZipFile(io.BytesIO(stockage.zipper(tmp_path, [("A/un.pdf", "un.pdf"), ("B/deux.pdf", "deux.pdf")]))) as archive:
        assert sorted(archive.namelist()) == ["deux.pdf", "un.pdf"]
        assert archive.read("deux.pdf") == b"22"


@pytest.fixture
def client_stockage(client: TestClient, tmp_path: Path) -> TestClient:
    app.dependency_overrides[obtenir_parametres] = lambda: charger_parametres(_env_file=None, dossier_sortie=tmp_path)
    return client


def test_routes_de_stockage(client_stockage: TestClient, secret_test: str) -> None:
    entete = {"X-Generateur-Secret": secret_test}
    corps = {"chemin": "PRD/2026/10/CP/POL-1_v1.pdf", "contenu": base64.b64encode(b"%PDF-test").decode()}
    reponse = client_stockage.post("/interne/stockage", headers=entete, json=corps)
    assert reponse.status_code == 200
    assert reponse.json()["taille"] == 9
    assert client_stockage.post("/interne/stockage", headers=entete, json=corps).status_code == 409
    assert client_stockage.get("/interne/stockage", headers=entete, params={"chemin": "PRD/2026/10/CP/POL-1_v1.pdf"}).content == b"%PDF-test"
    assert client_stockage.get("/interne/stockage", headers=entete, params={"chemin": "PRD/absent.pdf"}).status_code == 404
    assert client_stockage.get("/interne/stockage", headers=entete, params={"chemin": "../x"}).status_code == 422
    assert client_stockage.get("/interne/stockage", params={"chemin": "PRD/2026/10/CP/POL-1_v1.pdf"}).status_code == 401
    zip_ = client_stockage.post("/interne/stockage/zip", headers=entete, json={"fichiers": [{"chemin": "PRD/2026/10/CP/POL-1_v1.pdf", "nom": "POL-1.pdf"}]})
    assert zip_.status_code == 200 and zip_.content[:2] == b"PK"


def test_zip_stocke_dans_le_stockage(client_stockage: TestClient, secret_test: str, tmp_path: Path) -> None:
    # Phase 5 : l'archive d'un import en masse est écrite dans le stockage, en ajout seul, sans repasser par l'application.
    entete = {"X-Generateur-Secret": secret_test}
    for i in (1, 2):
        corps = {"chemin": f"PRD/2026/10/CERTIFICAT/C-{i}_v1.pdf", "contenu": base64.b64encode(f"%PDF-{i}".encode()).decode()}
        assert client_stockage.post("/interne/stockage", headers=entete, json=corps).status_code == 200
    demande = {
        "chemin": "lots/LOT-1/certificats_v1.zip",
        "fichiers": [{"chemin": f"PRD/2026/10/CERTIFICAT/C-{i}_v1.pdf", "nom": f"C-{i}.pdf"} for i in (1, 2)],
    }
    reponse = client_stockage.post("/interne/stockage/zip/stocker", headers=entete, json=demande)
    assert reponse.status_code == 200
    stocke = stockage.lire(stockage.racine(tmp_path), "lots/LOT-1/certificats_v1.zip")
    assert reponse.json()["empreinte"] == hashlib.sha256(stocke).hexdigest()
    with zipfile.ZipFile(io.BytesIO(stocke)) as archive:
        assert sorted(archive.namelist()) == ["C-1.pdf", "C-2.pdf"]
    # Jamais d'écrasement ; un fichier absent est signalé.
    assert client_stockage.post("/interne/stockage/zip/stocker", headers=entete, json=demande).status_code == 409
    absent = {**demande, "chemin": "lots/LOT-1/autre.zip", "fichiers": [{"chemin": "PRD/absent.pdf", "nom": "x.pdf"}]}
    assert client_stockage.post("/interne/stockage/zip/stocker", headers=entete, json=absent).status_code == 404
