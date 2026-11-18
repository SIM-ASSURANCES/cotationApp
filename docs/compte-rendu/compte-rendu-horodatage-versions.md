# Compte rendu — phase-horodatage-versions (18/11/2026)

Branche `phase-horodatage-versions` depuis `phase-version-par-identifiant-v2` (S1, 823f788). Décision **D68**, hypothèses **H219 à H226**. Une version de produit ou de modèle entre en vigueur à un **instant** ; aucun montant, document ni numéro existant ne change.

## Fichiers
- Migrations `20261111090000_horodatage_versions_produit` (instant, déclencheurs, unicité, H214) et `20261111100000_horodatage_versions_modele`.
- Domaine : `dates.ts` (horloge, instants), `parametrage.ts` (`enVigueur` à l'instant, titres), `documents/modeles.ts`. Serveur : `parametrage`, `bareme`, `bareme-edition`, `modeles`, `imports`, `portefeuille`, `bareme-excel`. Écran : `titre-version.tsx`, fiches produit et modèle.
- Tests neufs (12) : `horodatage-versions.integration` (6), `horodatage-migration.integration` (2), `horodatage-fiche.e2e` (1), un cas dans `documents.integration`, `bareme-documents-garanties.integration` et `factures.integration`.

## Tests (PostgreSQL 16, base vierge, suite complète ; l'intégration relancée après correction de fixtures)
| Suite | Fichiers | Tests |
| --- | --- | --- |
| Unitaires | 81 | 981 |
| Intégration | 39 | 511 |
| Bout en bout | 15 | 31 |
| pytest (générateur) | — | 244 |
`eslint`, `tsc`, `npm run build` sans erreur. Rien n'a été non exécuté. 1re passe d'intégration : 10 échecs, tous des fixtures qui posaient une version de modèle publiée sans instant (corrigées).

## « En préparation » (sans date sentinelle en base)
`instant_effet` et `date_effet` **NULL**, réservé au mode BAREME (CHECK), une seule par produit (index partiel). Version au barème non publiée avec date prévue : instant à minuit de cette date. Aucune ligne en 9999-12-31 après migration (testé). **Écart** : `DATE_EFFET_A_LA_PUBLICATION` reste dans le **code** comme valeur d'entrée et de lecture du domaine (H220), la base ne le connaît plus.

## Tests d'avant dont l'attente a changé (ancienne → nouvelle)
1. `vigueur-immediate` « D66 test 2 » (2 tests, réécrits) : la 2e publication du jour était refusée (« Une seule version par jour… », rien écrit) → acceptée, elle sert dès son instant, la 1re jusque-là ; idem pour « Ajouter une version » dès la publication.
2. `vigueur-immediate` : date de la version en préparation `9999-12-31` → `null` (2 attentes). `bareme-edition` : `["BAREME","9999-12-31"]` → `["BAREME", null, null]`.
3. `factures.integration` (mon test de S1) : date de la cotation après changement de `version_id` : `2026-06-01` → `2020-01-01` (la base recopie la date de la version, H214).
Les autres tests ne changent que leurs fixtures (instant posé en même temps que la date sous `replica`, ou type `!`), jamais une valeur attendue.

## Écarts
- Test 1 (barème) : cotation, émission, brouillon recalculé ; facture et reçu vérifiés sur un produit à formules (`factures.integration`, même logique). Un brouillon est recalculé à sa soumission (H223) : « garde la 1re » vaut pour une cotation émise.
- `titreDeVersion` (au jour) n'est plus utilisé par l'écran, gardé pour ses tests unitaires.
- Le test d'export du journal exige un ordre strict : il échoue s'il tourne après le test de numérotation sous concurrence (transactions parallèles). Vitest réordonne les fichiers d'après son cache : vidé pour le passage final (hors dépôt).
- Pile : PostgreSQL 16 (18 inaccessible), rôle de test `CREATEDB` + droit `SET` sur `session_replication_role` (helper de test existant).

## Hors périmètre
Taxes, conditions générales par branche, données Société, dates des contrats : au jour. Dictionnaire des documents inchangé : les modèles Word existants restent valables.

## Hypothèses ouvertes
H219 : horloge de l'application, gel à `now()`. H220 : jeton « dès la publication ». H221 : date passée = minuit. H222 : fuseau UTC+0. H224 : renouvellement = version la plus récente du jour d'effet. À confirmer par Thierry.

## Recette commune S1 + S2 (PostgreSQL 18, 8 étapes)
1. Sur une **copie** de la base restaurée sous PostgreSQL 18 : `docker compose up -d --build` ; les trois migrations (20261110090000, 20261111090000, 20261111100000) finissent par « successfully applied ». Si l'une échoue, le message liste les lignes sans version : rien n'est modifié.
2. En base : `version_id` jamais NULL (cotations, factures) ; aucune `date_effet` en 9999 ; dates des anciennes cotations et factures inchangées.
3. Produit au barème : corriger le barème deux fois « dès la publication » ; la fiche affiche « En vigueur depuis … à HH h MM » et « Remplacée le … à HH h MM ».
4. Cotation émise entre les deux : elle reste sur la 1re, PDF identique ; une cotation créée après prend la 2e.
5. Produit par formules : deux versions à la date du jour (tarifs différents), une à demain (« À venir : … » sans heure).
6. Modèle : publier deux fois le même jour ; un document émis avant garde l'ancienne (réédition identique), un émis après prend la nouvelle.
7. Police existante : facture, paiement, reçu, avoir, mêmes montants et même version de produit.
8. Journal d'audit et classeur de barème exporté : date et heure de la version.
