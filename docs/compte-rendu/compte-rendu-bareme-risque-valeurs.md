# Barème, documents : valeurs intermédiaires et attributs tarifaires sous `risque.*`

Branche `bareme-risque-valeurs` (depuis `main`). Commits locaux, rien de poussé. Décision D54, hypothèse H148.

## Ce qui change
- `risqueDuBareme` (`domaine/bareme/documents.ts`) fournit désormais trois familles de balises : (1) champs du barème (inchangé) ; (2) attributs tarifaires de la valeur choisie d'un champ liste, `risque.<champ>_<attribut>` (SECURPRO : `risque.type_commerce_classe`) ; (3) valeurs intermédiaires calculées par le moteur (`risque.contenu`, `risque.capital_immo`, `risque.capitaux_totaux`).
- Elles sont figées avec la cotation (`cotation.risque`, reprise par la police) au même endroit que les champs : aucune autre couche touchée.
- `codesRisqueDuBareme` les inclut : le contrôle des modèles au dépôt (D52) ne les signale plus comme inconnues.
- Une valeur qui dépend d'un champ inapplicable vaut « » (jamais zéro). Même code sur deux sources : le champ gagne, puis l'attribut, puis l'intermédiaire. Seuls les attributs au nom de balise valide sont exposés (H148).
- `guide-balisage.md` mis à jour.

## Tests (SECURPRO inventé)
- Unitaires (`documents.test.ts`) : contenu 8 866 500, capital_immo 18 000 000 (loyer × 120), capitaux_totaux 26 866 500 (locataire) ; 1 000 000 / 20 000 000 / 21 000 000 (propriétaire) ; classe 2 (Électronique), 1 (Bureau), 4 (Quincaillerie) ; attribut et intermédiaire vides si le champ est inapplicable ; priorité du champ sur un intermédiaire de même code.
- Intégration (`cotation-bareme.integration.test.ts`, 18/18) : la cotation enregistrée porte ces valeurs, la demande de PDF les reçoit, le dépôt d'un modèle qui les emploie ne produit aucun avertissement.
- Unitaires 673/673 ; `tsc` et eslint (domaine/bareme, test d'intégration) verts.
- Non lancés : suite d'intégration complète, e2e, `npm run build`, pytest. `cotations.integration.test.ts > le format du numéro de police se paramètre` ÉCHOUE déjà sur `main` sans mes changements (constaté par remise de `main`) : sans rapport, à regarder à part.

## Cotations antérieures à D54 (point 1)
- `risqueCompletDuDocument` (serveur/bareme.ts) : si le calcul figé est d'origine BAREME, relit le barème de la version ET de l'empreinte figées, et complète `risque` avec `risqueDuBareme(saisie figée)`. Calcul pur, rien n'est écrit ; ce qui est déjà enregistré n'est jamais remplacé ; barème introuvable ou altéré : `risque` inchangé. Appliqué au chargement de la cotation, de la police (CP, certificat) et de la police des factures, avoirs et reçus.
- `risqueDuBareme` ne lève plus d'erreur de saisie : une valeur non calculable vaut « ».
- Tests d'intégration SECURPRO : cotation dont les 4 clés sont retirées (cotation et police) → CP avec contenu 8 866 500, capital_immo, capitaux_totaux, classe 2, police inchangée en base ; saisie figée sans le stock → contenu et capitaux totaux vides, classe et capital_immo renseignés, aucune erreur. Les deux échouent sans le correctif.

## Test « le format du numéro de police se paramètre » (point 2)
- Cause : le test inscrivait un paramètre au 2999-01-01 sans l'effacer ; l'application ne supprime jamais un paramètre et n'en accepte qu'un par date d'effet. Sur une base non recréée, toute relance échoue (« Une valeur est déjà enregistrée à cette date d'effet »). `npm run test:integration` recrée la base, ce qui masque le défaut ; il apparaît en lançant vitest directement sur une base déjà utilisée.
- Introduit par le commit 7572dd4 (08/10/2026, « Taxes par branche et type de contrat, cotation (H1, H7, H9, H10, H12) »), latent depuis : pas une régression d'une fusion récente (bisect inutile). Sur une base fraîche il passe sur `main`.
- Correction (commit séparé) : date à cent ans d'aujourd'hui, valeur effacée avant et après (base de test, déclencheur contourné). Vérifié en 2 relances successives sur la même base.

## Tableau de la suite complète (point 3)
| Contrôle | Résultat |
|---|---|
| Unitaires | 674/674 |
| Lint / typecheck | 0 erreur / vert |
| Build | réussi |
| Intégration (conteneur, base recréée, vrai générateur) | 29 fichiers, 371/371 |
| E2E (conteneur, vrai générateur, Redis, pdftotext) | 6 fichiers, 13/13 |
| pytest (générateur) | non lancé (aucun fichier du générateur touché) |
Conteneur : image d'outils du dépôt avec `src`, `prisma`, `scripts` montés en lecture seule, Postgres / Redis / générateur jetables sur un réseau à part (supprimés ensuite) ; `poppler-utils` ajouté dans le conteneur pour les contrôles de texte des PDF.

## Besoins notés (non codés)
- Libellés : `risque.<champ>` rend le CODE de la liste (« LOCATAIRE »), pas son libellé (« Locataire »). La correction des libellés de B6b n'est dans aucune branche (aucun commit « libellé » dans `git log --all`) : elle reste à faire AVANT cette fusion si les cases à cocher du CP en dépendent.
- Pas de recette visuelle d'un PDF.

## Commits
(voir `git log` de la branche)
