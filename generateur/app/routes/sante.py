"""GET /sante : état du générateur, sans secret (appelé par /api/sante de l'application)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import __version__
from app.config import Parametres, obtenir_parametres
from app.polices import POLICES_REQUISES, Resolveur, familles_installees, polices_absentes, resolution_fontconfig

router = APIRouter(tags=["santé"])


class Sante(BaseModel):
    # « degrade » : le service répond mais ne peut pas produire un PDF fidèle (LibreOffice absent,
    # ou police indispensable absente). L'application traduit tout statut autre que « ok » par
    # generateur: "ko".
    statut: Literal["ok", "degrade"]
    version: str
    libreoffice_trouve: bool
    # Polices indispensables ni installées ni couvertes par un remplaçant libre autorisé (D69) ; None si la liste des
    # polices est impossible à obtenir.
    polices_manquantes: list[str] | None


def obtenir_familles() -> frozenset[str] | None:
    """Dépendance remplaçable dans les tests."""
    return familles_installees()


def obtenir_resolveur() -> Resolveur:
    """Dépendance remplaçable dans les tests : ce que fontconfig retient pour une police demandée (`fc-match`)."""
    return resolution_fontconfig


@router.get("/sante", summary="État du générateur")
def sante(
    parametres: Annotated[Parametres, Depends(obtenir_parametres)],
    familles: Annotated[frozenset[str] | None, Depends(obtenir_familles)],
    resolveur: Annotated[Resolveur, Depends(obtenir_resolveur)],
) -> Sante:
    # Vérifie seulement que l'exécutable existe : LibreOffice n'est pas lancé ici.
    libreoffice_trouve = parametres.libreoffice_chemin.is_file()
    manquantes = None if familles is None else polices_absentes(POLICES_REQUISES, familles, resolveur)
    en_forme = libreoffice_trouve and manquantes == []
    return Sante(
        statut="ok" if en_forme else "degrade",
        version=__version__,
        libreoffice_trouve=libreoffice_trouve,
        polices_manquantes=manquantes,
    )
