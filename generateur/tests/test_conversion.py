"""Tests de la conversion. Ils lancent le vrai LibreOffice : ignorés s'il est absent."""

import os
from pathlib import Path

import pytest
from docx import Document
from pypdf import PdfReader

from app.conversion import ConversionDelaiDepasse, ConversionEchouee, convertir_en_pdf

CHEMINS_POSSIBLES = [
    Path(os.environ.get("LIBREOFFICE_REEL", "")),
    Path(r"C:\Program Files\LibreOffice\program\soffice.com"),
    Path("/usr/bin/soffice"),
]
SOFFICE = next((c for c in CHEMINS_POSSIBLES if c.is_file()), None)

pytestmark = pytest.mark.skipif(SOFFICE is None, reason="LibreOffice absent")


@pytest.fixture
def docx_de_test(tmp_path: Path) -> Path:
    document = Document()
    document.add_paragraph("Document de test inventé : conversion.")
    chemin = tmp_path / "essai.docx"
    document.save(chemin)
    return chemin


def test_convertit_un_docx_en_pdf(docx_de_test: Path, tmp_path: Path) -> None:
    assert SOFFICE is not None
    pdf = convertir_en_pdf(
        docx_de_test, tmp_path / "sortie", executable=SOFFICE, profil=tmp_path / "profil", delai_s=120
    )

    assert pdf.read_bytes().startswith(b"%PDF")
    assert "conversion" in PdfReader(pdf).pages[0].extract_text()


def test_interrompt_une_conversion_trop_longue(docx_de_test: Path, tmp_path: Path) -> None:
    assert SOFFICE is not None
    # 10 ms : le démarrage de LibreOffice prend bien plus, donc le délai est dépassé.
    with pytest.raises(ConversionDelaiDepasse):
        convertir_en_pdf(
            docx_de_test, tmp_path / "sortie", executable=SOFFICE, profil=tmp_path / "profil", delai_s=0.01
        )
    assert not (tmp_path / "sortie" / "essai.pdf").exists()


def test_fichier_inexistant_est_une_echec_sans_pdf(tmp_path: Path) -> None:
    assert SOFFICE is not None
    with pytest.raises(ConversionEchouee):
        convertir_en_pdf(
            tmp_path / "absent.docx", tmp_path / "sortie", executable=SOFFICE, profil=tmp_path / "profil", delai_s=120
        )
