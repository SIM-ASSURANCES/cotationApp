# Exigences pour le serveur

Fiche destinée à l'administrateur du serveur et au superviseur. Elle est tenue à jour au fil du développement, et non le jour du déploiement, pour que le serveur soit prêt à temps.

> **À compléter** : recopier ici le tableau du tableur du 05/10/2026.

| Exigence | Détail | Statut |
| --- | --- | --- |
| | | |

## Constats du développement (à reporter dans le tableau)

- **Node.js 24 (LTS)** pour l'application : version exigée par `app/package.json` (poste de développement : 24.20.0).
- **PostgreSQL** : poste de développement en version 18.6.
- **Accès HTTPS sortant pendant l'installation** : paquets npm (`registry.npmjs.org`) et moteur de migration de Prisma, téléchargé depuis `binaries.prisma.sh` au premier usage (un miroir interne est possible avec la variable `PRISMA_ENGINES_MIRROR`).
- **Port de l'application** : 3000 par défaut, réglable avec les variables `PORT` et `HOSTNAME`.
- **Python 3.14** pour le générateur (poste de développement : 3.14.7) et **LibreOffice** (poste de développement : 26.8).
- **Générateur** : il n'écoute que la machine locale (`127.0.0.1`, port 8001 par défaut), donc aucun port à ouvrir pour lui.
- **Compte de service du générateur** : droit d'écriture sur le dossier de sortie (`DOSSIER_SORTIE`) et sur le dossier du profil LibreOffice dédié (`PROFIL_LIBREOFFICE`), deux dossiers hors du code.
- **Journaux en UTF-8** : définir `PYTHONUTF8=1` pour le service du générateur, sinon Python 3.14 écrit ses journaux en cp1252 sous Windows (accents illisibles).

## À prévoir plus tard (hors du socle actuel)

- **File de tâches** pour la génération en masse (avis d'échéance, relances, certificats) : Celery ou RQ, avec Redis. Pas encore développée ; à prévoir sur le serveur.
