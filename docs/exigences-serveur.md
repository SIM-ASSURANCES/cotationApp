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

## À prévoir plus tard (hors du socle actuel)

- **File de tâches** pour la génération en masse (avis d'échéance, relances, certificats) : Celery ou RQ, avec Redis. Pas encore développée ; à prévoir sur le serveur.
