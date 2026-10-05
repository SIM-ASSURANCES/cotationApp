"""Protection des routes internes par le secret partagé avec l'application."""

import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.config import Parametres, obtenir_parametres

# auto_error=False : un en-tête absent est traité plus bas, exactement comme un mauvais secret.
en_tete_secret = APIKeyHeader(name="X-Generateur-Secret", auto_error=False)


def verifier_secret(
    secret_recu: Annotated[str | None, Security(en_tete_secret)],
    parametres: Annotated[Parametres, Depends(obtenir_parametres)],
) -> None:
    """Exige l'en-tête X-Generateur-Secret, sinon répond 401 sans détail.

    hmac.compare_digest compare en temps constant : la durée de la réponse ne
    révèle rien sur le secret. La comparaison porte sur des octets, ce qui évite
    l'erreur que lève compare_digest sur des chaînes non ASCII.
    """
    attendu = parametres.generateur_secret.get_secret_value().encode()
    recu = (secret_recu or "").encode()
    if not hmac.compare_digest(recu, attendu):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
