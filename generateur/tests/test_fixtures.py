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
    assert [(b.nom, b.cle) for b in analyse.blocs] == [("garanties", "formules[].code")]


def test_fixtures_des_pieges() -> None:
    t9 = analyser((ICI / "t9_balise_inconnue.docx").read_bytes())
    assert "client.nom" in {r.chemin for r in t9.references}
    champ = analyser((ICI / "champ_word.docx").read_bytes())
    assert [c.instruction for c in champ.champs_word] == ["souscripteur.nom"]
    cg = analyser((ICI / "cg_test.docx").read_bytes())
    assert {r.chemin for r in cg.references} == {"produit.cg_libelle", "produit.cg_visa", "produit.cg_date"}
