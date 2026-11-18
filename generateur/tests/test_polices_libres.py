"""D69 : le générateur fonctionne avec des polices LIBRES de mêmes dimensions, sans aucune police Microsoft.

Ces tests lancent le vrai LibreOffice et lisent le PDF avec `pdffonts` (poppler-utils) : ils sont IGNORÉS si l'un des deux manque, si la
machine n'est pas Linux, ou si l'environnement n'est pas celui de l'image libre (Tahoma de Wine, Carlito) : par exemple un poste où SIM a déposé
de vraies polices dans generateur/polices/. Aucune police Microsoft n'est utilisée ici : le modèle Word est inventé, généré par le code."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient

from app.conversion import convertir_en_pdf

SOFFICE = Path("/usr/bin/soffice")
POLICES_DU_DEPOT = Path(__file__).resolve().parent.parent / "polices"


def _fichier_retenu(police: str) -> str:
    executable = shutil.which("fc-match")
    if executable is None:
        return ""
    return subprocess.run([executable, "-f", "%{file}", police], capture_output=True, text=True, timeout=30).stdout


pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or not SOFFICE.is_file() or shutil.which("pdffonts") is None or "wine" not in _fichier_retenu("Tahoma").lower() or "carlito" not in _fichier_retenu("Calibri").lower(),
    reason="environnement de l'image libre absent (LibreOffice, pdffonts, Tahoma de Wine, Carlito)",
)


def _polices_du_pdf(pdf: Path) -> list[str]:
    sortie = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True, check=True, timeout=60).stdout
    noms = [ligne.split()[0] for ligne in sortie.splitlines()[2:] if ligne.strip()]
    return [nom.split("+", 1)[-1] for nom in noms]  # sans le préfixe de sous-ensemble (« BAAAAA+WineTahoma »)


def test_sante_est_ok_sans_aucune_police_deposee(client: TestClient) -> None:
    autres = sorted(p.name for p in POLICES_DU_DEPOT.iterdir() if p.name != "README.md")
    if autres:
        pytest.skip(f"des polices ont été déposées dans generateur/polices/ ({', '.join(autres)}) : ce test vise l'image sans elles")
    # Vrais fc-list et fc-match de la machine : Tahoma est la police de Wine, Calibri est résolue en Carlito.
    assert client.get("/sante").json()["polices_manquantes"] == []


def test_un_modele_en_tahoma_et_calibri_donne_un_pdf_en_tahoma_de_wine_et_carlito(tmp_path: Path) -> None:
    document = Document()
    for police, gras in (("Tahoma", False), ("Tahoma", True), ("Calibri", False), ("Calibri", True)):
        run = document.add_paragraph().add_run(f"Texte inventé en {police}{' gras' if gras else ''} : ABC abc 0123456789")
        run.font.name, run.bold = police, gras
    docx = tmp_path / "essai.docx"
    document.save(docx)

    pdf = convertir_en_pdf(docx, tmp_path / "sortie", executable=SOFFICE, profil=tmp_path / "profil", delai_s=120)
    polices = _polices_du_pdf(pdf)
    assert {"WineTahoma", "WineTahomaBold", "Carlito-Regular", "Carlito-Bold"} <= set(polices), polices
    # Jamais une police de secours (DejaVu…) à la place : elle aurait d'autres dimensions et décalerait les sauts de page.
    assert not [p for p in polices if p.startswith("DejaVu")], polices
