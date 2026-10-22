-- Étape 10, point 5 (22/10/2026, audit m1) : date de la dernière modification du mot de passe.
-- Le jeton de session la porte ; elle est comparée à celle de la base à chaque requête : un changement ou une
-- réinitialisation de mot de passe invalide les sessions déjà ouvertes. Les comptes existants prennent la date de la migration.
ALTER TABLE "utilisateurs" ADD COLUMN "mot_de_passe_modifie_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
