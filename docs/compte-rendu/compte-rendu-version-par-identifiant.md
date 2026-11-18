# Compte rendu — phase-version-par-identifiant (18/11/2026)

Branche `phase-version-par-identifiant-v2` depuis `main` (a1afed9). Décision **D67**, hypothèses **H214 à H218**. Rien de visible ne change : aucun montant, document ni numéro.

## Fichiers
- Migration `20261110090000_version_par_identifiant` : `version_id` NOT NULL + clé étrangère RESTRICT + index (`cotations`, `factures`), remplissage depuis `(produit, version_date_effet)`, échec avec message clair si une ligne n'a pas sa version (tout annulé), `cotation_figee()` fige `version_id`.
- `schema.prisma` ; `cotations.ts`, `documents.ts` (`contexteVersion`), `factures.ts`, `imports.ts`.
- Tests : `version-par-identifiant.integration.test.ts` (5), bloc « D67 » de `factures.integration.test.ts` (2), `stockage-*` (version réelle), `tarification-garanties` (1 SQL).

## Tests (pile jetable, base vierge ; suite complète, intégration relancée après une correction)
| Suite | Fichiers | Tests |
| --- | --- | --- |
| Unitaires | 81 | 981 |
| Intégration | 37 | 500 (1re passe : 499 + 1 échec, corrigé, relance complète verte) |
| Bout en bout | 14 | 30 |
| pytest (générateur) | — | 244 (1 avertissement : `httpx` / starlette) |
`eslint`, `tsc`, `npm run build` : sans erreur. Non exécuté : rien. Pile : **PostgreSQL 16** (18 injoignable, dépôt `apt.postgresql.org` bloqué), Node 24.22.3, Python 3.14.6, LibreOffice 24.2, Redis 7.

## Les 9 recherches par `produitId_dateEffet`
Remplacées par `id` (version d'une cotation ou d'une facture) : `cotations.ts` ×3 (émission, acceptation, fiche), `imports.ts` (police), `factures.ts` (fiche au barème), `documents.ts` (devenue `contexteVersion(id)`).
Gardées : `parametrage.ts` (unicité de la date à la création d'une version), `bareme-edition.ts` ×2 (D66, « une seule version par jour »). Une enveloppe `contexteProduit(produit, date)` subsiste pour 5 appels de tests (H215).

## Lectures de `version_date_effet` qui restent (colonne conservée)
- Écriture à la création, avec `version_id`, de la même version : `cotations.ts`, `factures.ts`.
- Affichage : fiche de cotation (« Paramétrage du produit du »).
- Date des paramètres figée sur les documents (historique, T10) : `parametresDate` à l'émission, au paiement, à l'avoir, aux relances (`factures.ts`, `echeances.ts`), CP et PDF (`documents.ts`, depuis la date de la version trouvée par identifiant).
- Date du seuil de validation global (une date, pas une version) : `seuilDe`, `controlerSeuilContrat`.

## Écarts
- Tests d'avant D67 touchés, valeurs attendues inchangées : `stockage-*` créaient des lignes sur une version absente (version réelle ajoutée) ; « ceinture » de `tarification-garanties` fabriquait en SQL le rattachement par la date seule (pose aussi `version_id`).
- Ce dépôt est `skyjuan03/appTechniqueClone` : le dépôt de l'entreprise est inaccessible à la session (403). Branche `-v2` : le `main` de ce dépôt a été réécrit après le premier clone, une première branche `phase-version-par-identifiant` (ancien `main`, aucun commit) reste en ligne et peut être supprimée.
- Le rôle de test a `CREATEDB` et le droit `SET` sur `session_replication_role` (exigé par un helper de test existant).

## Hypothèses ouvertes
H214 : rien en base ne vérifie que `version_id` et `(produit, date)` désignent la même version (contrainte composite possible). H215 : enveloppe à retirer avec ses 5 tests. H217 : verrou court au déploiement. H218 : environnement de session.

## Recette pour Thierry
1. Avant de déployer, sur une copie de la base : `docker compose up -d --build` ; la migration doit finir par « successfully applied ». Si elle échoue, le message liste les identifiants des lignes sans version : rien n'est modifié.
2. Ouvrir une cotation émise et une facture émise anciennes : date « Paramétrage du produit du » inchangée.
3. Réémettre ou rééditer un PDF (CP, facture) d'une ancienne cotation : mêmes montants, même version de produit.
4. Créer une cotation sur un produit à deux versions, l'émettre, la faire accepter, facturer : le tarif de la version figée sert.
5. Contrôle en base : `SELECT count(*) FROM cotations WHERE version_id IS NULL` (idem `factures`) doit rendre 0.
