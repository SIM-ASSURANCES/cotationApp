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
| `npm run test:integration` | Tests sur une vraie base PostgreSQL de test (`TEST_DATABASE_URL`, supprimée et recréée à chaque fois). |
| `npm run initialiser` | Crée les profils du CDC §4 et leurs droits par défaut (sans écraser les droits modifiés). |
| `npm run creer-admin` | Crée le premier Admin système ; le mot de passe se saisit dans le terminal. |
| `npm run migrate:deploy` | Applique les migrations existantes : **seule commande de migration autorisée sur un serveur** (jamais `prisma migrate dev`). |

`npm install` lance aussi `prisma generate` (script `postinstall`) : le client Prisma est recréé dans `src/generated/`, un dossier ignoré par Git.
