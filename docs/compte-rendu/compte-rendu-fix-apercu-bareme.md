# Compte rendu — fix-apercu-bareme (30/10/2026)

Branche `fix-apercu-bareme`, issue de `main` (333b544). Commit local, rien de fusionné ni poussé.

## Défaut corrigé
L'aperçu d'un modèle (`apercuVersion`) ignorait le barème du produit : une CP citant `risque.<champ>`, `risque_code.<champ>`, un intermédiaire ou un attribut était refusée en aperçu (« donnée absente ») alors que le dépôt l'acceptait (CDC §6.6).

## Fichiers
- `app/src/domaine/bareme/documents.ts` : `risqueExempleDuBareme(bareme, jour)` (fonction pure), construite sur `risqueDuBareme` / `risqueCodeDuBareme`, donc mêmes clés que l'émission.
- `app/src/serveur/bareme.ts` : `baremePourApercu` (choix de la version), `risqueExempleDuProduit`.
- `app/src/serveur/modeles.ts` : `apercuVersion` remplace `risque` / `risque_code` pour un produit au barème ; produit sans barème inchangé.
- `docs/decisions.md` : D57, H154 à H156.

## Tests
- Unitaires (`documents.test.ts`) : mêmes clés que l'émission et aucune vide ; intermédiaires = calcul du moteur ; chaque type de champ et les bornes ; intermédiaire incalculable sans erreur.
- Intégration (`modeles.integration.test.ts`), barème SECURPRO inventé : brouillon seul, puis barème publié prioritaire ; `risque.<champ>`, `risque_code.<champ>`, intermédiaire et attribut présents ; produit sans barème garde les trois clés d'avant.
- Suite dans le conteneur : unitaires 684 verts ; lint et typecheck propres ; e2e 13 verts ; intégration 376 verts en série (`--no-file-parallelism`).

## Écarts
- En parallèle (mode par défaut), l'intégration échoue de façon intermittente sur d'autres fichiers (`Hook timed out in 10000ms`, audit-export, securite) : charge de la machine, sans lien avec ce changement ; les fichiers en cause varient d'un lancement à l'autre.
- Le test d'intégration crée les taxes INCENDIE et IARD (2020-01-01) que rejouent les jeux d'essai du barème à la publication.

## Hypothèses ouvertes (à confirmer)
- H154 version du barème : publié en vigueur, sinon dernier publié, sinon brouillon.
- H155 champs conditionnels remplis (conditions neutralisées), seul `surDocuments: false` reste vide.
- H156 intermédiaire incalculable : « 1000000 » ; attribut absent : « EXEMPLE ».
- Numérotation : H154-H156 / D57 laissent libres H151-H153 / D56, pris par `correctifs-refonte` ; la fusion des deux fins de `decisions.md` demandera une résolution manuelle.
