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
- Unitaires 498 verts ; lint, typecheck, build verts.
- Intégration : 23 fichiers, 273 verts (10 ignorés avant mon travail). Nouveaux : `cg-branches` (rattachement, historique immuable, refus, droits), `documents` (CG de la branche ; branche sans CG et produit sans branche refusés sans document produit, cotation non bloquée ; réédition qui garde la CG figée), `stockage-reorganisation` (injoignable : arrêt ; 404 : introuvable ; autre erreur : rapport).
- Reprise de la migration vérifiée sur une copie de la base de développement (copie supprimée).

## Écarts
- **Bout en bout NON validé** : 5 fichiers sur 6 échouent ici pour des raisons étrangères à l'étape : dates d'effet de 2026 antérieures à aujourd'hui (règle SECURPRO), Redis absent, `pdftotext` illisible sous Windows. J'ai seulement adapté leur rattachement de CG (typecheck vert). À rejouer dans le conteneur.
- Aide de test : les tests d'intégration rattachent leurs CG par `rattacherCgDeTest` (remplacement direct de la ligne, base de test seulement).

## Hypothèses ouvertes
- H118 : la mise à jour des CP d'un contrat de groupe prend la CG en vigueur le jour de la mise à jour (nouvelle émission). Faut-il garder la CG d'origine ?
- Besoins découverts, non codés : liste des produits touchés par une branche sans CG avant émission ; mention `cdc.md` §6.8 (visa lu au produit) à mettre à jour par Thierry.
