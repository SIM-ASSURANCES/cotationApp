"""Vérifie un modèle Word AVANT de le déposer dans l'application (aide au balisage, session 6.1).

Usage, depuis generateur/ (environnement activé) :
    python scripts/verifier_modele.py "C:/Users/moi/Documents/CP_sante.docx" --type CP

Le fichier doit être HORS du dépôt (aucun modèle réel n'y entre jamais). Rien n'est envoyé ni stocké : le .docx est lu et
analysé sur cette machine, avec la fonction `analyser()` du service (mêmes règles qu'au dépôt) ; seuls les FAITS de l'analyse
(balises, emplacements, polices) passent, par l'entrée standard d'un sous-processus local, au pont `app/scripts/controler-modele.mts`
qui applique les contrôles et le dictionnaire de l'application (source unique, rien n'est recopié ici). Il faut donc Node et
`npm ci` faits dans app/ (comme pour lancer l'application).

Options :
    --type TYPE            OBLIGATOIRE : type de modèle, comme au dépôt (CP, CERTIFICAT, COTATION, FACTURE, AVOIR, RECU,
                           AVIS_ECHEANCE, RELANCE, ANNEXE, SOUS_MODELE, CG, CS) ; il fixe les champs, filtres et mentions
                           obligatoires.
    --polices-image FICHIER  liste des polices de l'image du générateur (voir ci-dessous) : sans elle, les polices sont
                           comparées à celles de CETTE machine, ce qui n'est exact que sous Linux.
                           docker compose exec generateur fc-list : family > polices-image.txt

Code de sortie : 0 si le dépôt serait accepté, 1 s'il serait refusé, 2 si le script n'a pas pu s'exécuter.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

RACINE_GENERATEUR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE_GENERATEUR))

from app.analyse import Analyse, Probleme, analyser  # noqa: E402
from app.filtres import FILTRES  # noqa: E402
from app.polices import POLICES_REQUISES, analyser_fc_list, polices_absentes  # noqa: E402

RACINE_DEPOT = RACINE_GENERATEUR.parent
DOSSIER_APP = RACINE_DEPOT / "app"
PONT = "scripts/controler-modele.mts"

CODES_BALISE_COUPEE = {"BALISE_COUPEE", "BALISE_NON_FERMEE"}
CODES_BLOC = {"BLOC_MAL_FORME", "BLOC_NON_FERME"}
RE_FILTRE = re.compile(r"\|\s*([a-z_]+)")


class ErreurUsage(Exception):
    """Le script ne peut pas s'exécuter (fichier refusé, Node absent…) : code de sortie 2."""


# ------------------------------------------------------------------ Entrées


def lire_modele(chemin: str) -> bytes:
    fichier = Path(chemin).expanduser().resolve()
    if fichier.suffix.lower() != ".docx":
        raise ErreurUsage("Le fichier doit être un .docx.")
    if not fichier.is_file():
        raise ErreurUsage(f"Fichier introuvable : {fichier}")
    if fichier.is_relative_to(RACINE_DEPOT):
        raise ErreurUsage(
            f"Refus : {fichier} est dans le dépôt. Un modèle réel ne doit jamais s'y trouver (ni dans les tests) : "
            "copiez-le dans un dossier hors du dépôt, puis relancez."
        )
    return fichier.read_bytes()


def controles_de_l_application(type_modele: str, analyse: Analyse) -> dict:
    """Applique les contrôles et le dictionnaire de l'application, par le pont TypeScript (sous-processus local)."""
    node = shutil.which("node")
    if node is None or not (DOSSIER_APP / "node_modules" / "tsx").is_dir():
        raise ErreurUsage(
            "Node.js et les dépendances de app/ sont nécessaires : le dictionnaire des champs et les contrôles viennent de "
            "l'application (source unique). Faites « npm ci » dans app/, puis relancez."
        )
    entree = json.dumps({"type": type_modele, "analyse": analyse.model_dump()})
    resultat = subprocess.run(
        [node, "--import", "tsx", PONT], input=entree, capture_output=True, text=True, encoding="utf-8", cwd=DOSSIER_APP, timeout=120
    )
    try:
        sortie = json.loads(resultat.stdout)
    except json.JSONDecodeError:
        raise ErreurUsage(f"Le pont vers l'application a échoué (code {resultat.returncode}) :\n{resultat.stderr.strip() or resultat.stdout.strip()}") from None
    if not sortie.get("ok"):
        raise ErreurUsage(sortie.get("erreur", "Erreur inconnue du pont."))
    return sortie


def lire_texte(chemin: Path) -> str:
    """Texte d'un fichier, UTF-8 ou UTF-16 : la redirection « > » de Windows PowerShell écrit en UTF-16."""
    brut = chemin.read_bytes()
    if brut.startswith((b"\xff\xfe", b"\xfe\xff")):
        return brut.decode("utf-16", errors="replace")
    return brut.decode("utf-8-sig", errors="replace")


def polices_de_l_image(fichier: str | None, analyse: Analyse) -> tuple[list[str] | None, str]:
    """(polices absentes, origine de la liste). Sans fichier : celles de cette machine, comme le service."""
    if fichier is not None:
        chemin = Path(fichier).expanduser()
        if not chemin.is_file():
            raise ErreurUsage(f"Liste de polices introuvable : {chemin}")
        familles = analyser_fc_list(lire_texte(chemin))
        return polices_absentes(analyse.polices, familles), "l'image du générateur (liste fournie)"
    if analyse.polices_absentes is None:
        return None, "cette machine (liste impossible à obtenir)"
    return analyse.polices_absentes, "CETTE machine (exact sous Linux seulement ; sous Windows, passez --polices-image)"


# ------------------------------------------------------------------ Lecture des faits


def filtres_sur_champs_obligatoires(analyse: Analyse, facultatifs: set[str]) -> list[tuple[str, str, list[str]]]:
    """(champ, filtre, emplacements) : un des 6 filtres de valeur sur un champ NON facultatif (D26).

    Un tel champ, s'il est vide à la génération, arrête celle-ci en le nommant. Les filtres sont ceux du service
    (`app.filtres.FILTRES`), lus dans le texte de la balise ; une balise qui lit plusieurs champs est signalée."""
    champs_par_balise: dict[tuple[str, int, str], set[str]] = {}
    for r in analyse.references:
        champs_par_balise.setdefault((r.emplacement.partie, r.emplacement.paragraphe, r.balise), set()).add(r.chemin)
    groupes: dict[tuple[str, str], list[str]] = {}
    for r in analyse.references:
        if r.chemin in facultatifs:
            continue
        plusieurs = len(champs_par_balise[(r.emplacement.partie, r.emplacement.paragraphe, r.balise)]) > 1
        for filtre in dict.fromkeys(f for f in RE_FILTRE.findall(r.balise) if f in FILTRES):
            endroit = lieu(r.emplacement) + (" (balise à plusieurs champs : vérifiez lequel porte le filtre)" if plusieurs else "")
            lieux = groupes.setdefault((r.chemin, filtre), [])
            if endroit not in lieux:
                lieux.append(endroit)
    return [(champ, filtre, lieux) for (champ, filtre), lieux in groupes.items()]


def lieu(e) -> str:  # noqa: ANN001  (Emplacement)
    place = f"tableau {e.tableau}, ligne {e.ligne}, colonne {e.colonne}" if e.tableau is not None else f"paragraphe {e.paragraphe}"
    return f"{e.partie}, {place}"


def problemes_de(analyse: Analyse, codes: set[str]) -> list[Probleme]:
    return [p for p in analyse.problemes if p.code in codes]


# ------------------------------------------------------------------ Rapport


def rapport(analyse: Analyse, pont: dict, fichier_polices: str | None) -> tuple[str, bool]:
    """(texte du rapport, le dépôt serait-il accepté ?)."""
    lignes: list[str] = []
    ajouter = lignes.append

    def section(titre: str) -> None:
        ajouter("")
        ajouter(f"== {titre}")

    controle = pont["controle"]
    ajouter(f"Modèle analysé (type {pont['type']}) : {analyse.nombre_balises} balise(s) relevée(s).")

    section(f"Balises trouvées et leur emplacement ({len(analyse.references)} lecture(s) de données)")
    inconnues = {i["chemin"] for i in pont["inconnues"]}
    if not analyse.references:
        ajouter("  aucune")
    for r in analyse.references:
        ajouter(f"  {r.chemin:<38} {lieu(r.emplacement):<42} {r.balise}{'   <-- INCONNUE' if r.chemin in inconnues else ''}")

    section(f"Balises inconnues du dictionnaire ({len(pont['inconnues'])})")
    for i in pont["inconnues"]:
        ajouter(f"  {i['chemin']} — {i['emplacement']} — {i['balise']}")
    if not pont["inconnues"]:
        ajouter("  aucune")

    section(f"Champs Word (Ctrl+F9) ({len(analyse.champs_word)})")
    imitants = set(pont["champsWordImitantUneBalise"])
    for c in analyse.champs_word:
        ajouter(f"  {c.instruction.strip()} — {lieu(c.emplacement)}{'   <-- imite une balise : retapez-la au clavier' if c.instruction in imitants else '   (champ légitime : page, date…)'}")
    if not analyse.champs_word:
        ajouter("  aucun")

    coupees = problemes_de(analyse, CODES_BALISE_COUPEE)
    section(f"Balises coupées ou non fermées ({len(coupees)})")
    for p in coupees:
        ajouter(f"  {lieu(p.emplacement) if p.emplacement else '?'} — {p.message}" + (f" — « {p.emplacement.extrait} »" if p.emplacement and p.emplacement.extrait else ""))
    if not coupees:
        ajouter("  aucune")

    blocs = problemes_de(analyse, CODES_BLOC)
    section(f"Blocs mal fermés ({len(blocs)})")
    for p in blocs:
        ajouter(f"  {lieu(p.emplacement) if p.emplacement else '?'} — {p.message}")
    if blocs:
        ajouter("  Tant qu'un bloc est mal fermé, les autres balises de cette partie du document ne sont pas relevées (ni contrôlées) :")
        ajouter("  corrigez d'abord les blocs, puis relancez.")
    else:
        ajouter("  aucun")

    autres = [p for p in analyse.problemes if p.code not in CODES_BALISE_COUPEE | CODES_BLOC]
    if autres:
        section(f"Autres erreurs d'écriture dans les balises ({len(autres)})")
        for p in autres:
            ajouter(f"  {lieu(p.emplacement) if p.emplacement else '?'} — {p.message}")

    absentes, origine = polices_de_l_image(fichier_polices, analyse)
    section(f"Polices ({len(analyse.polices)} utilisée(s))")
    ajouter(f"  utilisées : {', '.join(analyse.polices) or 'aucune relevée'}")
    ajouter(f"  comparées aux polices de {origine}")
    if absentes is None:
        ajouter("  absentes : non vérifiable")
    else:
        ajouter(f"  absentes : {', '.join(absentes) or 'aucune'}")
    requises = [p for p in POLICES_REQUISES if p in analyse.polices]
    if requises:
        ajouter(f"  sans équivalent libre (fidélité de la pagination, voir generateur/polices/README.md) : {', '.join(requises)}")

    filtres = filtres_sur_champs_obligatoires(analyse, set(pont["facultatifs"]))
    section(f"Filtres appliqués à un champ obligatoire ({len(filtres)})")
    if filtres:
        ajouter("  Si le champ est vide à la génération, celle-ci s'arrête en le nommant (D26). Ajoutez-le aux champs facultatifs (D19) si la")
        ajouter("  Technique confirme qu'il peut manquer ; sinon, assurez-vous qu'il est toujours renseigné.")
    for champ, filtre, lieux in filtres:
        ajouter(f"  {champ} | {filtre} — {lieux[0]}" + (f" (et {len(lieux) - 1} autre(s) endroit(s))" if len(lieux) > 1 else ""))
    if not filtres:
        ajouter("  aucun")

    section("Ce que le dépôt ferait (mêmes contrôles que l'application)")
    for c in controle["rejets"]:
        ajouter(f"  REJET : {c['message']}" + (f" [{c['emplacement']}]" if c["emplacement"] else ""))
    for c in controle["avertissements"]:
        ajouter(f"  avertissement : {c['message']}" + (f" [{c['emplacement']}]" if c["emplacement"] else ""))
    accepte = not controle["rejets"]
    ajouter(f"  => {'dépôt ACCEPTÉ' if accepte else f'dépôt REFUSÉ ({len(controle['rejets'])} rejet(s))'}, {len(controle['avertissements'])} avertissement(s).")
    return "\n".join(lignes), accepte


def principal(argv: list[str] | None = None) -> int:
    parseur = argparse.ArgumentParser(description="Vérifie un modèle Word avant dépôt (rien n'est envoyé ni stocké).")
    parseur.add_argument("modele", help="chemin d'un .docx HORS du dépôt")
    parseur.add_argument("--type", dest="type_modele", required=True, help="type de modèle, comme au dépôt : CP, FACTURE, RELANCE…")
    parseur.add_argument("--polices-image", default=None, help="fichier issu de « fc-list : family » dans l'image du générateur")
    args = parseur.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  (console Windows)
    try:
        type_modele = args.type_modele.strip().upper()
        analyse = analyser(lire_modele(args.modele))
        if not analyse.docx_valide:
            print(f"Le fichier n'est pas un document Word .docx valide : {analyse.erreur}")
            return 1
        pont = controles_de_l_application(type_modele, analyse)
        texte, accepte = rapport(analyse, pont, args.polices_image)
    except ErreurUsage as erreur:
        print(erreur, file=sys.stderr)
        return 2
    print(texte)
    return 0 if accepte else 1


if __name__ == "__main__":
    sys.exit(principal())
