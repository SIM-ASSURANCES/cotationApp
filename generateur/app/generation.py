"""Génération d'un PDF : fusion du modèle, conversion (fonction unique de conversion.py), annexes.

Le PDF produit est : le corps, puis les annexes des listes longues, à la fin (CDC §6.5).
L'assemblage avec les conditions spéciales et générales (§6.8) viendra avec l'émission.

Les fichiers intermédiaires (données de clients) sont écrits dans un dossier de travail sous
DOSSIER_SORTIE, puis effacés dès la fin de la génération, réussie ou non.
"""

import io
import tempfile
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

from app.config import Parametres
from app.conversion import convertir_en_pdf
from app.fusion import Image, fusionner


def generer_pdf(
    parametres: Parametres,
    modele: bytes,
    donnees: dict[str, Any],
    *,
    seuil_liste: int,
    annexes: dict[str, bytes] | None = None,
    sous_modeles: dict[str, dict[str, bytes]] | None = None,
    images: dict[str, Image] | None = None,
) -> bytes:
    resultat = fusionner(
        modele, donnees, seuil_liste=seuil_liste, annexes=annexes, sous_modeles=sous_modeles, images=images
    )
    travail = parametres.dossier_sortie / "travail"
    travail.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=travail, prefix="generation-") as dossier:
        racine = Path(dossier)
        morceaux = [("document", resultat.corps)] + [(f"annexe-{a.liste}", a.docx) for a in resultat.annexes]
        pdfs: list[Path] = []
        for nom, docx in morceaux:
            chemin = racine / f"{nom}.docx"
            chemin.write_bytes(docx)
            pdfs.append(
                convertir_en_pdf(
                    chemin,
                    racine / "pdf",
                    executable=parametres.libreoffice_chemin,
                    profil=parametres.profil_libreoffice,
                    delai_s=parametres.delai_conversion_s,
                )
            )
        if len(pdfs) == 1:
            return pdfs[0].read_bytes()
        assemblage = PdfWriter()
        for pdf in pdfs:
            # Lu en mémoire : sous Windows, un fichier resté ouvert empêcherait d'effacer le dossier.
            assemblage.append(PdfReader(io.BytesIO(pdf.read_bytes())))
        sortie = io.BytesIO()
        assemblage.write(sortie)
        return sortie.getvalue()
