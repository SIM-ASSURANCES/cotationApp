"""Routes internes, réservées à l'application : toutes exigent le secret partagé."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.lettres import MontantInvalide, montant_en_lettres
from app.securite import verifier_secret

# Le secret est exigé au niveau du routeur : toute route ajoutée ici est protégée d'office.
router = APIRouter(prefix="/interne", tags=["interne"], dependencies=[Depends(verifier_secret)])


@router.get("/ping", summary="Vérifie le secret partagé")
def ping() -> dict[str, bool]:
    return {"pong": True}


class DemandeLettres(BaseModel):
    # Texte et non nombre : un montant ne passe jamais par un flottant JSON.
    montant: str


class ReponseLettres(BaseModel):
    lettres: str


@router.post("/montant-en-lettres", summary="Montant entier en francs CFA, en toutes lettres")
def montant_lettres(demande: DemandeLettres) -> ReponseLettres:
    try:
        return ReponseLettres(lettres=montant_en_lettres(demande.montant))
    except MontantInvalide as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
