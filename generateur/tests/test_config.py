from pathlib import Path

import pytest

from app.config import ConfigurationInvalide, charger_parametres

# _env_file=None : ces tests ignorent le fichier .env du poste.
SANS_FICHIER_ENV = {"_env_file": None}


def test_configuration_complete_acceptee_avec_les_defauts_documentes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Seules les variables obligatoires restent définies : les défauts s'appliquent.
    for variable in ("DELAI_CONVERSION_S", "GENERATEUR_HOTE", "GENERATEUR_PORT"):
        monkeypatch.delenv(variable)

    parametres = charger_parametres(**SANS_FICHIER_ENV)

    assert parametres.delai_conversion_s == 60
    assert parametres.generateur_hote == "127.0.0.1"
    assert parametres.generateur_port == 8001


def test_secret_trop_court_refuse_sans_afficher_sa_valeur() -> None:
    secret_court = "secret-trop-court-31-caracteres"
    assert len(secret_court) == 31

    with pytest.raises(ConfigurationInvalide) as erreur:
        charger_parametres(**SANS_FICHIER_ENV, generateur_secret=secret_court)

    message = str(erreur.value)
    assert "GENERATEUR_SECRET : doit contenir au moins 32 caractères" in message
    assert secret_court not in message


def test_variable_obligatoire_absente_refusee(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LIBREOFFICE_CHEMIN")

    with pytest.raises(ConfigurationInvalide, match="LIBREOFFICE_CHEMIN : obligatoire"):
        charger_parametres(**SANS_FICHIER_ENV)


def test_valeur_vide_traitee_comme_absente(monkeypatch: pytest.MonkeyPatch) -> None:
    # Sans cette règle, « DOSSIER_SORTIE= » deviendrait le dossier courant (Path("")).
    monkeypatch.setenv("DOSSIER_SORTIE", "")

    with pytest.raises(ConfigurationInvalide, match="DOSSIER_SORTIE : obligatoire"):
        charger_parametres(**SANS_FICHIER_ENV)


def test_chemin_relatif_refuse() -> None:
    with pytest.raises(ConfigurationInvalide, match="PROFIL_LIBREOFFICE : doit être un chemin absolu"):
        charger_parametres(**SANS_FICHIER_ENV, profil_libreoffice=Path("profil"))


def test_variable_inconnue_dans_le_fichier_env_refusee(tmp_path: Path) -> None:
    fichier_env = tmp_path / ".env"
    fichier_env.write_text("GENERATEUR_SECRT=faute-de-frappe\n", encoding="utf-8")

    with pytest.raises(ConfigurationInvalide, match="GENERATEUR_SECRT : variable inconnue"):
        charger_parametres(_env_file=fichier_env)


def test_conversions_simultanees_bornees() -> None:
    # Phase 5 : 2 par défaut (VPS partagé avec le portail RH), de 1 à 16.
    base = {"libreoffice_chemin": Path("/usr/bin/soffice").resolve(), "dossier_sortie": Path("/tmp").resolve(), "profil_libreoffice": Path("/tmp/p").resolve()}
    assert charger_parametres(**SANS_FICHIER_ENV, **base).conversions_simultanees == 2
    with pytest.raises(ConfigurationInvalide, match="CONVERSIONS_SIMULTANEES : doit être au moins 1"):
        charger_parametres(**SANS_FICHIER_ENV, **base, conversions_simultanees=0)
    with pytest.raises(ConfigurationInvalide, match="CONVERSIONS_SIMULTANEES : doit être au plus 16"):
        charger_parametres(**SANS_FICHIER_ENV, **base, conversions_simultanees=17)
