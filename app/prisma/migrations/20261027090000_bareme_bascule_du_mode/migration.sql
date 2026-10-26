-- Session B9 (27/10/2026, D50) : un barème se prépare AVANT la bascule du mode de sa version.
-- Horodatage postérieur à 20261026090000 (bareme_documents) : test src/serveur/migrations.test.ts.
--
-- Parcours : créer la version dans un autre mode, à une date future ; importer et publier son barème ; basculer le mode en BAREME.
--  1. Un barème naît donc sur une version qui n'est pas encore en vigueur (ou qui est déjà en mode BAREME : versions de la B3).
--  2. Le mode BAREME ne s'obtient que par une bascule : une version ne naît jamais en BAREME, et ne passe en BAREME que si
--     son barème est publié (la bascule d'une version déjà en vigueur est refusée par le déclencheur d'historisation).

CREATE OR REPLACE FUNCTION bareme_documents_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode_version text;
  date_version date;
BEGIN
  SELECT mode_tarification, date_effet INTO mode_version, date_version FROM produit_versions WHERE id = NEW.version_id;
  IF mode_version IS DISTINCT FROM 'BAREME' AND date_version <= CURRENT_DATE THEN
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

CREATE FUNCTION produit_versions_bareme_publie() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode_tarification = 'BAREME' AND (TG_OP = 'INSERT' OR OLD.mode_tarification IS DISTINCT FROM 'BAREME') THEN
    IF TG_OP = 'INSERT' OR NOT EXISTS (SELECT 1 FROM bareme_documents WHERE version_id = NEW.id AND statut = 'PUBLIE') THEN
      RAISE EXCEPTION 'barème : une version ne passe au mode BAREME que si son barème est publié (créez la version dans un autre mode, publiez le barème, puis basculez)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER produit_versions_bareme_publie BEFORE INSERT OR UPDATE OF mode_tarification ON "produit_versions"
  FOR EACH ROW EXECUTE FUNCTION produit_versions_bareme_publie();
