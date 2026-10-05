# SIM Documents

Module de génération automatique des documents d'assurance de SIM Assurances CI : cotations, conditions particulières et générales, factures, avoirs, reçus, avis d'échéance et relances (cahier des charges v1.0 du 25/09/2026).

> **État : socle technique uniquement.** Les deux services démarrent, se surveillent et sont testés ; aucune fonctionnalité métier n'est encore développée.

## Structure

| Dossier | Rôle |
| --- | --- |
| `app/` | Application TypeScript : Next.js 16, Prisma 7, PostgreSQL. Back-office, moteur de calcul, API interne. Code découpé en couches : voir [app/README.md](app/README.md). |
| `generateur/` | Service Python (FastAPI) : fusion des modèles Word, conversion PDF, assemblage, QR code, empreinte. N'écoute que la machine locale. |
| `docs/` | Décisions, exigences pour le serveur, installation, déploiement. |

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
| `app/` | `npm run typecheck`, `npm run lint`, `npm test` |
| `generateur/` | `pytest` (environnement virtuel activé) |

## Documentation

- [Décisions](docs/decisions.md) : choix d'architecture et de pile, décisions en attente.
- [Exigences pour le serveur](docs/exigences-serveur.md) : ce que l'administrateur doit préparer.
- [Guide de déploiement](docs/deploiement.md) : destiné à l'administrateur du serveur.

## Règles du dépôt

- Aucune donnée client, même en exemple : uniquement des données de test inventées.
- Aucun secret : seuls les fichiers `.env.example` sont versionnés.
- Montants : jamais de nombre à virgule flottante (voir la décision D3).
- Sur un serveur, la seule commande de migration autorisée est `npm run migrate:deploy`.
