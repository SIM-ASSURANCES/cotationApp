"""Routes internes, réservées à l'application : toutes exigent le secret partagé.

Les fichiers Word circulent en base64 dans du JSON : un seul format d'échange, sans dépendance
supplémentaire pour l'envoi de fichiers. Les montants sont des textes, jamais des nombres JSON à
virgule (un flottant est refusé par les filtres).
"""

import base64
import binascii
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.analyse import Analyse, analyser
from app.config import Parametres, obtenir_parametres
from app.conversion import ConversionDelaiDepasse, ConversionEchouee
from app.fusion import LISTES_LONGUES, ErreurFusion, Image
from app.generation import generer_pdf
from app.lettres import MontantInvalide, montant_en_lettres
from app.securite import verifier_secret

# Le secret est exigé au niveau du routeur : toute route ajoutée ici est protégée d'office.
router = APIRouter(prefix="/interne", tags=["interne"], dependencies=[Depends(verifier_secret)])


def _decoder(contenu: str, quoi: str) -> bytes:
    try:
        return base64.b64decode(contenu, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail=f"{quoi} : base64 invalide") from None


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


class DemandeAnalyse(BaseModel):
    modele: str = Field(description="Fichier .docx, en base64")


@router.post("/modeles/analyse", summary="Analyse d'un modèle Word au dépôt (faits relevés, sans décision)")
def analyse_modele(demande: DemandeAnalyse) -> Analyse:
    return analyser(_decoder(demande.modele, "modèle"))


class ImageDemandee(BaseModel):
    png: str = Field(description="Image PNG, en base64")
    largeur_mm: float = Field(gt=0, le=250)


class DemandeDocument(BaseModel):
    modele: str = Field(description="Modèle .docx, en base64")
    donnees: dict[str, Any] = Field(description="Données du dictionnaire (CDC §6.3), montants en texte")
    seuil_liste: int = Field(ge=1, description="Au-delà, une liste passe en annexe (CDC §6.5)")
    annexes: dict[str, str] = Field(default={}, description="Modèle d'annexe .docx (base64) par liste")
    sous_modeles: dict[str, dict[str, str]] = Field(
        default={}, description="Sous-modèles .docx (base64) de bloc(nom, clé) : {nom: {clé: docx}}"
    )
    images: dict[str, ImageDemandee] = Field(default={}, description="qr_code, signature_sim, cachet_sim")


@router.post(
    "/documents/pdf",
    summary="Fusionne un modèle avec des données et renvoie le PDF (corps, puis annexes)",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}, 422: {"description": "fusion impossible"}},
)
def document_pdf(demande: DemandeDocument, parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> Response:
    inconnues = sorted(set(demande.annexes) - set(LISTES_LONGUES))
    if inconnues:
        raise HTTPException(status_code=422, detail=f"liste sans annexe possible : {', '.join(inconnues)}")
    try:
        pdf = generer_pdf(
            parametres,
            _decoder(demande.modele, "modèle"),
            demande.donnees,
            seuil_liste=demande.seuil_liste,
            annexes={liste: _decoder(docx, f"annexe {liste}") for liste, docx in demande.annexes.items()},
            sous_modeles={
                nom: {cle: _decoder(docx, f"sous-modèle {nom}/{cle}") for cle, docx in par_cle.items()}
                for nom, par_cle in demande.sous_modeles.items()
            },
            images={nom: Image(_decoder(i.png, f"image {nom}"), i.largeur_mm) for nom, i in demande.images.items()},
        )
    except ErreurFusion as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    except ConversionDelaiDepasse:
        raise HTTPException(status_code=504, detail="conversion PDF trop longue : interrompue") from None
    except ConversionEchouee:
        raise HTTPException(status_code=502, detail="conversion PDF impossible (LibreOffice)") from None
    return Response(content=pdf, media_type="application/pdf")
