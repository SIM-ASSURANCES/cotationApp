# Compte rendu de la session 6.2b : composition manuelle de la prime, abandon d'un brouillon de facture

Écrit le 12/10/2026, branche `phase-6.2b` (créée depuis `main` à jour, après la fusion de la V1 et de la 6.2a), **non fusionnée**. Décision : [decisions.md](decisions.md#d32--décisions-de-thierry-du-12102026-composition-manuelle-de-la-prime-et-abandon-dun-brouillon-session-62b) (D32, H89 à H97). Source : instructions de la phase 6.2 (hors dépôt) et décisions de Thierry du 12/10/2026. **La 6.2c et la refonte V2 ne sont pas commencées.** Le simulateur de primes de la Technique reste hors dépôt : aucun barème, classe de risque, plafond ni coefficient n'est repris ; tous les chiffres des tests sont inventés, posés à la main avec leur calcul en commentaire.

## Décisions de Thierry consignées (12/10/2026)

H82 à H86 et H88 validées ; H87 : « Abandonner le brouillon » (fait ici) ; le paramétrage des quatre produits à garanties est une étape de **mise en production** par la Technique, sans aucun produit réel dans le dépôt : consigne en évidence dans [deploiement.md](deploiement.md) (« Après l'installation »), en plus de D31.

## Ce qui est fait

| Point des instructions | Livré | Logique |
| --- | --- | --- |
| Lignes de prime par garantie | `domaine/calcul/composition.ts` (fonctions pures) : `composer`, `problemesLignesDePrime`, `tauxUnique`, `recalculer` | Taxe de la ligne = (nette + accessoires) × son taux, arrondie selon la règle du produit (niveau « ligne » ou « total »), TTC = nette + accessoires + taxe, par ligne et au total ; aucun prorata |
| Taux de taxe | `figerLesTaux` : branche de la ligne, régime de taxe de la cotation, date d'effet (même `taxeEnVigueur` que le calcul automatique) | Taux et assiette **figés** dans la composition (T10) |
| Branches fiscales | **INCENDIE 12,5 %** (provisoire, 01/01/2026) et **IARD 7,25 %** aux données de démarrage ; **H32 fermée** | Une installation d'avant : ajouter une ligne IARD à 7,25 % (deploiement.md) |
| Surprimes, majorations | Des lignes comme les autres | Aucun nouveau champ |
| Droit « Composer une prime » | `COMPOSER_PRIME` : Technique **Oui**, les autres sans accès | Le Commercial crée, la Technique compose |
| Motif, journal, séparation des tâches | Motif obligatoire (3 à 500), `COTATION_COMPOSEE` (avant / après), composeur ajouté aux contributeurs | Qui a composé ne valide pas (T13, H9) ; seuils sur le TTC |
| Figement | La composition est dans `donnees_calcul` (type `COMPOSITION`), reprise telle quelle par l'acceptation, la police, les CP, la facture | Jamais recalculée ; une cotation composée s'accepte en entier |
| Documents | `garanties_souscrites[]` (libelle, branche, prime_nette, accessoires, taux_taxe, taxe, ttc), facultatif ; `prime.taux_taxe` facultatif (vide si plusieurs taux) ; `formules` vide ; `prime.*` = somme des lignes | Aide des modèles, guide de balisage, deux modèles de test |
| Facture | Une ligne par garantie avec son taux (écran, PDF) ; l'avoir reprend les lignes en négatif | |
| H87 : abandon d'un brouillon | Statut « Abandonnée », motif obligatoire, journal, aucun numéro consommé (contrainte en base), définitif (déclencheur) | Libère la place dans les index d'unicité ; brouillon ou « À valider », jamais une facture émise ni un avoir |
| Version du produit | Liste des garanties et case « saisie libre » ; **formules facultatives** en mode par garanties (H85 relâchée) | |

## Tests

| Suite | Résultat |
| --- | --- |
| Unitaires (`npm test`) | RESULTAT_UNIT |
| Intégration (`npm run test:integration`) | RESULTAT_INTEG |
| Bout en bout (`npm run test:e2e`, vrai générateur) | RESULTAT_E2E |
| Générateur (`pytest`) | RESULTAT_PYTEST |
| `npm run lint`, `npm run typecheck`, `npm run build` | RESULTAT_QUALITE |

Cas des instructions couverts, chiffres inventés posés à la main :

- **IARD** : Incendie 10 000 + 2 500 (12,5 % : taxe 1 563), Vol 9 850 + 2 500 (7,25 % : 895), Dégât des eaux 6 000 + 2 500 (7,25 % : 616) ; totaux nette 25 850, accessoires 7 500, taxe 3 074, TTC 36 424 ; invariant par ligne et au total ; niveau « total » (au supérieur à 100 F : 3 100 contre 3 200 « ligne par ligne »).
- **IA** : Accident 100 000 + 5 000 en IA (taxe 7 613), Décès toutes causes 20 000 + 0 en DECES (taxe 0).
- **Régime** : une ligne SANTE à 1,5 % (Groupe) et à 4 % (Individuel) ; invariant sur 72 règles d'arrondi × 20 compositions aléatoires.
- **Droits** : un Commercial (et la Comptabilité) ne peut pas composer ; celui qui a composé ne peut pas valider ; l'auteur non plus ; un autre valideur valide.
- **Bout en bout, vrai générateur** (`garanties.e2e.test.ts`) : cotation composée → émise → acceptée → CP → facture → avoir, 36 424 F partout, **une ligne par garantie avec son taux sur les PDF** de la CP et de la facture, taux global vide, échéancier 2 × 18 212, avoir en négatif.
- **Abandon** : motif obligatoire, droits, journal, définitif (même en SQL), aucun trou dans la numérotation, place libérée, renouvellement bloqué par la 6.2a abandonné.
- **Non-régression** : T1, T2, T3, T4 et les suites existantes passent ; le test T6 de bout en bout a été réécrit (voir Écarts).

## Défaut trouvé et corrigé en passant

À la **soumission** d'un brouillon, le **régime de taxe choisi** sur la cotation (session 6.0) était remplacé par le régime proposé pour son type de contrat : une famille cotée au régime Groupe repassait en Individuel, donc à un autre taux. Sans correction, une composition faite à 1,5 % aurait été recalculée à 4 % à la soumission. Corrigé (la saisie reconstruite reprend le régime enregistré) et testé. Il touche aussi les cotations à la formule : leur TTC ne change que dans ce cas (régime modifié à la main), vers le régime que l'utilisateur avait choisi.

## Écarts avec les instructions, hypothèses ouvertes

- **Branche** : `phase-6.2b`, sur consigne de Thierry (une branche par session, appuyée sur la dernière branche à jour).
- **H90 (à décider)** : le **renouvellement** et l'**avenant d'incorporation** d'une police à garanties sont **refusés** avec un message explicite. Les instructions ne disent pas comment se compose une nouvelle période : je ne recopie ni ne recalcule rien en silence. Tant que c'est ainsi, une police à garanties ne se renouvelle pas.
- **H85 relâchée** : une version par garanties n'a plus besoin de formule (la liste des garanties du produit en tient lieu, facultative).
- **H91** : pas de frais de fractionnement automatiques en mode par garanties (taux de taxe ambigu) ; ils se saisissent comme une ligne de prime.
- **T6 de bout en bout** : l'IARD n'est plus à taux mixte ; le test vérifie maintenant qu'un produit IARD par garanties se compose (27 308 F) et qu'un produit à la formule sur une branche à taux mixte reste refusé.
- **Taux de l'incendie** : 12,5 % reste **provisoire** (date d'effet à confirmer par la Technique, D27).
- H89, H92 à H97 : voir D32.

## Non vérifié

Les écrans (formulaire « Composer la prime », tableau des garanties, abandon d'un brouillon, version du produit avec la liste des garanties) n'ont pas été vus dans un navigateur : seul leur code a été relu et typé ; la logique est couverte par les tests de service. Le rendu de la facture et de la CP avec des modèles réels n'est pas essayé (modèles de test seulement).

## Pour Thierry : essai de la 6.2b

1. `npm run migrate:deploy` puis `npm run initialiser` (branche INCENDIE, IARD à 7,25 %, droit « Composer une prime »).
2. Avec un compte Technique : créer un produit de test en mode « Par garanties » (liste de garanties facultative), puis, avec un compte Commercial, une cotation de ce produit : la prime est « à composer ». Avec la Technique : « Composer la prime » (motif obligatoire). Soumettre ; au-dessus du seuil, vérifier que ni le composeur ni l'auteur ne peuvent valider.
3. Accepter, émettre les CP et la facture : une ligne par garantie avec son taux.
4. Abandonner un brouillon de facture : motif, puis refaire la facture.
5. Trancher **H90** (renouvellement d'une police à garanties) et confirmer le taux de l'incendie.
