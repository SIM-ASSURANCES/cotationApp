# Correctif de recette B6a — la saisie ne s'efface plus (cotation au barème)

Branche `bareme-b6a-cotation`. Commits locaux, rien de poussé.

## Cause exacte

React 19 **remet à zéro un formulaire dès que son action serveur se termine**, que l'action réussisse ou refuse (`requestFormReset` après chaque `<form action>` ou `formAction` de bouton). Les champs non contrôlés retrouvent alors leur `defaultValue` : souscripteur, type de contrat, régime de taxe, dates, champs du barème, cases…

- « Calculer » était un bouton `type="submit"` avec `formAction={calculer}` : le calcul réussi remettait tout le formulaire à zéro.
- « Créer / Enregistrer le brouillon » passe par `FormulaireAction` (`<form action>`) : un **refus** (champ manquant, refus E4) effaçait aussi la saisie. Seul un enregistrement réussi doit quitter la page (redirection).
- Constaté dans le navigateur sur l'ancien code : 63 champs relus après « Calculer », nom, prénoms, contrat, échéance et champs du barème étaient vides.

## Correction (option A)

- `champs-bareme.tsx` : « Calculer » est un `type="button"` ; il lit `new FormData(form)` et lance l'action de calcul dans `startTransition`. Aucun envoi, aucune remise à zéro.
- `FormulaireAction.tsx` : nouvelle option `conserverSaisie` (désactivée par défaut). L'envoi est intercepté (`preventDefault`), l'action est lancée à la main avec le même `FormData` (bouton déclencheur compris) ; l'état d'erreur et le spinner restent ceux de `useActionState`. L'attribut `action` reste le repli avant l'hydratation.
- `formulaire-cotation.tsx` : active `conserverSaisie` (création et modification d'un brouillon).
- « Soumettre » (fiche de la cotation) n'a aucun champ saisi (identifiant caché) : rien à conserver.
- Effet de bord assumé : la touche Entrée dans un champ déclenche désormais « Créer / Enregistrer le brouillon » (avant, le premier bouton d'envoi du formulaire était « Calculer »).

## Autres formulaires ayant le même défaut en cas de refus (listés, NON corrigés)

Tout formulaire `FormulaireAction` qui contient des champs saisis se vide au refus (même mécanisme). Par nombre de champs :
`parametrage/societe` (5 formulaires), `parametrage/produits/[code]` (version : 2), `cotations/[id]` (accepter avec compléments du souscripteur, composer la prime…), `cotations/[id]/adherents` (5), `factures/[id]` (8), `modeles/[id]` (4), `cotations/[id]/factures` (4), `modeles` (2), `admin/utilisateurs` (3), `parametrage/taxes`, `clients` (8 champs), `parametrage/intermediaires`, `parametrage/produits`, `parametrage/branches`, `parametrage/produits/[code]/relances`, `panneau-bareme`, `imports/[id]`, `TachesPolice`, `mon-compte`, `conditions-generales`, `connexion` (vider le mot de passe après un refus est acceptable). Correction possible partout par `conserverSaisie` ; à décider formulaire par formulaire (après un succès, la remise à zéro reste souhaitable pour les formulaires de création).

## Tests

- Recette navigateur `app/scripts/verifier-cotation-bareme.mjs` (Edge via Playwright installé à part, base `sim_documents_recette_test` à part, supprimée ensuite, données inventées, préparée par `scripts/preparer-recette-bareme.mts`) : **1440 px et 390 px, tous les contrôles passent** — saisie complète du SECURPRO inventé, Calculer (60 champs inchangés, TTC 139 420), changement d'un champ (résultat effacé, seul ce champ change), refus E4 au calcul et à l'enregistrement (champs conservés, on reste sur la page), champ obligatoire manquant (idem), enregistrement réussi (fiche à 139 420).
- Le même script sur l'ancien code échoue (champs vidés) : il détecte bien le défaut.
- Unitaires 653/653, `typecheck` et `eslint` sur les fichiers touchés : verts. Intégration, e2e, build complet, pytest : non relancés (aucun fichier de domaine ni de serveur touché).

## Constat hors périmètre

La fiche d'une cotation au barème défile horizontalement à 390 px (largeur de page 603 px, cause non identifiée ; non dû à ce correctif, la page n'est pas touchée). À traiter à part.

## Commits

(voir `git log` de la branche)
