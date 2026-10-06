"""Génération de bout en bout : fusion, conversion par LibreOffice, annexes en fin de PDF.

Ces tests lancent le vrai LibreOffice : ignorés s'il est absent. Ils tournent aussi dans le
conteneur du générateur (rendu Linux, polices de l'image) : voir docs/recette.md.
"""

import base64
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.config import charger_parametres, obtenir_parametres
from app.generation import generer_pdf
from app.main import app
from tests.fabrique import document
from tests.test_conversion import SOFFICE
from tests.test_fusion import ANNEXE_ASSURES, CP_ASSURES, assures

pytestmark = pytest.mark.skipif(SOFFICE is None, reason="LibreOffice absent")

# pypdf lit mal le texte accentué des PDF du LibreOffice Windows 26.8 (« à » lu « a! ») alors que
# le rendu est juste (pdftotext le lit correctement). Le rendu qui compte est celui de l'image Linux :
# ces vérifications de texte y tournent (docs/recette.md).
texte_lisible = pytest.mark.skipif(sys.platform == "win32", reason="extraction pypdf non fiable sur le PDF du LibreOffice Windows")

MODELE_FILTRES = document(
    "montant : {{ prime.ttc | montant }}",
    "lettres : {{ prime.ttc | lettres }}",
    "date : {{ police.date_effet | date }}",
    "dateheure : {{ police.date_effet | dateheure }}",
    "pct : {{ formule.taux_couverture | pct }}",
    "case : {{ (risque.statut == 'PROPRIETAIRE') | case }} Propriétaire {{ (risque.statut == 'LOCATAIRE') | case }} Locataire",
    "valeur : {{ souscripteur.raison_sociale }}",
)
DONNEES_FILTRES = {
    "prime": {"ttc": "11592000"},
    "police": {"date_effet": "2026-09-01T08:00"},
    "formule": {"taux_couverture": "80"},
    "risque": {"statut": "PROPRIETAIRE"},
    "souscripteur": {"raison_sociale": "CGE & Fils <SA>"},
}


@pytest.fixture
def parametres(tmp_path: Path):  # type: ignore[no-untyped-def]
    assert SOFFICE is not None
    return charger_parametres(
        _env_file=None,
        libreoffice_chemin=SOFFICE,
        dossier_sortie=tmp_path / "sortie",
        profil_libreoffice=tmp_path / "profil",
        delai_conversion_s=120,
    )


def pages(pdf: bytes) -> list[str]:
    # Espace insécable lue comme une espace : on vérifie ici le rendu, pas le caractère exact
    # (vérifié dans test_filtres.py et test_fusion.py).
    return [(p.extract_text() or "").replace(" ", " ") for p in PdfReader(io.BytesIO(pdf)).pages]


@texte_lisible
def test_chaque_filtre_rendu_dans_le_pdf(parametres) -> None:  # type: ignore[no-untyped-def]
    texte = "\n".join(pages(generer_pdf(parametres, MODELE_FILTRES, DONNEES_FILTRES, seuil_liste=10)))
    assert "montant : 11 592 000" in texte
    assert "lettres : onze millions cinq cent quatre-vingt-douze mille francs CFA" in texte
    assert "date : 01/09/2026" in texte
    assert "dateheure : 01/09/2026 à 08h00" in texte
    assert "pct : 80 %" in texte
    assert "valeur : CGE & Fils <SA>" in texte
    # Les cases sont dessinées avec une autre police que le texte (Calibri n'a pas ☒ ☐) : pypdf
    # les lit en fin de ligne. Leur ordre est vérifié dans le .docx (test_fusion.py) et à l'œil
    # sur le PDF (recette.md) ; ici, on vérifie qu'elles sont bien dans le PDF.
    ligne = next(l for l in texte.splitlines() if l.startswith("case :"))
    assert "Propriétaire" in ligne and "Locataire" in ligne
    assert ligne.count("☒") == 1 and ligne.count("☐") == 1


@texte_lisible
def test_t7_annexe_en_fin_de_pdf(parametres) -> None:  # type: ignore[no-untyped-def]
    """T7 : 25 assurés, seuil 10 : renvoi dans le corps, annexe complète à la fin du PDF."""
    pdf = generer_pdf(
        parametres,
        CP_ASSURES,
        {"police": {"numero": "POL-2026-000025"}, "assures": assures(25)},
        seuil_liste=10,
        annexes={"assures": ANNEXE_ASSURES},
    )
    contenu = pages(pdf)
    assert len(contenu) >= 2
    debut_annexe = next(i for i, t in enumerate(contenu) if "Annexe – Liste des assurés" in t)
    corps, annexe = "\n".join(contenu[:debut_annexe]), "\n".join(contenu[debut_annexe:])
    assert "Voir annexe – Liste des assurés (25 personnes)" in corps
    assert "ASSURE01" not in corps
    assert all(f"ASSURE{i:02d}" in annexe for i in range(1, 26))


def donnees_t1() -> dict:  # type: ignore[type-arg]
    """Cotation T1 (offre BENI), montants du moteur de calcul de l'application."""
    return {
        "doc": {"numero": "COT-2026-10-0001", "version": "v1", "lieu_emission": "Abidjan", "date_emission": "2026-10-06", "date_validite": "2027-01-06", "url_verification": "https://documents.exemple.ci/verif/" + "j" * 43},
        "produit": {"libelle": "Santé BENI"},
        "souscripteur": {"type": "PHYSIQUE", "nom": "KOUADIO", "prenoms": "Awa", "raison_sociale": None},
        "police": {"date_effet": "2026-01-01", "date_echeance": "2026-12-31", "duree_jours": 365},
        "formules": [
            {"libelle": "Solo", "effectif": 3, "prime_unitaire": "93581.33", "prime_nette": "280744", "accessoires": "3000", "taxe": "4256", "ttc": "288000"},
            {"libelle": "Famille", "effectif": 60, "prime_unitaire": "252657.63", "prime_nette": "15159458", "accessoires": "210000", "taxe": "230542", "ttc": "15600000"},
        ],
        "prime": {"nette": "15440202", "accessoires": "213000", "taux_taxe": "1.5", "taxe": "234798", "ttc": "15888000"},
        "societe": {"raison_sociale": "SIM Assurances Côte d'Ivoire"},
    }


@texte_lisible
def test_cotation_t1_complete_qr_cg_filigrane(parametres) -> None:  # type: ignore[no-untyped-def]
    """Cotation T1 : montants de T1, QR code, CG jointes à la fin, filigrane « EXPIRÉE » (T11)."""
    from tests.fixtures.creer_fixtures import ICI
    from tests.test_pdf_stockage import pdf_texte

    modele = (ICI / "cotation_test.docx").read_bytes()
    pdf = generer_pdf(parametres, modele, donnees_t1(), seuil_liste=10, qr_url=donnees_t1()["doc"]["url_verification"], pieces_jointes=[pdf_texte("CONDITIONS GENERALES")], filigrane="EXPIRÉE")
    contenu = pages(pdf)
    assert len(contenu) == 2 and "CONDITIONS GENERALES" in contenu[-1]
    texte = contenu[0]
    for attendu in ("COT-2026-10-0001", "288 000", "15 600 000", "Total TTC : 15 888 000 F CFA", "quinze millions huit cent quatre-vingt-huit mille francs CFA", "06/01/2027"):
        assert attendu in texte, attendu
    assert all("EXPIRÉE" in t for t in contenu)
    images = list(PdfReader(io.BytesIO(pdf)).pages[0].images)
    assert len(images) == 1  # le QR code


# ------------------------------------------------------------------ Routes


@pytest.fixture
def client_reel(client: TestClient, parametres) -> TestClient:  # type: ignore[no-untyped-def]
    app.dependency_overrides[obtenir_parametres] = lambda: parametres
    return client


def b64(contenu: bytes) -> str:
    return base64.b64encode(contenu).decode()


def test_route_pdf(client_reel: TestClient, secret_test: str) -> None:
    reponse = client_reel.post(
        "/interne/documents/pdf",
        headers={"X-Generateur-Secret": secret_test},
        json={"modele": b64(MODELE_FILTRES), "donnees": DONNEES_FILTRES, "seuil_liste": 10},
    )
    assert reponse.status_code == 200
    assert reponse.headers["content-type"] == "application/pdf"
    assert "11 592 000" in "\n".join(pages(reponse.content))
