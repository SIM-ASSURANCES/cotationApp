"""D69 : le générateur fonctionne avec des polices LIBRES de mêmes dimensions (Carlito, Liberation), sans aucune police Microsoft ; la Tahoma
libre de Wine est à l'ESSAI (TAHOMA_LIBRE=oui), Tahoma restant fournie par SIM.

Ces tests lancent le vrai LibreOffice et lisent le PDF avec `pdffonts` (poppler-utils) : ils sont IGNORÉS si l'un des deux manque, si la machine
n'est pas Linux, ou si l'environnement n'est pas celui de l'image (Carlito ; « Wine Tahoma » pour l'essai). Aucune police Microsoft n'est
utilisée ici : le modèle Word est inventé, généré par le code."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient

from app.conversion import convertir_en_pdf
from app.polices import familles_installees, polices_absentes, resolution_fontconfig

SOFFICE = Path("/usr/bin/soffice")
POLICES_DU_DEPOT = Path(__file__).resolve().parent.parent / "polices"


def _fichier_retenu(police: str) -> str:
    executable = shutil.which("fc-match")
    if executable is None:
        return ""
    return subprocess.run([executable, "-f", "%{file}", police], capture_output=True, text=True, timeout=30).stdout


def _famille_retenue(police: str) -> str:
    executable = shutil.which("fc-match")
    if executable is None:
        return ""
    return subprocess.run([executable, "-f", "%{family}", police], capture_output=True, text=True, timeout=30).stdout


_LIBRE = sys.platform != "win32" and SOFFICE.is_file() and shutil.which("pdffonts") is not None
avec_calibri_libre = pytest.mark.skipif(
    not _LIBRE or "carlito" not in _fichier_retenu("Calibri").lower(),
    reason="environnement de l'image libre absent (LibreOffice, pdffonts, Carlito)",
)
avec_essai_tahoma_wine = pytest.mark.skipif(
    not _LIBRE or _famille_retenue("Tahoma") != "Wine Tahoma",
    reason="essai TAHOMA_LIBRE=oui absent (fc-match Tahoma ne retient pas « Wine Tahoma »)",
)


def _polices_du_pdf(pdf: Path) -> list[str]:
    sortie = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True, check=True, timeout=60).stdout
    noms = [ligne.split()[0] for ligne in sortie.splitlines()[2:] if ligne.strip()]
    return [nom.split("+", 1)[-1] for nom in noms]  # sans le préfixe de sous-ensemble (« BAAAAA+WineTahoma »)


def _pdf_en_polices(tmp_path: Path, *polices: tuple[str, bool]) -> list[str]:
    """PDF d'un modèle Word INVENTÉ, un paragraphe par (police, gras) : les noms des polices embarquées dans le PDF."""
    document = Document()
    for police, gras in polices:
        run = document.add_paragraph().add_run(f"Texte inventé en {police}{' gras' if gras else ''} : ABC abc 0123456789")
        run.font.name, run.bold = police, gras
    docx = tmp_path / "essai.docx"
    document.save(docx)
    pdf = convertir_en_pdf(docx, tmp_path / "sortie", executable=SOFFICE, profil=tmp_path / "profil", delai_s=120)
    return _polices_du_pdf(pdf)


@avec_calibri_libre
def test_calibri_arial_et_times_sont_couvertes_sans_police_deposee(client: TestClient) -> None:
    autres = sorted(p.name for p in POLICES_DU_DEPOT.iterdir() if p.name != "README.md")
    if autres:
        pytest.skip(f"des polices ont été déposées dans generateur/polices/ ({', '.join(autres)}) : ce test vise l'image sans elles")
    # Vrais fc-list et fc-match de la machine : aucune police Microsoft, et pourtant ces trois polices sont couvertes.
    assert polices_absentes(("Calibri", "Arial", "Times New Roman"), familles_installees() or frozenset(), resolution_fontconfig) == []


@avec_calibri_libre
def test_un_modele_en_calibri_arial_et_times_donne_un_pdf_en_carlito_et_liberation(tmp_path: Path) -> None:
    polices = _pdf_en_polices(tmp_path, ("Calibri", False), ("Calibri", True), ("Arial", False), ("Times New Roman", False))
    assert {"Carlito-Regular", "Carlito-Bold", "LiberationSans", "LiberationSerif"} <= set(polices), polices
    assert not [p for p in polices if p.startswith("DejaVu")], polices  # jamais une police de secours aux autres dimensions


@avec_essai_tahoma_wine
def test_essai_la_tahoma_de_wine_couvre_tahoma_et_sante_est_ok(client: TestClient) -> None:
    autres = sorted(p.name for p in POLICES_DU_DEPOT.iterdir() if p.name != "README.md")
    if autres:
        pytest.skip(f"des polices ont été déposées dans generateur/polices/ ({', '.join(autres)}) : ce test vise l'image sans elles")
    assert client.get("/sante").json()["polices_manquantes"] == []


@avec_essai_tahoma_wine
def test_essai_un_modele_en_tahoma_donne_un_pdf_en_tahoma_de_wine(tmp_path: Path) -> None:
    polices = _pdf_en_polices(tmp_path, ("Tahoma", False), ("Tahoma", True), ("Calibri", False))
    assert {"WineTahoma", "WineTahomaBold", "Carlito-Regular"} <= set(polices), polices
    assert not [p for p in polices if p.startswith("DejaVu")], polices
