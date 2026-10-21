# Compte rendu — session 6.2c-1 (H90 : renouvellement et avenant par garanties)

Branche `phase-6.2c-1`. Décision **D38**, hypothèse **H90 fermée** (`docs/decisions.md`).

## Réalisations

1. **Renouvellement par garanties** :
   - Le brouillon reprend la composition précédente (libellé, branche, prime nette, accessoires, montant garanti).
   - Statut initial : **« À composer — composition précédente proposée »**.
   - Taux de taxe résolus de nouveau à la date d'effet du renouvellement (H93), jamais recopiés.
   - Soumission refusée tant que la Technique n'a pas confirmé (action « Composer une prime », motif obligatoire 3-500 caractères, tracé dans le journal `FACTURE_COMPOSEE`).
2. **Avenant d'incorporation par garanties** :
   - Brouillon préparé sans montant (`ttc: 0`, lignes vides), statut initial **« À composer »**.
   - Aucun prorata automatique.
   - La Technique compose la prime additionnelle (action « Composer une prime », motif obligatoire).
3. **Séparation des tâches (H95)** :
   - Le valideur d'une facture `A_VALIDER` ne peut pas être son demandeur, son préparateur, son composeur ni un contributeur.
4. **Non-régression & documents** :
   - Renouvellement à la formule inchangé au franc près (T1).
   - `garanties_souscrites[]` (avec `montant_garanti`) transmis aux documents PDF (CP et factures).
   - Messages de refus de la 6.2b levés pour ces deux cas.

## Base de données & Migration

- Migration `20261021090000_renouvellement_avenant_garanties` : colonnes `composition_par_id`, `composition_par`, `composition_le`, `composition_motif`, `contributeurs` sur `factures`, assouplissement de la contrainte `factures_avoir_coherent` pour autoriser `ttc = 0` en `BROUILLON`, et contrainte `factures_composition_coherente`.

## Tests à lancer par l'utilisateur

- Tests unitaires et intégration factures :
  `cd app; npm test`
  `cd app; npm run test:integration -- src/serveur/factures.integration.test.ts`
- Vérifications qualité :
  `cd app; npm run lint`
  `cd app; npm run typecheck`
  `cd app; npm run build`

