"""GET /sante : état du générateur, sans secret (appelé par /api/sante de l'application)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import __version__
from app.config import Parametres, obtenir_parametres

router = APIRouter(tags=["santé"])


class Sante(BaseModel):
    statut: Literal["ok"]
    version: str
    libreoffice_trouve: bool


@router.get("/sante", summary="État du générateur")
def sante(parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> Sante:
    # Vérifie seulement que l'exécutable existe : LibreOffice n'est pas lancé ici.
    return Sante(
        statut="ok",
        version=__version__,
        libreoffice_trouve=parametres.libreoffice_chemin.is_file(),
    )
