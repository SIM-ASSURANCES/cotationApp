# Correctif de recette — la fiche d'une cotation plante pour un Commercial

Branche `fix-fiche-cotation-droits` (issue de `main`). Commits locaux, rien de poussé. Aucun droit par défaut modifié.

## Cause

Les liaisons de l'étape 4 (commit 5109d0d) ont ajouté à la fiche `cotations/[id]` l'appel `facturesDePolice(...)` dès que la cotation a une police. Ce service refuse (`ErreurAcces : Droit insuffisant : factures`) tout profil qui ne lit ni les factures, ni les avoirs, ni les paiements. Le Commercial (Aucun sur ces trois droits) peut ouvrir la fiche (il lit les cotations) : l'erreur, levée pendant le rendu, donnait la page d'erreur.

## Correction

- Nouveau `serveur/fiche-cotation.ts` : `chargerPartiesLiees` charge documents, validation du contrat, tâches de la police et factures, chacun seulement si le profil a le droit de le lire (le contrôle reste dans les services : ils refusent toujours sans droit).
- `serveur/factures.ts` : `peutLireFactures` (même règle que `exigerLecture`).
- La fiche n'affiche plus l'avenant (lien « Adhérents ») sans droit de lecture du contrat ; sans droit sur les factures, la carte « Contrat, avenants et facturation » montre la police et les CP autorisées, puis « Factures, avoirs, reçus et relances : accès réservé » (pas de lien vers la gestion des factures).

## Même motif ailleurs (revue de toutes les pages à plusieurs services)

Aucune autre page ne l'a. Fiche facture, factures de la police, factures, portefeuille (4 niveaux), recherche des documents, tableau de bord, échéances, imports : le service est de leur propre domaine et l'`ErreurAcces` est interceptée (redirection « accès refusé » ou accueil). Adhérents : garde `EMETTRE_CONTRAT` identique à celle de tous ses services. Pages de paramétrage et de cotation : droits identiques (`PARAMETRER_PRODUITS`, `CREER_COTATION`) entre la garde de la page et ses services. Seul `cotations/[id]` mêlait des domaines.

## Tests

- Intégration `fiche-cotation.integration.test.ts` : cotation acceptée avec police, CP, facture, reçu ; pour les six profils par défaut, `chargerPartiesLiees` ne lève jamais et ne renvoie que les parties autorisées (Commercial : aucune ; Comptabilité et Admin n'ouvrent pas la fiche : accès refusé, pas d'erreur) ; le service des factures refuse toujours le Commercial.
- Unitaires, typecheck, eslint : verts. Intégration complète et build : voir ci-dessous.

## Commits

(voir `git log` de la branche)
