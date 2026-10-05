# SIM Documents

Module de génération automatique des documents d'assurance de SIM Assurances CI : cotations, conditions particulières et générales, factures, avoirs, reçus, avis d'échéance et relances (cahier des charges v1.0 du 25/09/2026).

> **État : phase 0 terminée** (socle durci, Docker, connexion, profils et droits, journal d'audit). Aucune fonctionnalité métier (calcul, cotation, documents) n'est encore développée : voir le plan par phases.

## Structure

| Dossier | Rôle |
| --- | --- |
| `app/` | Application TypeScript : Next.js 16, Prisma 7, PostgreSQL. Back-office, moteur de calcul, API interne. Code découpé en couches : voir [app/README.md](app/README.md). |
| `generateur/` | Service Python (FastAPI) : fusion des modèles Word, conversion PDF, assemblage, QR code, empreinte. N'écoute que la machine locale. |
| `docs/` | CDC en texte, décisions, exigences pour le serveur, installation, déploiement, recette. |
| `docker-compose.yml` | Déploiement sur le VPS : application, générateur, PostgreSQL, Redis ([guide](docs/deploiement.md)). |

L'application appelle le générateur par HTTP, avec un secret partagé (en-tête `X-Generateur-Secret`).

## Installation

Guide complet, depuis zéro : [docs/installation.md](docs/installation.md).

Ensuite, au quotidien, dans deux terminaux :

```powershell
# Terminal 1 : application, sur http://localhost:3000
cd app
npm run dev

# Terminal 2 : générateur, sur http://127.0.0.1:8001 (documentation : /docs)
cd generateur
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

État des deux services : `curl.exe -s http://localhost:3000/api/sante`

## Vérifications

| Où | Commande |
| --- | --- |
| `app/` | `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` (base de test) |
| `generateur/` | `pytest` (environnement virtuel activé) |

## Documentation

- [Décisions](docs/decisions.md) : choix d'architecture et de pile, décisions en attente.
- [Exigences pour le serveur](docs/exigences-serveur.md) : ce que l'administrateur doit préparer.
- [Guide de déploiement](docs/deploiement.md) : VPS Linux, Docker Compose, destiné à l'administrateur.
- [Recette](docs/recette.md) : ce qui a été vérifié, et ce qui ne l'est pas encore.
- [Cahier des charges](docs/cdc.md) : conversion texte du CDC v1.0.

## Règles du dépôt

- Aucune donnée client, même en exemple : uniquement des données de test inventées.
- Aucun secret : seuls les fichiers `.env.example` sont versionnés.
- Montants : jamais de nombre à virgule flottante (voir la décision D3).
- Sur un serveur, la seule commande de migration autorisée est `npm run migrate:deploy`.
