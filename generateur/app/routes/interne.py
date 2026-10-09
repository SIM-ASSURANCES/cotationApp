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
from pypdf.errors import PdfReadError as PdfError

from app.analyse import Analyse, analyser
from app.config import Parametres, obtenir_parametres
from app.conversion import ConversionDelaiDepasse, ConversionEchouee
from app.fusion import LISTES_LONGUES, ErreurFusion, Image
from app.generation import generer_pdf
from app.lettres import MontantInvalide, montant_en_lettres
from app.securite import verifier_secret
from app import stockage

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
    images: dict[str, ImageDemandee] = Field(default={}, description="signature_sim, cachet_sim (qr_code : voir qr)")
    qr: "QrDemande | None" = Field(default=None, description="QR code de vérification, produit ici (image qr_code)")
    pieces_jointes: list[str] = Field(default=[], description="PDF (base64) ajoutés à la fin, dans l'ordre : CS, puis CG")
    filigrane: str | None = Field(default=None, max_length=40, description="Texte en diagonale sur chaque page (« EXPIRÉE »)")
    listes_en_annexe: list[str] = Field(
        default=[], description="Listes toujours renvoyées en annexe, même sous le seuil (police de groupe : adhérents)"
    )
    champs_facultatifs: list[str] = Field(
        default=[], description="Champs facultatifs du dictionnaire (D19, « police.reference ») : vides, ils s'écrivent vides même dans un filtre"
    )


class QrDemande(BaseModel):
    url: str = Field(min_length=10, max_length=500)
    largeur_mm: float = Field(default=25, gt=0, le=100)


DemandeDocument.model_rebuild()


@router.post(
    "/documents/pdf",
    summary="Fusionne un modèle avec des données et renvoie le PDF (corps, puis annexes)",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}, 422: {"description": "fusion impossible"}},
)
def document_pdf(demande: DemandeDocument, parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> Response:
    inconnues = sorted((set(demande.annexes) | set(demande.listes_en_annexe)) - set(LISTES_LONGUES))
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
            qr_url=demande.qr.url if demande.qr else None,
            qr_largeur_mm=demande.qr.largeur_mm if demande.qr else 25,
            pieces_jointes=[_decoder(p, "pièce jointe") for p in demande.pieces_jointes],
            filigrane=demande.filigrane,
            listes_en_annexe=tuple(demande.listes_en_annexe),
            champs_facultatifs=tuple(demande.champs_facultatifs),
        )
    except ErreurFusion as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    except ConversionDelaiDepasse:
        raise HTTPException(status_code=504, detail="conversion PDF trop longue : interrompue") from None
    except ConversionEchouee:
        raise HTTPException(status_code=502, detail="conversion PDF impossible (LibreOffice)") from None
    except PdfError:
        raise HTTPException(status_code=422, detail="pièce jointe illisible : ce n'est pas un PDF valide") from None
    return Response(content=pdf, media_type="application/pdf")


# ------------------------------------------------------------------ Stockage des documents émis (ajout seul)


class DemandeEcriture(BaseModel):
    chemin: str = Field(description="Chemin relatif, ex. RELAXSANTE/2026/10/COTATION/COT-2026-10-0001_v1.pdf")
    contenu: str = Field(description="Fichier, en base64")


class ReponseEcriture(BaseModel):
    chemin: str
    empreinte: str
    taille: int


@router.post("/stockage", summary="Stocke un document émis (jamais d'écrasement : 409 si le chemin existe)")
def stocker(demande: DemandeEcriture, parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> ReponseEcriture:
    contenu = _decoder(demande.contenu, "contenu")
    try:
        empreinte = stockage.ecrire(stockage.racine(parametres.dossier_sortie), demande.chemin, contenu)
    except stockage.CheminInvalide as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    except stockage.DejaStocke:
        raise HTTPException(status_code=409, detail="un document est déjà stocké à ce chemin : il n'est jamais écrasé") from None
    return ReponseEcriture(chemin=demande.chemin, empreinte=empreinte, taille=len(contenu))


@router.get("/stockage", summary="Lit un document stocké", response_class=Response)
def lire_stockage(chemin: str, parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> Response:
    try:
        contenu = stockage.lire(stockage.racine(parametres.dossier_sortie), chemin)
    except stockage.CheminInvalide as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    except stockage.Introuvable:
        raise HTTPException(status_code=404, detail="document introuvable dans le stockage") from None
    return Response(content=contenu, media_type="application/octet-stream")


class FichierZip(BaseModel):
    chemin: str
    nom: str


class DemandeZip(BaseModel):
    fichiers: list[FichierZip] = Field(min_length=1, max_length=500)


@router.post("/stockage/zip", summary="Archive ZIP de documents stockés", response_class=Response)
def zip_stockage(demande: DemandeZip, parametres: Annotated[Parametres, Depends(obtenir_parametres)]) -> Response:
    try:
        contenu = stockage.zipper(stockage.racine(parametres.dossier_sortie), [(f.chemin, f.nom) for f in demande.fichiers])
    except stockage.CheminInvalide as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    except stockage.Introuvable as erreur:
        raise HTTPException(status_code=404, detail=f"document introuvable dans le stockage : {erreur}") from None
    return Response(content=contenu, media_type="application/zip")
