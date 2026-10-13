# Compte rendu de la session 6.0 : réponses de la Technique (P1) et documentation

Écrit le 09/10/2026, branche `phase-6.0` (créée depuis `phase-5b`, après la fusion de `phase-4b` et `phase-5a` dans `main`), **non fusionnée**. Décisions : [decisions.md](decisions.md) (D27 : réponses ; D28 : mise en œuvre ; hypothèses H73 à H81). Les P2 (§4 des instructions) ne sont **pas commencés** : ils attendent la validation des P1 par Thierry.

## Ce qui est fait

| Point des instructions | Livré | Logique |
| --- | --- | --- |
| §0 Réponses de la Technique | D27 | Chaque réponse est comparée au code : conforme, à corriger, en attente ou P2 |
| §1 Hygiène | `.gitignore` (`PHASE_*.md`, `.plans/`, `*.xlsx`, `*.csv`, sauf fixtures du générateur), `APP_PORT` dans Compose, `CLAUDE.md` racine | Aucun fichier versionné n'est devenu ignoré |
| §2.1 Avoir sur facture payée en partie (H47) | Avoir accepté ; facture d'origine « Annulée », conservée ; paiements reportés sur la remplaçante ; reçus d'origine valables | Chaque paiement devient un REPORT en avance sur la police ; à l'émission de la facture de remplacement, les reports sont imputés dans la limite de son TTC ; le surplus reste en avance |
| §2.4 Trop-perçu (H33) | Paiement accepté ; excédent en avance ; imputation (proposée, confirmée) et restitution (date, montant, canal, référence) | Grand livre `mouvements_avance` en ajout seul ; avance = crédits − débits ; un déclencheur verrouille la police et refuse tout débit au-delà du disponible : l'avance n'est jamais négative |
| §2.2 Régime de taxe (H29) | Choix « Individuel / Groupe » obligatoire sur la cotation, proposé selon le type de contrat | Le régime choisit la ligne de taux ; le type de contrat reste dans `police.type_contrat` ; rien n'est recalculé (T10) |
| §2.3 Branches (H32) | `MOTO`, `VOYAGE`, `RECOLTE` à 7,25 % depuis le 01/01/2026 (provisoire) | Données de démarrage, chargées par `npm run initialiser` ; IARD toujours refusé |
| §2.5 Numéros (H31, H37, H46) | Avertissement sans blocage sur le numéro de contrat ; certificat dérivé de la police mère ; `police.reference` = `police.numero` | Racine jusqu'à G ou I, puis numéro personnel sur 5 chiffres ; défaut = numéro d'ordre ; `00000` réservé au contrat ; unicité contrôlée, y compris contre un import en cours |
| §2.6 Assurés | `assures[].num_identification`, facultatif | Dictionnaire, saisie (cotation et adhérents), fichier modèle, contrôle de l'import |
| §2.7 Taux de couverture | `formules[].taux_couverture` facultatif (D19) | Vide dans un filtre `pct` : s'écrit vide au lieu de bloquer |
| §2.7 Intermédiaires (H71) | Référentiel (écran « Intermédiaires »), 0 à 2 par cotation, `intermediaires[]` dans les documents, taux de transformation par intermédiaire | Copie au moment du choix : un document réédité garde l'intermédiaire de l'époque |
| §2.7 Tâches d'import (H66) | Fermeture automatique à l'émission de la pièce, fermeture manuelle avec motif | Fermeture enregistrée et journalisée (`TACHE_FERMEE`) ; une tâche fermée ne se rouvre pas (déclencheur) |
| §3 Documentation | `README.md` réécrit (11 points), `docs/deploiement.md` (prérequis administrateur, mise à jour), `docs/installation.md`, `app/README.md` | Test `app/src/documentation.test.ts` : chaque lien et chaque commande citée existent |

## Fichiers principaux

- Migration : `app/prisma/migrations/20261010090000_session_6_0/migration.sql` (excédent, avances, régime de taxe, intermédiaires, fermeture des tâches) ; `schema.prisma`.
- Domaine : `facturation/factures.ts`, `calcul/taxes.ts`, `cotation/police.ts`, `cotation/saisie.ts`, `imports/adherents.ts`, `imports/taches.ts`, `intermediaires.ts`, `documents/dictionnaire.ts` et `donnees.ts`.
- Serveur : `factures.ts`, `encaissements.ts` (nouveau), `cotations.ts`, `documents.ts`, `imports.ts`, `intermediaires.ts` (nouveau), `taches-police.ts`, `tableaux-de-bord.ts`, `parametrage.ts`.
- Écrans : facture (avance, imputation), factures de la police (restitution), cotation (régime, intermédiaires, avertissement du numéro), adhérents (numéro proposé, pièce d'identité), `parametrage/intermediaires`, tâches (fermeture manuelle), tableau de bord.
- Données : `app/prisma/donnees/branches.json`, `taxes-loi.json`.

## Tests

| Suite | Résultat |
| --- | --- |
| Unitaires (`npm test`) | 325 verts |
| Intégration (`npm run test:integration`) | 174 verts, dont T4 sur T3 payée (41 000 repris, numérotation sans trou), trop-perçu, imputation et restitution, régime de taxe, certificat dérivé (saisie et import), intermédiaires, fermeture des tâches |
| Bout en bout (`npm run test:e2e`, vrai générateur) | 12 verts |
| Générateur (`pytest`) | 207 verts |
| `npm run lint`, `npm run typecheck`, `npm run build` | propres |
| Schéma Prisma face à la base migrée (`prisma migrate diff`) | aucune différence |

Les écrans nouveaux ou modifiés sont construits (`npm run build`) mais **n'ont pas été parcourus dans un navigateur** pendant cette session : à faire à la recette.

## Écarts et points d'attention

- **T6** reste testé avec des montants de test : le taux mixte de l'IARD est toujours refusé (H32, ouverte sur ce seul point).
- Les sommes reportées d'une facture annulée ne sont pas réservées à la facture de remplacement (H73) : à confirmer.
- Les codes de branche `MOTO`, `VOYAGE`, `RECOLTE` ne changeront plus une fois en production (H76) : à confirmer avant le déploiement.
- Le rôle d'un intermédiaire est porté par le référentiel, pas choisi cotation par cotation (H79).

## Hypothèses ouvertes

H73 à H81 (D28), plus celles de la section « Décisions en attente » de [decisions.md](decisions.md#décisions-en-attente). Fermées par cette session : H29, H30, H31, H33, H37, H46, H47, H66, H71 (et H1, H2, H28 par D27).

## Pour Thierry

1. Recette sur Windows : `npm run migrate:deploy`, puis `npm run initialiser` (nouvelles branches), puis `npm run test:e2e` et `pytest` (toujours en attente depuis la 5a).
2. Valider ou corriger H73 à H81.
3. Ensuite seulement : les P2 (§4 : composition manuelle de la prime, durées fixes, avoir partiel, avenants), chacun avec deux options au moins avant de coder.
