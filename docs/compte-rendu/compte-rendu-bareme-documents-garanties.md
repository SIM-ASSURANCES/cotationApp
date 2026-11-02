# Compte rendu — session bareme-documents-garanties (02/11/2026)

Branche `bareme-documents-garanties`, issue de `main` puis **rebasée sur `main` après la fusion de `bareme-formulaire-ergonomie`** (D62, H180–H184). Commits locaux seulement : rien n'est fusionné ni poussé. Décision **D61**, hypothèses **H173 à H178** ([decisions.md](../decisions.md)).

## Ce qui est livré

**A. Composantes affichées** (décision Technique du 02/11 : A6 inchangée, le Vol reste une garantie avec un accessoire)

1. Chaque ligne de garantie d'une cotation au barème **fige** son `code` et ses `composantes` souscrites (code, libellé, assiette, prime nette). Les montants de la ligne ne bougent pas.
2. Une cotation antérieure **reconstitue** ce détail à la lecture, par recalcul du barème figé sur la saisie figée (méthode D54 / D55), **sans rien écrire**. Si le recalcul ne retombe pas sur les lignes figées : ligne sans détail, sans erreur.
3. **Sous-lignes** (libellé, montant garanti, prime nette ; ni accessoires, ni taxe) sous la garantie, sur la fiche de cotation, le résultat du calcul et la facture à l'écran. Une garantie à une seule composante n'en a pas. Dans `champs-bareme.tsx`, seule la table de résultat est touchée.
4. Dictionnaire : `garanties_souscrites[].code` et `garanties_souscrites[].composantes` (liste facultative : `code`, `libelle`, `montant_garanti`, `prime_nette`). Guide de balisage et aide des modèles à jour.

**B. Une CP par garantie, incluse dans la CP générale**

5. `bloc("garanties", g.code)` dans `{%p for g in garanties_souscrites %}` insère, pour chaque garantie souscrite et dans l'ordre, le sous-modèle publié (nom « garanties », clé = code de la garantie ; celui du produit avant le commun).
   **Ce que voit le sous-modèle : toutes les données du document (`risque`, `risque_code`, `souscripteur`, `police`…) ET `garantie`, la ligne courante de la garantie** (`garantie.libelle`, `garantie.montant_garanti`, `garantie.composantes`…, mêmes champs que `garanties_souscrites[]`). **Le nom est bien « garantie »** — consigné dans D61 (point 5), dans le guide de balisage et dans l'aide des modèles. `garantie` n'existe que dans un sous-modèle « garanties » ; le dépôt le refuse ailleurs.
6. Une garantie souscrite **sans sous-modèle publié** refuse l'émission (CP, cotation) **avant la production du document**, en nommant la garantie et la clé attendue. Même refus pour une garantie sans code (composition manuelle, ou cotation antérieure irreconstituable).
7. Dépôt d'une CP qui appelle `bloc("garanties", g.code)` : **avertissement** pour chaque garantie du barème publié sans sous-modèle publié ; avertissement pour un sous-modèle « garanties » dont la clé n'est le code d'aucune garantie du barème ; rejet de `garantie.*` hors d'un sous-modèle « garanties ».
8. Réédition (T10) : les versions de tous les sous-modèles retenus sont conservées avec le document (mécanisme existant) ; la réédition retrouve les mêmes.

Aperçu d'un modèle d'un produit au barème : une ligne de garantie par garantie du barème (vrais codes), pour que `bloc("garanties", g.code)` trouve ses sous-modèles (H178).

## Fichiers principaux

- Domaine : `domaine/bareme/garantie.ts` (prime nette de composante, libellé), `bareme.ts` (code et composantes sur les lignes), `detail-figee.ts` (reconstitution), `documents.ts` (garanties d'exemple), `domaine/calcul/composition.ts` (types), `domaine/documents/dictionnaire.ts`, `donnees.ts`, `controles.ts`, `modeles.ts`.
- Serveur : `serveur/bareme.ts` (`calculAvecDetail`, `avecRisqueDuDocument`, `codesGarantiesDuProduit`), `modeles.ts` (`exigerSousModelesDesGaranties`, `clesDeSousModelesPublies`, dépôt, aperçu), `documents.ts`, `cotations.ts`, `factures.ts`.
- Écrans : `composants/bareme/sousLignes.tsx`, `cotations/[id]/page.tsx`, `cotations/champs-bareme.tsx`, `factures/[id]/page.tsx`, `modeles/aide/page.tsx`.
- Générateur : `generateur/app/fusion.py` (`garantie` pour le bloc « garanties »).
- Fixtures inventées : `cp_garanties_par_garantie_test.docx`, `garantie_sous_modele_test.docx` (`creer_fixtures.py`).
- Tests nouveaux : `detail-figee.test.ts`, `garanties-documents.test.ts`, `bareme-documents-garanties.integration.test.ts`, `bareme-documents-garanties.e2e.test.ts`, 3 tests dans `generateur/tests/test_fusion.py`. Tests modifiés : `emission.test.ts` (champs facultatifs), `factures.integration.test.ts` (les données portent `code: null` et `composantes: []` pour une composition manuelle), `cotation-bareme.integration.test.ts` (la ligne du résultat porte `composantes`).

## Tests (conteneurs, projet `sim-garanties`, jamais `sim-b1`), sur le code final (après le commit « test(e2e) »)

Image de test `sim-tests-tests:poppler`, construite depuis `app/Dockerfile.tests` (avec `poppler-utils`) ; PostgreSQL 18, Redis 7 et générateur à côté ; machine calme (aucune autre pile). Le commit « test(e2e) » est exécuté tel quel : aucune installation manuelle dans le conteneur.

| Suite | Résultat |
|---|---|
| Unitaires (`npm test`) | 72 fichiers, 876 tests, tous verts |
| Intégration (`npm run test:integration`) | 33 fichiers, 440 tests, tous verts |
| Bout en bout (`npm run test:e2e`) | 11 fichiers, 20 tests, tous verts, `pdftotext` présent : `contrats-4a` (3), `import-masse` (1, T8 : 488 certificats, 381 s), `factures` (2), `bareme-documents-garanties` (2), `facture-bareme` (1), `garanties` (1), `bareme-b5` (1), `cotation-souscripteur` (2), `bareme-ecran` (1), `modeles` (5), `documents` (1) |
| lint, typecheck, build | sans erreur |
| pytest (générateur) | 237 passés, 7 ignorés (mesuré avant le commit e2e, générateur inchangé depuis) |

Détail de mes tests : unitaires — composantes figées et somme à la ligne (20 960 F pour le Vol), prorata, libellés, reconstitution (identique à un calcul récent, rien n'est modifié, impossible → sans détail), dictionnaire, contrôles de dépôt ; intégration — cas 1 inventé **inchangé au franc (6 lignes, 139 420 F)**, Vol à 2 composantes figées en base, « Calculer », cotation antérieure reconstituée sans écriture, reconstitution impossible, facture à l'écran (neuve et antérieure), CP refusée avec sous-modèles manquants (garantie et clé nommées, rien d'émis), CP émise avec **7 sous-modèles inventés** dans l'ordre, réédition à l'identique, cotation antérieure qui émet ses CP, produit avant commun, avertissements de dépôt, aperçu ; e2e — cotation au barème → CP émise avec un bloc par garantie, **texte du PDF lu par `pdftotext`** (ordre des sept blocs, composantes du Vol, données du document dans chaque bloc), réédition.

## Écarts, constats et points ouverts

- **Cas 1 « 136 202 F » et tag `bareme-jalon-1`** : ni l'un ni l'autre n'existe dans le dépôt. Le SECURPRO inventé donne **139 420 F**. « Identique au franc » est vérifié sur ces chiffres ; si 136 202 F vient d'un barème réel, il faut le rejouer hors dépôt.
- **Redis** : `import-masse.e2e` exige `REDIS_URL` ; la pile de test en comporte un (`redis:7-alpine`), documenté dans `docs/installation.md` (8.1).
- **Non vérifié dans un navigateur** : les trois tables à sous-lignes (fiche de cotation, résultat du calcul, facture) sont typées et construites par les mêmes fonctions, mais je ne les ai pas vues à l'écran (contraste, retrait, 390 px). À faire en recette manuelle.
- Libellé d'une composante (H173) : le schéma du barème n'en porte pas ; le code mis en forme tient lieu de libellé. À confirmer, ou à ajouter au schéma (touche l'import Excel, l'éditeur, l'empreinte).
- Prime nette d'une composante (H173) : après réduction et prorata, arrondie comme la ligne ; une unité d'arrondi d'écart possible avec la ligne, qui fait foi.
- H174 à H178 : voir [decisions.md](../decisions.md).

## Commit « test(e2e) » (demande de la Direction, avant fusion)

1. **Normalisation du texte des PDF** : `app/src/serveur/pdf-test.ts` ramène U+202F et U+00A0 à l'espace ordinaire (`espacesOrdinaires`) pour le texte extrait ET pour les montants attendus. `facture-bareme.e2e` redevient vert avec `pdftotext` (la cause : sa propre normalisation ne convertissait pas l'espace fine insécable de `toLocaleString("fr-FR")`, le PDF était correct).
2. **`pdftotext` exigé** : les six e2e qui lisent un PDF (`contrats-4a`, `factures`, `import-masse`, `garanties`, `facture-bareme`, `bareme-documents-garanties`) appellent `exigerPdftotext()` dans leur `beforeAll` et lisent le texte par `texteDuPdf` / `texteCompactDuPdf`, qui lèvent une erreur claire (« pdftotext est introuvable … installez poppler-utils … app/Dockerfile.tests ») ; les `if (!AVEC_PDFTOTEXT) return` et les contrôles conditionnels (`if (texte !== null)`) sont supprimés. Test unitaire `pdf-test.test.ts` : l'absence de l'outil (PATH vide) lève ce message ; vérifié sur l'hôte (sans `pdftotext`) et dans le conteneur.
3. **`poppler-utils` dans l'image de test** : le dépôt n'avait aucun Dockerfile du runner de tests (l'image avait été construite hors dépôt). Création de `app/Dockerfile.tests` (étape « dépendances » de `app/Dockerfile` + `poppler-utils`, cache de téléchargement BuildKit et tentatives supplémentaires de `npm ci` : le réseau du poste a coupé quatre constructions sur `ECONNRESET`, la cinquième est passée). **`app/Dockerfile` et `generateur/Dockerfile` ne sont pas modifiés** ; un test de `documentation.test.ts` vérifie que `docker-compose.yml` ne cite pas `Dockerfile.tests` et que l'image de production n'embarque pas `poppler`. Procédure dans `docs/installation.md` (8.1). L'image `sim-tests-tests:latest` utilisée par l'autre session n'est pas remplacée (tag `poppler`).

## Déroulé

Une première suite complète n'a pas démarré à cause d'une commande `docker exec -d` sans effet que je n'avais pas vérifiée : environ 40 minutes perdues avant de m'en apercevoir. Suites coordonnées avec la session `bareme-formulaire-ergonomie` (une seule pile à la fois). Numérotation convenue avec elle : D61 et H173–H178 ici, D62 et H180–H184 chez elle.
