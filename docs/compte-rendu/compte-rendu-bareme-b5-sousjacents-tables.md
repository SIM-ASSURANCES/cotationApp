# Compte rendu — bareme-b5-sousjacents-tables (30/10/2026)

Branche `bareme-b5-sousjacents-tables`, issue de `main` (6698be3, qui contient la fusion de `bareme-b4-champs-garanties`, vérifiée avant de commencer). Commit local, rien de fusionné ni poussé.

## Ce qui est livré
**Un barème complet se crée de zéro sans Excel.** `/parametrage/produits/<code>/bareme/<versionId>` a maintenant huit onglets, tous actifs : Champs, Intermédiaires, Garanties (B4) puis **Tables**, **Sous-jacents**, **Jeux d'essai**, **Aperçu Commercial**, **Publier** (B5). Même document que l'import, même schéma zod, même `verifierBareme` ; un publié n'est jamais modifié (D49). Décisions et hypothèses : D59, H163 à H169.

- **Tables** : 1 clé (liste) ou 2 clés (grille lignes × colonnes) ; clés **tirées des valeurs des champs** (jamais saisies) ; cases au décimal (virgule acceptée) ; « Remplir les cases vides avec 1 » ; collage d'une plage copiée d'un tableur (avec ou sans en-têtes, tout ou rien, la cellule fautive est nommée) ; « n / N cases remplies » avec les clés absentes signalées ; au-delà de 2 clés : refus clair.
- **Sous-jacents** : les cinq effets seulement (E1 taux par table, E2 coefficient + option réduction en %, E3 assiette, E4 refus avec le message de la Technique, E5 minimum / plafond / ajout) ; formulaire guidé par l'effet ; un ou deux champs lus ; une ou plusieurs garanties ou composantes ciblées ; ordre de calcul affiché, non modifiable.
- **Jeux d'essai** : saisie par le **même formulaire généré** que le Commercial (composant partagé `FormulaireCotation`, extrait de la cotation, qui l'utilise désormais) ; l'attendu est **tapé** (lignes, TTC, ou message de refus) ; jamais prérempli par le moteur (garde-fou testé sur les sources) ; rejeu avec écart ligne à ligne.
- **Publier** : rejeu de tous les essais + contrôle des balises des modèles, motif obligatoire, publication et bascule par les services existants, empreinte affichée.
- **Aperçu Commercial** : le formulaire de cotation généré depuis le brouillon, avec les conditions d'affichage.
- **Ajout 9** : une balise `risque.<code>` / `risque_code.<code>` citée par un modèle CP, cotation ou certificat **publié en vigueur** et absente du barème **refuse la publication** (« modèle CP … v3 cite risque.contenu, absent du barème »), même liste de clés que l'émission (`codesRisqueDuBareme`).
- **Ajout 10** : un code de champ (et de valeur intermédiaire) du publié d'origine ne peut pas être renommé à l'enregistrement, côté serveur ; supprimer reste permis.

## Fichiers
- Domaine : `edition-tables.ts`, `edition-sousjacents.ts`, `edition-essais.ts`, `codes-figes.ts`, `securpro-ecran.ts` (SECURPRO inventé saisi par les opérations de l'éditeur, pour les tests) ; `verification.ts` (essai sans attendu, nom d'essai en double) ; `edition.ts` (messages, une ligne attendue compte parmi ce qui lit une garantie) ; `essais.ts` (type `ControlesDePublication`).
- Serveur : `serveur/bareme.ts` (`balisesDesModelesSansCle`, `ErreurBalisesAbsentes`, `controlerAvantPublication`, contrôle des codes figés dans `enregistrerBrouillonBareme`, `baremeDOrigine`).
- Écran : `composants/bareme/` — `OngletTables`, `OngletSousJacents`, `OngletEssais`, `OngletApercu`, `OngletPublier`, `FormulaireCotation` ; `EditeurBareme` (huit onglets, rejeu partagé) ; `OngletsLecture` supprimé. Page et actions de `parametrage/produits/[code]/` (`controlerLaPublicationEcran`, `publierLeBaremeEcran`, `basculerLeBaremeEcran`, empreinte rendue à l'enregistrement, écarts structurés au rejeu). Cotation : `cotations/champs-bareme.tsx` réduit à l'état de calcul autour de `FormulaireCotation` (même rendu, mêmes noms de champs).
- Docs : `decisions.md` (D59, H163 à H169), captures `captures-b5/` (1440 et 390 px).

## Tests
- Unitaires : `edition-tables.test.ts` (22 : grille, cases, collage, refus au-delà de 2 clés), `edition-sousjacents.test.ts` (les cinq effets, cibles, moteur qui relit ce que l'écran écrit), `edition-essais.test.ts` (attendu tapé, écarts), `codes-figes.test.ts` (14 : renommage, balises), `securpro-ecran.test.ts` (SECURPRO saisi à l'écran : schéma, contrôles de publication, 139 420 F TTC, mêmes lignes que la fixture), `essais-sans-moteur.test.ts` (garde-fou), `EditeurBareme.test.tsx` (rendu des cinq nouveaux onglets).
- Intégration `bareme-b5.integration.test.ts` (13) : table incomplète bloque ; sous-jacent sur champ supprimé bloque ; essai à l'attendu faux bloque (écart ligne à ligne, refus journalisé) ; publié intouchable (service et base) ; refus sans droit ; **ajout 9** (nom du modèle, de la version et de la balise ; trois types ; seule la version publiée en vigueur compte) ; **ajout 10** (renommage refusé, brouillon intact, suppression permise, publication refusée par les balises, aucune règle sans publié d'origine).
- Bout en bout `bareme-b5.e2e.test.ts` (recette) : le SECURPRO **inventé** saisi **entièrement** à l'écran (champs, intermédiaires, garanties, tables, sous-jacents, essais) → enregistrement sans problème → contrôle (3 essais verts, aucune balise orpheline) → publication → bascule → cotation par le Commercial à **139 420 F TTC**, mêmes six lignes ; le classeur du publié se réimporte avec **la même empreinte**. Jamais le barème réel.
- Navigateur (Chromium, application compilée, base de test jetable `sim_b5_recette_test`, données inventées) : onglets au clavier (flèches, Début, Fin) ; case vidée → « 3 / 4 cases remplies » et contrôle rouge ; « Remplir avec 1 » ; virgule acceptée ; texte refusé et case rétablie ; plage collée avec en-têtes ; plage trop grande refusée en gardant le texte ; suppression d'une table lue refusée en nommant le sous-jacent ; formulaire d'ajout différent pour E1 à E5 ; E4 avec message et condition ; essai : l'occupation masque et révèle les champs, attendu faux → « attendu 14000, obtenu 12000 » ; aperçu : le champ conditionnel apparaît ; publication → lecture seule → bascule ; barème vide → champ liste, table collée, sous-jacent. **Aucun débordement du panneau de l'éditeur à 390 px** (350/350) ; seul le filigrane SVG de la coquille, déjà signalé en B4 et présent sur la fiche du produit, fait déborder la page.
- Suite complète (conteneurs, projet `sim-tests`, jamais `sim-b1`) : voir le tableau ci-dessous.

| Suite | Résultat |
|---|---|
| Unitaires | 67 fichiers, 827 tests verts |
| Intégration | 32 fichiers, 420 tests verts (une première passe complète : 32 fichiers verts ; deux passes suivantes sous charge de la machine ont eu des délais dépassés **sans rapport** — fichiers différents à chaque fois, tous verts relancés seuls) |
| Bout en bout | 9 fichiers, 17 tests verts |
| lint, typecheck, build | sans erreur |
| pytest (générateur) | non relancé : générateur non modifié |

## Écarts et limites
- **E3 n'est pas un sous-jacent du document** (H163) : l'assiette s'édite dans la composante ; l'onglet la présente avec les autres effets. Aucun effet nouveau, aucun changement de schéma.
- **Règle ajoutée : un essai doit attendre quelque chose** (H164). Elle a fait échouer une fixture existante (`cotation-bareme.integration.test.ts`, import en masse par tête, `attendu: {}`) : j'y ai tapé le TTC de ce cas (155 641 pour 5 assurés, relevé une fois au moteur — cette fixture teste l'import en masse, pas l'essai). Un classeur ancien dont un essai n'a aucun attendu est désormais refusé : **à valider avec vous** (retirer la règle de `verifierBareme` suffit si vous préférez).
- **Renommage vu du serveur** (H167) : c'est une heuristique (même type et même libellé, ou mêmes valeurs de liste, ou tout le reste identique) ; elle peut refuser un champ supprimé puis recréé à l'identique sous un autre code, et ne voit pas un renommage accompagné d'autres changements. Elle s'applique aussi à l'import. Le contrôle des balises (ajout 9) reste le filet pour tout ce qu'un modèle cite.
- **Valeur d'une liste lue par une table** (H168) : supprimer ou renommer reste refusé ; il faut d'abord changer les champs lus par la table ou la supprimer.
- **Aperçu Commercial** : utilisable mais inerte (H165) — on peut répondre pour voir les conditions, rien n'est calculé ni conservé.
- **Modèles « en vigueur »** (H166) : ceux en vigueur à la date d'effet de la version du barème (ou aujourd'hui) ; une version de modèle programmée plus tard n'est contrôlée qu'à la publication du barème qui la concerne.
- **Débordement horizontal à 390 px** de la page (≈ 560 à 590 px) : filigrane SVG de la coquille, déjà présent avant B4 sur la fiche du produit ; non traité.
- Les 420 tests d'intégration comptent les 13 de B5 ; le premier lot des tests de base de B4 (407) est inchangé.
- Un serveur `next start` d'une session précédente occupait le port 3100 du conteneur `sim-tests-runner` : arrêté pour la recette navigateur ; le serveur de recette est arrêté ; la base jetable `sim_b5_recette_test` reste dans le conteneur de test ; les scripts de recette sont hors dépôt.

## Hypothèses ouvertes
H163 à H169 (voir `decisions.md`, D59).
