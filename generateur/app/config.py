"""Configuration du générateur.

Les valeurs viennent des variables d'environnement, puis du fichier generateur/.env.
Elles sont validées au démarrage : une valeur manquante ou invalide arrête le
service avec la liste des variables en faute. Aucune valeur par défaut
silencieuse, à part les trois défauts documentés ci-dessous et dans .env.example.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# generateur/.env, quel que soit le dossier depuis lequel le service est lancé.
FICHIER_ENV = Path(__file__).resolve().parent.parent / ".env"


class Parametres(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=FICHIER_ENV,
        env_file_encoding="utf-8",
        # « VARIABLE= » (valeur vide) compte comme une variable absente.
        env_ignore_empty=True,
        # Une variable inconnue dans .env (faute de frappe) est une erreur.
        extra="forbid",
    )

    # Obligatoires
    generateur_secret: SecretStr = Field(min_length=32)
    libreoffice_chemin: Path
    dossier_sortie: Path
    profil_libreoffice: Path

    # Défauts documentés
    delai_conversion_s: int = Field(default=60, gt=0)
    generateur_hote: str = Field(default="127.0.0.1", min_length=1)
    generateur_port: int = Field(default=8001, ge=1, le=65535)

    @field_validator("libreoffice_chemin", "dossier_sortie", "profil_libreoffice")
    @classmethod
    def chemin_absolu(cls, chemin: Path) -> Path:
        # Un chemin relatif dépendrait du dossier depuis lequel le service est lancé.
        if not chemin.is_absolute():
            raise ValueError("doit être un chemin absolu")
        return chemin


class ConfigurationInvalide(Exception):
    """Configuration absente ou invalide : le service ne doit pas démarrer."""


def _message(erreur: dict[str, Any]) -> str:
    """Message en français, qui ne reprend jamais la valeur saisie (elle peut être un secret)."""
    contexte = erreur.get("ctx") or {}
    match erreur["type"]:
        case "missing":
            return "obligatoire"
        case "extra_forbidden":
            return "variable inconnue (faute de frappe ?)"
        case "string_too_short" | "too_short":  # « too_short » : cas d'un SecretStr
            return f"doit contenir au moins {contexte['min_length']} caractères"
        case "value_error":
            return str(contexte.get("error", erreur["msg"]))
        case "int_parsing":
            return "doit être un nombre entier"
        case _:
            return erreur["msg"]


def charger_parametres(**valeurs: Any) -> Parametres:
    """Lit et valide la configuration ; lève ConfigurationInvalide en listant
    toutes les variables en faute."""
    try:
        return Parametres(**valeurs)
    except ValidationError as erreur:
        lignes = [
            f"  - {'.'.join(str(partie) for partie in e['loc']).upper()} : {_message(e)}"
            for e in erreur.errors(include_url=False, include_input=False)
        ]
        raise ConfigurationInvalide(
            "Configuration du générateur invalide : le service ne peut pas démarrer.\n"
            "Variables en faute (modèle commenté : generateur/.env.example) :\n"
            + "\n".join(lignes)
        ) from None


@lru_cache
def obtenir_parametres() -> Parametres:
    """Configuration validée, lue une seule fois (dépendance FastAPI)."""
    return charger_parametres()
