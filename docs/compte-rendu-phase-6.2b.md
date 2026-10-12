> **Suite (décisions de Thierry après la 6.2b)** : H98 est décidée et mise en œuvre sur `phase-6.2b-h98` (la composition est vidée au changement de période, de régime ou de type de contrat) ; H90 : principe retenu, pour la 6.2c. Voir D32. Le texte ci-dessous décrit l'état de la 6.2b telle que livrée.

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
| Unitaires (`npm test`) | **438 verts** (36 fichiers) |
| Intégration (`npm run test:integration`) | **237 verts** (16 fichiers) |
| Bout en bout (`npm run test:e2e`, vrai générateur) | **13 verts** (6 fichiers), dont `garanties.e2e.test.ts` (cotation composée → police → CP → facture → avoir, PDF relus par `pdftotext`) |
| Générateur (`pytest`) | **231 verts** (dont 11 nouveaux : les trois modèles par garanties, une ligne par garantie avec son taux, taux global vide) |
| `npm run lint`, `npm run typecheck`, `npm run build` | `npm run lint` sans avertissement, `npm run typecheck` propre, `npm run build` réussi |

Cas des instructions couverts, chiffres inventés posés à la main :

- **IARD** : Incendie 10 000 + 2 500 (12,5 % : taxe 1 563), Vol 9 850 + 2 500 (7,25 % : 895), Dégât des eaux 6 000 + 2 500 (7,25 % : 616) ; totaux nette 25 850, accessoires 7 500, taxe 3 074, TTC 36 424 ; invariant par ligne et au total ; niveau « total » (au supérieur à 100 F : 3 100 contre 3 200 « ligne par ligne »).
- **IA** : Accident 100 000 + 5 000 en IA (taxe 7 613), Décès toutes causes 20 000 + 0 en DECES (taxe 0).
- **Régime** : une ligne SANTE à 1,5 % (Groupe) et à 4 % (Individuel) ; invariant sur 72 règles d'arrondi × 20 compositions aléatoires.
- **Droits** : un Commercial (et la Comptabilité) ne peut pas composer ; celui qui a composé ne peut pas valider ; l'auteur non plus ; un autre valideur valide.
- **Bout en bout, vrai générateur** (`garanties.e2e.test.ts`) : cotation composée → émise → acceptée → CP → facture → avoir, 36 424 F partout, **une ligne par garantie avec son taux sur les PDF** de la CP et de la facture, taux global vide, échéancier 2 × 18 212, avoir en négatif.
- **Abandon** : motif obligatoire, droits, journal, définitif (même en SQL), aucun trou dans la numérotation, place libérée, renouvellement bloqué par la 6.2a abandonné.
- **Non-régression** : T1, T2, T3, T4 et les suites existantes passent ; le test T6 de bout en bout a été réécrit (voir Écarts).

## Revue contradictoire et corrections

Relecteurs indépendants par axe, puis un sceptique par constat : **46 constats confirmés** (plusieurs doublons). Tous traités sauf H98 (décision de Thierry). Les principaux, par ordre de gravité :

- **Échéancier périmé** (défaut préexistant, exposé par la recomposition) : `undefined` voulait dire « ne pas toucher » ; repasser à une tranche laissait les tranches d'avant, qui ne sommaient plus au TTC, sur la fiche et sur le PDF de la cotation. Corrigé et testé.
- **Course entre écritures** : aucune écriture du brouillon ne verrouillait la ligne ; une soumission pouvait écrire par-dessus une composition faite entre-temps. Verrou de ligne sur la modification, la composition, la soumission, la validation et le renvoi ; test avec une vraie transaction concurrente (échoue sans le verrou).
- **Conversion silencieuse** : l'écran de modification d'un brouillon à formules, sur un produit passé « par garanties », le convertissait en brouillon « à composer » (formules et forçage perdus). Refusé, la fiche explique.
- **Import en masse** impossible sur une police composée (colonne « formule » obligatoire) ; **abandon** d'une demande « À valider » par un tiers ; **modèle de facture** qui exigeait `prime.taux_taxe` même pour un produit multi-taux ; documents numérotés sortis avec un modèle sans détail des garanties.
- Écrans : formule d'assuré proposée puis refusée, boutons qui échouent à coup sûr (aperçu et soumission d'une prime « à composer », renouvellement et avenant), liste sans « À composer », bandeau « taux figés » faux pour un brouillon.
- Tests : l'invariant aléatoire était vrai par construction (remplacé par un **oracle entier indépendant**, 1 440 compositions) ; date d'effet, règle d'arrondi, assiette « nette seule », reliquat, séparation des tâches de l'auteur, gardes de cohérence, T10 jusqu'à la CP et à la facture, gardes SQL de l'abandon, bornes, droits par défaut.
- Documentation : affirmations fausses du guide de mise en production (incorporation « refusée » : elle ne l'est pas, elle n'est simplement pas facturée ; droit de publication ; essai en production), `migrations.test.ts` (désormais épinglé jusqu'à la 6.2a), « trois modèles de test », recette, README.
- Au passage : la liste de choix des formules du fichier modèle d'import était posée sur une colonne écrite en dur (la mauvaise : elle portait la pièce d'identité) ; la lettre se déduit maintenant de l'ordre des colonnes.

## Défaut trouvé et corrigé en passant

À la **soumission** d'un brouillon, le **régime de taxe choisi** sur la cotation (session 6.0) était remplacé par le régime proposé pour son type de contrat : une famille cotée au régime Groupe repassait en Individuel, donc à un autre taux. Sans correction, une composition faite à 1,5 % aurait été recalculée à 4 % à la soumission. Corrigé (la saisie reconstruite reprend le régime enregistré) et testé. Il touche aussi les cotations à la formule : leur TTC ne change que dans ce cas (régime modifié à la main), vers le régime que l'utilisateur avait choisi.

## Écarts avec les instructions, hypothèses ouvertes

- **Branche** : `phase-6.2b`, sur consigne de Thierry (une branche par session, appuyée sur la dernière branche à jour).
- **H90 (à décider)** : le **renouvellement** et l'**avenant d'incorporation** d'une police à garanties sont **refusés** avec un message explicite. Les instructions ne disent pas comment se compose une nouvelle période : je ne recopie ni ne recalcule rien en silence. Tant que c'est ainsi, une police à garanties ne se renouvelle pas.
- **H85 relâchée** : une version par garanties n'a plus besoin de formule (la liste des garanties du produit en tient lieu, facultative).
- **H91** : pas de frais de fractionnement automatiques en mode par garanties (taux de taxe ambigu) ; ils se saisissent comme une ligne de prime.
- **T6 de bout en bout** : l'IARD n'est plus à taux mixte ; le test vérifie maintenant qu'un produit IARD par garanties se compose (27 308 F) et qu'un produit à la formule sur une branche à taux mixte reste refusé.
- **Taux de l'incendie** : 12,5 % reste **provisoire** (date d'effet à confirmer par la Technique, D27).
- **H98 (à décider)** : un brouillon composé dont le Commercial change la période, le régime, le type de contrat ou les tranches **garde sa composition** ; le journal trace maintenant les dates et les tranches, mais une prime composée pour un an peut être émise pour deux, sous le seuil, sans revue de la Technique. Faut-il la vider dans ce cas ?
- H99 (abandon d'une demande « À valider » : son demandeur ou un profil qui peut décider), H100 (import en masse d'une police composée : colonne « formule » vide), H101 (modèles de cotation, CP et facture d'un produit par garanties : ils citent `garanties_souscrites[]`) : voir D32.
- H89, H92 à H97 : voir D32.

## Vérifié dans un navigateur

Application construite (`npm run build`) et lancée contre une base de développement (comptes `test.*` du seed de développement, données inventées), pilotée par Playwright en 1 440 px et 390 px (script hors dépôt, 39 vérifications, captures relues) :

- **Commercial** : formulaire d'une cotation par garanties (aucun bloc « Formules », aucune colonne « Formule » d'assuré), fiche « Prime à composer » (ni aperçu PDF, ni bouton « Soumettre »), liste (« À composer »), brouillon à formules d'un produit passé par garanties (« Brouillon à recréer », ni modification ni soumission, la page de modification renvoie à la fiche).
- **Technique** : formulaire « Composer la prime » à trois lignes, motif, puis la fiche : 36 424 F, taxes 1 563 / 895 / 616 aux taux de chaque ligne, échéancier 12 141 / 12 141 / 12 142, « Prime composée par … ».
- **Commercial, de nouveau** : « Soumettre (émettre) » → cotation émise avec son numéro, taux figés.
- **Factures d'une police à garanties** : renouvellement et avenant non proposés (H90) ; facture en brouillon avec une ligne par garantie et son taux ; abandon (motif trop court refusé, puis « Abandonnée » avec son motif, plus de formulaire d'émission) ; une nouvelle facture peut être préparée.
- **Version du produit** : liste des garanties et case « saisie libre ».

Un **défaut d'écran** est sorti de cet essai (et d'aucun test) : la version d'un produit par garanties affichait une ligne de formule vide dont les champs étaient obligatoires, que le serveur n'ignorait pas : il fallait cliquer « Retirer » pour pouvoir enregistrer. Corrigé (champs obligatoires seulement une fois la ligne commencée ; ligne entièrement vide ignorée par le serveur, testé) et re-vérifié dans le navigateur.

## Non vérifié

L'import en masse d'une police composée n'est testé que par les services (pas par l'écran) ; le rendu de la facture et de la CP avec des **modèles réels** n'est pas essayé (modèles de test seulement) ; aucune ouverture des PDF dans un lecteur graphique ; l'écran d'abandon n'a pas été vu sur téléphone.

## Pour Thierry : essai de la 6.2b

1. `npm run migrate:deploy` puis `npm run initialiser` : sur une **base neuve**, ils créent la branche INCENDIE à 12,5 %, IARD à 7,25 % et le droit « Composer une prime ». Sur une **base déjà installée**, `initialiser` n'écrase rien : ajouter à la main, dans l'écran « Taxes », une ligne IARD à 7,25 % (l'ancienne est à taux mixte) et renommer la branche IARD dans l'écran « Branches » ([deploiement.md](deploiement.md#après-linstallation--produits-à-paramétrer-par-la-technique-d31-d32)).
2. Avec un compte Technique : créer un produit de test en mode « Par garanties » (liste de garanties facultative), puis, avec un compte Commercial, une cotation de ce produit : la prime est « à composer ». Avec la Technique : « Composer la prime » (motif obligatoire). Soumettre ; au-dessus du seuil, vérifier que ni le composeur ni l'auteur ne peuvent valider.
3. Accepter, émettre les CP et la facture : une ligne par garantie avec son taux. Les modèles de cotation, de CP et de facture du produit doivent citer `garanties_souscrites[]` (sinon l'émission est refusée) ; les trois modèles de test sont dans `generateur/tests/fixtures/`.
4. Abandonner un brouillon de facture : motif, puis refaire la facture.
5. Trancher **H90** (renouvellement d'une police à garanties ; l'incorporation d'adhérents reste possible mais n'est pas facturée), **H98** (vider la composition quand le Commercial change la période ?) et confirmer le taux de l'incendie.
