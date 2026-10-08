# Compte rendu de la session 4a : contrats complets et contrats de groupe

Écrit le 09/10/2026, branche `phase-4a` (créée à partir de `phase-4.0`, non fusionnée dans `main`). Décisions : [decisions.md](decisions.md) (D22, hypothèses H34 à H43).

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

- vitest : **211 unitaires**, **116 d'intégration**, **8 de bout en bout** (dont 3 nouveaux : T5, refus de l'IARD, T6), tous verts. `typecheck`, `lint` et `next build` verts.
- pytest : **162 verts** (136 avant la 4a). Nouveau : `test_contrats_4a.py` (T5, T6, annexe imposée, certificat, route, rendu PDF), 4 tests de fusion, fixtures de la 4a.
- Les contrôles de texte des PDF de bout en bout utilisent `pdftotext` ; ils sont ignorés s'il est absent (sur un poste Windows par exemple).
- **Non fait** : les nouveaux écrans (compléments, adhérents) n'ont pas été essayés dans un navigateur : types, lint et build seulement ; ouverture des PDF dans un vrai lecteur ; rendu sous Windows (polices Calibri et Tahoma absentes du conteneur, `/sante` répond « dégradé », sans effet sur les tests).

## Écarts et points à connaître

- **Modèle de test T9** : il est maintenant un CP complet dont seule la balise `{{ client.nom }}` est fausse. Sans cela, le nouveau contenu obligatoire du §10.1 aurait ajouté d'autres refus à celui que le test attend.
- **Modèles existants** : tout CP déposé avant la 4a doit contenir le contenu du §10.1 pour être redéposé ; un modèle publié reste utilisable tel quel.
- **Certificat sans prime** (H36) : choix de prudence, pas une règle de la Technique.
- **Question en attente de Thierry** : numéro du certificat, « Saisi » (mis en œuvre), « Dérivé de la police mère » ou « Celui de la mère » (H37).
- **Champs toujours non fournis** (bloquants s'ils sont dans un modèle) : `assures[].prime`, `police.reference`.
- Le trop-perçu reste réservé à **H33** (session 4b) ; rien n'a été commencé de la 4b.

## Hypothèses ouvertes

H34 à H43 (D22). À trancher en priorité : **H37** (numéro du certificat) et **H39** (la durée s'écrit « 365 jours » ; mois ou années ?). Restent ouvertes de la 4.0 : H2, H8, H28 à H32 et la date d'entrée en vigueur des taux.
