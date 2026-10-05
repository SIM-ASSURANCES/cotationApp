"""Test de fidélité du rendu PDF (CDC §15.3 « Fidélité »).

Convertit un .docx avec LibreOffice (comme le fera le service) et le compare au
PDF exporté par Word du même document : nombre de pages, fin de chaque page
(saut de page décalé ?), ressemblance du texte page par page et polices
réellement présentes dans le PDF produit.

Usage, depuis generateur/ (environnement activé, .env en place) :
    python scripts/test_fidelite.py --modele CP_test.docx --reference CP_test_word.pdf

Sous Docker (rendu Linux, le vrai test) :
    docker compose run --rm -v ${PWD}/essais:/essais generateur \
        python scripts/test_fidelite.py --modele /essais/CP_test.docx --reference /essais/CP_test_word.pdf

Le modèle et le PDF de référence sont des fichiers de TEST, jamais commités.
Sortie : tableau Markdown à coller dans docs/recette.md. Code de sortie 1 si le
nombre de pages ou une fin de page diffère.
"""

import argparse
import difflib
import re
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import obtenir_parametres  # noqa: E402
from app.conversion import ConversionEchouee, convertir_en_pdf  # noqa: E402

MOTS_DE_FIN = 8  # nombre de derniers mots comparés pour détecter un saut de page décalé


def _normaliser(texte: str) -> str:
    return re.sub(r"\s+", " ", texte).strip()


def pages_texte(pdf: Path) -> list[str]:
    return [_normaliser(page.extract_text() or "") for page in PdfReader(pdf).pages]


def polices(pdf: Path) -> set[str]:
    """Noms des polices du PDF, sans le préfixe de sous-ensemble (« ABCDEF+Calibri »)."""
    noms: set[str] = set()
    for page in PdfReader(pdf).pages:
        ressources = page.get("/Resources")
        fontes = ressources.get_object().get("/Font") if ressources else None
        for fonte in (fontes.get_object().values() if fontes else []):
            base = fonte.get_object().get("/BaseFont")
            if base:
                noms.add(re.sub(r"^[A-Z]{6}\+", "", str(base).lstrip("/")))
    return noms


def fin_de_page(texte: str) -> str:
    return " ".join(texte.split(" ")[-MOTS_DE_FIN:])


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    analyseur.add_argument("--modele", type=Path, required=True, help=".docx de test")
    analyseur.add_argument("--reference", type=Path, required=True, help="PDF exporté par Word")
    args = analyseur.parse_args()

    parametres = obtenir_parametres()
    with tempfile.TemporaryDirectory(prefix="fidelite-") as dossier:
        try:
            pdf = convertir_en_pdf(
                args.modele,
                Path(dossier),
                executable=parametres.libreoffice_chemin,
                profil=parametres.profil_libreoffice,
                delai_s=parametres.delai_conversion_s,
            )
        except ConversionEchouee as erreur:
            print(f"Conversion impossible : {erreur}")
            return 1

        libre, word = pages_texte(pdf), pages_texte(args.reference)
        polices_libre, polices_word = polices(pdf), polices(args.reference)

    print(f"Modèle : {args.modele.name}")
    print(f"Pages : Word = {len(word)}, LibreOffice = {len(libre)}\n")
    print("| Page | Ressemblance du texte | Fin de page identique |")
    print("|---|---|---|")
    ecarts = len(word) != len(libre)
    for numero in range(max(len(word), len(libre))):
        a = word[numero] if numero < len(word) else ""
        b = libre[numero] if numero < len(libre) else ""
        ressemblance = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
        meme_fin = fin_de_page(a) == fin_de_page(b)
        ecarts = ecarts or not meme_fin
        print(f"| {numero + 1} | {ressemblance:.0%} | {'oui' if meme_fin else 'NON'} |")

    print(f"\nPolices du PDF Word : {', '.join(sorted(polices_word)) or '(aucune)'}")
    print(f"Polices du PDF LibreOffice : {', '.join(sorted(polices_libre)) or '(aucune)'}")
    absentes = sorted(polices_word - polices_libre)
    if absentes:
        print(f"Polices de Word absentes du rendu LibreOffice (substituées ?) : {', '.join(absentes)}")
    print("\nRésultat :", "ÉCART DÉTECTÉ" if ecarts else "identique (pages et fins de page)")
    return 1 if ecarts else 0


if __name__ == "__main__":
    sys.exit(main())
