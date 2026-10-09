from decimal import Decimal

import pytest

from app.filtres import ChampObligatoireVide, ErreurFiltre, Vide, case, date_fr, dateheure, lettres, montant, pct

NB = " "  # espace insécable


@pytest.mark.parametrize(
    ("valeur", "attendu"),
    [
        ("11592000", f"11{NB}592{NB}000"),
        (11592000, f"11{NB}592{NB}000"),
        ("15600000.00", f"15{NB}600{NB}000"),  # décimales nulles : non écrites
        ("1809.50", f"1{NB}809,50"),  # décimales reçues : écrites telles quelles, sans arrondi
        ("1809.495", f"1{NB}809,495"),
        ("999", "999"),
        ("0", "0"),
        ("-2898000", f"-2{NB}898{NB}000"),  # avoir
        (Decimal("288000"), f"288{NB}000"),
    ],
)
def test_montant(valeur: object, attendu: str) -> None:
    assert montant(valeur) == attendu


def test_montant_jamais_d_espace_ordinaire() -> None:
    # Une espace ordinaire laisserait « 300 » et « 000 » se séparer en fin de ligne.
    assert " " not in montant("11592000")


@pytest.mark.parametrize("valeur", [11592000.0, "11 592 000", "abc", None, True, "", "1e6"])
def test_montant_refuse_ce_qu_il_ne_sait_pas_ecrire(valeur: object) -> None:
    with pytest.raises(ErreurFiltre, match="montant"):
        montant(valeur)


def test_lettres() -> None:
    assert lettres("11592000") == "onze millions cinq cent quatre-vingt-douze mille francs CFA"
    assert lettres(288000) == "deux cent quatre-vingt-huit mille francs CFA"


def test_lettres_refuse_les_centimes_et_les_flottants() -> None:
    with pytest.raises(ErreurFiltre, match="entier"):
        lettres("1809.50")
    with pytest.raises(ErreurFiltre):
        lettres(1809.5)


def test_date_et_dateheure() -> None:
    assert date_fr("2026-09-01") == "01/09/2026"
    assert date_fr("2026-09-01T08:00") == "01/09/2026"
    assert dateheure("2026-09-01T08:00") == "01/09/2026 à 08h00"
    assert dateheure("2026-09-01T08:05:00Z") == "01/09/2026 à 08h05"  # Abidjan = UTC+0


@pytest.mark.parametrize("valeur", ["", None, "01/09/2026", "2026-13-01", 20260901])
def test_date_illisible(valeur: object) -> None:
    with pytest.raises(ErreurFiltre, match="date"):
        date_fr(valeur)


def test_dateheure_refuse_une_date_sans_heure() -> None:
    with pytest.raises(ErreurFiltre, match="heure absente"):
        dateheure("2026-09-01")


@pytest.mark.parametrize(
    ("valeur", "attendu"),
    [("80", f"80{NB}%"), ("80.000", f"80{NB}%"), ("1.5", f"1,5{NB}%"), (70, f"70{NB}%")],
)
def test_pct(valeur: object, attendu: str) -> None:
    assert pct(valeur) == attendu


def test_case() -> None:
    assert case(True) == "☒"
    assert case(False) == "☐"


@pytest.mark.parametrize("valeur", ["PROPRIETAIRE", "oui", 1])
def test_case_refuse_ce_qui_n_est_pas_un_booleen(valeur: object) -> None:
    with pytest.raises(ErreurFiltre, match="parenthèses"):
        case(valeur)


# Valeur vide (null ou texte vide) : la fusion la remplace par un Vide nommé (voir test_fusion.py).
FILTRES = {"montant": montant, "lettres": lettres, "date": date_fr, "dateheure": dateheure, "pct": pct, "case": case}


@pytest.mark.parametrize("nom", FILTRES)
@pytest.mark.parametrize("vide", [None, "", "  "], ids=["null", "texte_vide", "blanc"])
def test_valeur_vide(nom: str, vide: str | None) -> None:
    filtre = FILTRES[nom]
    assert filtre(Vide(vide, "formules[0].champ", facultatif=True)) == ""
    with pytest.raises(ChampObligatoireVide, match=rf"^champ obligatoire vide : « formules\[0\]\.champ » \(filtre {nom}\)$"):
        filtre(Vide(vide, "formules[0].champ", facultatif=False))
    # Appelé hors fusion, sans chemin : refusé quand même (jamais un blanc silencieux).
    with pytest.raises(ChampObligatoireVide, match=rf"filtre {nom}"):
        filtre(vide)
