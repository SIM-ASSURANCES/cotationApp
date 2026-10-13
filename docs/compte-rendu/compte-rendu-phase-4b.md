# Compte rendu de la session 4b : factures, avoirs, paiements, reçus

Écrit le 08/10/2026, branche `phase-4b` (créée à partir de `phase-4a`, non fusionnée dans `main`). Décisions : [decisions.md](decisions.md) (D23, H33, hypothèses H47 à H59 ; H45 mise à jour ; H21 fermée).

## Ce qui est fait

| Point | Livré |
| --- | --- |
| Migrations | une seule nouvelle migration, `20261009110000_factures_paiements_recus`, postérieure à `20261009100000`. Nouveau test `migrations.test.ts` : noms au format `AAAAMMJJHHMMSS_nom`, horodatages strictement croissants, toute nouvelle migration après `20261009100000`, aucune migration qui cite une table, une fonction ou un type créé par une migration nommée après elle (commentaires et textes ignorés) |
| H45 | `assures[].prime` = TTC d'une unité de la formule : test T1 à 96 000 (Solo) et 260 000 (Famille). Membres d'une famille : prime de la famille, choix conservé et marqué « à confirmer par la Technique » |
| « Oui (sous seuil) » des factures | comme les contrats : le Gestionnaire au-dessus du seuil enregistre une demande « À valider » sans numéro ; la Technique ou la Comptabilité, autre que le demandeur, émet ; la DG ne valide pas (H56). H21 fermée |
| Modèle de facture (§11.2) | contenu exigé au dépôt (H57) : police, Facturé à avec adresse, taux de taxe, TTC avec le filtre `lettres`, RIB, Mobile Money, mention de l'article 13 du Code CIMA, signature, QR code. « Envoyé à » masqué s'il est vide ou identique ; échéances Payé / Non payé si fractionnée ; paiements et restant dû s'il y en a |
| Types (§11.3) | affaire nouvelle (après les CP, H48), renouvellement au tarif en vigueur à la nouvelle date d'effet (H50), avenant d'incorporation au prorata (H51), avoir (H47), facture de groupe globale avec détail par adhérent en annexe (H59) |
| Numérotation (§11.4) | FAC, AV, REC (COT existait) ; compteur annuel par type, sans trou ; format paramétrable par type dans l'écran Société, historisé et journalisé (avant, après) ; numéro attribué à l'émission dans la même transaction, PDF après ; « PDF en attente » relancé à l'identique |
| Intangibilité | déclencheurs : facture émise ni modifiée ni supprimée (seule l'annulation par avoir, une fois), paiements en ajout seul et jamais au-delà du TTC, documents à produire figés |
| Paiements (§12) | date, montant (analyseur unique), canal, référence, payeur ; montant > 0 ; rien sur une facture annulée ; trop-perçu refusé (H33) ; échéances payées dans l'ordre (H49) ; chaque paiement → reçu REC et facture v+1 |
| Écrans | `Factures` (liste et filtres), fiche d'une facture (émettre, modifier le brouillon, payer, avoir, relancer les PDF), factures d'une police depuis la fiche de la cotation, formats des numéros dans « Société » |

## Fichiers principaux

- Domaine : `facturation/factures.ts` (nouveau), `cotation/numerotation.ts` (formats), `documents/donnees.ts`, `documents/dictionnaire.ts`, `documents/modeles.ts`, `documents/controles.ts`.
- Serveur : `factures.ts` et `production.ts` (nouveaux), `numerotation.ts`, `societe.ts`, `documents.ts`.
- Base : migration `20261009110000_factures_paiements_recus` (tables `factures`, `paiements`, `documents_a_produire`, contraintes et déclencheurs).
- Écrans : `factures/`, `factures/[id]/`, `cotations/[id]/factures/`, `parametrage/societe/`.
- Générateur : modèles de test `facture_test.docx`, `avoir_test.docx`, `recu_test.docx` (inventés, refaits par code) ; `tests/test_factures_4b.py`.

## Tests (lancés dans le conteneur, avec le vrai générateur et LibreOffice)

- vitest : **266 unitaires** (240 avant), **148 d'intégration** (129 avant, dont 19 nouveaux : T2, T3, T4, concurrence de 20 émissions, sous seuil, PDF en attente, renouvellement, avenant, formats), **10 de bout en bout** (8 avant : T2, T3 et T4 avec de vrais PDF). `typecheck`, `lint` et `next build` verts.
- pytest : **169 verts** (162 avant).
- **Non fait** : les nouveaux écrans n'ont pas été essayés dans un navigateur (types, lint et build seulement) ; aucun essai sous Windows. **À lancer chez toi avant fusion** : `npm run test:e2e` et `pytest`.

## Écarts et points à connaître

- **T2 et T3** : le CDC donne les totaux, pas le tarif ; celui des tests est reconstitué pour retrouver les montants au franc (H58), sans valeur tarifaire.
- **Avoir** : seulement total, et refusé sur une facture déjà payée en partie (H47).
- **DG** : ne valide pas l'émission d'une facture, même écart avec le CDC §4.1 que pour la cotation et le contrat (à présenter au superviseur).
- **Réédition** : une facture, un avoir ou un reçu ne se réédite plus depuis « Documents émis » ; la facture est rééditée à chaque paiement (H55).
- **Données de test de bout en bout** : la société de test reçoit un RIB et un Mobile Money inventés (`assurerSocieteDeTest`), partagés avec le test de la 4a.

## Hypothèses ouvertes

H33 et H47 à H59 (D23), à faire confirmer par la Technique, en priorité : **H33** (trop-perçu), **H47** (avoir partiel, facture déjà payée), **H51** (accessoires et prime minimale d'un avenant, ristourne d'un retrait), **H52** (sens de « Valide » pour l'avoir) et la prime d'un membre de famille (H45). **H53** (extensions du dictionnaire) est à valider par toi. Restent ouvertes des sessions précédentes : H2, H8, H28 à H32, H44, H46.
