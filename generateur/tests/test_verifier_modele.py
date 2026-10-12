"""Script d'aide au balisage `scripts/verifier_modele.py` (session 6.1) : modèles de TEST générés par du code, écrits HORS du dépôt
(dossier temporaire de pytest) ; aucun modèle réel. Les contrôles et le dictionnaire viennent de l'application (pont Node)."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app.analyse import analyser
from tests.fabrique import avec_champ_word, avec_texte_supprime, document

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "verifier_modele.py"
APP = SCRIPT.parent.parent.parent / "app"
PONT_DISPONIBLE = shutil.which("node") is not None and (APP / "node_modules" / "tsx").is_dir()
avec_pont = pytest.mark.skipif(not PONT_DISPONIBLE, reason="Node et « npm ci » dans app/ requis (le dictionnaire vient de l'application)")


def lancer(*args: str | Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, encoding="utf-8", timeout=180)


def ecrire(dossier: Path, nom: str, contenu: bytes) -> Path:
    chemin = dossier / nom
    chemin.write_bytes(contenu)
    return chemin


def test_refuse_un_modele_situe_dans_le_depot() -> None:
    dans_le_depot = SCRIPT.parent.parent / "tests" / "fixtures" / "cp_test.docx"
    r = lancer(dans_le_depot, "--type", "CP")
    assert r.returncode == 2
    assert "est dans le dépôt" in r.stderr
    assert r.stdout == ""


def test_refuse_un_fichier_qui_n_est_pas_un_docx_ou_introuvable(tmp_path: Path) -> None:
    assert "doit être un .docx" in lancer(ecrire(tmp_path, "m.txt", b"x"), "--type", "CP").stderr
    assert "introuvable" in lancer(tmp_path / "absent.docx", "--type", "CP").stderr


def test_le_type_est_obligatoire(tmp_path: Path) -> None:
    r = lancer(ecrire(tmp_path, "m.docx", document("{{ police.numero }}")))
    assert r.returncode == 2 and "--type" in r.stderr


@avec_pont
def test_type_inconnu_est_explique(tmp_path: Path) -> None:
    r = lancer(ecrire(tmp_path, "m.docx", document("{{ police.numero }}")), "--type", "LETTRE")
    assert r.returncode == 2
    assert "Type de modèle inconnu" in r.stderr and "FACTURE" in r.stderr


@avec_pont
def test_fichier_non_docx_est_dit(tmp_path: Path) -> None:
    r = lancer(ecrire(tmp_path, "faux.docx", b"ceci n'est pas un document Word"), "--type", "CP")
    assert r.returncode == 1
    assert "pas un document Word" in r.stdout


@avec_pont
def test_rapport_complet_sur_un_modele_plein_de_pieges(tmp_path: Path) -> None:
    modele = document(
        "Souscripteur : {{ client.nom }}",  # balise hors dictionnaire (T9)
        "Date d'effet : {{ police.date_effet | date }}",  # filtre sur un champ obligatoire (D26)
        "Taux : {{ formules[0].taux_couverture | pct }}",  # filtre sur un champ facultatif : pas signalé
        police="Tahoma",
    )
    chemin = ecrire(tmp_path, "cp.docx", modele)
    r = lancer(chemin, "--type", "CP")
    sortie = r.stdout
    assert r.returncode == 1  # le dépôt serait refusé
    assert "Balises trouvées et leur emplacement" in sortie
    assert "police.date_effet" in sortie and "corps, paragraphe 2" in sortie
    assert "== Balises inconnues du dictionnaire (1)" in sortie and "client.nom — corps, paragraphe 1" in sortie
    assert "== Filtres appliqués à un champ obligatoire (1)" in sortie
    assert "police.date_effet | date" in sortie
    filtres = sortie.split("== Filtres appliqués")[1].split("== Ce que le dépôt")[0]
    assert "taux_couverture" not in filtres  # facultatif (D19) : un champ vide passe dans le filtre sans arrêter la génération
    assert "Tahoma" in sortie
    # Les mêmes rejets que l'application au dépôt, dont les champs obligatoires du type.
    assert "REJET : Balise inconnue « client.nom »" in sortie
    assert "Champ obligatoire pour un modèle de conditions particulières absent" in sortie
    assert "dépôt REFUSÉ" in sortie


@avec_pont
def test_bloc_mal_ferme_est_signale_avec_sa_consequence(tmp_path: Path) -> None:
    chemin = ecrire(tmp_path, "bloc.docx", document("{{ police.numero }}", "{% if police.nantissement %}", "Nantissement"))
    sortie = lancer(chemin, "--type", "ANNEXE").stdout
    assert "== Blocs mal fermés (1)" in sortie and "endif" in sortie
    assert "ne sont pas relevées" in sortie  # l'analyse saute les balises d'une partie dont un bloc est mal fermé


@avec_pont
def test_champ_word_balise_coupee_et_case_sans_parentheses(tmp_path: Path) -> None:
    mot = ecrire(tmp_path, "champ.docx", avec_champ_word("Souscripteur : ", "souscripteur.nom"))
    sortie = lancer(mot, "--type", "ANNEXE").stdout
    assert "== Champs Word (Ctrl+F9) (1)" in sortie and "imite une balise" in sortie

    coupee = ecrire(tmp_path, "coupee.docx", avec_texte_supprime("Nom : {", "x", "{ souscripteur.nom }}"))
    sortie = lancer(coupee, "--type", "ANNEXE").stdout
    assert "== Balises coupées ou non fermées (1)" in sortie and "retapez-la d'un seul tenant" in sortie

    piege = ecrire(tmp_path, "case.docx", document('{{ risque.statut == "PROPRIETAIRE" | case }} Propriétaire'))
    sortie = lancer(piege, "--type", "ANNEXE").stdout
    assert "== Autres erreurs d'écriture dans les balises (1)" in sortie and "parenthèses" in sortie


@avec_pont
def test_un_modele_correct_est_accepte_et_la_liste_de_polices_de_l_image_est_prise_en_compte(tmp_path: Path) -> None:
    modele = ecrire(tmp_path, "annexe.docx", document("Assuré : {{ police.numero }}", police="Tahoma"))
    sans_liste = lancer(modele, "--type", "ANNEXE")
    assert sans_liste.returncode == 0 and "dépôt ACCEPTÉ" in sans_liste.stdout
    # Liste de l'image fournie (fc-list : family) : Tahoma absente, puis présente.
    absente = ecrire(tmp_path, "image1.txt", "Carlito\nLiberation Sans\n".encode())
    presente = ecrire(tmp_path, "image2.txt", "Carlito\nTahoma\nCambria\n".encode())  # Cambria : police par défaut de python-docx
    assert "absentes : Cambria, Tahoma" in lancer(modele, "--type", "ANNEXE", "--polices-image", absente).stdout
    assert "absentes : aucune" in lancer(modele, "--type", "ANNEXE", "--polices-image", presente).stdout
    assert "l'image du générateur (liste fournie)" in lancer(modele, "--type", "ANNEXE", "--polices-image", presente).stdout


@avec_pont
def test_liste_de_polices_ecrite_par_powershell_en_utf16(tmp_path: Path) -> None:
    modele = ecrire(tmp_path, "annexe.docx", document("{{ police.numero }}", police="Tahoma"))
    liste = ecrire(tmp_path, "image.txt", "Tahoma\nCambria\n".encode("utf-16"))  # « > » de Windows PowerShell : UTF-16 avec BOM
    assert "absentes : aucune" in lancer(modele, "--type", "ANNEXE", "--polices-image", liste).stdout


def test_rien_n_est_envoye_ni_stocke() -> None:
    """Le script n'importe ni le client HTTP ni le stockage du service, et n'écrit aucun fichier."""
    source = SCRIPT.read_text(encoding="utf-8")
    for interdit in ("httpx", "requests", "urllib", "socket", "app.stockage", "app.config", ".write_bytes(", ".write_text(", "open("):
        assert interdit not in source, interdit


def test_analyse_locale_du_modele_de_test_sans_pont() -> None:
    """Le script s'appuie sur la même `analyser()` que le service : un modèle correct n'a aucun problème."""
    assert analyser(document("{{ police.numero }}")).problemes == []
