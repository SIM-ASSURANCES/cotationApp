# Compte rendu — Étape 6 : CG par branche (22/10/2026)

Branche `phase-cg-par-branche`. Décisions : D42, hypothèses H117 à H119 (`docs/decisions.md`).

## Fichiers
- Migration `20261022090000_cg_par_branche` : table `branche_cg` (historisée, déclencheur `parametrage_historise`), reprise de l'existant, journal.
- Domaine : `domaine/documents/cg-branche.ts` (CG en vigueur à une date, validation, messages de refus) ; `problemesVisas` ne contrôle plus que les CS.
- Serveur : `serveur/cg-branches.ts` (lecture, rattachement, droit du paramétrage des produits) ; `documents.ts` : `piecesContractuelles` lit la CG de la branche du produit et son visa dans la version publiée.
- Écran « Paramétrage > Conditions générales » (5 branches, historique, rattachement daté) ; menu ; la saisie des CG disparaît de la fiche produit (CS inchangées).
- Petit point : `ranger:dev` s'arrête si le générateur est injoignable ; seul un 404 est « introuvable » (H119).

## Branches restées vides après la migration (base de développement)
Mesuré sur une copie de `sim_documents_docker` : **INCENDIE_DOMMAGES** et **RÉCOLTE** (aucun produit). Reprises : MALADIE, ACCIDENTS_CORPORELS et DECES, avec `CG-TESTSANTE` (modèle de test), datées du 01/01/2026. À renseigner par Thierry à l'écran, et à revoir pour les trois reprises (CG de test).
Sur un autre serveur, la liste se lit à l'écran : bandeau « Branches sans conditions générales en vigueur ».

## Tests
- Unitaires 498 verts ; lint, typecheck verts.
- Intégration : 23 fichiers, 274 verts (10 ignorés avant mon travail). Nouveaux : `cg-branches` (rattachement, historique immuable, refus, droits), `documents` (CG de la branche ; branche sans CG et produit sans branche refusés sans document produit, cotation non bloquée ; réédition qui garde la CG figée), `stockage-reorganisation` (injoignable : arrêt ; 404 : introuvable ; autre erreur : rapport).
- Reprise de la migration vérifiée sur une copie de la base de développement (copie supprimée).

## Tests de bout en bout (conteneurs Docker : Postgres, Redis, générateur, pdftotext)
Dates d'effet fixes remplacées par des dates calculées depuis aujourd'hui (`serveur/dates-test.ts` : demain, période de 365 jours ; 163 jours pour T3).

| Fichier | Tests | Résultat |
|---|---|---|
| `contrats-4a.e2e` | T5, T6 (×2) | 3 verts |
| `documents.e2e` | T1 | 1 vert |
| `factures.e2e` | T2, T3/T4 | 2 verts |
| `garanties.e2e` | composition à l'avoir | 1 vert |
| `modeles.e2e` | T9, champ Word, T7, filtres, CG | 5 verts |
| `import-masse.e2e` | T8 (488 certificats) | 1 vert : 237 s avec `CONVERSIONS_SIMULTANEES=4` sur 8 processeurs. Avec 2 (valeur par défaut) : 301 certificats en 15 min, test en échec sur cette machine ; à re-vérifier sur le serveur |

Corrections nécessaires en plus des dates : seuil global relevé à 20 M le temps de T1 et T2 (`parametres-test.ts`, seuil unique de 10 M depuis l'étape 3) ; base de test remise à zéro avant chaque série.

## H118 (option A, 22/10/2026)
Mise à jour des CP et certificats d'un contrat en cours : CG figée à la première émission des CP. Test dans `groupes.integration`. Le renouvellement n'émet aucune CG aujourd'hui : règle sans chemin de code.

## Hypothèses ouvertes
- Besoins découverts, non codés : liste des produits touchés par une branche sans CG ; `cdc.md` §6.8 (visa lu au produit) à mettre à jour par Thierry.
