# Guide de déploiement

Destiné à **l'administrateur du serveur**, qui réalise le déploiement.

> **Squelette.** Ce guide sera complété quand le système du serveur (Windows ou Linux) sera connu.

## 1. Prérequis

_À compléter._

## 2. Installation initiale

_À compléter._

## 3. Mise à jour

_À compléter._

## 4. Retour arrière

_À compléter._

## 5. Vérifications après déploiement

_À compléter._

## Éléments déjà établis (à intégrer aux sections ci-dessus)

- **Application, sans Docker** : `npm run build` produit un dossier autonome `app/.next/standalone/`, complété par `public/` et `.next/static/`. On le lance avec `node server.js` depuis ce dossier, sous forme de service Windows ou systemd. Les variables `PORT` et `HOSTNAME` règlent l'écoute ; par défaut, toutes les interfaces (`0.0.0.0`) sur le port 3000.
- **Secrets** : Next.js recopie dans `.next/standalone/` le fichier `.env` du poste qui a construit l'application. Il ne doit **jamais** être déployé tel quel : le serveur reçoit son propre `.env` de production, ou des variables d'environnement définies dans le service.
- **Base de données** : `npm run migrate:deploy` (`prisma migrate deploy`) est la **seule** commande de migration autorisée sur un serveur. Jamais `prisma migrate dev`, qui peut proposer de vider la base.
- **Démarrage** : si une variable obligatoire manque ou est invalide, l'application s'arrête aussitôt (code de sortie 1) en listant les variables en faute.
- **Contrôle** : `GET /api/sante` renvoie HTTP 200 et `{"statut":"ok","base":"ok","generateur":"ok"}` quand tout fonctionne, et HTTP 503 sinon.
- **Générateur** : installation par `pip install -r requirements.txt` dans un environnement virtuel ; lancement par `python -m app` depuis `generateur/`, qui lit l'adresse et le port dans `generateur/.env` (défaut : `127.0.0.1:8001`, machine locale uniquement). Prévoir `PYTHONUTF8=1` dans l'environnement du service. Contrôle : `GET http://127.0.0.1:8001/sante` doit indiquer `"libreoffice_trouve": true`.
- **Secret partagé** : `GENERATEUR_SECRET` doit être identique dans `app/.env` et `generateur/.env` ; un secret propre au serveur, jamais celui d'un poste de développement.
