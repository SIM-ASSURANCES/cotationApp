"""Génération d'un PDF : fusion du modèle, conversion (fonction unique de conversion.py), assemblage.

Le PDF produit est, dans l'ordre (CDC §6.5, §6.8) : le corps, les annexes des listes longues, puis
les pièces jointes déjà en PDF (conventions spéciales, conditions générales). Un filigrane
(« EXPIRÉE ») peut couvrir chaque page.

Les fichiers intermédiaires (données de clients) sont écrits dans un dossier de travail sous
DOSSIER_SORTIE, puis effacés dès la fin de la génération, réussie ou non.
"""

import tempfile
from pathlib import Path
from typing import Any

from app.config import Parametres
from app.conversion import convertir_en_pdf
from app.fusion import Image, fusionner
from app.pdf import assembler, filigraner, qr_png


def generer_pdf(
    parametres: Parametres,
    modele: bytes,
    donnees: dict[str, Any],
    *,
    seuil_liste: int,
    annexes: dict[str, bytes] | None = None,
    sous_modeles: dict[str, dict[str, bytes]] | None = None,
    images: dict[str, Image] | None = None,
    qr_url: str | None = None,
    qr_largeur_mm: float = 25,
    pieces_jointes: list[bytes] | None = None,
    filigrane: str | None = None,
    listes_en_annexe: tuple[str, ...] = (),
    champs_facultatifs: tuple[str, ...] = (),
) -> bytes:
    images = dict(images or {})
    if qr_url:
        images["qr_code"] = Image(qr_png(qr_url), qr_largeur_mm)
    resultat = fusionner(
        modele,
        donnees,
        seuil_liste=seuil_liste,
        annexes=annexes,
        sous_modeles=sous_modeles,
        images=images,
        listes_en_annexe=listes_en_annexe,
        champs_facultatifs=champs_facultatifs,
    )
    travail = parametres.dossier_sortie / "travail"
    travail.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=travail, prefix="generation-") as dossier:
        racine = Path(dossier)
        morceaux = [("document", resultat.corps)] + [(f"annexe-{a.liste}", a.docx) for a in resultat.annexes]
        pdfs: list[bytes] = []
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
                    simultanees=parametres.conversions_simultanees,
                ).read_bytes()  # lu en mémoire : sous Windows, un fichier ouvert empêcherait d'effacer le dossier
            )
    pdf = assembler(pdfs + list(pieces_jointes or []))
    return filigraner(pdf, filigrane) if filigrane else pdf
