"""Session 6.2b : modèles de test des produits tarifés par garanties (cotation, CP, facture). Données inventées.

Les lignes de prime sont celles que l'application envoie : une ligne par garantie, avec son taux ; le générateur ne
calcule rien. Chiffres des instructions de la phase 6.2 : Incendie 10 000 + 2 500 à 12,5 %, Vol 9 850 + 2 500 et
Dégât des eaux 6 000 + 2 500 à 7,25 %. La fusion est vérifiée sur le .docx produit ; le rendu PDF l'est par le test de
bout en bout de l'application (garanties.e2e.test.ts).
"""

from typing import Any

import pytest

from app.analyse import analyser
from app.fusion import ErreurFusion, fusionner
from tests.fabrique import texte_docx
from tests.fixtures.creer_fixtures import ICI
from tests.test_contrats_4a import IMAGES, donnees_cp
from tests.test_factures_4b import donnees_t2

NB = "\u00a0"  # espace insécable : celle que produisent les filtres montant et pct
# Champs que l'application déclare facultatifs (dictionnaire) : la liste de garanties et le taux global (vide dès qu'il y a plusieurs taux).
FACULTATIFS = {"garanties_souscrites", "prime.taux_taxe"}

GARANTIES = [
    {"libelle": "Incendie", "branche": "INCENDIE", "prime_nette": "10000", "accessoires": "2500", "taux_taxe": "12.5", "taxe": "1563", "ttc": "14063"},
    {"libelle": "Vol", "branche": "IARD", "prime_nette": "9850", "accessoires": "2500", "taux_taxe": "7.25", "taxe": "895", "ttc": "13245"},
    {"libelle": "Dégât des eaux", "branche": "IARD", "prime_nette": "6000", "accessoires": "2500", "taux_taxe": "7.25", "taxe": "616", "ttc": "9116"},
]
# Totaux : nette 25 850, accessoires 7 500, taxe 3 074, TTC 36 424 ; plusieurs taux, donc aucun taux global.
PRIME = {"nette": "25850", "accessoires": "7500", "base_taxe": "33350", "taux_taxe": None, "taxe": "3074", "ttc": "36424"}


def modele(nom: str) -> bytes:
    return (ICI / nom).read_bytes()


def fusion(nom: str, donnees: dict[str, Any]) -> str:
    return texte_docx(fusionner(modele(nom), donnees, seuil_liste=10, images=IMAGES, champs_facultatifs=FACULTATIFS).corps)


def donnees_facture(**autres: Any) -> dict[str, Any]:
    return donnees_t2(formules=[], garanties_souscrites=GARANTIES, prime=PRIME, **autres)


def donnees_cotation() -> dict[str, Any]:
    d = donnees_t2(formules=[], garanties_souscrites=GARANTIES, prime=PRIME)
    d["doc"] = {**d["doc"], "numero": "COT-2026-10-0001", "version": "v1", "date_validite": "2027-01-08"}
    d["police"] = {**d["police"], "duree_jours": 365}
    return d


def donnees_cp_garanties() -> dict[str, Any]:
    d = donnees_cp()
    d["produit"] = {**d["produit"], "libelle": "SECURPRO (inventé)"}
    d["garanties_souscrites"] = GARANTIES
    d["prime"] = PRIME
    return d


MODELES = {
    "cotation_garanties_test.docx": donnees_cotation,
    "cp_garanties_test.docx": donnees_cp_garanties,
    "facture_garanties_test.docx": donnees_facture,
}


@pytest.mark.parametrize("nom", MODELES)
def test_modeles_garanties_sans_probleme_et_citent_la_boucle(nom: str) -> None:
    a = analyser(modele(nom))
    assert a.problemes == []
    chemins = {r.chemin for r in a.references}
    assert {"garanties_souscrites", "garanties_souscrites[].libelle", "garanties_souscrites[].taux_taxe", "garanties_souscrites[].ttc"} <= chemins


@pytest.mark.parametrize("nom", MODELES)
def test_une_ligne_par_garantie_avec_son_taux_et_ses_totaux(nom: str) -> None:
    lignes = fusion(nom, MODELES[nom]()).split("\n")
    for libelle in ("Incendie", "Vol", "Dégât des eaux"):
        assert lignes.count(libelle) == 1, f"{nom} : {libelle} doit apparaître dans une seule cellule"
    # Taux propres à chaque ligne : 12,5 % pour l'incendie, 7,25 % pour les deux autres garanties.
    assert lignes.count(f"12,5{NB}%") == 1
    assert lignes.count(f"7,25{NB}%") == 2
    # Taxes et TTC de ligne ; totaux : 1 563 + 895 + 616 = 3 074 ; 14 063 + 13 245 + 9 116 = 36 424.
    for cellule in (f"1{NB}563", "895", "616", f"14{NB}063", f"13{NB}245", f"9{NB}116"):
        assert cellule in lignes, f"{nom} : {cellule} manquant"
    texte = "\n".join(lignes)
    assert f"36{NB}424" in texte and f"3{NB}074" in texte


def test_cp_plusieurs_taux_pas_de_parenthese_de_taux_global_vide() -> None:
    assert "taxe ()" not in fusion("cp_garanties_test.docx", donnees_cp_garanties())


def test_facture_taux_global_vide_quand_plusieurs_taux() -> None:
    # `prime.taux_taxe` est facultatif : vide, il s'écrit vide (aucune erreur de génération).
    assert "\nTaux de taxe unique : \n" in fusion("facture_garanties_test.docx", donnees_facture())


def test_facture_un_seul_taux_remplit_le_taux_global() -> None:
    seule = [GARANTIES[1]]
    prime = {"nette": "9850", "accessoires": "2500", "base_taxe": "12350", "taux_taxe": "7.25", "taxe": "895", "ttc": "13245"}
    texte = fusion("facture_garanties_test.docx", donnees_t2(formules=[], garanties_souscrites=seule, prime=prime))
    assert f"\nTaux de taxe unique : 7,25{NB}%\n" in texte


def test_sans_la_declaration_de_facultatif_le_taux_global_vide_arrete_la_fusion() -> None:
    # Garde-fou : c'est bien la liste des champs facultatifs de l'application qui rend le champ vide acceptable.
    with pytest.raises(ErreurFusion, match="prime.taux_taxe"):
        fusionner(modele("facture_garanties_test.docx"), donnees_facture(), seuil_liste=10, images=IMAGES, champs_facultatifs={"garanties_souscrites"})


def test_produit_a_la_formule_la_liste_des_garanties_vide_ne_produit_aucune_ligne() -> None:
    texte = fusion("facture_garanties_test.docx", donnees_t2(garanties_souscrites=[]))
    for libelle in ("Incendie", "Vol", "Dégât des eaux"):
        assert libelle not in texte
