# Compte rendu — Étape 7 : prorata de l'avenant d'incorporation (branche `phase-prorata-avenant`)

Décision **D45**, hypothèse **H126** (`docs/decisions.md`). Réponse de la Technique sur H51 : prorata temporis au choix.

## Fichiers

- `app/src/serveur/factures.ts` : `creerFactureAvenant(…, prorata = true)` ; `prorata: false` donne un coefficient 1 (prime entière de la période). Journal `FACTURE_CREEE` et `FACTURE_EMISE` avec le champ `prorata` (avenant calculé seulement). `FactureLue.prorataAvenant` (`true`, `false`, ou `null` hors avenant calculé).
- `app/src/app/(protege)/factures/actions.ts` : lecture de la case.
- `app/src/app/(protege)/cotations/[id]/factures/page.tsx` : case « Prorata temporis », cochée par défaut, absente pour un produit par garanties.
- `app/src/app/(protege)/factures/[id]/page.tsx` : ligne « Prorata temporis » sur la fiche d'un avenant calculé.
- `app/src/serveur/factures.integration.test.ts` : 3 tests ajoutés, 1 complété. `docs/decisions.md` : D45, H126.

Aucune migration : le choix est figé dans `contenu.entree.parametres.prorata.actif`, que l'émission et les rééditions reprennent déjà.

## Tests

Incorporation d'un Solo le 22/07/2026, période du 01/01 au 31/12/2026 ; prime unitaire 236 453,25 F, taxe 1,5 %, calculs à la main en commentaire dans le test :

| Choix | Net | Taxe | TTC |
|---|---|---|---|
| OUI (163/365) | 105 594 | 1 584 | 107 178 |
| NON (prime entière) | 236 453 | 3 547 | 240 000 |

Vérifié aussi : défaut = OUI, journal de création et d'émission, réédition au paiement (version 2) avec la même prime, produit par garanties non concerné (même avec `false`), facture hors avenant sans prorata.

- `npm test` : 498 / 498. `npm run lint`, `npm run typecheck`, `npm run build` : verts.
- `npm run test:integration` : 277 verts, 10 ignorés (`import-masse`, sans `REDIS_URL` sur ce poste). `factures.integration.test.ts` : 40 / 40.
- **Non lancé** : `npm run test:e2e` (générateur non accessible depuis le poste). Aucun test e2e ne touche l'avenant ni ce formulaire. À lancer dans le conteneur.

## Écarts et hypothèses ouvertes

- **H126** : choix non modifiable dans le brouillon (abandonner puis refaire, H87) ; durée affichée sur la facture inchangée en « Non » ; la Technique doit dire si le modèle de facture doit mentionner « prime entière ».
- Test avec des dates fixes (fixture `policeT2` du fichier, `fixerDateMinimumEffetPourTests`) et non `dates-test.ts` : le test reste indépendant de la date du jour.
- Branche non poussée ni fusionnée.
