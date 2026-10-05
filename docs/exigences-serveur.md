# Exigences pour le serveur

Fiche destinée à l'administrateur du serveur et au superviseur. Depuis la décision D5 (05/10/2026), la cible est un **VPS Linux avec Docker Compose** : les exigences du poste de développement Windows (compte de service Windows, imprimante par défaut, dossier partagé monté) ne s'appliquent plus au serveur.

## Ce que l'administrateur doit fournir

| Exigence | Détail | Statut |
| --- | --- | --- |
| Système | Linux 64 bits (distribution à préciser) ; VPS du portail RH | à confirmer |
| Docker | Docker Engine + plugin Compose v2 | à confirmer |
| Accès Internet sortant | à la construction : images Docker, paquets Debian, npm, PyPI, Google Fonts (Montserrat). À l'exécution : aucun | à confirmer |
| Proxy inverse HTTPS | certificat valide sur le domaine de l'application, transmission de `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` | à confirmer (Q1) |
| Pare-feu | ouvrir uniquement 80 et 443 | |
| Domaine | nom de domaine de l'application | à définir par le superviseur |
| Sauvegarde | base (quotidienne) et volume des documents ; copie hors VPS ; test de restauration trimestriel | à planifier |
| Polices des modèles | fichiers de polices (Tahoma notamment) à copier dans l'image : licence à confirmer | à confirmer (Q2) |
| Stockage des documents émis | volume persistant (`documents`) : **seul exemplaire** des contrats, plus de dossier partagé (D11) ; espace disque surveillé, sauvegarde automatique quotidienne copiée hors du VPS | à planifier |
| Flux vers le service public de vérification des QR codes | domaine stable valable 10 ans (CDC §14.1) | à définir (phase 3) |

## Constats du développement

- **Poste de développement** : Windows 11, Node 24.20.0, Python 3.14.7, PostgreSQL 18.6, LibreOffice 26.8.0.3.
- **Images Docker** : `node:24-bookworm-slim` (application), `python:3.14-slim-trixie` + LibreOffice Debian (générateur), `postgres:18-bookworm`, `redis:7-alpine`. Non construites à ce jour.
- **Le LibreOffice de l'image n'est pas celui du poste** (Debian, version plus ancienne que 26.8) : tout écart de rendu se détecte avec `generateur/scripts/test_fidelite.py`.
- **Polices** : Calibri et Arial sont remplacées dans l'image par Carlito et Liberation (mêmes dimensions). Tahoma et Segoe UI Symbol n'ont pas d'équivalent libre.
- **Générateur** : n'écoute que le réseau privé de Docker, aucun port publié. Délai maximal de conversion : `DELAI_CONVERSION_S` (60 s par défaut).
- **Redis** : présent dans `docker-compose.yml` pour la file de tâches de la phase 5 (génération en masse, relances). Rien ne l'utilise encore.
- **Ressources (processeur, mémoire, disque)** : à mesurer avec le test de charge T8 (500 certificats en moins de 15 minutes) ; non dimensionnées à ce jour.
