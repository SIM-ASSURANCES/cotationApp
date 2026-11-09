# Compte rendu — phase-vigueur-immediate (09/11/2026)

Branche `phase-vigueur-immediate` depuis `main` (1121678), commits locaux seulement. Décisions et hypothèses : **D66, H204 à H210**.

## Fichiers
- Migration `20261109090000_version_au_bareme_en_preparation` : le déclencheur `produit_versions_bareme_publie` admet l'INSERTION en mode BAREME (la bascule d'une version existante exige toujours un barème publié).
- Domaine `calcul/parametrage.ts` : `enVigueur` écarte les versions en préparation, `problemeChangementDeMode`, date provisoire 9999-12-31.
- Serveur : `parametrage.ts` (`creerVersion` : mode figé, retour `VersionCreee`), `bareme.ts` (`publierDansTransaction`, `publierBaremeDetaille`), `bareme-edition.ts` (version au barème, copie, publication immédiate), `imports.ts`.
- Écran : `formulaire-version.tsx` (extrait de la page), `libelles-produit.ts`, `page.tsx`, `panneau-bareme.tsx`, `actions.ts`, pages de cotation.
- Tests : `vigueur-immediate.integration.test.ts` (18), `vigueur-immediate.test.ts` (7), `formulaire-version.e2e.test.ts` (4), `actions.integration.test.ts` (+2), aide `produit-bareme-test.ts`.

## Tests (pile jetable `sim-vigueur`, base vierge, suite complète une fois)
| Suite | Fichiers | Tests |
| --- | --- | --- |
| Unitaires | 81 | 972 |
| Intégration | 36 | 485 |
| Bout en bout | 13 | 26 (25 + `bareme-b5` relancé seul après correction du test) |
`eslint`, `tsc`, `npm run build` : sans erreur. Cas 1 à 10 de la demande couverts (1-9 en intégration, 10 en e2e).

## Écarts
- Points A et B : **un seul commit de code** (mêmes fonctions et même formulaire), puis un commit de test et un commit de docs.
- Tests d'avant D66 modifiés, aucun supprimé : « une version ne naît pas au barème » (règle D50.2 remplacée) ; 3 tests de `bareme-edition` (mode BAREME, alerte H140 remplacée, date vide valide) ; 11 tests qui passaient un produit d'un mode à l'autre posent maintenant l'historique mixte comme donnée héritée (`ajouterVersionHeritee`).
- Représentation « en préparation » : déduite (BAREME sans barème publié), sans colonne ; type de `date_effet`, unicité et `versionDateEffet` intacts. « Dès la publication » = date provisoire 9999-12-31 (H205).
- Changer le mode d'un produit existant : non proposé (nouveau produit).

## Besoins découverts, non codés
1. Une version « dès la publication » ne peut pas changer de date : si une autre version existe le jour même, republier le lendemain ou créer une version à date future (H207).
2. Version en préparation à date future dont la date est passée : inutilisable, publication refusée (H206) ; aucune alerte à l'écran.
3. Le refus d'« Ajouter une version » au barème (essai rouge) n'est pas journalisé (H208).
4. Ajouter une version FORMULE ou GARANTIES accepte toujours une date passée (comportement inchangé).
5. **Règle (Thierry, 09/11)** : « Ajouter une version » garde toujours le mode précédent ; seule exception, `creerVersionDepuisBareme` (copie d'un barème publié du même produit) ramène au barème pour réparer une version « Par garanties » créée par erreur (D66, H204). L'écart règle/code est **assumé** : le code autorise ce geste, le test « historique mêlé » le dit.

## Recette pour Thierry (6 étapes)
1. Déployer (`docker compose up -d --build` : la migration s'applique seule). Ne pas relancer sim-b1 avant d'avoir relu cette liste.
2. Produits > SECURPRO : lire l'historique. Repérer la version « Par garanties » créée par erreur (date d'effet, case durée imposée).
3. Si cette version est **encore à date future** : cas d'avant D66 conservé (version provisoire H140). Sur sa fiche, exporter le barème publié de la version au barème, l'importer ici, rejouer les essais, publier, puis « Basculer la version au barème ». La durée imposée est gardée.
4. Si elle est **déjà en vigueur** : sur la version qui porte le barème publié, « Créer une nouvelle version à partir de ce barème », entrée **dès la publication** (si une version existe déjà aujourd'hui, la publication est refusée : republier demain). Les paramètres, dont la durée imposée, viennent de la dernière version retenue : les vérifier ; publier avec un motif. Vérifié par Thierry sur sim-b1.
5. Contrôle : nouvelle cotation SECURPRO (essai de 139 420 F) ; sa fiche indique la version du jour. Une cotation émise avant garde son ancienne version.
6. Contrôle de l'écran : « Ajouter une version » sur SECURPRO affiche « Au barème » en lecture seule, « dès la publication » et le motif ; sur un produit par formules, aucune liste de garanties.

## Suite de la relecture
- **Mesures** (pile jetable, base vierge, suite complète) : unitaires 81 fichiers / 976 tests ; intégration 36 / 490 ; **bout en bout 13 / 26, tous verts** ; lint, typecheck, build sans erreur.
- **Audit des tris par date** (sites lisant `produit_versions`) — exclus de la préparation : `enVigueur` (domaine), `resoudreVersion`, `exigerCalculAutomatiqueEnVigueur`, `exigerModeCoherentEnVigueur`, `dateDeVersionPourCotation`, `listerProduits`, `formulesEnVigueur` (import). **Corrigés** : simulateur `calcul/page.tsx` (`versions[0]`), `portefeuille.ts` (« dernière version »), `creerVersionDepuisBareme` (« derniere »), pages Nouvelle cotation / Modifier (nouvelle fonction `versionPourCotation`, qui porte aussi `dateDeVersionAnticipee`), journal et classeur Excel (la date 9999 s'écrit « dès la publication » / « version en préparation »).
- **Voulus, non exclus** : l'historique de la fiche produit (la préparation y figure, titrée comme telle), la détection d'une préparation existante (`avenir`), l'aperçu d'un modèle (`baremePourApercu`, brouillon le plus récent : aucun montant), `tableau-technique` (ne lit que GARANTIES), cotations/documents/factures (clés sur la version figée).
- **Pré-remplissage d'« Ajouter une version »** (`baseDeNouvelleVersion`) : le **mode** vient de la version la plus récente par date, préparation comprise (c'est la règle du service) ; les **valeurs** viennent de la dernière version retenue (hors préparation), sinon de la préparation si le produit n'a rien d'autre. Même règle pour les paramètres de `creerVersionDepuisBareme`.
- **Tests ajoutés** (`vigueur-immediate`, 5 en intégration + 4 unitaires) : 2a produit neuf (aucune date en 9999, aucun calcul, cotation le jour même après publication) ; 2b ajout pendant une préparation + paramètres de la correction ; 2c taxes avec un taux piège en 2100 (essais au brouillon, au contrôle et à la publication lus à la date du jour) ; 3 date prévue passée sans barème publié (calcul et soumission avec la version précédente, sans refus).
- **`ajouterVersionHeritee`** n'existe que dans `produit-bareme-test.ts` (aide de test, importée seulement par des `*.test.ts`) et ses appelants de test ; aucun fichier de l'application ne l'importe.
- **Défaut de recette (H212)** : plus aucune action de barème sur une version « Par formule » ou « Par garanties » sans barème ; `creerBaremeVide` et l’import refusent une version qui n’est pas au barème ; les versions provisoires d’avant D66 qui ont déjà un barème et la réparation de H204 restent permises. Fixtures de test adaptées (6 fichiers), `panneau-bareme.e2e` ajouté. Mesures après H212 (suite complète) : unitaires 81 / 979, intégration 36 / 493, bout en bout 14 / 30, lint, typecheck, build sans erreur.
