# app/ : application SIM Documents

Next.js 16 (TypeScript strict), Prisma 7 et PostgreSQL. Installation : voir [../docs/installation.md](../docs/installation.md).

## Couches de `src/` (décision D4)

| Dossier | Rôle |
| --- | --- |
| `domaine/` | Règles métier pures : ni Next.js, ni React, ni Prisma, ni système de fichiers. |
| `serveur/` | Base de données (Prisma), appels au générateur, services. Chaque fichier commence par `import "server-only"`. |
| `app/` | Pages, routes API et Server Actions : du code mince qui appelle `serveur/`. |
| `composants/` | Interface React ; n'importe jamais `serveur/`. |

Sens des dépendances : `app/` → `serveur/` → `domaine/`, jamais l'inverse. `npm run lint` le vérifie. Il interdit aussi tout accès au journal d'audit hors de `src/serveur/audit.ts`.

La sécurité des pages se vérifie à deux niveaux : `src/proxy.ts` (premier filtre, sur le cookie) puis `exigerUtilisateur()` / `exigerDroit()` de `src/serveur/session.ts` dans chaque page et chaque action.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement (http://localhost:3000). |
| `npm run build` | Construction de production : sortie autonome dans `.next/standalone/`, complétée par `scripts/completer-standalone.mjs`. |
| `npm run start` | Lance la version construite, comme sur un serveur : `node .next/standalone/server.js`. |
| `npm run lint` | ESLint, y compris le sens des couches. |
| `npm run typecheck` | Génère les types des routes (`next typegen`), puis vérifie les types (`tsc --noEmit`). |
| `npm test` | Tests Vitest (une seule exécution). |
| `npm run test:integration` | Tests sur une vraie base PostgreSQL de test (`TEST_DATABASE_URL`, supprimée et recréée à chaque fois) et sur Redis (`REDIS_URL`). Le générateur y est simulé. |
| `npm run test:e2e` | Tests de bout en bout : base de test **et** vrai générateur (`GENERATEUR_URL`, à lancer avant), avec les modèles de test de `generateur/tests/fixtures/`. |
| `npm run initialiser` | Crée les profils du CDC §4 et leurs droits par défaut, les motifs de refus, les branches et les taux de démarrage (`prisma/donnees/`), sans rien écraser. |
| `npm run creer-admin` | Crée le premier Admin système ; le mot de passe se saisit dans le terminal. |
| `npm run travailleur` | Travailleur de la file de tâches BullMQ (D24) : imports en masse, lots d'avis et de relances, reprise des écritures différées. Exige `REDIS_URL`. |
| `npm run seed:dev` | Comptes de test, **développement seulement** : exige `AUTORISER_SEED_DEV=oui` et `SEED_MOT_DE_PASSE`, refusé si `NODE_ENV=production` (voir `scripts/seed-dev.mts`). |
| `npm run migrate:deploy` | Applique les migrations existantes : **seule commande de migration autorisée sur un serveur** (jamais `prisma migrate dev`). |

`npm install` lance aussi `prisma generate` (script `postinstall`) : le client Prisma est recréé dans `src/generated/`, un dossier ignoré par Git.
