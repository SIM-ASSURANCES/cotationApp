"""Les modèles de test de tests/fixtures/ sont à jour et jouent leur rôle (recréés par code)."""

from app.analyse import analyser
from tests.fixtures.creer_fixtures import FIXTURES, ICI
from tests.fabrique import texte_docx


def test_fixtures_a_jour() -> None:
    # Le texte (et non les octets : python-docx date le fichier) doit être celui que le code produit.
    for nom, contenu in FIXTURES.items():
        assert texte_docx((ICI / nom).read_bytes()) == texte_docx(contenu), f"{nom} : relancer python -m tests.fixtures.creer_fixtures"


def test_cp_de_test_sans_probleme() -> None:
    analyse = analyser((ICI / "cp_test.docx").read_bytes())
    assert analyse.problemes == []
    assert {"assures[].nom_prenoms", "formules[].code", "prime.ttc", "police.nantissement.beneficiaire"} <= {r.chemin for r in analyse.references}
    # Contenu obligatoire du §10.1 (4a) : durée, intermédiaires, CG et visa, réclamation, signature SIM.
    assert {"police.duree_libelle", "intermediaires[].nom", "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.date_emission", "signature_sim"} <= {r.chemin for r in analyse.references}
    assert [(b.nom, b.cle) for b in analyse.blocs] == [("garanties", "formules[].code")]


def test_fixtures_des_pieges() -> None:
    t9 = analyser((ICI / "t9_balise_inconnue.docx").read_bytes())
    assert "client.nom" in {r.chemin for r in t9.references}
    champ = analyser((ICI / "champ_word.docx").read_bytes())
    assert [c.instruction for c in champ.champs_word] == ["souscripteur.nom"]
    cg = analyser((ICI / "cg_test.docx").read_bytes())
    assert {r.chemin for r in cg.references} == {"produit.cg_libelle", "produit.cg_visa", "produit.cg_date"}


def test_fixtures_de_la_4a_sans_probleme() -> None:
    attendu = {
        "cp_securvie_test.docx": {"beneficiaires[].quote_part", "contacts_urgence[].contact", "produit.cg_visa", "signature_sim"},
        "cp_vol_test.docx": {"risque.capital_vol_caisse", "risque.gardiennage", "risque.statut", "doc.date_emission"},
        "cp_groupe_test.docx": {"assures[].formule", "police.duree_libelle"},
        "certificat_test.docx": {"police.police_mere", "assures[].ordre", "qr_code"},
    }
    for nom, references in attendu.items():
        analyse = analyser((ICI / nom).read_bytes())
        assert analyse.problemes == [], nom
        assert references <= {r.chemin for r in analyse.references}, nom
    sous_modele = analyser((ICI / "garanties_securvie_standard.docx").read_bytes())
    assert sous_modele.problemes == [] and sous_modele.references == []
    assert [(b.nom, b.cle) for b in analyser((ICI / "cp_securvie_test.docx").read_bytes()).blocs] == [("garanties", "formules[].code")]
