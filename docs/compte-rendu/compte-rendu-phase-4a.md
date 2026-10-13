# Compte rendu de la session 4a : contrats complets et contrats de groupe

Écrit le 08/10/2026 (corrections du même jour ajoutées en bas), branche `phase-4a` (créée à partir de `phase-4.0`, non fusionnée dans `main`). Décisions : [decisions.md](decisions.md) (D22, hypothèses H34 à H46).

## Ce qui est fait

| Point des instructions | Livré |
| --- | --- |
| Saisies manquantes (D19) | 14 champs du souscripteur, `beneficiaires[]`, `contacts_urgence[]` : saisis dans le brouillon de cotation, complétables à l'acceptation (H34). `null` = jamais fourni, `[]` = saisi vide, jusque dans les données du document. Un client enregistré porte ses compléments |
| CP, contenu du §10.1 | exigé **au dépôt** du modèle (H35) : durée (`police.duree_libelle`), bloc des primes complet, clause CG avec `produit.cg_libelle` et `produit.cg_visa`, clause de réclamation (`societe.email_reclamation`), lieu, date d'émission, `signature_sim`. Identification, assurés, bénéficiaires, contacts, garanties (`bloc()`) viennent des données |
| Assemblage | inchangé : CP → annexes → CS → CG, visa vérifié avant l'émission |
| Groupes (§10.2) | police mère : liste des adhérents **toujours en annexe** (`listes_en_annexe`). Incorporation et retrait = nouvelle version de la liste (ajout seul, protégée par la base), numéros d'ordre jamais réutilisés, nouvelle version des CP à chaque changement, réédition à l'identique (T10). Écran « Adhérents » de la police |
| Certificat d'adhésion | un document par adhérent, `police.police_mere`, son propre QR code, **sans prime** (H36), numéro saisi (H37). Génération en masse : phase 5 |
| T5 | SECURVIE, 3 bénéficiaires (50/30/20 %) : tableau répété, garanties du sous-modèle, visa `MFB/DGTCP/DA/N° 01497` identique dans le CP et dans les CG jointes, branche `DECES` : taxe 0 %, TTC 105 000 pour 100 000 + 5 000 |
| T6 | CP VOL : cases cochées selon la saisie (vol caisse 100 000, gardiennage de nuit, locataire), date d'émission dynamique. **Test du document seul**, montants de fixture (H43) : l'IARD est refusé par le moteur tant que H32 n'est pas tranchée, ce que le test vérifie aussi |

## Fichiers principaux

- Domaine : `cotation/saisie.ts` (compléments, bénéficiaires, contacts), `cotation/adherents.ts` (versions, incorporation, retrait, date d'adhésion), `documents/modeles.ts` (contenu obligatoire du CP et du certificat), `documents/donnees.ts`.
- Serveur : `cotations.ts`, `clients.ts`, `adherents.ts` (nouveau), `documents.ts` (`emettreCp`, `mettreAJourCp`, `emettreCertificat`), `generateur.ts`.
- Base : migration `20261009090000_contrats_4a` (colonnes, table `adherents_versions`, déclencheurs d'ajout seul, `documents_emis.adherent_ordre`).
- Écrans : saisie des compléments (cotation, client), fiche de cotation, `cotations/[id]/adherents`.
- Générateur : `fusion.py`, `generation.py`, `routes/interne.py` (`listes_en_annexe`) ; modèles Word de test refaits par code (`tests/fixtures/creer_fixtures.py`).

## Tests (lancés dans le conteneur, avec le vrai générateur et LibreOffice)

- vitest (après les corrections ci-dessous) : **240 unitaires**, **129 d'intégration**, **8 de bout en bout** (dont 3 de la 4a : T5, refus de l'IARD, T6), tous verts. `typecheck`, `lint` et `next build` verts.
- pytest : **162 verts** (136 avant la 4a, inchangé par les corrections). Nouveau : `test_contrats_4a.py` (T5, T6, annexe imposée, certificat, route, rendu PDF), 4 tests de fusion, fixtures de la 4a.
- Les contrôles de texte des PDF de bout en bout utilisent `pdftotext` ; ils sont ignorés s'il est absent (sur un poste Windows par exemple).
- **Non fait** : les nouveaux écrans (compléments, adhérents) n'ont pas été essayés dans un navigateur : types, lint et build seulement ; ouverture des PDF dans un vrai lecteur ; rendu sous Windows (polices Calibri et Tahoma absentes du conteneur, `/sante` répond « dégradé », sans effet sur les tests).

## Écarts et points à connaître

- **Modèle de test T9** : il est maintenant un CP complet dont seule la balise `{{ client.nom }}` est fausse. Sans cela, le nouveau contenu obligatoire du §10.1 aurait ajouté d'autres refus à celui que le test attend.
- **Modèles existants** : tout CP déposé avant la 4a doit contenir le contenu du §10.1 pour être redéposé ; un modèle publié reste utilisable tel quel.
- **Certificat sans prime** (H36) : choix de prudence, pas une règle de la Technique.
- **Numéro du certificat** (H37) : Thierry garde « Saisi » (08/10/2026).
- **Champs** : `assures[].prime` est maintenant fourni par le moteur (H45), `police.reference` est facultatif (H46).
- Le trop-perçu reste réservé à **H33** (session 4b) ; rien n'a été commencé de la 4b.

## Hypothèses ouvertes

H34 à H46 (D22). H37 et H39 sont tranchées par Thierry. À faire confirmer en priorité : **H44** (validation du contrat, la DG ne valide pas) et **H45** (prime par assuré : nette ou TTC ?). Restent ouvertes de la 4.0 : H2, H8, H28 à H32, la question de H31 (les 5 chiffres sont-ils le numéro de l'adhérent ?) et la date d'entrée en vigueur des taux.

## Corrections du 08/10/2026 (avant la 4b)

| Point | Fait |
| --- | --- |
| 1. Droits par défaut = CDC §4 | **Non reproduit** : le code donne « Oui » au Commercial pour « Créer une cotation » depuis la phase 0 (`droits.ts`, jamais modifié), et un test le vérifiait déjà. Ajouté : comparaison de **chaque cellule** du tableau du CDC (lu dans `docs/cdc.md`) avec les droits par défaut du code, avec les droits écrits en base par `npm run initialiser`, et de l'ordre des colonnes. Si le Commercial n'a pas « Oui » chez vous, c'est une ligne déjà en base modifiée (l'initialisation n'écrase jamais) : à regarder dans « Droits par profil » |
| 2. « Oui (sous seuil) » à l'émission d'un contrat | au-dessus du seuil du produit, la demande du Gestionnaire passe « À valider » ; la Technique, autre que le demandeur, émet ce qui vaut validation (H44, H21 fermée pour les contrats). Table `validations_contrat` en ajout protégé, journal `CONTRAT_A_VALIDER` / `CONTRAT_VALIDE`, fiche de cotation adaptée |
| 3. « Proposition » retiré | valeur supprimée ; Comptabilité en « Lecture » ; migration qui convertit les lignes existantes et les journalise ; trace et écart avec le CDC dans D21 |
| 4. Validation de la cotation | dépend du seul droit « Valider une cotation » (déjà le cas, lu dans `cotations.ts`) ; deux nouveaux tests : la DG (« Forcer : Valide ») ne valide ni ne renvoie en brouillon, la Technique valide même sans droit sur le forçage |
| 5. `assures[].prime` | calculée par le moteur (`primeParUnite`), recalculée depuis l'entrée figée donc valable pour les polices déjà émises ; le générateur ne calcule rien (H45) |
| 6. `police.reference` | facultatif ; question ajoutée pour la Technique (H46) |
| 7. Durée (H39) | « 1 an », « 6 mois », « 163 jours » selon la règle de Thierry ; 17 tests dans `duree.test.ts` et vérifications dans les données du CP et du certificat |
| 8. H37, H31 | « Saisi » conservé ; question « les 5 chiffres sont-ils le numéro de l'adhérent ? » ajoutée à H31 et au tableau des décisions en attente |
| 9. Date | 08/10/2026 dans ce compte rendu, D22 et la recette ; la migration `20261009090000_contrats_4a` n'est pas renommée. La nouvelle migration `20261009100000_validation_contrat_et_droits` passe après elle |

Tests de ces corrections : voir les chiffres plus haut. Rien de la 4b n'est commencé.
