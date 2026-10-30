# Compte rendu — bareme-b4-champs-garanties (30/10/2026)

Branche `bareme-b4-champs-garanties`, issue de `main` (8f8bd7a, qui contient 333b544). Commit local, rien de fusionné ni poussé.

## Ce qui est livré
La Technique crée et modifie un barème **à l'écran**, sans Excel : `/parametrage/produits/<code>/bareme/<versionId>`, ouvert depuis le panneau « Barème de cette version » (« Créer un barème vide », « Modifier à l'écran », « Consulter à l'écran »). L'écran édite le **même document** que l'import, validé par le même schéma zod et la même `verifierBareme` ; les contrôles en continu en sont le reflet (rouge = publication bloquée). Onglets actifs : Champs (et blocs), Intermédiaires, Garanties et composantes. Onglets en lecture : Sous-jacents, Tables, Jeux d'essai (avec la mention « modifiable par le classeur jusqu'à la session B5 »). Suppression ou changement de code d'un élément lu ailleurs : refusé en nommant ce qui le lit.

## Écart entre le brief et D49 (le brief avait tort)
Le brief demandait que « Modifier » sur un barème publié crée un brouillon sur la **même version**. D49 et le déclencheur de la base l'interdisent (une correction est une nouvelle version) et la publication aurait produit une seconde ligne PUBLIE. Décision de Thierry : sur un publié, le bouton est « Créer une nouvelle version à partir de ce barème » ; date d'effet **saisie**, postérieure à aujourd'hui ; version créée par le service existant (`creerVersionDansTransaction`, extrait de `creerVersion`) ; copie du publié en brouillon dans la même transaction ; refus nommé si une version à venir a déjà un barème ; alerte H140 applicable. Tracé en **H157** (renvoi à D49).
Précision : la copie a la **même empreinte** que le publié (l'empreinte est le SHA-256 du contenu, identique tant qu'on ne modifie rien) ; le couple (version, empreinte) les distingue, comme dans les cotations.

## Fichiers
- Domaine : `domaine/bareme/edition.ts` (codes proposés, opérandes et profondeur 2, conditions, « qui lit quoi », suppressions et renommages refusés, valeurs et attributs, barème vide, résumé de journal).
- Serveur : `serveur/bareme-edition.ts` (`lireBaremePourEdition`, `creerBaremeVide`, `creerVersionDepuisBareme`) ; `serveur/bareme.ts` (`enregistrerBrouillonBareme` avec `toleranceIntegrite`, résumé de journal enrichi) ; `serveur/parametrage.ts` (`creerVersionDansTransaction` extrait de `creerVersion`, comportement inchangé).
- Écran : `composants/bareme/` (éditeur, trois onglets actifs, trois en lecture, panneau de contrôles, éditeurs d'opérande et de condition) ; page et actions de `parametrage/produits/[code]/` ; `ListeDeroulante` : option `desactive`.
- Docs : `decisions.md` (D58, H157 à H162), captures `captures-b4/` (1440 et 390 px).

## Tests
- Unitaires : `edition.test.ts` (32 : propositions de code, profondeur, références croisées, refus nommés, renommages, attributs) ; `EditeurBareme.test.tsx` (22 : onglets et panneaux accessibles, lecture seule, contrôles, sept opérandes, conditions par listes).
- Intégration : `bareme-edition.integration.test.ts` (16) : barème vide, enregistrement avec journal avant/après, contrôle bloquant (publication refusée, journalisée), mêmes erreurs qu'à l'import, publié intouchable (service et base), refus sans droit, aller-retour export / réimport (même empreinte), nouvelle version depuis un publié avec cotation citante inchangée, date passée refusée, version à venir déjà au barème, même date, brouillon refusé.
- Bout en bout : `bareme-ecran.e2e.test.ts` (champ liste, garantie à deux composantes, taux modifié, essais rejoués : l'écart « dde, attendu 12000, obtenu 14000 » s'affiche, correction, publication).
- Navigateur (Chromium, pile de test, application compilée, base de développement jetable) : flèches, Début et Fin sur les onglets ; ajout d'un champ liste et de valeurs avec code proposé ; refus nommé en supprimant `occupation` ; enregistrement (journalisé) ; garantie et composante ajoutées ; aucun débordement de l'éditeur à 390 px.
- Suite complète (conteneurs, projet `sim-tests`, jamais `sim-b1`) :

| Suite | Résultat |
|---|---|
| Unitaires | 61 fichiers, 749 tests verts |
| Intégration | 31 fichiers, 407 tests verts (mesuré le 30/10, y compris le test d'empreinte ; pile `sim-tests` seule, `sim-apercu` inactive) |
| Bout en bout | 8 fichiers, 16 tests verts |
| lint, typecheck, build | sans erreur |
| pytest (générateur) | non relancé : générateur non modifié |

- Empreinte (ajouté avant fusion) : copie d'un publié, taux modifié, enregistré → empreinte du brouillon ≠ celle du publié et = SHA-256 du JSON canonique du contenu ; publié → empreinte publiée = SHA-256 du contenu final, publié d'origine inchangé. Elle est bien recalculée à chaque enregistrement : aucune correction.

## Écarts et limites
- **Tolérance à l'enregistrement** (H158) : le schéma est exigé, les problèmes d'intégrité n'empêchent pas d'enregistrer (ils bloquent la publication). Sans cela, toute modification touchant une table ou un sous-jacent (lecture seule) aurait été impossible à enregistrer.
- **Champ obligatoire ajouté** : les essais existants échouent tant qu'ils ne le renseignent pas (H161) ; à corriger par le classeur jusqu'à B5.
- Le code d'un champ figé (publié) n'est protégé que dans l'écran : le serveur reçoit un document entier et ne distingue pas un renommage d'un ajout suivi d'une suppression.
- Débordement horizontal à 390 px (≈ 550 px) dû à un filigrane SVG de la coquille, **déjà présent** sur les autres pages (taxes, fiche produit) : non traité ici.
- Le serveur de développement (Turbopack, bind mount Windows) ne voyait pas la nouvelle route ; vérification faite sur l'application compilée.

## Hypothèses ouvertes
H157 à H162 (voir `decisions.md`, D58).
