# Compte rendu — retouches-mise-en-service (04/11/2026)

Branche `retouches-mise-en-service`, issue de `main` (e21681a, à jour de `origin/main`), worktree `sim-documents-retouches`. Commit local, rien de fusionné ni poussé, conteneurs `sim-b1` non touchés. Décision D63, hypothèses H185 à H190. Aucune règle métier nouvelle ; aucune dépendance modifiée.

## Ce qui est livré (numérotation de la consigne)
1. **Champs de montant** : séparateur de milliers pendant la frappe, valeur envoyée sans séparateur, curseur stable, collage depuis Excel (avec ou sans séparateurs, décimales avec virgule). Cotation, barème (champs, listes, constantes, garanties, tranches, minimum, cases de tables, attendus des essais), essais, paiement et avance, produit (prime minimale, frais), seuil de validation. Le serveur reste la seule validation.
2. **Durée couverte et prorata au barème** : « 365 jour(s) couverts, coefficient de prorata 1 » sous le résultat ; phrase partagée avec le calcul par formules.
3. **Largeur à 390 px** : **cause réelle différente de celle annoncée.** Le filigrane n'est pas en cause : des mots sans coupure (empreinte de 64 caractères, codes dans un `h1`) élargissaient la page (566, 578, 456 et 397 px mesurés avant correction sur fiche produit, éditeur de barème, fiche d'un modèle, portefeuille) ; le filigrane fixe suivait la page élargie. Correction globale dans `globals.css`. Les taxes ne débordaient pas avec les données de recette.
4. **Images de production** : `npm ci` tolérant aux coupures dans `app/Dockerfile` (cache BuildKit, 6 essais, délais plus longs) ; une seule étape commune aux images application, travailleur et outils. **Non construit ici** (voir « Non vérifié »).
5. **Formulaire produit** : « Garanties » seulement pour « Par garanties » ; aides pour Gamme, Formules comparées au plus, précision d'arrondi ; valeurs d'arrondi inchangées (vérifié : 1, 10, 100, 1000).
6. **Nouvelle cotation** : branche principale, puis produit de la branche (liste filtrée).
7. **Cotation par formules** : calcul automatique serveur (anti-rebond 600 ms, une requête en vol, réponse périmée ignorée, « Complétez : … », bouton conservé, Entrée = Calculer). T1 = **15 888 000 F** au franc, identique à l'enregistrement.
8. **Modèles** : regroupés par branche puis produit (déposés et manquants) ; vue « À valider / À publier (n) » réservée au droit de publication, contrôlé dans `serveur/`.
9. **Import des adhérents** : dates en JJ/MM/AAAA ; « Date inexistante » distinguée de « Format de date invalide ».
10. **Messages `verifierBareme`** : `TAUX_SANS_SOURCE`, `E1_SUR_TAUX_FIXE` (et le message d'exécution) disent quoi faire.

## Fichiers
- Domaine : `calcul/saisie-montant.ts`, `calcul/libelle-prorata.ts`, `cotation/calcul-automatique.ts`, `cotation/choix-produit.ts`, `documents/regroupement-modeles.ts` (nouveaux, testés) ; `imports/adherents.ts`, `cotation/adherents.ts`, `bareme/verification.ts`, `bareme/garantie.ts`.
- Serveur : `cotations.ts` (`calculerCotationFormules`, `prorata` dans `ResultatCalculBareme`), `modeles.ts` (`listerModelesAPublier`, `listerProduitsDesModeles`), `imports.ts` (messages).
- Écrans : `composants/ui/ChampMontant.tsx` (+ hook `useSaisieMontant`), `FormulaireAction.tsx` (`ChampMontant`, `aide`), `SectionSelonMode.tsx`, `ChoixProduitCotation.tsx`, `cotations/calcul-formules.tsx`, `modeles/groupes-modeles.tsx` et `page.tsx`, éditeur de barème, pages produit, société, factures, `statuts.tsx` (« Manquant »), `globals.css`.
- Outillage : `app/Dockerfile` ; `app/scripts/preparer-recette-retouches.mts` et `verifier-retouches.mjs` (recette navigateur, comme `verifier-formulaire-ergonomie.mjs`) ; `CLAUDE.md` (règle des montants saisis).
- Docs : `decisions.md` (D63, H185 à H190), captures `docs/compte-rendu/captures-retouches/` (25 PNG, 1440 et 390 px).

## Tests (mesurés dans la pile `sim-retouches`, jetable)
| Suite | Résultat |
|---|---|
| `npm run typecheck` (`tsc`) | sans erreur |
| `npm run lint` | sans erreur |
| Unitaires (`vitest run`) | **78 fichiers, 924 tests** verts |
| Intégration (`npm run test:integration`) | **33 fichiers, 451 tests** : 449 verts au premier passage ; `factures.integration.test.ts` a échoué deux tests de concurrence (« timeout exceeded when trying to connect », machine chargée, même famille que H184), **rejoué seul : 40 tests verts** |
| E2E serveur (`npm run test:e2e`) | **11 fichiers, 20 tests** verts |
| `npm run build` | réussi |
| Recette navigateur `verifier-retouches.mjs` (Chromium, application compilée, 1440 puis 390 px) | **TOUT VERT, 125 contrôles** |

Tests nouveaux ou modifiés : unitaires (`saisie-montant` 18 : formatage, lecture, collage, curseur ; `libelle-prorata` 3 ; `calcul-automatique` 6 ; `choix-produit` 7 ; `regroupement-modeles` 7 ; `verification-messages` 3 ; `ChampMontant` 4 dans `ui.test.tsx` ; dates de l'import dans `adherents.test.ts`) ; intégration (`cotations.integration.test.ts` +8 : T1 = 15 888 000, égalité avec le brouillon, prorata, seuil, droit de forçage rétabli après test, mode « Par garanties » refusé ; `modeles.integration.test.ts` +3 : vue « à publier » refusée à la Technique et au Commercial, visible à la DG puis vidée à la publication ; `cotation-bareme.integration.test.ts` : forme de la réponse étendue à `prorata`).
La recette navigateur couvre les trois e2e demandés : saisie d'un montant avec séparateur jusqu'à l'enregistrement (version de produit « 1 000 000 » → `1000000` ; paiement « 12 345 » → `12345`), calcul automatique par formules = T1 au franc (une seule requête pour une frappe rapide, brouillon à 15 888 000), largeur à 390 px sur 9 pages (dont fiche produit, éditeur de barème, taxes).

## Écarts et points ouverts
- **Entrée sur la cotation par formules** lance « Calculer » (H186) : comportement modifié, à confirmer.
- **Vue « À publier »** : seulement ce que le profil peut publier lui-même (H185).
- La règle « le valideur n'est jamais l'auteur » de la vue n'a pas de test d'intégration (aucun profil par défaut ne dépose et publie ; l'auteur d'une version ne se modifie pas en base) ; elle est portée par `peutPublier`, déjà testée.
- Messages de `verifierBareme` : seule la famille « taux sans source » est complétée (H190).
- Le test d'intégration `modeles` n'est pas rejouable deux fois de suite sur la même base (annexe et seuil) : défaut existant, la suite complète repart d'une base préparée.
- L'image `sim-tests-generateur:latest` était antérieure à D61 (un e2e échouait sans montage de `generateur/app`) : **reconstruite le 05/11/2026**, voir « Passage complet sur machine calme ».

## Non vérifié
- **`app/Dockerfile` n'a pas été construit** : le changement (cache BuildKit et options de `npm ci`) reproduit celui de `Dockerfile.tests`, mais aucune image de production n'a été reconstruite ici. À valider par `docker compose build` sur le poste de recette.
- Safari / iPhone et appareils réels : captures et mesures faites sous Chromium seulement. Le collage au presse-papiers a été joué par Chromium (autorisation `clipboard`).

## Passage complet sur machine calme (05/11/2026)
Images de test reconstruites depuis `main` (e21681a, à jour de `sim/main`) sous les tags de `sim-tests` : `sim-tests-tests:latest` (et `:poppler`, même image) par `app/Dockerfile.tests`, `sim-tests-generateur:latest` par `generateur/Dockerfile` (contexte `generateur/`, polices comprises). Aucune image ni aucun conteneur `sim-b1` touché. Une seule pile (`sim-retouches`, recréée), aucune autre pile de test active ; le générateur est celui de l'image neuve, **sans montage de `generateur/app`**. Les six étapes ont tourné à la suite, dans le conteneur, sur la branche `retouches-mise-en-service`.

| Suite | Résultat mesuré |
|---|---|
| `npm run typecheck` | sans erreur |
| `npm run lint` | sans erreur |
| Unitaires (`npm test`) | **78 fichiers, 924 tests** verts |
| Intégration (`npm run test:integration`) | **33 fichiers, 451 tests** verts, en un seul passage |
| E2E (`npm run test:e2e`) | **11 fichiers, 20 tests** verts, dont `bareme-documents-garanties` avec l'image neuve |
| `npm run build` | réussi (sortie autonome complétée) |

`factures.integration.test.ts` : **40 tests verts dans le passage complet**, dont les deux tests de concurrence (numérotation sans trou sous concurrence ; écritures concurrentes d'une même cotation) qui avaient expiré à la session précédente sur machine chargée. Cela confirme la cause (charge de la machine) ; aucun code modifié.
