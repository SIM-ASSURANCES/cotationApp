# Feuille de route — fin de stage (à partir du 20/10/2026)

> Une étape = **une session Claude Code**, sur une branche créée depuis `main` à jour. On ne commence une étape que quand la précédente est **recettée par Thierry et fusionnée**.
> Pour chaque étape : copier dans la session le bloc « Règles communes » + le bloc de l'étape. Rien d'autre.

## Règles communes (à coller en tête de chaque session)

```
Dépôt SIM-ASSURANCES/cotationApp. Lire CLAUDE.md et seulement les sections de docs/decisions.md citées par l'étape (ne pas relire tout le CDC).
Migrations : nom postérieur à la dernière existante. Hypothèses et décisions : à la suite des dernières de decisions.md.
Données de test inventées. Aucun barème ni donnée du simulateur de la Technique.
Périmètre strict : seulement ce que décrit l'étape. Tout besoin découvert en route : le noter dans le compte rendu, ne pas le coder.
Si plusieurs approches valables : proposer au moins 2 options (avantages, limites, risque, recommandation) et S'ARRÊTER avant de coder.
Économie : tests ciblés pendant le travail, suite complète une seule fois à la fin. Compte rendu de 40 lignes maximum (docs/compte-rendu/).
Fin : tests verts (unitaires, intégration, lint, typecheck, build), un commit par point, pousser la branche, ne pas fusionner.
```

## Ordre des étapes

| # | Étape | Taille | Qui |
|---|---|---|---|
| 0 | Finir SECURPRO (session en cours) + montant garanti | en cours | agent + Thierry |
| 1 | 6.2c-1 : renouvellement et avenant des polices par garanties (H90) | moyenne | agent |
| 2 | 6.2c-2 : réductions selon l'effectif — **options seulement** | petite | agent |
| 3 | Seuil unique de validation (10 M, Technique et Direction) | petite | agent |
| 4 | Arborescence, partie 1 : navigation et menu | moyenne | agent |
| 5 | Arborescence, partie 2 : rangement des fichiers | moyenne | agent |
| 6 | CG par branche (5 CG, code et visa) | petite | agent |
| 7 | Prorata de l'avenant d'incorporation : oui / non | petite | agent |
| 8 | Sauvegarde hebdomadaire et restauration | petite | agent + superviseur |
| 9 | Retouches d'interface (liste tenue par Thierry pendant les recettes) | petite | agent |
| 10 | Défauts connus (tests `droits-defauts`, `factures` T4 ; M2, m1) | petite | agent |
| — | **Sans code** : SECURHOME paramétré en formules ; liste des 5 défauts du simulateur envoyée à la Technique ; manuel utilisateur ; document de passation | — | Thierry |

---

## Étape 0 — Finir SECURPRO
Consigne en cours : `SECURPRO_instructions_claude_code.md`. **Si la Technique confirme** que « la somme de la garantie » est le **montant garanti** (colonne « Montant / 1er risque » du simulateur), ajouter à la session :
```
Correction du point 2 : chaque garantie de la version du produit porte un MONTANT GARANTI par défaut (capital ou 1er risque, FCFA, ≥ 0), modifiable sur chaque cotation à la composition. La prime nette et les accessoires restent saisis par la Technique à la composition (pré-remplissage des accessoires par défaut conservé). Dictionnaire : garanties_souscrites[].montant_garanti (facultatif : vide pour une garantie sans capital). Test : montant par défaut repris, modifié sur une cotation, figé à l'émission, présent dans les données du PDF.
```

## Étape 1 — 6.2c-1 (H90)
Consigne existante : `PHASE_6_2c_instructions_claude_code.md`, **session 6.2c-1 seulement**. Ajouter : le **montant garanti** de chaque ligne est repris de la composition précédente comme la prime.

## Étape 2 — 6.2c-2 (options seulement)
Consigne existante : `PHASE_6_2c_instructions_claude_code.md`, session 6.2c-2. Livrable : `docs/propositions-6.2c-2.md`, aucun code. Thierry envoie les questions qu'il contient à la Technique ; la réalisation attend leurs réponses.

## Étape 3 — Seuil unique de validation
```
Réponse de la Technique (20/10/2026) : un seuil UNIQUE pour tous les produits, 10 000 000 FCFA TTC ; valideurs : Technique et Direction.
1. Le seuil devient un paramètre global (écran Société), défaut 10 000 000, historisé avec date d'effet. Le seuil par version de produit est retiré de la saisie (gardé en base pour l'historique, plus utilisé). Comparaison stricte inchangée (D18).
2. Valideurs : profils Technique ET Direction générale peuvent valider (cotation, émission de contrat H44, facture H56). Fin de l'écart D21 : tracer dans decisions.md.
3. AVANT DE CODER, poser la question à Thierry si le texte suivant n'est pas tranché dans decisions.md : « une validation par l'un des deux profils » (par défaut) ou « deux validations successives, Technique puis Direction ». Coder le défaut si Thierry ne répond pas autrement.
4. Séparation des tâches inchangée (auteur, composeur, demandeur ne valident pas).
Tests : 9 999 999 passe, 10 000 001 va en validation ; DG valide ; l'auteur ne valide pas ; une cotation émise avant le changement n'est pas touchée.
```

## Étape 4 — Arborescence, partie 1 : navigation et menu
```
Besoin de la Technique : parcourir le portefeuille dans cet ordre :
Branche → Produit → Client → Cotation → Contrat (police) → Avenant → Facture → Avoir → Reçu → Relance.
(Les 5 branches principales existent depuis l'étape 0.)
Proposer 2 options AVANT de coder, par exemple :
(a) un explorateur « Portefeuille » : une page par niveau (/portefeuille, /portefeuille/[branche], /…/[produit], /…/[client], puis la fiche cotation existante), fil d'Ariane en haut, compteurs à chaque niveau ;
(b) des filtres enchaînés (branche, produit, client) sur les listes existantes, avec fil d'Ariane.
Recommandation attendue avec la charge. Après accord de Thierry :
- Menu latéral : entrée « Portefeuille » ; dans « Paramétrage > Produits », produits regroupés par branche.
- Sous une cotation : son contrat, puis ses avenants, puis les factures ; sous une facture : avoir, reçus, relances (la plupart existent déjà sur les fiches : les relier, ne pas les refaire).
- Droits : chaque niveau n'affiche que ce que le profil peut lire (mêmes contrôles côté serveur que les listes actuelles).
- Mise en page de la bibliothèque d'interface (D33), 1440 px et 390 px sans défilement horizontal.
Tests : droits par niveau ; fil d'Ariane ; une branche sans produit ; un client avec deux produits.
```

## Étape 5 — Arborescence, partie 2 : rangement des fichiers
```
Les PDF émis sont rangés sur le volume du générateur selon le même ordre :
<branche>/<produit>/<client>/<cotation>/<contrat>/<avenant>/<facture>/{avoir,recus,relances}
Proposer 2 options AVANT de coder pour l'identifiant de chaque niveau. Contraintes : pas de nom de personne dans un chemin (donnée personnelle, et un nom change) → codes et numéros (code branche, code produit, identifiant client, COT-…, numéro de police, FAC-…) ; segments validés comme aujourd'hui (stockage.py : pas de « .. », 10 segments au plus, ajout seul) ; l'export ZIP reprend la même arborescence.
Rien en production : pas de reprise des fichiers existants, mais un script qui range les fichiers de la base de développement, idempotent, à lancer à la main.
Tests : chemin de chaque type de document ; ZIP ; caractères interdits refusés.
```

## Étape 6 — CG par branche
```
Réponse de la Technique : cinq CG, une par branche principale, gérées depuis le paramétrage ; code et visa obligatoires (fait à l'étape 0 pour le dépôt).
1. Une CG se rattache à une BRANCHE (et non plus à chaque produit) ; un produit hérite de la CG de sa branche ; une CS reste propre au produit.
2. Proposer 2 options pour l'existant (CG déjà rattachées à des produits) avant de coder.
3. Les balises produit.cg_libelle / cg_visa / cg_date restent les mêmes (aucun modèle Word à reprendre).
Tests : CP d'un produit qui reçoit la CG de sa branche ; nouvelle version de CG sans effet sur une CP émise ; branche sans CG → émission refusée avec message.
```

## Étape 7 — Prorata de l'avenant d'incorporation
```
Réponse de la Technique : à l'avenant d'incorporation, appliquer le prorata temporis OUI ou NON.
1. Choix fait sur la facture d'avenant (case « Prorata temporis »), défaut = OUI (comportement actuel H51) ; NON = prime entière de la période.
2. Produits par garanties : sans objet (composition manuelle, H90).
3. Le choix est journalisé et figé à l'émission.
Tests : même incorporation, OUI et NON, montants attendus calculés à la main en commentaire.
```

## Étape 8 — Sauvegarde hebdomadaire
```
Besoin : sauvegarder et pérenniser les données chaque semaine (en plus de la sauvegarde quotidienne de deploiement.md §7).
1. Script scripts/sauvegarde.sh : pg_dump au format custom (-Fc, fichier écrit DANS le conteneur puis docker cp, jamais de redirection), archive du volume des documents, horodatage, conservation (7 quotidiennes, 8 hebdomadaires), copie vers un dossier cible paramétrable (disque ou serveur distinct, à fixer par le superviseur).
2. Script scripts/restauration.sh vers une base NEUVE (jamais l'existante), puis vérification : migrate status, nombre de lignes de 5 tables clés, ouverture d'un PDF.
3. deploiement.md : lignes cron (quotidienne, hebdomadaire), test de restauration trimestriel.
Tests : sauvegarde puis restauration sur une pile Docker de test (-p sauvegarde-test), comparaison des comptes de lignes.
```

## Étape 9 — Retouches d'interface
Thierry tient pendant ses recettes une liste « écran → ce qui ne va pas → ce qu'il faut » (une ligne par retouche). La session reçoit cette liste telle quelle ; **aucune nouvelle fonctionnalité** n'y entre.

## Étape 10 — Défauts connus
```
1. Test droits-defauts : ne plus dépendre de docs/cdc.md à l'exécution (données attendues dans le test).
2. Test factures T4 : trouver pourquoi Prisma rapporte une violation de clé étrangère au lieu du message du déclencheur dans le conteneur ; vérifier le message affiché à l'utilisateur.
3. M2 de l'audit : limite de tentatives de connexion par adresse (classe LimiteRequetes existante).
4. m1 de l'audit : invalider les sessions ouvertes après un changement ou une réinitialisation de mot de passe.
```

---

## Sans code — Thierry
- **SECURHOME** : paramétrer en mode `FORMULE`, 5 formules (1 à 5 pièces), accessoires fixes 2 500, branche fiscale INCENDIE. Vérifier une cotation contre le simulateur.
- **Défauts du simulateur** à envoyer à la Technique, avec la cellule : IA (11 personnes) ; SECURMOTO (taxe avant réduction) ; SECURPRO (`H33` s'arrête à `D37` : Tempête et TRI hors du total ; prime à 0 sans message au-delà du plafond ; capital forcé à 5 M dans un marché) ; RELAXSANTE (calcul à rebours à 7,25 %).
- **Manuel utilisateur** : une page par profil (Commercial, Technique, Gestionnaire, Comptabilité, Admin).
- **Passation** : déploiement, comptes admin, sauvegarde et restauration, questions encore ouvertes (doc « Questions en attente »), version 2 (calcul automatique par garanties).
