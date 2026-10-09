"""Fusion d'un modèle avec des données (sans LibreOffice : on lit le .docx produit)."""

import io
import zipfile

import pytest

from app.fusion import ErreurFusion, Image, fusionner
from tests.fabrique import PNG_1PX, document, texte_docx

NB = " "


def assures(n: int) -> list[dict[str, str]]:
    return [{"ordre": str(i), "nom_prenoms": f"ASSURE{i:02d} Inventé", "date_naissance": "1990-01-01"} for i in range(1, n + 1)]


CP_ASSURES = document(
    "Conditions particulières – police {{ police.numero }}",
    [
        ["N°", "Nom et prénoms", "Naissance"],
        ["{%tr for a in assures %}", "", ""],
        ["{{ a.ordre }}", "{{ a.nom_prenoms }}", "{{ a.date_naissance | date }}"],
        ["{%tr endfor %}", "", ""],
    ],
    "Nombre d'assurés : {{ assures | length }}",
)
ANNEXE_ASSURES = document(
    "Annexe – Liste des assurés de la police {{ police.numero }}",
    [
        ["N°", "Nom et prénoms"],
        ["{%tr for a in assures %}", ""],
        ["{{ a.ordre }}", "{{ a.nom_prenoms }}"],
        ["{%tr endfor %}", ""],
    ],
)


def corps(modele: bytes, donnees: dict, **options) -> str:  # type: ignore[no-untyped-def,type-arg]
    return texte_docx(fusionner(modele, donnees, seuil_liste=options.pop("seuil_liste", 10), **options).corps)


def test_valeurs_et_filtres() -> None:
    texte = corps(
        document(
            "{{ souscripteur.nom }} {{ souscripteur.prenoms }}",
            "TTC : {{ prime.ttc | montant }} ({{ prime.ttc | lettres }})",
            "Effet : {{ police.date_effet | dateheure }} ; taux : {{ formule.taux_couverture | pct }}",
            "{{ (risque.statut == 'PROPRIETAIRE') | case }} Propriétaire {{ (risque.statut == 'LOCATAIRE') | case }} Locataire",
        ),
        {
            "souscripteur": {"nom": "KOUADIO", "prenoms": "Awa"},
            "prime": {"ttc": "11592000"},
            "police": {"date_effet": "2026-09-01T08:00"},
            "formule": {"taux_couverture": "80.000"},
            "risque": {"statut": "LOCATAIRE"},
        },
    )
    assert "KOUADIO Awa" in texte
    assert f"TTC : 11{NB}592{NB}000 (onze millions cinq cent quatre-vingt-douze mille francs CFA)" in texte
    assert f"Effet : 01/09/2026 à 08h00 ; taux : 80{NB}%" in texte
    assert "☐ Propriétaire ☒ Locataire" in texte


def test_donnee_absente_nommee_par_son_chemin() -> None:
    with pytest.raises(ErreurFusion, match=r"donnée absente : « souscripteur\.prenoms »"):
        corps(document("{{ souscripteur.nom }} {{ souscripteur.prenoms }}"), {"souscripteur": {"nom": "KOUADIO"}})
    with pytest.raises(ErreurFusion, match=r"« assures\[0\]\.date_naissance »"):
        corps(document("{%p for a in assures %}", "{{ a.date_naissance }}", "{%p endfor %}"), {"assures": [{"nom_prenoms": "X"}]})
    with pytest.raises(ErreurFusion, match=r"« police »"):
        corps(document("{{ police.numero }}"), {})


def test_donnee_vide_ecrite_vide() -> None:
    assert corps(document("Courriel : [{{ souscripteur.email }}]"), {"souscripteur": {"email": None}}) == "Courriel : []"


# ------------------------------------------------------------------ Valeur vide dans un filtre (D19)

# Pour chaque filtre : un champ obligatoire et un champ facultatif (du point de vue de ce test), dans
# une liste pour vérifier que le message donne le rang de l'élément (« formules[0]… »).
FILTRES_VIDES = [
    ("montant", "formules[].prime_nette"),
    ("lettres", "formules[].prime_ttc"),
    ("date", "formules[].date_effet"),
    ("dateheure", "formules[].date_emission"),
    ("pct", "formules[].taux_couverture"),
    ("case", "formules[].incluse"),
]


@pytest.mark.parametrize(("filtre", "champ"), FILTRES_VIDES, ids=[f for f, _ in FILTRES_VIDES])
@pytest.mark.parametrize("vide", [None, ""], ids=["null", "texte_vide"])
def test_filtre_sur_un_champ_vide(filtre: str, champ: str, vide: str | None) -> None:
    nom = champ.removeprefix("formules[].")
    modele = document("{%p for f in formules %}", f"[{{{{ f.{nom} | {filtre} }}}}]", "{%p endfor %}")
    donnees = {"formules": [{nom: vide}]}
    # Obligatoire : la génération s'arrête et nomme le champ, avec le rang de l'élément.
    with pytest.raises(ErreurFusion) as erreur:
        corps(modele, donnees)
    assert str(erreur.value) == f"champ obligatoire vide : « formules[0].{nom} » (filtre {filtre})"
    # Facultatif (D19) : chaîne vide.
    assert corps(modele, donnees, champs_facultatifs=[champ]) == "[]"


def test_filtre_sur_un_champ_facultatif_hors_liste() -> None:
    modele = document("Référence : [{{ police.reference | date }}]")
    assert corps(modele, {"police": {"reference": None}}, champs_facultatifs=["police.reference"]) == "Référence : []"


def test_tous_les_champs_manquants_nommes_d_un_coup() -> None:
    modele = document(
        "{{ souscripteur.nom }} {{ souscripteur.profession }}",
        "Effet : {{ police.date_effet | date }} ; émis le {{ doc.date_emission | dateheure }}",
        "{%p for f in formules %}",
        "{{ f.code }} : {{ f.taux_couverture | pct }} {{ f.prime_ttc | montant }}",
        "{%p endfor %}",
        "Référence : {{ police.reference | date }} ; rappel : {{ police.date_effet | date }}",
    )
    donnees = {
        "souscripteur": {"nom": "KOUADIO"},
        "police": {"date_effet": None, "reference": None},
        "doc": {"date_emission": ""},
        "formules": [{"code": "SOLO", "taux_couverture": "80", "prime_ttc": "96000"}, {"code": "FAMILLE", "taux_couverture": None}],
    }
    with pytest.raises(ErreurFusion) as erreur:
        corps(modele, donnees, champs_facultatifs=["police.reference"])
    assert str(erreur.value) == (
        "5 points à corriger : donnée absente : « souscripteur.profession » ; "
        "champ obligatoire vide : « police.date_effet » (filtre date) ; "
        "champ obligatoire vide : « doc.date_emission » (filtre dateheure) ; "
        "champ obligatoire vide : « formules[1].taux_couverture » (filtre pct) ; "
        "donnée absente : « formules[1].prime_ttc »"
    )


def test_donnees_manquantes_de_l_annexe_nommees_avec_celles_du_corps() -> None:
    donnees = {"police": {}, "assures": [{"ordre": "1", "nom_prenoms": "X", "date_naissance": None}]}
    with pytest.raises(ErreurFusion) as erreur:
        corps(CP_ASSURES, donnees, annexes={"assures": ANNEXE_ASSURES}, listes_en_annexe=["assures"])
    assert str(erreur.value) == "donnée absente : « police.numero »"  # corps et annexe : un seul message par champ


def test_valeur_null_reste_none_dans_les_conditions() -> None:
    modele = document(
        "{% if police.nantissement %}gagé{% else %}libre{% endif %}",
        "{% if police.nantissement is none %}aucun{% endif %} {% if police.nantissement == None %}égal{% endif %}",
        "{% if souscripteur.email is none %}NON{% else %}OUI{% endif %} [{{ souscripteur.email | upper }}]",
    )
    texte = corps(modele, {"police": {"nantissement": None}, "souscripteur": {"email": ""}})
    assert texte == "libre\naucun égal\nOUI []"


def test_caracteres_speciaux_echappes() -> None:
    # Sans autoescape, « < » et « & » produiraient un XML invalide (document illisible).
    texte = corps(document("{{ souscripteur.raison_sociale }}"), {"souscripteur": {"raison_sociale": "A & B <SARL>"}})
    assert texte == "A & B <SARL>"


def test_montant_flottant_refuse() -> None:
    with pytest.raises(ErreurFusion, match="montant"):
        corps(document("{{ prime.ttc | montant }}"), {"prime": {"ttc": 288000.0}})


def test_bac_a_sable() -> None:
    with pytest.raises(ErreurFusion, match="interdite|absente"):
        corps(document("{{ souscripteur.__class__.__mro__ }}"), {"souscripteur": {}})


def test_bloc_insere_le_sous_modele_de_la_formule() -> None:
    sous_modele = document("Garanties de la formule {{ souscripteur.nom }}", [["Garantie", "Plafond"], ["Hospitalisation", "80 %"]])
    texte = corps(
        document("Avant", "{%p for f in formules %}", '{{ bloc("garanties", f.code) }}', "{%p endfor %}", "Après"),
        {"formules": [{"code": "SOLO"}], "souscripteur": {"nom": "KOUADIO"}},
        sous_modeles={"garanties": {"SOLO": sous_modele}},
    )
    lignes = texte.splitlines()
    assert lignes[0] == "Avant"
    assert "Garanties de la formule KOUADIO" in lignes
    assert "Hospitalisation" in lignes
    assert lignes[-1] == "Après"


def test_bloc_introuvable() -> None:
    with pytest.raises(ErreurFusion, match="sous-modèle « garanties » introuvable pour « FAMILLE »"):
        corps(document('{{ bloc("garanties", formule.code) }}'), {"formule": {"code": "FAMILLE"}}, sous_modeles={"garanties": {}})


def test_image() -> None:
    resultat = fusionner(document("QR : {{ qr_code }}"), {}, seuil_liste=10, images={"qr_code": Image(PNG_1PX, 25)})
    with zipfile.ZipFile(io.BytesIO(resultat.corps)) as archive:
        assert any(nom.startswith("word/media/") for nom in archive.namelist())


# ------------------------------------------------------------------ T7 : listes longues


def test_t7_liste_courte_reste_dans_le_corps() -> None:
    resultat = fusionner(CP_ASSURES, {"police": {"numero": "POL-2026-000001"}, "assures": assures(10)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES})
    texte = texte_docx(resultat.corps)
    assert "ASSURE10 Inventé" in texte
    assert "Voir annexe" not in texte
    assert resultat.annexes == []


def test_t7_liste_longue_renvoyee_en_annexe() -> None:
    """T7 : 25 assurés, seuil 10 : renvoi dans le corps, liste complète dans l'annexe."""
    resultat = fusionner(CP_ASSURES, {"police": {"numero": "POL-2026-000001"}, "assures": assures(25)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES})
    texte = texte_docx(resultat.corps)
    assert "Voir annexe – Liste des assurés (25 personnes)" in texte
    assert "ASSURE01" not in texte
    assert "Nombre d'assurés : 25" in texte  # la liste reste entière pour le reste du document
    assert [a.liste for a in resultat.annexes] == ["assures"]
    annexe = texte_docx(resultat.annexes[0].docx)
    assert "Annexe – Liste des assurés de la police POL-2026-000001" in annexe
    assert all(f"ASSURE{i:02d} Inventé" in annexe for i in range(1, 26))


def test_t7_seuil_parametrable() -> None:
    resultat = fusionner(CP_ASSURES, {"police": {"numero": "P"}, "assures": assures(25)}, seuil_liste=30, annexes={"assures": ANNEXE_ASSURES})
    assert resultat.annexes == []
    assert "ASSURE25" in texte_docx(resultat.corps)


def test_t7_sans_modele_d_annexe() -> None:
    with pytest.raises(ErreurFusion, match="aucun modèle d'annexe pour « assures »"):
        fusionner(CP_ASSURES, {"police": {"numero": "P"}, "assures": assures(25)}, seuil_liste=10)


def test_t7_boucle_de_paragraphes() -> None:
    modele = document("Assurés :", "{%p for a in assures %}", "- {{ a.nom_prenoms }}", "{%p endfor %}", "Fin")
    resultat = fusionner(modele, {"police": {"numero": "P"}, "assures": assures(12)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES})
    assert texte_docx(resultat.corps).splitlines() == ["Assurés :", "Voir annexe – Liste des assurés (12 personnes)", "Fin"]


def test_t7_boucle_dans_une_ligne_de_texte_non_prise_en_charge() -> None:
    modele = document("Assurés : {% for a in assures %}{{ a.nom_prenoms }}, {% endfor %}")
    with pytest.raises(ErreurFusion, match="ne peut pas être remplacée"):
        fusionner(modele, {"assures": assures(12)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES})


# ------------------------------------------------------------------ Session 4a : liste imposée en annexe (police de groupe, §10.2)


def test_liste_imposee_en_annexe_meme_sous_le_seuil() -> None:
    """Police mère : la liste des adhérents est toujours en annexe, même courte (3 adhérents, seuil 10)."""
    resultat = fusionner(
        CP_ASSURES,
        {"police": {"numero": "POL-2026-000001"}, "assures": assures(3)},
        seuil_liste=10,
        annexes={"assures": ANNEXE_ASSURES},
        listes_en_annexe=["assures"],
    )
    texte = texte_docx(resultat.corps)
    assert "Voir annexe – Liste des assurés (3 personnes)" in texte
    assert "ASSURE01" not in texte
    assert [a.liste for a in resultat.annexes] == ["assures"]
    assert all(f"ASSURE0{i} Inventé" in texte_docx(resultat.annexes[0].docx) for i in (1, 2, 3))


def test_liste_imposee_sans_boucle_dans_le_modele_ne_produit_pas_d_annexe() -> None:
    resultat = fusionner(document("Police {{ police.numero }}"), {"police": {"numero": "P"}, "assures": assures(3)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES}, listes_en_annexe=["assures"])
    assert resultat.annexes == []


def test_liste_imposee_sans_modele_d_annexe() -> None:
    with pytest.raises(ErreurFusion, match="renvoyée en annexe : aucun modèle d'annexe pour « assures »"):
        fusionner(CP_ASSURES, {"police": {"numero": "P"}, "assures": assures(3)}, seuil_liste=10, listes_en_annexe=["assures"])


def test_liste_non_imposee_reste_dans_le_corps_sous_le_seuil() -> None:
    resultat = fusionner(CP_ASSURES, {"police": {"numero": "P"}, "assures": assures(3)}, seuil_liste=10, annexes={"assures": ANNEXE_ASSURES}, listes_en_annexe=["beneficiaires"])
    assert "ASSURE03 Inventé" in texte_docx(resultat.corps)
    assert resultat.annexes == []
