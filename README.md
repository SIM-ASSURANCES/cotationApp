# SIM Documents

Module de génération automatique des documents d'assurance de SIM Assurances CI : cotations, conditions particulières et générales, factures, avoirs, reçus, avis d'échéance et relances (cahier des charges v1.0 du 25/09/2026).

> **État : socle technique uniquement.** Aucune fonctionnalité métier n'est encore développée.

## Structure

| Dossier | Rôle |
| --- | --- |
| `app/` | Application TypeScript (Next.js) : back-office, moteur de calcul, API interne. |
| `generateur/` | Service Python (FastAPI) : fusion des modèles Word, conversion PDF, assemblage, QR code, empreinte. |
| `docs/` | Décisions, exigences pour le serveur, installation, déploiement. |

## Installation

Voir [docs/installation.md](docs/installation.md).

## Documentation

- [Décisions](docs/decisions.md) : choix d'architecture et de pile, décisions en attente.
- [Exigences pour le serveur](docs/exigences-serveur.md) : ce que l'administrateur doit préparer.
- [Guide de déploiement](docs/deploiement.md) : destiné à l'administrateur du serveur.

## Règles du dépôt

- Aucune donnée client, même en exemple : uniquement des données de test inventées.
- Aucun secret : seuls les fichiers `.env.example` sont versionnés.
- Montants : jamais de nombre à virgule flottante (voir la décision D3).
