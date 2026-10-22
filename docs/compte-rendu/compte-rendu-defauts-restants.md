# Compte rendu — Étape 10 : défauts et points restants (branche `phase-defauts-restants`)

Décision **D46**, hypothèses **H127 à H131** (`docs/decisions.md`). Branche issue de `main` : D45 et H126 sont ceux de `phase-prorata-avenant` (à fusionner avant ou après, sans conflit de numéros).

## Les dix points (un commit chacun)

1. **droits-defauts** : tableau CDC §4 écrit dans le test ; `matriceDuCdc` supprimée (inutilisée).
2. **Factures T4** : cause trouvée. `adapter-pg` classe le code `23001` (`restrict_violation`, celui de tous nos déclencheurs) parmi les clés étrangères : Prisma dit « Foreign key constraint violated » (P2003) ; le vrai message est dans `meta.driverAdapterError.cause.originalMessage`. `refusDuDeclencheur` + `executerAction` / `avecMessage` : plus d'erreur 500. Modifier une facture annulée : « La facture … est annulée par un avoir : elle ne se modifie plus. » Test sur modifier, abandonner, émettre, avoir.
3. **e2e seuil 20 M** : `finally` dans `documents.e2e` et `factures.e2e`. `afterAll` s'exécute déjà si `beforeAll` échoue (vérifié) ; le `finally` couvre un échec du rétablissement.
4. **M2** : 10 échecs / minute / adresse IP (H127). Refus avant le hachage, une ligne d'audit par adresse et par minute.
5. **m1** : colonne `mot_de_passe_modifie_le` (migration `20261022120000`), dans le jeton, comparée à la base (H128).
6. **m7** : le seed refuse une base qui contient un compte hors seed ; message sans identifiants.
7. **m13** : `GENERATEUR_DOCS` (`non` par défaut) ; `/docs`, `/redoc`, `/openapi.json` en 404 (H129).
8. **Alerte de sauvegarde** : `scripts/alerte-sauvegarde.sh`, 26 h, courriel ou journal + syslog, code 1 ; `scripts/tests/alerte.test.sh` (dates simulées) ; `deploiement.md` §7 (H130).
9. **Journal d'audit en Excel** : **n'existait pas**, ajouté (`/api/audit/export`, bouton sur l'écran). Mêmes droit (Admin, Technique, DG) et filtre que l'écran ; 50 000 lignes au plus ; export tracé `JOURNAL_EXPORTE` (H131).
10. **Renouvellement : constat, rien codé** — voir ci-dessous.

## Point 10 : ce que fait un renouvellement aujourd'hui

- Un renouvellement est une **facture** de type RENOUVELLEMENT sur la **même police** (`creerFactureRenouvellement`) : période suivante, tarif de la version du produit en vigueur à la date d'effet, effectifs repris et modifiables. Produit par garanties : composition précédente reprise en brouillon, confirmée avec motif (H90).
- À l'émission, un seul document : la **facture FAC** (puis un reçu par paiement). Le contenu figé de la facture porte `cg: null` (`factures.ts`, données du document).
- **CP** : aucune CP n'est émise ni mise à jour. Celles de l'affaire nouvelle restent, avec les dates de la première période. `mettreAJourCp` n'est appelée que pour un changement de liste d'adhérents d'un contrat de groupe, et reprend alors la CG **figée** à la première émission (H118).
- **CG** : aucune n'est jointe ni citée au renouvellement ; l'assuré garde celles de la première émission. La règle D42 « un renouvellement prend la CG en vigueur à sa date » n'a donc **aucun chemin de code** (le futur chemin appellera `piecesContractuelles` sans CG figée).
- **Question pour la Technique (à poser)** : au renouvellement, faut-il réémettre les CP (et les certificats d'un contrat de groupe) avec les CG en vigueur à la nouvelle date d'effet, ou la facture seule suffit-elle ? Et si oui, pour l'individuel comme pour le groupe ?

## Tests

- `npm test` : 508 / 508. `npm run lint`, `npm run typecheck`, `npm run build` : verts.
- `npm run test:integration` : 298 verts, 10 ignorés (`import-masse`, sans `REDIS_URL` sur ce poste).
- `pytest` (générateur) : 4 échecs propres à Windows (`test_verifier_modele`, accents des sous-processus ; `test_conversion`, LibreOffice), les mêmes sans mes changements ; tests ajoutés verts. Alerte : 43 contrôles verts.
- **Non lancé** : `npm run test:e2e` (générateur inaccessible depuis le poste) ; seuls 2 fichiers e2e ont changé (le `finally`). À lancer dans le conteneur, avec `pytest`.

## Écarts et à noter

- Non vérifié : l'envoi réel d'un courriel (relais SMTP du VPS) ; le parcours de connexion et de déconnexion après changement de mot de passe dans un navigateur (jeton Auth.js testé par ses parties, pas de bout en bout).
- Les tests d'intégration du seuil global des autres fichiers (cotations, documents…) rétablissent déjà le seuil dans `afterAll` ; non modifiés.
- Branche non poussée ni fusionnée.
