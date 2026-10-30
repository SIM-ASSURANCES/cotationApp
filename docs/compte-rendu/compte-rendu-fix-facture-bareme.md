# Compte rendu — fix-facture-bareme (D60, H170-H171)

Branche `fix-facture-bareme`, depuis `main` (B4 fusionné), **commit local, non fusionnée, non poussée**. Worktree `sim-documents-fixfacture`. Décision : [decisions.md](../decisions.md) D60.

## Défaut et correction

La facture d'affaire nouvelle d'une police au barème (composition d'origine BAREME) était lue comme une composition manuelle non faite : « Émettre » absent, « Composer une prime » proposé, et `composerFacture` acceptait une composition manuelle (contournement de Q3 et du futur forçage B7).

- `estCompositionManuelle` ajouté à `domaine/calcul/composition.ts`.
- `serveur/factures.ts` : drapeaux d'écran (`emettre`, `composer`, `composition`), libellé de statut et garde d'émission utilisent ce prédicat ; `composerFacture` refuse une facture au barème (`MESSAGE_FACTURE_AU_BAREME`).
- Avenant et renouvellement au barème : inchangés (refus H143), vérifiés par test.

## Inventaire des usages de `estComposition` (sens « composition manuelle »)

| Fichier | Usage | Sens | Suite |
| --- | --- | --- | --- |
| `factures.ts` émission, libellé, `lireFacture` | « à composer » | manuelle | **corrigé** |
| `factures.ts` `composerFacture` | refus de nature | manuelle | **corrigé** (refus barème ajouté) |
| `factures.ts` renouvellement (≈339), avenant (≈440), `modifierFacture` (≈576) | reprise de lignes précédentes | structure de lignes, atteinte après le refus H143 | inchangé |
| `factures.ts` `prorataAvenant` (168), `lireFacturesDePolice.composee` (≈1561) | prorata sans objet ; texte d'aide | structure ; voir point ouvert | inchangé, décrit |
| `cotations.ts` 650-677, 741-742, 780, 1003, 1184 | brouillon à formules, composition vidée, acceptation, lecture | déjà séparent `estCompositionBareme` (C8, B6a) ; 780 : refus déjà posé en amont (`MESSAGE_TARIFICATION_AU_BAREME`) | inchangé, **à confirmer** |
| `cotations.ts` `estNonComposee` (548, 573, 851, 1118) | ttc nul / « à composer » | lignes vides ; jamais vide pour un barème | inchangé |
| `documents.ts` 133, 390 | montants, détail des garanties | structure ; barème traité à part (134) | inchangé |
| `imports.ts` 270, 305 | `sansFormule` (import sans colonne formule) | structure : vrai aussi pour le barème | inchangé |
| `parametrage.ts` 874-875 | moteur de composition / arrondi | structure | inchangé |
| Avenants, tâches | aucun usage direct hors `factures.ts` | | |

Rien à toucher hors du périmètre facture n'a été modifié ; les lignes « à confirmer » attendent votre accord.

## Tests

- Intégration (`cotation-bareme.integration.test.ts`, bloc D60, 4 tests), par `lireFacture().actions` : barème → `emettre` vrai (Gestionnaire), `composer` faux (Gestionnaire et Technique), libellé « Brouillon », `composerFacture` refusé sans rien écrire, émission au TTC de la cotation ; profil sans droit : pas d'« Émettre » ; renouvellement et avenant refusés (H143) ; produit par garanties : `composer` vrai, composition lue, recomposition acceptée.
- E2E (`facture-bareme.e2e.test.ts`) : cotation au barème → acceptation → CP → facture ; « Émettre » visible (drapeau), émission réelle (vrai générateur), TTC = cotation = jeu d'essai = PDF.
- Suite complète dans le conteneur : typecheck et lint propres ; unitaires 61 fichiers / 749 tests verts ; e2e 9 fichiers verts ; intégration 30 fichiers verts sur 31 en passage complet, le 31e (`cotation-bareme`, bloc D60 compris) a échoué sur le délai de 10 s de son `beforeAll` (machine chargée par d autres piles) et passe seul (26 tests verts).

## Écarts et points ouverts

- **Affaire nouvelle par garanties (H172, corrigée)** : aucune règle du CDC ni de `decisions.md` n'impose de la recomposer (H90/D38 : renouvellement et avenant seulement ; H88/T10 : elle vient de la police figée). La facture reprend la composition figée de la cotation, s'émet selon les règles ordinaires, ne se recompose pas. Tests : intégration par `lireFacture().actions` (bloc D60) et une ligne dans `garanties.e2e.test.ts`.
- Textes d'aide de la page « Factures de la police » faux pour le barème (renouvellement, avenant) — sans effet, à reprendre avec B8.
- README des tests (`app/README.md`) : le lancement d'un e2e seul exige la préparation de la base.
- Les e2e partagent la base avec l'intégration : `signature_sim` posée par une PNG invalide (intégration) fait échouer la CP des e2e si la base n'est pas préparée avant (`npm run test:e2e` la prépare ; lancer un e2e seul demande `test:integration:preparer`).
