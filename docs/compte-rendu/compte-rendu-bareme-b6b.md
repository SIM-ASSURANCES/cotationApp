# Compte rendu — B6b, documents, import en masse et finitions du barème

Branche `bareme-b6b-documents`. Décisions : D52 (`docs/decisions.md`), hypothèse H146. Commits locaux, rien de poussé ni fusionné.

## Écart de départ
- B6a n'est **pas** dans `main` (ni local ni `origin/main`) : le rebase demandé était sans objet. La branche portait B6a sous d'autres hashes mais pas le correctif `a90c54a` (saisie conservée) : repris par cherry-pick. `main` (correctif fiche cotation sans droit factures) n'est **pas** intégré : la fusion est interdite par les instructions, à faire par Thierry.

## Points
1. Import en masse, option 2c : plafond = effectif figé, adhérents actifs, barème par effectif seulement ; modèle et aide corrigés (`&police=` pour l'effectif maximal).
2. Balises `risque.<code>` : écrites dans `risque` de la cotation depuis la saisie figée ; vides = facultatives ; avertissement au dépôt d'un modèle (balise inconnue du barème publié).
3. Portefeuille : mode lu sur la version (corrige « Par formule » pour un barème), « Au barème ».
4. Page produit : tableau des formules masqué au barème.
5. H145 : message du barème sur la fiche d'un brouillon à formules.
6. Entrée = « Calculer » (`entreeSur`). 7. Fiche à 390 px : l'empreinte (64 car.) faisait déborder la page, `break-all`.

## Tests
- Unitaires 668/668 ; intégration 350 réussis, 10 ignorés ; lint, typecheck, build : verts.
- Navigateur (`verifier-cotation-bareme.mjs`, Edge, base `_test` à part supprimée) : 1440 et 390 px, tous les contrôles passent, dont Entrée (points 6) et absence de défilement horizontal (point 7).
- **Non exécutés** : e2e (générateur injoignable sur 8001), pytest. Le script n'a pas été rejoué sur l'ancien code pour les points 6 et 7.

## Écarts, hypothèses ouvertes, besoins découverts (non codés)
- **H146** à confirmer : un `risque.*` vide s'écrit vide pour tout produit, y compris les champs libres sans barème.
- Avertissement (non rejet) pour une balise inconnue : choix à confirmer.
- Valeur de `risque.<code>` = code saisi (pas le libellé de la liste) ; le drapeau `surDocuments` du schéma reste inutilisé.
- Le modèle d'import ne connaît pas l'effectif sans `&police=` (fichier générique : seulement la règle).
- Lignes en trop d'un import : l'avenant d'incorporation d'une police au barème reste refusé (H143, B8).
- Autres formulaires qui se vident au refus : voir le compte rendu du correctif B6a.

## Commits
