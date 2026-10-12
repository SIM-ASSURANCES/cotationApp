# Compte rendu de la refonte visuelle, session V2 : pages métier

Écrit le 12/10/2026, branche `refonte-v2`, **non fusionnée**. Elle est **empilée** sur `phase-6.2b-h98` (H98), elle-même sur `phase-6.2b` : fusionner dans cet ordre, sinon la V2 embarque ces commits. Décision : [decisions.md](decisions.md#d33--refonte-visuelle-v2--les-pages-métier-prennent-la-bibliothèque-dinterface) (D33). **Présentation seulement** : rien dans `domaine/`, `serveur/`, le schéma, les migrations, le générateur ni les droits (diff vide depuis H98) ; aucune dépendance npm ; aucune Server Action modifiée.

## Ce qui est fait

| Lot | Pages | Commit |
| --- | --- | --- |
| Bibliothèque | `LienBouton`, `Bandeau`, `ListeDefinitions`, `PastilleStatut` + table unique des statuts, `Carte` titrée, `Tableau` à zébrure facultative, `stylesBouton.ts` | `684aa2d`, `47597f1` |
| 1 | Cotations (liste, nouvelle, fiche, modifier, adhérents, factures de la police), clients | `b32426c` |
| 2 | Factures, échéances, documents émis | `4873729` |
| 3 | Modèles Word (liste, détail, aide), imports | `8282ec8` |
| 4 | Paramétrage (produits, versions, relances, branches, taxes, intermédiaires, société), calcul | `9020af2` |
| 5 | Administration (utilisateurs, droits, stockage, audit), mon compte, tableaux de bord, accueil | `ccfe13c` |

Captures : `docs/captures/refonte-v2/avant/` et `apres/`, 41 pages × 1440 px et 390 px (JPEG, données inventées, base de développement). Contrôle automatique de chaque page « après » : aucune erreur HTTP, aucune erreur de page, aucun défilement horizontal (12 pages débordaient à 390 px avant correction, 0 après).

## Revue contradictoire

Cinq relecteurs indépendants (un par lot). Aucune régression de comportement. Défauts réels, corrigés avant commit : import d'une fonction d'un fichier client depuis un composant serveur (bloquant : le build l'aurait refusé), statuts sans ton, zébrure sur des lignes de champs, zones défilantes non positionnées (`.sr-only` qui élargissait la page), grille qui s'étirait avec un tableau large, bandeau étroit à côté d'un bouton sur mobile, zone d'envoi de la fiche cotation trop serrée sur mobile.

## Tests

| Suite | Résultat |
| --- | --- |
| Unitaires (`npm test`) | 444 verts (nouveaux tests de la bibliothèque : statuts, `LienBouton`, `Bandeau`, `ListeDefinitions`, `Carte`, `Tableau`) |
| `npm run lint`, `npm run typecheck`, `npm run build` | propres |
| Intégration, bout en bout, `pytest` | non relancés : aucun fichier de `serveur/`, `domaine/` ni du générateur n'a changé depuis H98 |

## Écarts à valider

- Table des statuts **étendue** au-delà de la consigne (liste dans D33) ; chaque ton se change dans `statuts.tsx`.
- Quelques textes de présentation ont changé (messages de tableau vide, en-têtes de colonnes, « Derniers lots » en tableau).
- Zébrure désactivée là où les lignes contiennent des champs ; `Tableau` dans `Carte` = cadre dans un cadre.
- Tableau des formules masqué pour une version en mode `GARANTIES` (il était toujours vide).

## Non vérifié

Appareils réels (iPhone, Android), Safari, lecteur d'écran, rendu des PDF (non concernés, mais non rouverts). Les captures sont celles de Chromium.

## Hypothèses ouvertes

Aucune nouvelle hypothèse numérotée (H101 reste la dernière).
