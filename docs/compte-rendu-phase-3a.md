# Compte rendu de la phase 3a : modèles Word, contrôles, fusion, conversion

Écrit le 06/10/2026. Décisions : [decisions.md](decisions.md) (D14, D15, hypothèses H13 à H17). Vérifications : [recette.md](recette.md) (§2 quater et §3).

## Ce qui est fait

| Domaine | Livré |
| --- | --- |
| **Reliquats** | `/sante` du générateur « dégradé » si Tahoma ou Calibri manque ; décisions du 05/10 consignées (D14 : `URL_PUBLIQUE`, polices jamais dans un registre public) |
| **Bibliothèque** (§6.1, §6.6) | 11 types (CP, cotation, facture, avoir, reçu, avis d'échéance, relance par niveau, annexe par liste, sous-modèle, CG, CS) ; versions conservées en base, jamais écrasées ; Brouillon → Soumis (auteur) → Publié (un autre profil : la DG) ; CG et CS converties en PDF **une seule fois**, à la publication, avec leur visa |
| **Contrôles au dépôt** (§6.7) | .docx valide ; balise hors dictionnaire rejetée **avec son emplacement** (T9) ; blocs if/for ; balise coupée que docxtpl ne recolle pas ; champ Word qui imite une balise ; modèle sans balise ; `case` sans parenthèses ; calcul, `default`, `set` interdits. Avertissements : police absente du générateur, marqueurs hérités |
| **Fusion** (§6.2) | `StrictUndefined` (une donnée absente arrête la génération et est nommée), `autoescape`, bac à sable ; filtres `montant`, `lettres`, `date`, `dateheure`, `pct`, `case` ; `bloc()` ; images |
| **Listes longues** (§6.5) | au-delà du seuil (paramétrable, 10) : renvoi « Voir annexe – … » dans le corps, annexe complète à la fin du PDF (T7) |
| **Écrans** | « Modèles Word » (liste, création, dépôt, soumission, publication, renvoi, téléchargement, aperçu PDF à données fictives) ; « Aide à la rédaction des modèles », générée depuis le dictionnaire |

**T7 et T9 sont verts**, en tests automatisés à tous les niveaux et par les écrans.

## Points à connaître

- **Piège de la syntaxe du CDC** : `{{ risque.statut == "PROPRIETAIRE" | case }}` (§6.2) affiche « False ». Il faut écrire `{{ (risque.statut == "PROPRIETAIRE") | case }}`. Un dépôt sans parenthèses est refusé, avec l'explication.
- **Hypothèses H13 à H17** à faire confirmer par la Direction Technique, avant le balisage. En particulier, les marqueurs hérités ne sont qu'un **avertissement** (H14) : une ligne « ________ » pour une signature manuscrite reste possible.
- Le PDF des **vrais** modèles de SIM n'a pas été produit : ils ne sont pas réunis. Dérouler d'abord le [plan de test de tous les modèles](plan-test-modeles.md).
- Reste pour la **phase 3b** : émission (assemblage CP + annexes + CS + CG, contrôle du visa), QR code et empreinte, réédition à l'identique (T10), page de vérification (T12), filigrane « EXPIRÉE » dans le PDF.

## Essayer soi-même

Préparation : application et générateur lancés (en développement, ou `docker compose up -d`) ; un compte **Technique** et un compte **Direction Générale** (Admin → Utilisateurs). Les fichiers d'essai sont dans `generateur/tests/fixtures/` (données inventées).

1. **Technique** → Modèles Word → créer un modèle « Conditions particulières » (code `CP_ESSAI`, un produit).
2. **T9** : déposer `t9_balise_inconnue.docx`. Attendu : « Dépôt refusé », avec « Balise inconnue « client.nom » … corps, tableau 1, ligne 2, colonne 1 ». Essayer aussi `champ_word.docx` (« retapez-la au clavier »).
3. Déposer `cp_test.docx` : accepté, version 1 en brouillon. Cliquer « Aperçu PDF » : la génération est refusée, avec l'explication : il faut le sous-modèle `garanties`.
4. Créer un « Sous-modèle (bloc) » : nom de bloc `garanties`, clé `SOLO`, même produit. Y déposer `garanties_solo.docx`, puis refaire l'aperçu du CP : le tableau des garanties apparaît, sous chaque formule.
5. **T7** : aperçu avec 25 assurés fictifs → refus expliqué (pas de modèle d'annexe). Créer une « Annexe (liste longue) » sur la liste `assures`, y déposer `annexe_assures.docx`, la soumettre, la faire publier par la **DG**, puis refaire l'aperçu à 25 : renvoi « Voir annexe – Liste des assurés (25 personnes) » et annexe en dernière page.
6. **Cycle** : soumettre la version 1 du CP. Avec la DG : « Publier » avec une date passée → refusé ; avec la date du jour → « Publié, en vigueur ». L'auteur, lui, n'a jamais le bouton « Publier ».
7. **CG** : créer des « Conditions générales » ; déposer `cg_test.docx` avec un visa et une date ; soumettre ; publier (DG). Le bouton « PDF publié » donne le PDF produit à la publication.
8. **Aide** : lien en haut de la page Modèles Word : syntaxe, filtres, dictionnaire complet.

En automatique : `pytest` (générateur), puis, dans `app/`, `npm test`, `npm run test:integration` et `npm run test:e2e` (générateur lancé).
