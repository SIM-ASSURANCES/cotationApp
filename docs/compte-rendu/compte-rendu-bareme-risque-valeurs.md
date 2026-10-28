# Barème, documents : valeurs intermédiaires et attributs tarifaires sous risque.* et risque_code.*

Branche `bareme-risque-valeurs`, REBASÉE sur `main` (qui contient `bareme-libelles`, D55). Commits locaux, rien de poussé. Décision D54, hypothèse H148.

## Ce qui change
- `risque.<code>` ET `risque_code.<code>` exposent, avec la MÊME valeur (ni liste ni oui / non), (1) les valeurs intermédiaires du barème (SECURPRO inventé : `contenu`, `capital_immo`, `capitaux_totaux`), le montant décimal calculé par le moteur ; (2) les attributs tarifaires de la valeur choisie d'un champ liste, `<champ>_<attribut>` (`type_commerce_classe`).
- Une fonction de construction (`domaine/bareme/documents.ts`, `valeursDuBareme`, rendu libellé ou code) pour les champs, les attributs et les intermédiaires ; `codesRisqueDuBareme` les comprend tous : le contrôle au dépôt les reconnaît pour les deux racines.
- Un champ non imprimable (`surDocuments: false`) vide aussi ses attributs. Valeur non calculable (champ inapplicable, saisie incomplète) : « », jamais une erreur. Même code sur deux sources : le champ gagne (H148).
- UNE fonction de chargement et UNE règle pour les cotations antérieures : celles de D55 (`risqueDuDocument` / `avecRisqueDuDocument`, serveur/bareme.ts), appliquées à la cotation, à la police et aux factures. La version D54 (`avecRisqueComplet`) a été abandonnée au rebasage.

## Conflits résolus au rebasage
- `domaine/bareme/documents.ts` et son test : fusion des deux versions (libellés/codes + attributs/intermédiaires) en une seule construction.
- `serveur/bareme.ts`, `serveur/documents.ts`, `serveur/factures.ts` : version de `main` (D55) gardée telle quelle.
- `decisions.md` (D54 puis D55) et `guide-balisage.md` : textes fusionnés, D54 précise les deux racines.
- Tests d'intégration D54 : portés sur le chargement unique, avec `risque_code` vérifié.

## Test « le format du numéro de police se paramètre »
Cause : il inscrivait un paramètre au 2999-01-01 sans l'effacer (l'application n'efface jamais un paramètre, une valeur par date d'effet) : échec à toute relance sur une base non recréée. Introduit par 7572dd4 (08/10/2026). Corrigé dans un commit séparé (date à cent ans d'aujourd'hui, valeur effacée avant et après).

## Tests et suite complète
Voir le tableau en fin de fichier.

## Besoins notés (non codés)
- H150 (D55) reste valable : un modèle déjà publié qui compare `risque.<champ>` à un code doit passer à `risque_code.<champ>`.

## Tableau de la suite complète
| Contrôle | Résultat |
|---|---|
| Unitaires | 680/680 |
| Lint / typecheck | 0 erreur / vert |
| Build | réussi |
| Intégration (conteneur, base recréée, vrai générateur) | 29 fichiers, 373/373 |
| E2E (conteneur, vrai générateur, Redis, pdftotext) | 6 fichiers, 13/13 |
| pytest (générateur) | non lancé (aucun fichier du générateur touché) |
Conteneur : image d'outils du dépôt, `src` / `prisma` / `scripts` montés en lecture seule, Postgres / Redis / générateur jetables sur un réseau à part (supprimés ensuite).

## Commits
(voir `git log` de la branche)
