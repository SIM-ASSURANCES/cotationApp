"""Lance le générateur avec l'adresse et le port de la configuration.

Depuis le dossier generateur/ :
    python -m app
Équivaut à « uvicorn app.main:app --host GENERATEUR_HOTE --port GENERATEUR_PORT ».
"""

import uvicorn

from app.config import ConfigurationInvalide, obtenir_parametres


def main() -> None:
    try:
        parametres = obtenir_parametres()
    except ConfigurationInvalide as erreur:
        raise SystemExit(str(erreur)) from None
    uvicorn.run("app.main:app", host=parametres.generateur_hote, port=parametres.generateur_port)


if __name__ == "__main__":
    main()
