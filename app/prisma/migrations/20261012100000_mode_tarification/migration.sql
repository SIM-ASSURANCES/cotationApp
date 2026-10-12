-- Session 6.2a : mode de tarification d'une version de produit.
-- Horodatage postérieur à 20261010090000 (dernière migration, session 6.0) : test src/serveur/migrations.test.ts.
--
-- FORMULE (défaut) : le comportement actuel, prime unitaire × effectif × prorata, calcul automatique.
-- GARANTIES : produit tarifé par garanties (SECURPRO, SECURHOME, SECURHOME +, RELAXACCIDENTS) ; le moteur ne sait pas le
-- calculer, le calcul automatique est refusé (la composition manuelle est la session 6.2b).
-- Les versions existantes prennent FORMULE : leurs montants ne changent pas. Ajouter une colonne avec une valeur par défaut
-- ne déclenche pas le déclencheur d'historisation (il ne porte que sur UPDATE et DELETE).
ALTER TABLE "produit_versions" ADD COLUMN "mode_tarification" TEXT NOT NULL DEFAULT 'FORMULE';
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_mode_tarification_valide" CHECK ("mode_tarification" IN ('FORMULE', 'GARANTIES'));
