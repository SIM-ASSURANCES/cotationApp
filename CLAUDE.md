# Règles du projet SIM Documents (à lire avant toute session)

Module de génération des documents de SIM Assurances CI (cotations, contrats, factures, reçus).
Les règles propres à Next.js sont dans `app/CLAUDE.md`.

## Avant de coder

- Lire `docs/cdc.md` et `docs/decisions.md`. Les cas de test du CDC (T1 à T14) font foi (D10).
- Le dictionnaire normatif est `app/src/domaine/documents/dictionnaire.ts` : nomenclature exacte, aucun nom de champ inventé. Toute extension est consignée dans `decisions.md`.
- Un doute sur une règle métier : s'arrêter et poser la question, ne pas supposer. Une hypothèse retenue est numérotée à la suite de la dernière de `decisions.md` (H1, H2…).

## Ce qui n'entre jamais dans le dépôt

- Aucune donnée client réelle, aucun modèle Word réel de SIM, aucun secret (`.env` hors dépôt), aucune police Microsoft.
- Fichiers d'instructions des sessions (`PHASE_*.md`, `.plans/`), fichiers d'import et rapports (`*.xlsx`, `*.csv`) : ignorés par `.gitignore`. Les fichiers de test sont générés par le code ou inventés.

## Code

- Montants en décimal, jamais en flottant (D3).
- Couches `domaine/` → `serveur/` → `app/` (D4). Le moteur de calcul est la seule source des montants.
- Migrations : nom strictement postérieur à la dernière (`migrations.test.ts` le vérifie). Jamais `prisma db push` ; sur un serveur, uniquement `npm run migrate:deploy` (ou `docker compose up -d --build`).
- Pas de `npm audit fix --force`.

## Travail

- Une branche `phase-…` par session ; rien dans `main` sans l'accord de Thierry, qui fusionne lui-même.
- Tests dans le conteneur : unitaires (`npm test`), intégration (`npm run test:integration`), bout en bout (`npm run test:e2e`), `pytest` (generateur), `npm run lint`, `npm run typecheck`, `npm run build`.
- Fin de session : tests verts, commit, compte rendu court `docs/compte-rendu-<session>.md` (fichiers, tests, écarts, hypothèses ouvertes).
