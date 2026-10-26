# Compte rendu — étape B3, stockage et publication du barème (branche `bareme-b3-stockage`)

Décision **D49**, hypothèses **H137 à H139** (`docs/decisions.md`). Option (c) de `propositions-bareme.md` §3. Aucun écran.

## Fichiers
- Migration `20261026090000_bareme_documents` : mode `BAREME` dans la contrainte de `produit_versions` ; table `bareme_documents` ; index partiels (un brouillon, un publié par version) ; déclencheurs (gel d'un publié, naissance en brouillon sur une version `BAREME`).
- `app/src/serveur/bareme.ts` (service), `app/src/domaine/bareme/canonique.ts` (JSON canonique), `app/scripts/demo-bareme.mts` (`npm run demo:bareme`).
- Modifiés : `schema.prisma`, `domaine/calcul/parametrage.ts` (`BAREME` dans `MODES_TARIFICATION`, formules facultatives), page produit (libellé du mode), `serveur/parametrage.ts` (3 exports : `exigerEcriture`, `taxeEnVigueur`, `versVersion`).

## Points de l'étape
1. Migration : faite (empreinte SHA-256 du JSON canonique, recalculée à la lecture).
2. Mode `BAREME` + CHECK : fait. « Exige un barème publié pour calculer » : `lireBaremePublie` / `calculerAvecBaremePublie` refusent sans barème publié ou si l'empreinte ne correspond plus.
3. Service : brouillon (zod + `verifierBareme`, erreurs `[CODE] message`), rejeu des essais, publication transactionnelle (verrou de ligne sur la version, essais verts, écart ligne à ligne, motif, journal avant/après).
4. Droit : `PARAMETRER_PRODUITS` ; publieur dans `publie_par` et le journal.
5. Réduction : vérifiée, **rien à corriger** (pourcentage saisi, moteur `(100 − taux)/100`, déjà testé).
- Sites D31/D32 : les cinq refusent `BAREME` (test dédié), aucun code modifié.

## Tests
- Unitaires 598 verts ; intégration 323 verts (10 ignorés, déjà ainsi) dont 18 nouveaux ; lint, typecheck, build verts.
- `npm run demo:bareme` (base `_test`) : SECURPRO inventé publié ; barème à écart (ttc 139 421) refusé, 2 écarts listés.
- **Non exécutés** : `test:e2e` (générateur injoignable sur 127.0.0.1:8001, Docker arrêté) et `pytest` (générateur non touché).

## Écarts et besoins découverts (non codés)
- Message des sites D31/D32 pour `BAREME` : celui de `GARANTIES`, inexact (H139, B6).
- `imports.ts` (`parGaranties` = mode `GARANTIES` seul), `portefeuille.ts` (libellé « Par formule ») et la page produit (tableau des formules) ne connaissent pas `BAREME` : à reprendre avec B6.
- Le formulaire de version propose déjà « Au barème » : une version `BAREME` créée à l'écran n'a pas encore d'écran de barème (B4/B5, ou B9 par import).
- Pas de séparation auteur / publieur (H138, Q8). Un refus de publication n'est pas journalisé (la transaction est annulée).
- Les chiffres de test restent inventés (H135).

## Commits
- `afd55e1` feat(bareme): migration bareme_documents et mode de tarification BAREME
- `180e2bf` feat(bareme): service d'enregistrement, d'essais et de publication du barème
- `8854b77` feat(bareme): script de démonstration de la publication (npm run demo:bareme)
- (ce commit) docs(bareme): D49 et compte rendu de l'étape B3
