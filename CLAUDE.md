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

## Design system (refonte visuelle, D30)

L'apparence reprend celle du portail RH de SIM Assurances. Les règles ci-dessous valent pour tout écran, nouveau ou existant.

- **Tokens seulement.** Les couleurs, les ombres et les courbes sont définies une fois dans `app/src/app/globals.css` et exposées en classes (`bg-primary`, `text-danger`, `border-border`, `bg-muted`, `shadow-elevated`, `ease-out-strong`…). **Aucune couleur en dur** dans le code : ni classe de la palette Tailwind (`bg-blue-600`, `text-zinc-700`), ni `bg-white` / `text-white`, ni `#004b9c`, `rgb()`, style en ligne. `app/src/couleurs.test.ts` le vérifie ; une couleur manque ? On l'ajoute comme token dans `globals.css`, on n'écrit pas la valeur dans un composant.
- **Contraste (WCAG AA, 4,5:1).** `text-muted-foreground` n'est valable que sur fond blanc ; sur `bg-muted` ou `bg-primary-bg`, écrire en `text-neutral`. Le ton ne porte jamais le sens seul : le libellé d'un statut reste écrit.
- **Champs.** Les champs (`Champ`, `ZoneTexte`, `ListeDeroulante`) ont un fond `primary-bg` : jamais dans un conteneur `bg-muted` (ils s'y confondraient), toujours dans une `Carte` ou un panneau `bg-surface`. 16 px sous `sm` (Safari sur iPhone zoome la page au focus d'un champ plus petit). L'anneau de focus est celui du bleu principal (`globals.css`, calque `base`) ; sur un fond bleu, `focus-visible:outline-primary-foreground`.
- **Composants** : `app/src/composants/ui/` (`Bouton`, `Champ`, `ZoneTexte`, `ListeDeroulante`, `ChampFormulaire`, `Carte`, `Pastille`, `EnTetePage`, `Tableau`, `EtatVide`, `CarteIndicateur`, `Icone`). Ils changent d'apparence, jamais de comportement, et restent compatibles avec `FormulaireAction` (mêmes `name`, même envoi). Une icône manque ? L'ajouter à `composants/ui/icones.tsx` (jeu maison, aucune dépendance). `composants/` n'importe jamais `serveur/`.
- **Coquilles.** Application : `composants/coquille/Coquille.tsx` (cadre bleu, barre latérale, barre du haut). Hors application (connexion, accès refusé, mot de passe à changer, page publique `/verif`) : `CoquilleConnexion.tsx`. La navigation est construite par la fonction pure `domaine/navigation.ts` à partir des droits ; une nouvelle page se rattache à une branche existante, avec la même condition d'affichage que sa propre garde.
- **Logo.** Les fichiers `app/public/logo-sim-couleur.svg` et `logo-sim-blanc.svg` font foi et ne se modifient pas. Logo **couleur** sur fond blanc, logo **blanc** sur fond bleu foncé (`bg-primary`). Zone de protection autour du logo égale à la hauteur de son « S » (le remplissage de la carte ou de l'en-tête la garantit : rien ne touche ses bords). Taille minimale : 120 px de large à l'écran ; en dessous, le pictogramme seul (`composants/ui/pictogramme.ts`, source unique de son tracé). Interdit : déformer, pivoter, recolorer, le poser sur un fond chargé, le réduire sous la taille minimale.
- **Typographie.** Montserrat, **hébergée dans le dépôt** (`app/src/app/polices/`, `next/font/local`) : ne jamais passer à `next/font/google` (la construction Docker ne télécharge rien). Arial reste réservé aux modèles Word.
- **Calques CSS.** Une règle personnalisée de `globals.css` s'écrit dans `@layer base` (règle générale) ou avec `@utility` (nouvelle classe) : hors calque, elle battrait les classes Tailwind et rendrait `focus:outline-…`, `shadow-none`… sans effet.
- **Clavier et lecteurs d'écran.** Un tiroir ou un menu qui se comporte comme une fenêtre modale reçoit le focus à l'ouverture, le rend à la fermeture et rend le reste inerte ; la barre du haut est collante : `scroll-padding-top` de `globals.css` en tient compte ; les cibles tactiles font 40 px au moins sous `lg`.
- **Mouvement.** Toute animation s'écrit sous `prefers-reduced-motion` (`motion-safe:` / `motion-reduce:` ou la media query de `globals.css`), avec les courbes du design system : pas d'autre `cubic-bezier`.
- **Montants** alignés à droite, en chiffres tabulaires (`tabular-nums`), séparateur de milliers inchangé.

## Travail

- Une branche `phase-…` par session ; rien dans `main` sans l'accord de Thierry, qui fusionne lui-même.
- Tests dans le conteneur : unitaires (`npm test`), intégration (`npm run test:integration`), bout en bout (`npm run test:e2e`), `pytest` (generateur), `npm run lint`, `npm run typecheck`, `npm run build`.
- Fin de session : tests verts, commit, compte rendu court `docs/compte-rendu-<session>.md` (fichiers, tests, écarts, hypothèses ouvertes).
