-- D68 : une version de produit entre en vigueur à un INSTANT (date et heure), plus seulement à un jour. Plusieurs versions d'un même produit
-- peuvent donc se succéder le même jour, chacune servant dès sa mise en vigueur.
--
-- Représentation :
--   * instant_effet (timestamptz) : l'instant de mise en vigueur ; NULL tant qu'une version « dès la publication » (D66) est en préparation.
--   * date_effet (date) : la DATE de cet instant à Abidjan, tenue par la base (déclencheur + CHECK) ; NULL aussi tant que l'instant l'est.
--     La date sentinelle 9999-12-31 disparaît : aucune ligne n'est plus datée de 9999.
--   * unicité par (produit_id, instant_effet) ; une seule version « dès la publication » (instant NULL) en préparation par produit, comme avant.
-- Africa/Abidjan est UTC+0 toute l'année : minuit à Abidjan est minuit UTC.
--
-- Migration des données : instant = minuit (Abidjan) de date_effet pour les versions existantes ; version en 9999-12-31 : instant et date NULL.
-- Rien ne change pour les cotations, factures et documents existants (leurs colonnes ne sont pas touchées).

-- ---------------------------------------------------------------- Colonne et données

ALTER TABLE "produit_versions" ADD COLUMN "instant_effet" TIMESTAMPTZ(3);
ALTER TABLE "produit_versions" ALTER COLUMN "date_effet" DROP NOT NULL;

-- Le remplissage touche des versions en vigueur : le déclencheur d'historisation est suspendu pour ce seul remplissage, dans la même transaction.
ALTER TABLE "produit_versions" DISABLE TRIGGER "produit_versions_historisees";

UPDATE "produit_versions" SET "instant_effet" = ("date_effet"::timestamp AT TIME ZONE 'Africa/Abidjan') WHERE "date_effet" <> DATE '9999-12-31';
UPDATE "produit_versions" SET "date_effet" = NULL, "instant_effet" = NULL WHERE "date_effet" = DATE '9999-12-31';

ALTER TABLE "produit_versions" ENABLE TRIGGER "produit_versions_historisees";

-- ---------------------------------------------------------------- Unicité et cohérence

DROP INDEX "produit_versions_produit_id_date_effet_key";
CREATE UNIQUE INDEX "produit_versions_produit_id_instant_effet_key" ON "produit_versions"("produit_id", "instant_effet");
CREATE UNIQUE INDEX "produit_versions_une_preparation_sans_date" ON "produit_versions"("produit_id") WHERE "instant_effet" IS NULL;
CREATE INDEX "produit_versions_produit_id_date_effet_idx" ON "produit_versions"("produit_id", "date_effet");
-- Support de la clé étrangère composite (produit_id, version_id) des cotations et des factures (H214).
CREATE UNIQUE INDEX "produit_versions_id_produit_id_key" ON "produit_versions"("id", "produit_id");

ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_date_de_l_instant"
  CHECK (("instant_effet" IS NULL AND "date_effet" IS NULL) OR ("instant_effet" IS NOT NULL AND "date_effet" = ("instant_effet" AT TIME ZONE 'Africa/Abidjan')::date));
-- Seule une version au barème peut être sans instant (en préparation, « dès la publication »).
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_instant_sauf_preparation"
  CHECK ("instant_effet" IS NOT NULL OR "mode_tarification" = 'BAREME');

-- date_effet est la date de l'instant : une saisie de date seule pose l'instant à minuit (Abidjan), un instant pose la date. L'instant l'emporte.
CREATE FUNCTION produit_versions_instant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.instant_effet IS NULL AND NEW.date_effet IS NOT NULL THEN
      NEW.instant_effet := NEW.date_effet::timestamp AT TIME ZONE 'Africa/Abidjan';
    END IF;
  ELSIF NEW.instant_effet IS NOT DISTINCT FROM OLD.instant_effet AND NEW.date_effet IS DISTINCT FROM OLD.date_effet THEN
    NEW.instant_effet := CASE WHEN NEW.date_effet IS NULL THEN NULL ELSE NEW.date_effet::timestamp AT TIME ZONE 'Africa/Abidjan' END;
  END IF;
  NEW.date_effet := CASE WHEN NEW.instant_effet IS NULL THEN NULL ELSE (NEW.instant_effet AT TIME ZONE 'Africa/Abidjan')::date END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER produit_versions_instant BEFORE INSERT OR UPDATE ON "produit_versions"
  FOR EACH ROW EXECUTE FUNCTION produit_versions_instant();

-- ---------------------------------------------------------------- Historisation : figée dès que l'INSTANT est atteint
-- Avant : date_effet <= CURRENT_DATE. Après : instant_effet <= now(). Une version sans instant (en préparation) ou à venir reste modifiable.
-- Le message garde sa forme (« en vigueur depuis le AAAA-MM-JJ »). Cette fonction ne sert plus qu'à produit_versions et formules (taxe_historisee
-- gère les taxes, qui restent au jour).
CREATE OR REPLACE FUNCTION parametrage_historise() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  date_ligne date;
  instant_ligne timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'formules' THEN
    SELECT date_effet, instant_effet INTO date_ligne, instant_ligne FROM produit_versions WHERE id = OLD.produit_version_id;
  ELSIF TG_TABLE_NAME = 'produit_versions' THEN
    date_ligne := OLD.date_effet;
    instant_ligne := OLD.instant_effet;
  ELSE
    date_ligne := OLD.date_effet;
    instant_ligne := OLD.date_effet::timestamp AT TIME ZONE 'Africa/Abidjan';
  END IF;
  IF instant_ligne IS NOT NULL AND instant_ligne <= now() THEN
    RAISE EXCEPTION 'paramétrage historisé : % interdit sur % (en vigueur depuis le %)', TG_OP, TG_TABLE_NAME, date_ligne
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Un barème ne se rattache pas à une version déjà en vigueur dans un autre mode : « en vigueur » se juge à l'instant (20261027090000 jugeait au jour).
CREATE OR REPLACE FUNCTION bareme_documents_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode_version text;
  instant_version timestamptz;
BEGIN
  SELECT mode_tarification, instant_effet INTO mode_version, instant_version FROM produit_versions WHERE id = NEW.version_id;
  IF mode_version IS DISTINCT FROM 'BAREME' AND instant_version <= now() THEN
    RAISE EXCEPTION 'barème : la version % est déjà en vigueur dans un autre mode, elle ne peut plus recevoir de barème', NEW.version_id;
  END IF;
  IF NEW.statut <> 'BROUILLON' THEN
    RAISE EXCEPTION 'barème : un barème naît en brouillon, il ne devient publié que par la publication';
  END IF;
  IF EXISTS (SELECT 1 FROM bareme_documents WHERE version_id = NEW.version_id AND statut = 'PUBLIE') THEN
    RAISE EXCEPTION 'barème : la version % a déjà un barème publié, qui ne se modifie plus (une correction est une nouvelle version)', NEW.version_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- H214 : une cotation ou une facture ne désigne que une version de SON produit
-- La clé étrangère simple de 20261110090000 (même nom) devient composite (version_id, produit_id) -> produit_versions(id, produit_id).
ALTER TABLE "cotations" DROP CONSTRAINT "cotations_version_id_fkey";
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_version_id_fkey" FOREIGN KEY ("version_id", "produit_id") REFERENCES "produit_versions"("id", "produit_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factures" DROP CONSTRAINT "factures_version_id_fkey";
ALTER TABLE "factures" ADD CONSTRAINT "factures_version_id_fkey" FOREIGN KEY ("version_id", "produit_id") REFERENCES "produit_versions"("id", "produit_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- version_date_effet est recopié par la base depuis la version désignée : la date ne peut plus diverger de l'identifiant. Une version sans date
-- (en préparation) ne peut pas être désignée : version_date_effet reste obligatoire. Ces déclencheurs passent APRÈS cotations_figees et
-- factures_intangibles (ordre alphabétique) : le gel d'une ligne émise juge la valeur reçue, puis la copie la rend cohérente.
CREATE FUNCTION version_date_effet_de_la_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  date_version date;
BEGIN
  SELECT date_effet INTO date_version FROM produit_versions WHERE id = NEW.version_id;
  IF FOUND THEN
    IF date_version IS NULL THEN
      RAISE EXCEPTION 'version de produit en préparation (sans date d''effet) : une cotation ou une facture ne peut pas la désigner' USING ERRCODE = 'check_violation';
    END IF;
    NEW.version_date_effet := date_version;
  END IF;
  -- Version introuvable : la clé étrangère refuse la ligne, avec son propre message.
  RETURN NEW;
END;
$$;

CREATE TRIGGER cotations_version_date_effet BEFORE INSERT OR UPDATE ON "cotations"
  FOR EACH ROW EXECUTE FUNCTION version_date_effet_de_la_version();
CREATE TRIGGER factures_version_date_effet BEFORE INSERT OR UPDATE ON "factures"
  FOR EACH ROW EXECUTE FUNCTION version_date_effet_de_la_version();
