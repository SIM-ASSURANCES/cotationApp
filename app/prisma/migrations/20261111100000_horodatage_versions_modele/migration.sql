-- D68 : une version PUBLIÉE de modèle entre en vigueur à un INSTANT, comme une version de produit (20261111090000). Deux publications du même
-- modèle le même jour se succèdent : chacune sert à partir de son instant ; un document déjà émis garde sa version (modele_version_id).
--
-- instant_effet (timestamptz) : renseigné pour une version PUBLIE seulement. Date future : minuit de cette date (Abidjan, UTC+0 toute l'année) ;
-- date du jour : instant de la publication. date_effet reste la date de cet instant (CHECK) ; avant publication, c'est la date saisie au dépôt.
-- Migration des données : instant = minuit (Abidjan) de date_effet pour les versions déjà publiées. Aucun document émis ne change.

ALTER TABLE "modele_versions" ADD COLUMN "instant_effet" TIMESTAMPTZ(3);

-- Une version publiée ne se modifie plus (déclencheur modele_versions_figees) : suspendu pour ce seul remplissage, dans la même transaction.
ALTER TABLE "modele_versions" DISABLE TRIGGER "modele_versions_figees";
UPDATE "modele_versions" SET "instant_effet" = ("date_effet"::timestamp AT TIME ZONE 'Africa/Abidjan') WHERE "statut" = 'PUBLIE';
ALTER TABLE "modele_versions" ENABLE TRIGGER "modele_versions_figees";

-- Une seule version publiée par (modèle, instant) : remplace l'unicité par date (20261006125718).
DROP INDEX "modele_versions_publiee_date_key";
CREATE UNIQUE INDEX "modele_versions_publiee_instant_key" ON "modele_versions"("modele_id", "instant_effet") WHERE "statut" = 'PUBLIE';

ALTER TABLE "modele_versions" ADD CONSTRAINT "modele_versions_instant_publiee"
  CHECK (("statut" = 'PUBLIE') = ("instant_effet" IS NOT NULL) AND ("instant_effet" IS NULL OR "date_effet" = ("instant_effet" AT TIME ZONE 'Africa/Abidjan')::date));
