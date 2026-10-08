# Compte rendu de la session 4.0 : réponses de la Technique, calcul, taxes, cotation

Écrit le 08/10/2026, branche `phase-4.0` (non fusionnée dans `main`). Décisions : [decisions.md](decisions.md) (D18 à D21, hypothèses H29 à H31).

## Ce qui est fait

| Point des instructions | Livré |
| --- | --- |
| §0 Réponses de la Technique | consignées dans D18 (H1 à H12, H28), comparées au code : conforme, à corriger ou en attente |
| §1.1 Accessoires (H1) | valeur par défaut de la formule, modifiable dans la cotation ; journal « Accessoires modifiés » avant/après ; seuil de validation sur le TTC obtenu |
| §1.2 Prorata (H3) | coefficient `min(1, jours / 365)` ; 01/01/2028 → 31/12/2028 donne 1 ; T3 inchangé |
| §1.3 Arrondi (H4) | TTC = somme des trois montants arrondis, à chaque formule et au total ; échéancier = TTC |
| §1.4 Taxes (H5) | clé (branche, type de contrat, date d'effet), ligne la plus précise, H29 ; taux de la loi en données de démarrage ; IARD refusé (« taux mixte non pris en charge : à paramétrer ») ; contrainte d'exclusion PostgreSQL contre les chevauchements ; écran d'historique (période, taux, auteur, date de saisie) |
| §1.5 Validation (H7) | droit paramétrable « Valider une cotation », Technique seule ; `doc.auteur_nom` ajouté au dictionnaire (D20) |
| §1.6 Brouillon (H9) | tout agent habilité modifie un brouillon, tracé ; qui a créé ou modifié ne valide pas |
| §1.7 Numéro de police (H10) | saisi à la transformation, jamais généré, unique, format paramétrable (écran Société) |
| §1.8 Renvoi (H12) | motif obligatoire, journalisé ; « Refusée » reste réservé au refus du client |
| §2 Montants | analyseur unique dans `domaine/calcul/montant.ts` (espaces normale, U+00A0, U+202F, virgule décimale ; refus de `1.234,5`, `1,234.5`, plusieurs virgules) ; messages en français, plus d'erreur 500, rien d'enregistré en cas d'erreur |
| §2 H19 option b | champ non fourni absent (la génération échoue en le nommant) sauf s'il est facultatif (D19) |
| §2 Montserrat | hébergée dans `app/src/app/polices/` avec `OFL.txt`, chargée par `next/font/local` ; le build ne télécharge plus rien pour elle |

Compatibilité : les cotations calculées avant 4.0 gardent leur ancien calcul (version du moteur enregistrée) et ne sont jamais recalculées (T10). Un brouillon ancien sans type de contrat doit être modifié avant soumission.

## Fichiers principaux

- Domaine : `calcul/calcul.ts` (moteur v2), `calcul/montant.ts` (analyseur), `calcul/taxes.ts` (choix du taux), `cotation/police.ts` (numéro saisi), `documents/dictionnaire.ts` et `donnees.ts` (facultatifs), `droits.ts`.
- Serveur : `parametrage.ts` (taxes, accessoires), `cotations.ts` (H1, H7, H9, H10, H12), `societe.ts` (format du numéro), `documents.ts`.
- Base : migration `20261008100000_taxes_type_contrat_cotation` ; données `prisma/donnees/taxes-loi.json`, chargées par `npm run initialiser`.
- Écrans : taxes, calcul, formulaire et fiche de cotation, Société.

## Tests

- vitest : **198 unitaires** et **95 d'intégration**, tous verts ; `typecheck`, `lint` et `next build` verts.
- T1 au franc, T3 (163 jours, 1 809), T13 adapté (B modifie le brouillon de A et ne peut pas valider ; la DG ne valide plus).
- Nouveaux : invariants d'arrondi (moteurs v1 et v2), choix du taux, chevauchement refusé par le service et par la base, taux de démarrage, accessoires, numéro de police, renvoi motivé, test de route du formulaire de version (montants à espaces acceptés, montants ambigus refusés sans rien enregistrer).
- **Non lancés ici** : tests de bout en bout (`npm run test:e2e`) et pytest, qui demandent le générateur. Seules leurs données d'entrée ont été adaptées.

## Écarts et points à connaître

- **Choix à valider (D21)** : taux de démarrage datés du 01/01/2026 ; codes de branche `IA`, `DECES`, `SANTE`, `IARD` ; la DG perd la validation par défaut (le CDC §4.1 disait Technique ou DG).
- **Composante absorbante** : le réglage reste dans la version d'un produit, mais n'a plus d'effet (H4).
- **Route** : le test de route appelle l'action serveur du formulaire avec une vraie base ; la session et l'adresse IP sont simulées, il n'y a pas d'appel HTTP.
- **Modèles existants** : avec l'option b de H19, un modèle qui utilise un champ non fourni (profession, bénéficiaires…) ne se génère plus. Liste dans D19.
- **Recette manuelle** : les KO « montants au format français » et « Montserrat » sont traités ; le test 2.2b (deux taxes SANTE qui se chevauchent) peut être joué.

## Hypothèses ouvertes

H2 (garanties à prime fixe et calculée), H8 (options au choix), H11, H28 (accessoires non proratisés), H29 (FAMILLE → INDIVIDUEL, GROUPE_OUVERT → GROUPE), H30 (T3 : individuel à 4 % ou 1,5 % ?), H31 (signification des 5 chiffres du numéro de police), liste des champs facultatifs (D19).
