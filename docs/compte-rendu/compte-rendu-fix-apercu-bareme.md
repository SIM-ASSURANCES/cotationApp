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
- Suite dans le conteneur : unitaires 684 verts ; lint et typecheck propres ; e2e 13 verts ; intégration 376 verts en parallèle (voir Écarts).

## Écarts
- Intégration relancée EN PARALLÈLE (mode par défaut), une seule pile active (`sim-b1` mise en pause, `sim-tests` arrêtée) : 29 fichiers et 376 tests verts, deux lancements consécutifs (≈ 175 s chacun). Aucun `Hook timed out` : les échecs intermittents vus plus tôt venaient de la charge de plusieurs piles simultanées.
- Un échec a persisté au premier lancement parallèle, dans notre propre fichier : `modeles.integration.test.ts`, hook `beforeAll` du bloc « produit au barème », `creerTaxe` refusé (« chevauche un taux INCENDIE… ») car un autre fichier crée le même taux dans la base partagée. Corrigé dans cette branche (test seulement) : branches fiscales propres au test (`INC_…`, `IARD_…`), catégories de taxe du barème inventé renommées en conséquence.

## Hypothèses ouvertes (à confirmer)
- Validées par Thierry le 30/10/2026 : H154 version du barème : publié en vigueur, sinon dernier publié, sinon brouillon.
- H155 champs conditionnels remplis (conditions neutralisées), choix multiple : première valeur, seul `surDocuments: false` reste vide.
- H156 intermédiaire incalculable : « 1000000 » ; attribut absent : « EXEMPLE ».
- Numérotation : H154-H156 / D57 laissent libres H151-H153 / D56, pris par `correctifs-refonte` ; la fusion des deux fins de `decisions.md` demandera une résolution manuelle.
