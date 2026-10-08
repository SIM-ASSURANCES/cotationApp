"""Session 4a : contenu du CP (§10.1), tests T5 et T6, annexe imposée des polices de groupe (§10.2), certificat d'adhésion.

Données inventées. La fusion est vérifiée sur le .docx produit (sans LibreOffice) ; le rendu en PDF
(avec LibreOffice) l'est à part, et ignoré si LibreOffice est absent.

T6 est un test du DOCUMENT seul : les montants viennent d'une fixture, car l'application refuse de
calculer une cotation IARD tant que la branche fiscale et le taux mixte ne sont pas tranchés (H32).
"""

import copy
import io
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.config import charger_parametres
from app.fusion import ErreurFusion, Image, fusionner
from app.generation import generer_pdf
from tests.fabrique import PNG_1PX, texte_docx
from tests.fixtures.creer_fixtures import ICI
from tests.test_conversion import SOFFICE
from tests.test_generation import b64, pages, texte_lisible

NB = "\u00a0"  # espace insécable : celle que produisent les filtres montant et pct
IMAGES = {"qr_code": Image(PNG_1PX, 25), "signature_sim": Image(PNG_1PX, 30)}


def modele(nom: str) -> bytes:
    return (ICI / nom).read_bytes()


def donnees_cp() -> dict[str, Any]:
    """Données communes d'un CP (invention : aucune donnée réelle). Les montants sont des textes."""
    return {
        "doc": {"lieu_emission": "Abidjan", "date_emission": "2026-10-08", "url_verification": "https://documents.exemple.ci/verif/" + "k" * 43},
        "produit": {"libelle": "Sécur'Vie", "cg_libelle": "SECURVIE – Conditions générales", "cg_visa": "01497", "cg_date": "2024-03-15"},
        "souscripteur": {"type": "PHYSIQUE", "nom": "KOUADIO", "prenoms": "Awa", "raison_sociale": ""},
        "police": {"numero": "SECURVIE-2026-000001-I00001", "date_effet": "2026-01-01", "date_echeance": "2026-12-31", "duree_libelle": "12 mois"},
        "intermediaires": [{"nom": "Courtier Inventé", "code": "INT001"}],
        "prime": {"nette": "100000", "accessoires": "5000", "taux_taxe": "0", "taxe": "0", "ttc": "105000"},
        "societe": {"raison_sociale": "SIM Assurances Côte d'Ivoire", "rccm": "CI-ABJ-0000-B-00000", "email_reclamation": "reclamations@exemple.ci"},
    }


# ------------------------------------------------------------------ T5 : SECURVIE, trois bénéficiaires, branche DÉCÈS (taxe 0 %)


def donnees_t5() -> dict[str, Any]:
    d = donnees_cp()
    d["beneficiaires"] = [
        {"ordre": 1, "nom_prenoms": "KOUADIO Paul", "lien": "Conjoint", "contact": "0700000001", "quote_part": "50"},
        {"ordre": 2, "nom_prenoms": "KOUADIO Marie", "lien": "Enfant", "contact": "0700000002", "quote_part": "30"},
        {"ordre": 3, "nom_prenoms": "KOUADIO Jean", "lien": "Enfant", "contact": "0700000003", "quote_part": "20"},
    ]
    d["contacts_urgence"] = [{"nom_prenoms": "YAO Eric", "contact": "0700000009"}]
    d["formules"] = [{"libelle": "Standard", "code": "STANDARD"}]
    return d


SOUS_MODELES_T5 = {"garanties": {"STANDARD": modele("garanties_securvie_standard.docx")}}


def cp_t5(donnees: dict[str, Any] | None = None, **options: Any) -> str:
    resultat = fusionner(modele("cp_securvie_test.docx"), donnees or donnees_t5(), seuil_liste=10, sous_modeles=SOUS_MODELES_T5, images=IMAGES, **options)
    return texte_docx(resultat.corps)


def test_t5_trois_beneficiaires_repetes_dans_le_tableau() -> None:
    lignes = cp_t5().splitlines()
    i = lignes.index("Bénéficiaires du capital décès :")
    # Cinq colonnes : en-tête, puis trois lignes répétées (une par bénéficiaire), dans l'ordre saisi.
    tableau = lignes[i + 1 : i + 1 + 5 * 4]
    assert tableau[:5] == ["N°", "Nom et prénoms", "Lien", "Contact", "Quote-part"]
    assert tableau[5:10] == ["1", "KOUADIO Paul", "Conjoint", "0700000001", f"50{NB}%"]
    assert tableau[10:15] == ["2", "KOUADIO Marie", "Enfant", "0700000002", f"30{NB}%"]
    assert tableau[15:20] == ["3", "KOUADIO Jean", "Enfant", "0700000003", f"20{NB}%"]
    assert "Personne à prévenir : YAO Eric (0700000009)" in lignes


def test_t5_les_garanties_viennent_du_sous_modele_de_la_formule() -> None:
    texte = cp_t5()
    for garantie in ("Décès toutes causes", "Invalidité permanente totale", "Frais funéraires", "5 000 000", "500 000"):
        assert garantie in texte


def test_t5_branche_deces_taxe_nulle_et_bloc_des_primes_complet() -> None:
    texte = cp_t5()
    assert f"nette 100{NB}000 ; accessoires 5{NB}000 ; taxe (0{NB}%) 0 ; TOTAL TTC 105{NB}000 F CFA, soit cent cinq mille francs CFA." in texte


def test_t5_le_visa_du_cp_est_celui_des_cg() -> None:
    """Le visa cité par le CP (clause de composition du contrat) et celui des CG sont la même donnée : 01497."""
    donnees = donnees_t5()
    assert "conditions générales SECURVIE – Conditions générales, visa 01497, forment le contrat." in cp_t5(donnees)
    cg = texte_docx(fusionner(modele("cg_test.docx"), donnees, seuil_liste=10).corps)
    assert "Visa : 01497 du 15/03/2024" in cg


def test_t5_clause_de_reclamation_lieu_date_et_signature() -> None:
    texte = cp_t5()
    assert "toute réclamation s'adresse à reclamations@exemple.ci" in texte
    assert "Fait à Abidjan, le 08/10/2026." in texte
    assert "Pour SIM Assurances :" in texte
    corps = fusionner(modele("cp_securvie_test.docx"), donnees_t5(), seuil_liste=10, sous_modeles=SOUS_MODELES_T5, images=IMAGES).corps
    with zipfile.ZipFile(io.BytesIO(corps)) as archive:
        # Deux images insérées (signature_sim et QR code) : le fichier PNG est le même ici, donc un seul fichier de médias.
        assert archive.read("word/document.xml").count(b"<wp:inline") == 2


def test_t5_sans_signature_sim_la_fusion_est_refusee() -> None:
    with pytest.raises(ErreurFusion, match="donnée absente : « signature_sim »"):
        fusionner(modele("cp_securvie_test.docx"), donnees_t5(), seuil_liste=10, sous_modeles=SOUS_MODELES_T5, images={"qr_code": Image(PNG_1PX, 25)})


def test_t5_une_liste_de_beneficiaires_saisie_vide_ecrit_un_tableau_vide() -> None:
    """D19 option b : un champ saisi mais laissé vide s'écrit vide (le CP reste émis), il ne bloque pas."""
    donnees = donnees_t5()
    donnees["beneficiaires"] = []
    donnees["contacts_urgence"] = []
    texte = cp_t5(donnees)
    assert "KOUADIO Paul" not in texte and "Personne à prévenir" not in texte
    assert "Bénéficiaires du capital décès :" in texte


def test_t5_beneficiaires_jamais_fournis_la_fusion_nomme_la_donnee_absente() -> None:
    donnees = donnees_t5()
    del donnees["beneficiaires"]
    with pytest.raises(ErreurFusion, match="beneficiaires"):
        cp_t5(donnees)


# ------------------------------------------------------------------ T6 : VOL (IARD), cases à cocher, date d'émission dynamique


def donnees_t6(**risque: str) -> dict[str, Any]:
    """Montants d'une fixture (document seul) : pas de calcul IARD tant que H32 n'est pas tranchée."""
    d = donnees_cp()
    d["produit"] = {"libelle": "Vol", "cg_libelle": "VOL – Conditions générales", "cg_visa": "01234", "cg_date": "2024-03-15"}
    d["prime"] = {"nette": "80000", "accessoires": "5000", "taux_taxe": "14.5", "taxe": "12325", "ttc": "97325"}
    d["risque"] = {"capital_vol_caisse": "100000", "gardiennage": "NUIT", "statut": "LOCATAIRE", **risque}
    return d


def cp_t6(donnees: dict[str, Any]) -> list[str]:
    return texte_docx(fusionner(modele("cp_vol_test.docx"), donnees, seuil_liste=10, images=IMAGES).corps).splitlines()


def test_t6_les_bonnes_cases_sont_cochees() -> None:
    lignes = cp_t6(donnees_t6())
    assert f"Vol caisse, capital garanti : ☒ 100 000 F   ☐ 250 000 F   ☐ 500 000 F" in lignes
    assert "Gardiennage : ☐ Jour   ☒ Nuit   ☐ Jour et nuit" in lignes
    assert "Statut de l'assuré : ☐ Propriétaire   ☒ Locataire" in lignes


def test_t6_une_autre_saisie_deplace_les_cases() -> None:
    lignes = cp_t6(donnees_t6(capital_vol_caisse="500000", gardiennage="JOUR_NUIT", statut="PROPRIETAIRE"))
    assert f"Vol caisse, capital garanti : ☐ 100 000 F   ☐ 250 000 F   ☒ 500 000 F" in lignes
    assert "Gardiennage : ☐ Jour   ☐ Nuit   ☒ Jour et nuit" in lignes
    assert "Statut de l'assuré : ☒ Propriétaire   ☐ Locataire" in lignes


def test_t6_valeur_hors_liste_ne_coche_rien() -> None:
    lignes = cp_t6(donnees_t6(gardiennage="JAMAIS"))
    assert "Gardiennage : ☐ Jour   ☐ Nuit   ☐ Jour et nuit" in lignes


def test_t6_la_date_d_emission_est_dynamique() -> None:
    premiere, seconde = donnees_t6(), donnees_t6()
    seconde["doc"]["date_emission"] = "2026-11-15"
    assert any("Fait à Abidjan, le 08/10/2026." in l for l in cp_t6(premiere))
    assert any("Fait à Abidjan, le 15/11/2026." in l for l in cp_t6(seconde))


def test_t6_montants_de_la_fixture_tels_quels() -> None:
    texte = "\n".join(cp_t6(donnees_t6()))
    assert f"nette 80{NB}000 ; accessoires 5{NB}000 ; taxe (14,5{NB}%) 12{NB}325 ; TOTAL TTC 97{NB}325 F CFA" in texte


# ------------------------------------------------------------------ Police de groupe : liste des adhérents toujours en annexe (§10.2)


def adherents(n: int) -> list[dict[str, Any]]:
    return [{"ordre": i, "nom_prenoms": f"ADHERENT{i:02d} Inventé", "date_naissance": "1990-01-01", "formule": "SOLO"} for i in range(1, n + 1)]


def test_police_mere_trois_adherents_renvoyes_en_annexe_malgre_le_seuil() -> None:
    donnees = {**donnees_cp(), "assures": adherents(3)}
    resultat = fusionner(modele("cp_groupe_test.docx"), donnees, seuil_liste=10, annexes={"assures": modele("annexe_assures.docx")}, images=IMAGES, listes_en_annexe=["assures"])
    corps = texte_docx(resultat.corps)
    assert "Voir annexe – Liste des assurés (3 personnes)" in corps and "ADHERENT01" not in corps
    assert [a.liste for a in resultat.annexes] == ["assures"]
    annexe = texte_docx(resultat.annexes[0].docx)
    assert all(f"ADHERENT0{i} Inventé" in annexe for i in (1, 2, 3))


def test_une_nouvelle_version_de_l_annexe_remplace_la_liste() -> None:
    """Incorporation / retrait : on régénère avec la liste courante, l'adhérent retiré n'y figure plus."""
    donnees = {**donnees_cp(), "assures": [a for a in adherents(4) if a["ordre"] != 2]}
    resultat = fusionner(modele("cp_groupe_test.docx"), donnees, seuil_liste=10, annexes={"assures": modele("annexe_assures.docx")}, images=IMAGES, listes_en_annexe=["assures"])
    annexe = texte_docx(resultat.annexes[0].docx)
    assert "ADHERENT02" not in annexe and "ADHERENT04 Inventé" in annexe
    assert "Voir annexe – Liste des assurés (3 personnes)" in texte_docx(resultat.corps)


# ------------------------------------------------------------------ Certificat d'adhésion unitaire (§10.2)


def donnees_certificat() -> dict[str, Any]:
    return {
        "doc": {"lieu_emission": "Abidjan", "date_emission": "2026-10-08", "url_verification": "https://documents.exemple.ci/verif/" + "c" * 43},
        "police": {"numero": "SECURVIE-2026-000001-G00001", "police_mere": "SECURVIE-2026-000001-G00001", "date_effet": "2026-06-15", "date_echeance": "2026-12-31"},
        "souscripteur": {"raison_sociale": "ENTREPRISE INVENTÉE SA"},
        "societe": {"raison_sociale": "SIM Assurances Côte d'Ivoire"},
        "assures": [{"ordre": 3, "nom_prenoms": "ADHERENT03 Inventé", "date_naissance": "1992-02-02", "formule": "SOLO"}],
    }


def test_certificat_porte_la_police_mere_l_adherent_et_son_propre_qr() -> None:
    resultat = fusionner(modele("certificat_test.docx"), donnees_certificat(), seuil_liste=10, images=IMAGES)
    texte = texte_docx(resultat.corps)
    assert "CERTIFICAT D'ADHÉSION n° SECURVIE-2026-000001-G00001" in texte
    assert "Police mère n° SECURVIE-2026-000001-G00001 – souscripteur : ENTREPRISE INVENTÉE SA" in texte
    assert "Adhérent n° 3 : ADHERENT03 Inventé, né(e) le 02/02/1992, formule SOLO" in texte
    assert "Date d'adhésion : 15/06/2026 ; fin de la période de la police : 31/12/2026" in texte
    assert "Prime" not in texte  # H36 : pas de prime sur le certificat (pas de partage des accessoires inventé)
    with zipfile.ZipFile(io.BytesIO(resultat.corps)) as archive:
        assert any(n.startswith("word/media/") for n in archive.namelist())


def test_certificat_sans_police_mere_est_refuse() -> None:
    donnees = copy.deepcopy(donnees_certificat())
    del donnees["police"]["police_mere"]
    with pytest.raises(ErreurFusion, match="donnée absente : « police.police_mere »"):
        fusionner(modele("certificat_test.docx"), donnees, seuil_liste=10, images=IMAGES)


# ------------------------------------------------------------------ Route : listes imposées en annexe


def test_route_liste_imposee_inconnue_refusee(client: TestClient, secret_test: str) -> None:
    reponse = client.post(
        "/interne/documents/pdf",
        headers={"X-Generateur-Secret": secret_test},
        json={"modele": b64(modele("cp_groupe_test.docx")), "donnees": donnees_cp(), "seuil_liste": 10, "listes_en_annexe": ["beneficiaires_inconnus"]},
    )
    assert reponse.status_code == 422
    assert "liste sans annexe possible : beneficiaires_inconnus" in reponse.json()["detail"]


# ------------------------------------------------------------------ Rendu PDF (LibreOffice)

sans_libreoffice = pytest.mark.skipif(SOFFICE is None, reason="LibreOffice absent")


@pytest.fixture
def parametres(tmp_path: Path):  # type: ignore[no-untyped-def]
    assert SOFFICE is not None
    return charger_parametres(_env_file=None, libreoffice_chemin=SOFFICE, dossier_sortie=tmp_path / "sortie", profil_libreoffice=tmp_path / "profil", delai_conversion_s=120)


@sans_libreoffice
@texte_lisible
def test_t5_pdf_complet(parametres) -> None:  # type: ignore[no-untyped-def]
    pdf = generer_pdf(parametres, modele("cp_securvie_test.docx"), donnees_t5(), seuil_liste=10, sous_modeles=SOUS_MODELES_T5, images=IMAGES)
    texte = "\n".join(pages(pdf))
    for attendu in ("KOUADIO Paul", "KOUADIO Marie", "KOUADIO Jean", "50 %", "30 %", "20 %", "Décès toutes causes", "visa 01497", "taxe (0 %) 0", "reclamations@exemple.ci", "Fait à Abidjan, le 08/10/2026"):
        assert attendu in texte, attendu


@sans_libreoffice
@texte_lisible
def test_t6_pdf_une_case_cochee_par_ligne(parametres) -> None:  # type: ignore[no-untyped-def]
    pdf = generer_pdf(parametres, modele("cp_vol_test.docx"), donnees_t6(), seuil_liste=10, images=IMAGES)
    lignes = "\n".join(pages(pdf)).splitlines()
    for debut, cochees, vides in (("Vol caisse", 1, 2), ("Gardiennage", 1, 2), ("Statut de l'assuré", 1, 1)):
        ligne = next(l for l in lignes if l.startswith(debut))
        assert ligne.count("☒") == cochees and ligne.count("☐") == vides, ligne


@sans_libreoffice
@texte_lisible
def test_police_mere_pdf_annexe_apres_le_corps(parametres) -> None:  # type: ignore[no-untyped-def]
    donnees = {**donnees_cp(), "assures": adherents(3)}
    pdf = generer_pdf(parametres, modele("cp_groupe_test.docx"), donnees, seuil_liste=10, annexes={"assures": modele("annexe_assures.docx")}, images=IMAGES, listes_en_annexe=("assures",))
    contenu = pages(pdf)
    assert len(contenu) >= 2
    assert "Voir annexe" in contenu[0] and "ADHERENT01" not in contenu[0]
    assert "ADHERENT01 Inventé" in contenu[-1] and "ADHERENT03 Inventé" in contenu[-1]
    assert len(PdfReader(io.BytesIO(pdf)).pages) == len(contenu)
