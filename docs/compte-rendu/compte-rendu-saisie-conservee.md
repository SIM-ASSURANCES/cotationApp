# Saisie conservée sur tous les formulaires

Branche `saisie-conservee` (depuis `main`). Option B retenue : nouveau défaut de `FormulaireAction`. Commits locaux, rien de poussé.

## Ce qui change
- `FormulaireAction` intercepte TOUJOURS l'envoi (comme `conserverSaisie` de B6a, qui disparaît) : un refus (validation, règle métier, droit) ne touche à rien ; un succès remet le formulaire à zéro (`form.reset()`, ce que React 19 faisait déjà), sauf `garderApresSucces`. Le spinner du bouton suit désormais `enCours` partout.
- Seuls les champs `type="password"` sont vidés après un refus (H147, écart assumé à « toujours conserver »).
- `garderApresSucces` (modification) : société (5 formulaires), branche principale d'un produit, relances, facture (modification, composition), composition de la prime d'une cotation, seuil des modèles, branches, intermédiaires, utilisateurs (modification), droits. Les autres sont traités comme des créations (clients, taxes, version de produit, paiement, adhérents…).
- Champs dépendants : les composants à état local (`ChoixContrat`, `ChampNumeroPolice`, lignes dynamiques) sont contrôlés, donc non touchés par un refus ; au succès le reset natif agit comme avant. Cases, listes, zones de texte et dates sont couvertes par le test.
- Décision D53 / hypothèse H147 dans `decisions.md` (B6b fusionnée avant : D52 et H146 lui appartiennent).

## Tests
- Recette navigateur `app/scripts/verifier-saisie-conservee.mjs` (Edge via Playwright installé à part, base jetable `…_test` dans un conteneur Postgres à part, données inventées préparées par `preparer-recette-bareme.mts` puis `preparer-recette-saisie.mts`), 1440 px, **tous les contrôles passent** :
  - Société (modification) : succès → valeurs gardées ; refus (même date d'effet) → champs, zones de texte, date conservés.
  - Version de produit (création) : refus → champs, 2 listes, case décochée, date conservés ; succès → formulaire remis aux valeurs par défaut.
  - Facture : paiement refusé (montant invalide) → date, montant, canal, référence, payeur conservés.
- Sur l'ancien code (`app/src` remis à l'état de `main`) : le script ÉCHOUE dès la Société (« succès : valeurs gardées » en échec : le formulaire revient aux anciennes valeurs, puis le script s'arrête).
- Unitaires 653/653 ; `tsc --noEmit` et eslint (src, script) : verts ; `npm run build` : réussi.
- NON lancés : intégration, e2e, pytest (aucun fichier de domaine ni de serveur touché ; pas de `TEST_DATABASE_URL` lue). Pas de test automatique sur 390 px (non demandé).

## Écarts et besoins notés (non codés)
- Le test navigateur couvre 3 formulaires ; les 60 autres reposent sur le même composant, non exercés un à un.
- `FormulaireAction` n'a toujours pas de test unitaire (aucun outil de rendu de composants dans le projet).
- Le script de recette crée l'application en `next dev` : utiliser `localhost`, pas `127.0.0.1` (ressources de développement bloquées sinon).

## Commits
- e0dfc9e feat(saisie): un refus ne vide plus jamais un formulaire, le succès remet une création à zéro (D53)
- ca4a538 feat(saisie): garderApresSucces sur les formulaires de modification (société, facture, branches, droits…) (D53)
- 52584ab test(saisie): recette navigateur Société, version de produit, paiement refusé à 1440 px (D53)
- db32d93 docs(saisie): décision D53 et hypothèse H147
- (ce compte rendu : commit « docs(saisie): compte rendu »)
