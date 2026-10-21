# Compte rendu — Étape 3 : Seuil unique de validation

Branche `phase-seuil-unique`. Décision **D39**, fin de l'écart **D21**, hypothèses **H109** et **H110** (`docs/decisions.md`).

## Réalisations

1. **Seuil global unique (point 1)** :
   - Paramètre global d'entreprise (écran « Société », clé `seuil_validation_global`), défaut 10 000 000 FCFA TTC.
   - Historisé avec date d'effet (non rétroactive) et journalisé (`PARAMETRE_MODIFIE`).
   - Retiré de la saisie des versions de produits (gardé en base pour l'historique, plus utilisé).
   - Comparaison stricte inchangée (D18) : 9 999 999 F et 10 000 000 F passent, 10 000 001 F va en validation.
2. **Valideurs & fin de l'écart D21 (point 2)** :
   - Profils Technique ET Direction Générale habilités à valider (cotation, contrat H44, facture H56).
   - Clôture formelle de l'écart D21 avec le CDC §4.1.
3. **Circuit de validation (point 3)** :
   - Validation unique par l'un des deux profils (arbitrage Thierry confirmé, H110).
4. **Séparation des tâches & intangibilité (point 4)** :
   - Auteur, composeur, demandeur ou contributeur ne peuvent pas valider leur propre pièce.
   - Cotations et documents émis avant le changement strictement intangibles (T10).

## Base de données & Migration

- Migration `20261021120000_seuil_unique_validation` : valeur par défaut 10 000 000 FCFA TTC dans `parametres`, et droits `DIRECTION_GENERALE` à `VALIDE` sur `VALIDER_COTATION`, `EMETTRE_CONTRAT`, `EMETTRE_FACTURE` avec audit.

## Tests & Qualité

- Tests unitaires et intégration verts : seuil-unique (9 tests), cotations (39), validation-contrat (8), factures (37), seuil-validation, droits, lire-version, migrations.

## Besoins découverts en route (non codés)

- Aucun besoin bloquant hors périmètre ; adaptation propre des jeux de données d'intégration aux règles du seuil unique.

