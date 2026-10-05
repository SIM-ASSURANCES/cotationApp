"""Routes internes, réservées à l'application : toutes exigent le secret partagé."""

from fastapi import APIRouter, Depends

from app.securite import verifier_secret

# Le secret est exigé au niveau du routeur : toute route ajoutée ici est protégée d'office.
router = APIRouter(prefix="/interne", tags=["interne"], dependencies=[Depends(verifier_secret)])


@router.get("/ping", summary="Vérifie le secret partagé")
def ping() -> dict[str, bool]:
    return {"pong": True}
