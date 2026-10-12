# Compte rendu de la session 5b : avis d'échéance, relances, tableaux de bord

Écrit le 09/10/2026, branche `phase-5b` (créée à partir de `phase-5a` après les corrections de tes décisions sur H62 à H65, non fusionnée dans `main`). Décisions : [decisions.md](decisions.md) (D25, hypothèses H67 à H72). Rien n'est commencé au-delà de la 5b.

## Avant la 5b : corrections de la 5a (commit sur `phase-5a`, poussé)

| Décision | Fait |
| --- | --- |
| H65 : pas de colonne de montant | consigné, rien à changer dans le code |
| H62 : âge à la date d'adhésion | déjà le cas ; test ajouté (adhérent ajouté en cours de contrat : âge à sa date d'adhésion, pas à la date d'effet de la police) |
| H63 : doublon = même nom et même date de naissance | c'était déjà la règle, vérifiée : rien à corriger |
| H64 : deux tâches visibles | table `taches_police` (migration `20261009130000_taches_police`) ; l'import crée « Nouvelle version des CP à émettre » et « Facture d'avenant à émettre », affichées sur la cotation acceptée et sur l'écran des adhérents jusqu'à l'émission. Test d'intégration. Règle de fermeture : H66, **à confirmer** |

## Ce qui est fait en 5b

| Point | Livré |
| --- | --- |
| Paramètres par produit | délai J-x de l'avis (15 jours par défaut) et niveaux de relance (J+7, J+15, J+30 « Mise en demeure » par défaut, jusqu'à 9), **historisés** (date d'effet jamais passée, journalisés). Écran : Paramétrage › produit › « Avis et relances » |
| Liste du jour | écran « Échéances » : avis dus (de J-x au jour de l'échéance) et relances dues, avec le reste à payer et les jours de retard. Tâche quotidienne à 6 h (Abidjan) par la file : elle **établit** la liste et la trace au journal, elle n'émet rien (H69) |
| Génération | un bouton par ligne, ou une sélection en **lot** par la file de tâches (barre de progression). Tout est revérifié au moment de produire : facture annulée par un avoir, échéance payée, fenêtre de l'avis, retard de la relance. Aucun envoi automatique |
| Un seul document | un avis par échéance, une relance par (échéance, niveau), **garanti par la base** (index uniques). Trois générations simultanées donnent un document et deux « Déjà produit », sans numéro perdu |
| Modèles | type « Avis d'échéance » ; « Relance » avec un modèle **par niveau** (H16), du produit sinon commun. Nouveaux champs `echeance_appelee.*` et `relance.*`, expliqués dans l'aide des modèles. Numéros AVE et REL (H72) |
| Avoir | annule aussi les avis et relances déjà produits de la facture (« Annulé » sur la page de vérification) |
| Tableaux de bord | cotations par statut ; taux de transformation par produit et par commercial (H70) ; facturation : émis, avoirs, encaissé, restant dû, impayés 0-30 / 31-60 / plus de 60 jours, avis et relances par niveau ; production : documents par type et par mois, imports. Recalculés depuis la base à chaque affichage |
| Droits | nouvelle action « Consulter les tableaux de bord » (hors tableau du CDC §4) : Technique, Comptabilité et DG en lecture, les autres sans accès, modifiable |

## Logique, pour que tu saches ce que tu livres

1. Une **échéance** = une tranche de l'échéancier figé dans la facture émise. Les paiements couvrent les tranches dans l'ordre ; une tranche n'est payée que couverte en entier. Sans échéancier : une seule échéance, le TTC à la date d'effet (H67).
2. **Avis dû** si : facture émise et non annulée, tranche non payée, aujourd'hui entre (date − J-x) et la date, et aucun avis déjà produit.
3. **Relance due** : on calcule le retard ; on prend le niveau **le plus élevé** dont le délai est atteint ; on le produit s'il ne l'a pas déjà été. Pas de rattrapage des niveaux inférieurs (H68).
4. **Générer** : choisir le modèle (sinon refus, aucun numéro consommé), verrouiller la facture, tout revérifier, attribuer le numéro AVE ou REL, figer les données dans la même transaction, puis produire le PDF après. L'index unique est le dernier garde-fou contre les doublons.
5. **Tableaux de bord** : le serveur lit les lignes brutes, des fonctions pures du domaine comptent. Rien n'est stocké, donc rien ne se désynchronise.

## Fichiers principaux

- Base : migration `20261009140000_avis_relances` (colonnes `echeance_numero` et `niveau_relance` de `documents_a_produire`, index uniques partiels, tables `lots_echeances` et `lots_echeances_elements`).
- Domaine : `facturation/echeances.ts`, `tableaux/indicateurs.ts` (nouveaux, avec leurs tests) ; `droits.ts`, `audit.ts`, `cotation/numerotation.ts`, `documents/dictionnaire.ts`, `documents/donnees.ts`.
- Serveur : `echeances.ts`, `tableaux-de-bord.ts` (nouveaux) ; `factures.ts`, `production.ts`, `modeles.ts`, `societe.ts`, `audit.ts`, `taches.ts` (files `echeances` et `quotidien`), `travailleur.ts`.
- Écrans : `echeances/`, `echeances/lots/[id]/`, `tableaux-de-bord/`, `parametrage/produits/[code]/relances/`, liens du menu, aide des modèles.
- Docs : `decisions.md` (D25, H67 à H72), `deploiement.md`, `installation.md`.

## Tests (dans le conteneur, PostgreSQL, Redis et vrai générateur)

- vitest : **302 unitaires** (287 avant), **167 d'intégration** (158 avant ; 9 nouveaux dans `echeances.integration.test.ts`), **11 de bout en bout**. pytest : **173 verts**. `typecheck`, `lint`, `next build` : verts. Schéma et migrations sans écart (`prisma migrate diff` vide).
- Un test par bloc : avis (concurrence, rejeu, lot, hors fenêtre, droits) ; relances (niveaux 1 et 2 avec le modèle de leur niveau, niveau 3 refusé avant J+30, arrêt dès paiement même dans un lot créé avant, paiement partiel, arrêt après avoir) ; liste quotidienne (trace unique, rien d'émis) ; tableaux de bord (écarts avant / après sur des données connues, droits) ; paramètres (historisation, contrôles, droits).
- Dans le test, les modèles d'avis et de relance sont antidatés au 01/01/2026 directement dans la base de test, parce que les échéances de T2 sont passées et que l'application refuse, à raison, de publier un modèle dans le passé.
- **Non fait** : aucun écran essayé dans un navigateur ; rien sous Windows ni avec Docker. **À lancer chez toi** : `npm run test:e2e`, `pytest`, puis l'écran « Échéances » avec `npm run travailleur` lancé.

## Écarts avec le CDC et les instructions

- Taux de transformation **par intermédiaire non livré** : l'application ne connaît pas l'intermédiaire d'une cotation (H71). Il faudrait d'abord l'ajouter à la saisie.
- Droit « Consulter les tableaux de bord » : extension du tableau du CDC §4, à présenter au superviseur avec les autres écarts.

## Hypothèses ouvertes

- **H66** (5a) : règle de fermeture des tâches de H64.
- **H67** : facture sans échéancier = une échéance, le terme, à la date d'effet.
- **H68** : seul le niveau atteint le plus élevé est produit, sans rattrapage.
- **H69** : la tâche quotidienne n'émet rien.
- **H70** : définition du taux de transformation.
- **H71** : pas de transformation par intermédiaire.
- **H72** : préfixes AVE et REL.
