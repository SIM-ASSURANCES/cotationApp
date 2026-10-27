# Compte rendu — étape B6a, cotation au barème (branche `bareme-b6a-cotation`)

Décision **D51**, hypothèses **H142 à H145** (`docs/decisions.md`). La session B6b (balises `risque.<code>`, portefeuille, import en masse) n'est pas faite.

## Fichiers
- Domaine : `composition.ts` (origine BAREME, `natureDuCalcul`), `bareme/tranches.ts`, `bareme/formulaire.ts` (descripteur, conditions, conversion), schéma / vérification / garantie (accessoires par tranche), `calcul/parametrage.ts` (messages, alerte H140).
- Serveur : `cotations.ts` (voie du barème, `calculerCotationBareme`, `lireDescripteurBareme`, modification, soumission), `parametrage.ts` (gardes à trois valeurs, `resoudreContexteBareme`), `documents.ts` (`montantsDu`), `bareme.ts` (`parametresDeCalcul`), classeur Excel (tranches).
- Écran : `cotations/champs-bareme.tsx`, `formulaire-cotation.tsx`, pages nouvelle / modifier / fiche, action « Calculer », alerte H140 sur la fiche du produit. `propositions-bareme.md` mis à jour (Q3 : (a) ; Q4, Q8, Q10 aussi).

## Points de l'étape
1. Écran généré, conditions recontrôlées au serveur, souscription par garantie et composante, « Calculer », résultat effacé à toute modification : fait.
2. Lignes d'origine BAREME figées avec l'empreinte et la saisie ; `composer()` pour taxe, arrondi, TTC ; refus E4 avec le message de la Technique : fait.
3. Gardes à trois valeurs, un test par site : fait.
4. Secours : **(a), refus sans exception** ; tests (création, « Composer une prime », formules) : fait.
5. Accessoires par tranche (produit ou garantie), chaque borne testée : fait.
6. Alerte H140 : fait.

## Tests
- Unitaires 653 verts ; intégration 343 verts (10 ignorés, comme avant) ; lint, typecheck, build verts. **Non exécutés** : `test:e2e` (générateur injoignable sur 127.0.0.1:8001, Docker arrêté) et `pytest` (générateur non touché). Nouveaux : `tranches.test.ts` (16), `formulaire.test.ts` (11), `bareme-classeur.test.ts` (+2), `cotation-bareme.integration.test.ts` (10 : SECURPRO inventé de la cotation au reçu = 139 420 F et montants du jeu d'essai, « Calculer », refus E4, secours, modification, les cinq sites).
- Le test de bout en bout met la version « en vigueur » par un `UPDATE` en mode `replica` (on ne peut pas attendre sa date d'effet) : base de test seulement.

## Écarts et besoins découverts (non codés)
- Écran non essayé dans un navigateur (compilation, lint, build seulement) ; le calcul au clic et l'effacement du résultat reposent sur le code, pas sur une capture.
- Renouvellement / avenant d'une police au barème : refusés (H143), à faire en B8. Forçage : B7.
- Reste pour B6b : balises `risque.<code>`, libellé du portefeuille, tableau des formules de la page produit, import en masse (`imports.ts`).
- Le descripteur n'affiche pas le montant garanti avant « Calculer » ; le libellé des champs est leur code tant que la Technique ne renseigne pas `libelle`.
