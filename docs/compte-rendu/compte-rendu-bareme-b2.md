# Compte rendu — étape B2, moteur de barème (branche `bareme-b2-moteur`)

Décisions : **D48** (barème = mode cible, secours par cotation, prorata). Documents : `docs/propositions-bareme.md` (§8, §9 corrigés).

## Fait
- **Document** : ordre B3 → B9 → B6 → B4, B5 → B7, B8 ; secours en cas de refus en deux branches (Q3) ; schéma du JSON aligné sur le code.
- **Moteur pur** `app/src/domaine/bareme/` : `schema.ts` (zod), `verification.ts` (`verifierBareme`), `contexte.ts` (champs actifs, souscriptions, saisie contrôlée), `operandes.ts` (7 opérations), `tables.ts` (une ou deux clés, clé absente = refus), `garantie.ts` (composantes A6, E1 à E5, réduction, prorata, accessoires), `bareme.ts` (`calculerBareme` dans l'ordre du socle §6, `composerBareme` via `composer()`), `essais.ts` (`rejouerJeuxEssai`), `securpro-fixture.ts` (SECURPRO **inventé**).
- **Prorata temporis** au niveau du produit : jours inclus / 365 (au plus 1), après la réduction, avant les accessoires ; tests dédiés (73 jours, inactif, plus d'un an, passage dans les montants).
- **Jeux d'essai** : 139 420 F (§1.2), minimum de la caisse (2 500 relevé depuis 1 250 : 21 784 F), refus E4 en marché.

## Tests
- 55 tests du moteur : un test par effet (E1 à E5, réduction, prorata) ; **mutation vérifiée** : 10 retraits d'effet dans le moteur font chacun échouer au moins un test.
- Oracle BigInt indépendant (fractions entières) : 200 saisies tirées à graine fixe, 100+ calculées et 5+ refusées, mêmes lignes et même TTC.
- 8 propriétés à graine fixe (déterminisme, jamais de ligne à 0, somme, ordre des sous-jacents, coefficient 1, garantie non souscrite sans effet, monotonie, prorata).
- `npm test` 592/592, `npm run lint`, `npm run typecheck`, `npm run build` verts.
- **Non lancés** : `npm run test:integration`, `npm run test:e2e`, `pytest` (base, Redis et conteneur indisponibles ici). Aucun fichier touché par ces suites (pas de migration, pas d'écran).

## Écarts et choix à confirmer
- Ni migration, ni écran, ni dépendance, ni changement de `ModeTarification` (B3, B6). Les sites D31/D32 sont inchangés.
- **Choix du moteur** (à valider, non décidés par la Technique) : tout champ actif est obligatoire sauf `obligatoire:false` ; assiette ou prime nulle = refus ; ordre dans une composante : taux → coefficients → minimum → plafond → ajout → × effectif ; E5 a trois modes (`MINIMUM`, `PLAFOND`, `AJOUT`) ; réduction = E2 `reduction:true` sur une garantie.
- La SECURPRO du jeu d'essai est **inventée** (H134, H135) : à remplacer par un cas du simulateur (Q1).

## Besoins découverts (non codés)
- Accessoires par **tranche d'effectif** (IA) : il manque une clé « tranche » sur table (clés exactes seulement aujourd'hui) ; à décider avec la Technique.
- Forçage (`forcage.ts`) : volontairement absent, c'est B7.
- `risque.<code>` dans le dictionnaire : extension à consigner avant B6.
- Les littéraux BigInt sont refusés par la cible TypeScript du projet : les tests passent par `BigInt()`.
- Saisie du taux en ‰ ou en % : une unité par composante ; vérifier avec la Technique qu'elle suffit.

## Commits (locaux, rien n'est poussé)
- e701d30 docs(bareme): ordre des sessions (B3, B9, B6, B4-B5, B7-B8), secours par cotation en deux branches, prorata, schéma aligné
- 0312692 docs(decisions): D48, le barème est le mode cible, la composition manuelle devient un secours par cotation
- b15fe70 feat(bareme): moteur pur domaine/bareme (schéma zod, verifierBareme, calculerBareme, E1 à E5, composantes, prorata, jeux d'essai)
- c94cb57 test(bareme): oracle BigInt sur 200 saisies SECURPRO et propriétés à graine fixe
- (ce compte rendu : commit « docs(bareme): compte rendu de l'étape B2 »)
