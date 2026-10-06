"""Test de fidélité par lot : tous les modèles Word d'un dossier, d'un seul coup.

Pour chaque .docx de --modeles, convertit avec LibreOffice (même fonction que le service),
le compare au PDF exporté par Word du même chemin relatif dans --pdf-word (voir
scripts/exporter_word.ps1), et produit un tableau Markdown : une ligne par modèle, avec les
pages dont la fin est décalée. Les PDF LibreOffice sont conservés dans --sortie pour contrôle
visuel.

Sous Docker (rendu Linux, le vrai test), depuis la racine du dépôt :
    docker compose run --rm -v ${PWD}/essais:/essais generateur \
        python scripts/test_fidelite_lot.py --modeles /essais/modeles \
        --pdf-word /essais/pdf_word --sortie /essais/pdf_libreoffice

Les modèles sont comparés BRUTS (balises {{ }} non remplacées), des deux côtés : on mesure la
mise en page, pas le contenu final. Un modèle rempli de données de test donne un résultat plus
proche de la production (voir test_fidelite.py pour un modèle isolé).

Code de sortie 1 si un modèle présente un écart, une conversion échouée ou un PDF Word absent.
"""

import argparse
import sys
from pathlib import Path

from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import obtenir_parametres  # noqa: E402
from app.conversion import ConversionEchouee, convertir_en_pdf  # noqa: E402
from test_fidelite import fin_de_page, pages_texte, polices  # noqa: E402


def comparer(docx: Path, pdf_word: Path, dossier_lo: Path, parametres) -> dict:
    try:
        pdf_lo = convertir_en_pdf(
            docx,
            dossier_lo,
            executable=parametres.libreoffice_chemin,
            profil=parametres.profil_libreoffice,
            delai_s=parametres.delai_conversion_s,
        )
    except ConversionEchouee as erreur:
        return {"erreur": f"conversion : {erreur}"}

    word, libre = pages_texte(pdf_word), pages_texte(pdf_lo)
    communes = min(len(word), len(libre))
    decalees = [n + 1 for n in range(communes) if fin_de_page(word[n]) != fin_de_page(libre[n])]
    mots_word = sum(len(p.split()) for p in word)
    mots_lo = sum(len(p.split()) for p in libre)
    return {
        "pages_word": len(word),
        "pages_lo": len(libre),
        "communes": communes,
        "decalees": decalees,
        "mots_word": mots_word,
        "mots_lo": mots_lo,
        "absentes": sorted(polices(pdf_word) - polices(pdf_lo)),
    }


def verdict(r: dict) -> str:
    if "erreur" in r:
        return "ERREUR"
    if r["pages_word"] != r["pages_lo"]:
        return "ÉCART (pages)"
    return "ÉCART (fins de page)" if r["decalees"] else "identique"


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    analyseur.add_argument("--modeles", type=Path, required=True, help="dossier des .docx (sous-dossiers compris)")
    analyseur.add_argument("--pdf-word", type=Path, required=True, help="PDF Word, même arborescence")
    analyseur.add_argument("--sortie", type=Path, required=True, help="dossier des PDF LibreOffice produits")
    args = analyseur.parse_args()

    parametres = obtenir_parametres()
    docx_trouves = sorted(p for p in args.modeles.rglob("*.docx") if not p.name.startswith("~$"))
    if not docx_trouves:
        print(f"Aucun .docx sous {args.modeles}")
        return 1

    lignes: list[str] = []
    problemes = 0
    for docx in docx_trouves:
        relatif = docx.relative_to(args.modeles)
        pdf_word = (args.pdf_word / relatif).with_suffix(".pdf")
        if not pdf_word.exists():
            lignes.append(f"| {relatif} | n/a | n/a | n/a | n/a | PDF Word absent | ERREUR |")
            problemes += 1
            continue
        dossier_lo = args.sortie / relatif.with_suffix("")
        dossier_lo.mkdir(parents=True, exist_ok=True)
        r = comparer(docx, pdf_word, dossier_lo, parametres)
        v = verdict(r)
        problemes += v != "identique"
        if "erreur" in r:
            lignes.append(f"| {relatif} | n/a | n/a | n/a | n/a | {r['erreur']} | {v} |")
            continue
        fins = f"{r['communes'] - len(r['decalees'])}/{r['communes']}"
        decalees = ", ".join(map(str, r["decalees"])) or "aucune"
        absentes = ", ".join(r["absentes"]) or "aucune"
        lignes.append(
            f"| {relatif} | {r['pages_word']} | {r['pages_lo']} | {fins} | {decalees} | {absentes} | {v} |"
        )

    print("| Modèle | Pages Word | Pages LibreOffice | Fins de page identiques | Pages décalées | Polices de Word absentes du rendu | Verdict |")
    print("|---|---|---|---|---|---|---|")
    print("\n".join(lignes))
    print(f"\n{len(docx_trouves)} modèle(s), {problemes} à examiner.")
    return 1 if problemes else 0


if __name__ == "__main__":
    sys.exit(main())
