# SIM Documents

Module de génération des documents d'assurance de SIM Assurances CI : cotations, conditions particulières et générales, certificats d'adhésion, factures, avoirs, reçus, avis d'échéance et relances.
Il calcule les primes, numérote, produit des PDF signés d'un QR code de vérification et archive chaque version, à partir de modèles Word paramétrables.
Référence : cahier des charges v1.0 du 25/09/2026 ([docs/cdc.md](docs/cdc.md)).

## État

Phases livrées, regroupées par lot du CDC (§17). Chaque phase a son compte rendu (voir « Documentation »).

| Lot du CDC | Phase | Contenu |
| --- | --- | --- |
| Lot 1, socle | 0 | Connexion, droits paramétrables, journal d'audit en ajout seul |
| Lot 1, socle | 3a | Bibliothèque de modèles Word, contrôles au dépôt, fusion, filtres, listes longues en annexe |
| Lot 1, socle | 3b | Émission : assemblage CP + annexes + CS + CG, QR code, page de vérification, empreinte, stockage, réédition à l'identique |
| Lot 2, calcul et cotation | 1 | Paramétrage historisé des produits et des taxes, moteur de calcul en décimal |
| Lot 2, calcul et cotation | 2 | Cotation : forçage, double validation, numérotation sans trou, expiration, transformation en police |
| Lot 2 et 3 | 4.0 | Branches fiscales paramétrables, type de contrat, accessoires saisis, compléments du dictionnaire |
| Lot 3, contrat et facture | 4a | Contrats complets (bénéficiaires, contacts d'urgence), contrats de groupe, certificats, validation du contrat |
| Lot 3, contrat et facture | 4b | Factures, avoirs, paiements, reçus, échéancier |
| Lot 4, masse et relances | 5a | Import en masse, file de tâches BullMQ et travailleur, stockage indisponible |
| Lot 4, masse et relances | 5b | Avis d'échéance, relances, tableaux de bord |
| Corrections | 6.0 | Réponses de la Technique : avoir sur facture payée, avance (trop-perçu), régime de taxe, numéros de certificat, intermédiaires, tâches d'import |
| Corrections | 6.1 | Échéances payées en partie (statut « Partiellement payé »), avertissement sur les avances d'une facture annulée, script et guide de balisage des modèles réels |
| Refonte visuelle | V1 | Apparence du portail RH : tokens, bibliothèque d'interface, coquille (barre latérale, barre du haut), connexion et page publique de vérification (D30) |

Cas de test du CDC (§16) :

| Cas | Objet | Statut |
| --- | --- | --- |
| T1 | Cotation santé BENI | test automatisé (moteur, base, bout en bout) et recette manuelle sur Docker |
| T2 | Facture groupe CGE-SN | test automatisé |
| T3 | Facture individuelle YAO (prorata) | test automatisé ; taux de 1,5 % pris comme cas particulier (H30, fermée) |
| T4 | Correction de facture par avoir | test automatisé, y compris sur T3 payée en partie (session 6.0) |
| T5 | SECURVIE, 3 bénéficiaires | test automatisé (bout en bout) |
| T6 | CP VOL, cases à cocher | **écart** : le document est testé seul (cases à cocher, date d'émission), avec des montants de test ; depuis la 6.2b, un produit IARD se tarife par garanties : la prime est composée par la Technique (D32), l'incendie à 12,5 % et les autres dommages à 7,25 % (H32 fermée), testé de la composition à la facture |
| T7 | Liste de plus de 10 assurés | test automatisé |
| T8 | Génération en masse (500 adhérents) | test automatisé (temps mesuré : [docs/recette.md](docs/recette.md)) |
| T9 | Modèle avec balise inconnue | test automatisé |
| T10 | Régénération historique | test automatisé |
| T11 | Cotation expirée | test automatisé |
| T12 | QR code d'une facture annulée | test automatisé |
| T13 | Double validation | test automatisé |
| T14 | Stockage indisponible | **adapté** (D11 : plus de dossier partagé), test automatisé |

Ce qui a été vérifié dans le navigateur : [docs/recette-manuelle.md](docs/recette-manuelle.md). Détail des tests : [docs/recette.md](docs/recette.md).

## Écarts avec le CDC (à présenter au superviseur)

- Validation des cotations, des contrats et des factures par la Technique seule ; la Direction Générale ne valide pas ([D21](docs/decisions.md#d21--choix-de-mise-en-œuvre-de-la-session-40-à-valider-par-thierry), H44, H56).
- Comptabilité en « Lecture » sur le paramétrage : la valeur « Proposition » est retirée (D21).
- Droit « Consulter les tableaux de bord », ajouté au tableau des droits du CDC §4 ([D25](docs/decisions.md#d25--avis-déchéance-relances-tableaux-de-bord-session-5b)).
- Dossier partagé réseau remplacé par un volume persistant sur le VPS ([D11](docs/decisions.md#d11--plus-de-dossier-partagé--stockage-sur-volume-persistant)) ; T14 adapté en conséquence.
- File de tâches BullMQ au lieu de Celery/RQ, cité en exemple par le CDC ([D24](docs/decisions.md#d24--file-de-tâches-bullmq-import-en-masse-stockage-indisponible-session-5a)).
- Âges limites ajoutés au paramétrage des formules (H62) ; référentiel des intermédiaires (D28).

## Hypothèses ouvertes

18 sujets restent en attente (hypothèses H… à faire confirmer, questions au superviseur) : voir la section « Décisions en attente » de [docs/decisions.md](docs/decisions.md#décisions-en-attente).

## Architecture

| Service Docker Compose | Rôle |
| --- | --- |
| `app` | Application Next.js : écrans, moteur de calcul, numérotation, droits, journal. Publiée sur `127.0.0.1:${APP_PORT}` |
| `generateur` | Service Python (FastAPI) : fusion des modèles Word, conversion PDF par LibreOffice, assemblage, QR code. Réseau Docker seulement |
| `postgres` | Base de données PostgreSQL |
| `redis` | File de tâches BullMQ (D24) |
| `travailleur` | Même code que `app` : certificats des imports en masse, lots d'avis et de relances, reprise des écritures différées |
| `outils` | Applique les migrations au démarrage, puis s'arrête ; sert aux scripts (`initialiser`, `creer-admin`) |

```text
navigateur ──HTTPS──> proxy inverse ──> app ──HTTP + secret──> generateur ──> volume « documents »
                                         │ │
                                         │ └──> postgres <──────────┐
                                         └──> redis ──> travailleur ┘ (le travailleur appelle aussi le générateur)
```

Code de l'application en couches `domaine/` → `serveur/` → `app/` : voir [app/README.md](app/README.md).

## Démarrer en développement

Avec Docker (chemin conseillé), depuis la racine :

```bash
cp .env.example .env        # remplir les secrets ; URL_PUBLIQUE=http://127.0.0.1:3000 pour émettre des documents en local
docker compose up -d --build                    # construit, applique les migrations, démarre les 5 services
docker compose run --rm outils npm run initialiser   # profils, droits, branches et taux de démarrage
docker compose run --rm outils npm run creer-admin   # premier Admin système
# Comptes de test (développement seulement ; SEED_MOT_DE_PASSE dans .env) :
docker compose run --rm -e NODE_ENV=development -e AUTORISER_SEED_DEV=oui outils npm run seed:dev
```

Application : http://127.0.0.1:3000 (ou le port de `APP_PORT`). Sans Docker (Node, Python, PostgreSQL et **Redis** installés à la main, trois terminaux : application, générateur, travailleur) : [docs/installation.md](docs/installation.md).

## Après la récupération d'une branche

1. Si la branche apporte une migration (`app/prisma/migrations/`) : **sauvegarder la base** d'abord ([docs/deploiement.md](docs/deploiement.md), §7).
2. `docker compose up -d --build` : reconstruit et applique les nouvelles migrations (service `outils`).
3. `docker compose run --rm outils npm run initialiser` si la branche ajoute des données de démarrage (`app/prisma/donnees/`) ; sans risque à relancer.
4. Vérifier : `curl -s http://127.0.0.1:3000/api/sante` (`"statut":"ok"`) et `docker compose run --rm outils npx prisma migrate status` (« Database schema is up to date »).

**Jamais** `prisma db push` (il contourne les migrations et les déclencheurs) ; **jamais** `docker compose down -v` (il supprime la base et les documents émis).

## Vérifications

| Où | Commandes |
| --- | --- |
| `app/` | `npm test` (unitaires), `npm run test:integration` (base de test, Redis), `npm run test:e2e` (base de test et générateur lancé), `npm run lint`, `npm run typecheck`, `npm run build` |
| `generateur/` | `pytest` (environnement virtuel activé) |

Ces commandes se lancent hors Docker, sur un poste ou un conteneur Linux de développement (variables de `app/.env` et `generateur/.env`, PostgreSQL et Redis lancés : [docs/installation.md](docs/installation.md)). Les images Docker ne contiennent pas les tests : une pile Docker se vérifie avec `docker compose ps`, `curl -s http://127.0.0.1:3000/api/sante` et les contrôles de [docs/deploiement.md](docs/deploiement.md) (§4).

## Déployer (administrateur)

Guide : [docs/deploiement.md](docs/deploiement.md) ; exigences détaillées : [docs/exigences-serveur.md](docs/exigences-serveur.md).

Prérequis à fournir par l'administrateur :

- **Domaine** et certificat HTTPS de l'application : `URL_PUBLIQUE` (les QR codes y renvoient ; vide, aucun document ne peut être émis).
- **Port libre** sur l'hôte : `APP_PORT` (3000 par défaut ; le VPS est partagé avec le portail RH).
- **Ressources du VPS** (processeurs, mémoire) : elles fixent `CONVERSIONS_SIMULTANEES` (autour du nombre de processeurs moins un).
- **Polices des modèles** (Tahoma notamment) dans `generateur/polices/`, sous licence, jamais dans le dépôt (question Q2).
- **Sauvegarde quotidienne** de la base **et** du volume `documents`, copiée hors du VPS, avec un test de restauration.

## Documentation

- Décisions et hypothèses : [docs/decisions.md](docs/decisions.md)
- Recette : [docs/recette.md](docs/recette.md) ; recette manuelle : [docs/recette-manuelle.md](docs/recette-manuelle.md) ; [plan de test des modèles Word](docs/plan-test-modeles.md)
- Installation sans Docker : [docs/installation.md](docs/installation.md) ; déploiement : [docs/deploiement.md](docs/deploiement.md) ; [exigences pour le serveur](docs/exigences-serveur.md)
- Cahier des charges : [docs/cdc.md](docs/cdc.md)
- Aide à la rédaction des modèles Word : écran « Modèles › Aide » de l'application ([source](app/src/app/%28protege%29/modeles/aide/page.tsx)) ; [guide de balisage](docs/guide-balisage.md) (méthode, pièges, anomalies A1 à A20) et script `generateur/scripts/verifier_modele.py` qui vérifie un modèle avant son dépôt
- Comptes rendus : [phase 2](docs/compte-rendu-phase-2.md), [3a](docs/compte-rendu-phase-3a.md), [3b](docs/compte-rendu-phase-3b.md), [4.0](docs/compte-rendu-phase-4.0.md), [4a](docs/compte-rendu-phase-4a.md), [4b](docs/compte-rendu-phase-4b.md), [5a](docs/compte-rendu-phase-5a.md), [5b](docs/compte-rendu-phase-5b.md), [6.0](docs/compte-rendu-phase-6.0.md), [6.1](docs/compte-rendu-phase-6.1.md), [refonte visuelle V1](docs/compte-rendu-refonte-v1.md), [6.2a](docs/compte-rendu-phase-6.2a.md), [6.2b](docs/compte-rendu-phase-6.2b.md)

## Règles du dépôt

- Aucune donnée client réelle, aucun modèle Word réel de SIM : uniquement des données de test inventées, des fichiers de test générés par le code.
- Aucun secret : seuls les fichiers `.env.example` sont versionnés. Aucune police Microsoft.
- Montants en décimal, jamais en nombre à virgule flottante (D3) ; couches `domaine/` → `serveur/` → `app/` (D4).
- Migrations : chacune nommée après la dernière existante (`migrations.test.ts` le vérifie). **Jamais `prisma db push`** ; sur un serveur, uniquement `npm run migrate:deploy` (ou `docker compose up -d --build`).
- Pas de `npm audit fix --force`.
- Une branche `phase-…` par session ; rien dans `main` sans l'accord de Thierry, qui fusionne lui-même. Règles complètes pour les sessions : [CLAUDE.md](CLAUDE.md).
