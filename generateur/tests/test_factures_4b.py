"""Session 4b : modèles de test de facture, d'avoir et de reçu (CDC §11, §12). Données inventées.

Les données sont celles que l'application envoie (montants en texte, déjà calculés par le moteur) : le générateur ne
calcule rien. La fusion est vérifiée sur le .docx produit ; le rendu PDF est vérifié par le test de bout en bout de
l'application.
"""

from typing import Any

from app.analyse import analyser
from app.fusion import Image, fusionner
from tests.fabrique import PNG_1PX, texte_docx
from tests.fixtures.creer_fixtures import ICI

NB = " "
IMAGES = {"qr_code": Image(PNG_1PX, 25), "signature_sim": Image(PNG_1PX, 30)}


def modele(nom: str) -> bytes:
    return (ICI / nom).read_bytes()


def donnees_t2(**autres: Any) -> dict[str, Any]:
    """T2 (CDC §16.1) : facture de groupe, 4 échéances, aucune encore payée."""
    d: dict[str, Any] = {
        "doc": {"numero": "FAC-2026-10-0001", "version": "v1", "lieu_emission": "Abidjan", "date_emission": "2026-10-08", "url_verification": "https://documents.exemple.ci/verif/" + "f" * 43},
        "produit": {"libelle": "RELAXSANTE 80 % (inventé)"},
        "police": {"numero": "RLX-2026-000001-G00001", "date_souscription": "2025-12-15", "date_effet": "2026-01-01", "date_echeance": "2026-12-31"},
        "souscripteur": {"type": "MORALE", "nom": "", "prenoms": "", "raison_sociale": "CGE-SN (inventée)", "adresse": "Plateau, rue inventée"},
        "envoye_a": None,
        # assures[].prime (H45) : TTC d'une unité de la formule, fourni par l'application.
        "assures": [{"ordre": 1, "nom_prenoms": "Assuré 1 Inventé", "date_naissance": "1990-01-01", "formule": "SOLO", "prime": "240000"}, {"ordre": 9, "nom_prenoms": "Assuré 9 Inventé", "date_naissance": "1985-05-05", "formule": "FAMILLE", "prime": "312000"}],
        "formules": [
            {"libelle": "Solo", "effectif": 8, "prime_nette": "1891626", "taxe": "28374", "ttc": "1920000"},
            {"libelle": "Famille", "effectif": 31, "prime_nette": "9529064", "taxe": "142936", "ttc": "9672000"},
        ],
        "prime": {"nette": "11420690", "accessoires": "0", "taux_taxe": "1.5", "taxe": "171310", "ttc": "11592000"},
        "echeances": [{"numero": n, "date": f"2026-{m:02d}-01", "montant": "2898000", "statut": "Non payé"} for n, m in ((1, 1), (2, 4), (3, 7), (4, 10))],
        "paiements": [],
        "solde": {"total_paye": "0", "restant_du": "11592000"},
        "societe": {
            "raison_sociale": "SIM Assurances Côte d'Ivoire",
            "rccm": "CI-ABJ-0000-B-00000",
            "ncc": "0000000A",
            "rib": [{"banque": "Banque inventée", "numero": "CI000 00000 000000000000 00"}],
            "mobile_money": [{"operateur": "Opérateur inventé", "numero_marchand": "000000"}],
        },
    }
    d.update(autres)
    return d


def facture(donnees: dict[str, Any]) -> str:
    return texte_docx(fusionner(modele("facture_test.docx"), donnees, seuil_liste=10, images=IMAGES).corps)


def test_modeles_4b_sans_probleme_et_contenu_obligatoire_present() -> None:
    f = analyser(modele("facture_test.docx"))
    assert f.problemes == []
    assert "lettres" in f.filtres
    assert any("CIMA" in t.texte for t in f.textes)
    chemins = {r.chemin for r in f.references}
    assert {"police.numero", "souscripteur.adresse", "prime.taux_taxe", "prime.ttc", "societe.rib[].numero", "societe.mobile_money[].numero_marchand", "echeances[].statut", "solde.restant_du", "envoye_a.nom", "signature_sim", "qr_code"} <= chemins
    assert {"doc.facture_origine", "prime.ttc", "qr_code"} <= {r.chemin for r in analyser(modele("avoir_test.docx")).references}
    assert {"paiements[].montant", "doc.facture_origine", "solde.restant_du"} <= {r.chemin for r in analyser(modele("recu_test.docx")).references}


def test_t2_montants_lettres_echeances_et_police() -> None:
    t = facture(donnees_t2())
    assert "Police n° RLX-2026-000001-G00001" in t
    assert f"Total HT : 11{NB}420{NB}690 ; accessoires : 0 ; taxe (1,5{NB}%) : 171{NB}310" in t
    assert f"Total TTC : 11{NB}592{NB}000 F CFA, soit onze millions cinq cent quatre-vingt-douze mille francs CFA." in t
    echeances = [l for l in t.splitlines() if l.startswith("Échéance")]
    assert len(echeances) == 4
    assert all(f"2{NB}898{NB}000 F CFA – Non payé" in l for l in echeances)
    assert "Facturé à : CGE-SN (inventée), Plateau, rue inventée" in t
    assert "Article 13 du Code CIMA" in t
    assert "Virement : Banque inventée" in t and "Mobile Money : Opérateur inventé" in t


def test_blocs_conditionnels_envoye_a_et_paiements_masques_quand_vides() -> None:
    t = facture(donnees_t2())
    assert "Envoyé à" not in t
    assert "Restant dû" not in t and "Paiement " not in t
    t = facture(donnees_t2(envoye_a={"nom": "Service comptable (inventé)", "adresse": "Cocody"}))
    assert "Envoyé à : Service comptable (inventé), Cocody" in t


def test_facture_v2_apres_paiement_echeance_payee_et_restant_du() -> None:
    d = donnees_t2(
        paiements=[{"numero": "REC-2026-10-0001", "date": "2026-10-08", "montant": "2898000", "canal": "Virement", "reference": "VIR-1", "payeur": "CGE-SN", "restant_du": "8694000"}],
        solde={"total_paye": "2898000", "restant_du": "8694000"},
    )
    d["echeances"][0]["statut"] = "Payé"
    d["doc"]["version"] = "v2"
    t = facture(d)
    assert "(v2)" in t
    assert [l.rsplit("– ", 1)[1] for l in t.splitlines() if l.startswith("Échéance")] == ["Payé", "Non payé", "Non payé", "Non payé"]
    assert f"Paiement REC-2026-10-0001 du 08/10/2026 : 2{NB}898{NB}000 F CFA (Virement)" in t
    assert f"Restant dû : 8{NB}694{NB}000 F CFA" in t


def test_avoir_montants_negatifs_et_facture_d_origine() -> None:
    d = donnees_t2(prime={"nette": "-120633", "accessoires": "0", "taux_taxe": "1.5", "taxe": "-1809", "ttc": "-122442"})
    d["doc"].update(numero="AV-2026-10-0001", facture_origine="FAC-2026-10-0007")
    t = texte_docx(fusionner(modele("avoir_test.docx"), d, seuil_liste=10, images=IMAGES).corps)
    assert "AVOIR n° AV-2026-10-0001 – annule la facture FAC-2026-10-0007" in t
    assert f"TTC -122{NB}442 F CFA" in t


def test_t3_recu_du_paiement_de_41_000_avec_restant_du() -> None:
    d = donnees_t2(
        prime={"nette": "120633", "accessoires": "0", "taux_taxe": "1.5", "taxe": "1809", "ttc": "122442"},
        souscripteur={"type": "PHYSIQUE", "nom": "YAO", "prenoms": "Koffi (inventé)", "raison_sociale": "", "adresse": "Cocody"},
        paiements=[{"numero": "REC-2026-10-0001", "date": "2026-10-08", "montant": "41000", "canal": "Espèces", "reference": "", "payeur": "YAO Koffi (inventé)", "restant_du": "81442"}],
        solde={"total_paye": "41000", "restant_du": "81442"},
    )
    d["doc"].update(numero="REC-2026-10-0001", facture_origine="FAC-2026-10-0002")
    t = texte_docx(fusionner(modele("recu_test.docx"), d, seuil_liste=10, images=IMAGES).corps)
    assert "REÇU n° REC-2026-10-0001 – facture FAC-2026-10-0002" in t
    assert f"Reçu de YAO Koffi (inventé), le 08/10/2026 : 41{NB}000 F CFA, soit quarante et un mille francs CFA" in t
    assert f"Total payé : 41{NB}000 F CFA ; restant dû : 81{NB}442 F CFA" in t


def test_facture_de_groupe_detail_par_assure_en_annexe() -> None:
    resultat = fusionner(modele("facture_test.docx"), donnees_t2(), seuil_liste=10, images=IMAGES, annexes={"assures": modele("annexe_assures.docx")}, listes_en_annexe=["assures"])
    corps = texte_docx(resultat.corps)
    assert "Assuré 1 Inventé" not in corps
    assert [a.liste for a in resultat.annexes] == ["assures"]
    assert "Assuré 9 Inventé" in texte_docx(resultat.annexes[0].docx)
    sans_annexe = facture(donnees_t2())
    assert f"Assuré 9 Inventé\nFAMILLE\n312{NB}000" in sans_annexe
