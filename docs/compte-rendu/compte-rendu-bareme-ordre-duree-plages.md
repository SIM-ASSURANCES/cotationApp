# Compte rendu — session bareme-ordre-duree-plages (D64, H191 à H199)

Branche `bareme-ordre-duree-plages`, issue de `main` (e99ea15), worktree séparé, commits locaux. Décisions de la Direction Technique du 04/11/2026.

## Livré
1. **Minimum avant coefficients, par composante** (`minimumAvantCoefficients`) : essai inventé 625 → max(625 ; 2 500) × 1,25 = 3 125, contre 2 500 par défaut. Schéma, `verifierBareme` (`MINIMUM_ABSENT`), moteur, classeur (colonne `minimum_avant_coefficients`, modèle, Lisez-moi), écran Garanties, aller-retour à empreinte identique.
2. **Durée imposée par version** (1 an, sans prorata, tous modes) : colonne `duree_imposee_un_an`, case dans le formulaire de version, échéance recalculée par le serveur (`avecDureeImposee`), champ d'échéance affiché et non saisi, prorata inactif (la durée imposée exclut le prorata : validation et CHECK en base).
3. **Plages de montant** : plage sous le champ et au survol, bandeau nommant le champ et la plage, calcul automatique suspendu, même refus et même texte au serveur.
4. **Jalon 1** : les 6 essais SECURPRO inventés et le cas à 139 420 F sont inchangés (suites unitaires `securpro`, `oracle`, classeur : vertes).
5. **Liste → montant borné** dans une version issue d'un publié : accepté à l'écran et à l'import, garde H167 non modifiée.

## Fichiers
Domaine : `bareme/schema.ts`, `garantie.ts`, `verification.ts`, `plage.ts` (nouveau), `contexte.ts`, `formulaire.ts`, `calcul/dates.ts` (`echeanceUnAn`), `calcul/parametrage.ts`.
Serveur : `cotations.ts`, `parametrage.ts`, `bareme-classeur-ecriture.ts`, `bareme-classeur-lecture.ts`.
Écrans : `composants/EcheanceImposee.tsx` (nouveau), `composants/bareme/FormulaireCotation.tsx`, `OngletGaranties.tsx`, `cotations/champs-bareme.tsx`, `formulaire-cotation.tsx`, pages nouvelle et modifier, fiche produit et `lire-version.ts`.
Base : migration `20261104100000_version_duree_imposee`, `schema.prisma`. Documentation : `docs/decisions.md` (D64, H191 à H199).

## Tests ajoutés
- Unitaires : `effets.test.ts` (ordre, 6 cas), `plage.test.ts` (nouveau), `codes-figes.test.ts` (liste → montant), `bareme-classeur.test.ts` (colonne, aller-retour, ancien classeur, liste → montant), `dates.test.ts` (29/02/2028 → 28/02/2029 ; 01/03/2027 → 29/02/2028 ; 05/11/2026 → 04/11/2027), `lire-version.test.ts`.
- Intégration : `duree-imposee.integration.test.ts` (nouveau, 5 tests), `duree-imposee-bareme.integration.test.ts` (nouveau, 4 tests : SECURPRO inventé au barème, effets 05/11/2026, 01/03/2027, 01/09/2027 et 29/02/2028 ; échéance imposée, coefficient 1, 139 420 F), `bareme-b5.integration.test.ts` (liste → montant, écran et import).
- Bout en bout : `cotations/duree-imposee.e2e.test.ts` (nouveau, 2 tests).

## Résultats (base vierge, pile jetable)
Unitaires 79 fichiers / 950 ; intégration 35 / 461 ; bout en bout 12 / 22 (relevé final, scripts `npm test`, `npm run test:integration`, `npm run test:e2e`) ; `eslint`, `tsc`, `npm run build` sans erreur. Voir H199 pour le piège de l'e2e lancé sans `npm run test:e2e`.

## Écarts
- **Captures non réalisées** : la recette navigateur exige Playwright, un navigateur et l'application lancée sur une base préparée (trois scripts `preparer-recette-*`) ; rien de cela n'est installé sur ce poste. À faire à part : écran de cotation (plage, message hors plage, échéance imposée) et écran Garanties (case « minimum avant coefficients »).
- `pytest` du générateur non rejoué (aucun changement du générateur).
- **Échéance du 29 février** corrigée (H192) : la veille du même jour de l'année suivante ; 29/02/2028 → 28/02/2029. Ce période compte 366 jours inclus (la consigne annonçait 365) ; sans effet sur les montants (coefficient 1).

## Hypothèses ouvertes
H191 à H198 (portée du minimum, 29 février, exclusion durée/prorata, périmètre de la durée imposée, `MINIMUM_ABSENT`, libellé de plage, tables clés d'une liste devenue montant, schéma inchangé), à confirmer par la Technique.
