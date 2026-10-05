"""Application FastAPI du générateur : création de l'application et inclusion des routes.

Lancement, depuis le dossier generateur/ :
    uvicorn app.main:app --host 127.0.0.1 --port 8001
ou, avec l'adresse et le port lus dans .env (GENERATEUR_HOTE, GENERATEUR_PORT) :
    python -m app
Documentation OpenAPI : http://127.0.0.1:8001/docs
"""

from fastapi import FastAPI

from app import __version__
from app.config import ConfigurationInvalide, obtenir_parametres
from app.routes import interne, sante


def creer_app() -> FastAPI:
    # Valide la configuration dès le démarrage : une erreur arrête le service tout de suite.
    obtenir_parametres()

    application = FastAPI(
        title="SIM Documents : générateur",
        version=__version__,
        description=(
            "Service interne de fusion des modèles Word, de conversion en PDF et "
            "d'assemblage. Il n'écoute que la machine locale ; les routes /interne "
            "exigent l'en-tête X-Generateur-Secret."
        ),
    )
    application.include_router(sante.router)
    application.include_router(interne.router)
    return application


try:
    app = creer_app()
except ConfigurationInvalide as erreur:
    # Message clair, sans trace Python ni valeur saisie.
    raise SystemExit(str(erreur)) from None
