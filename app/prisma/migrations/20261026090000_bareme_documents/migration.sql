-- Session B3 (26/10/2026, D49) : stockage et publication du barème (propositions-bareme.md §3 option c ; D47, D48).
-- Horodatage postérieur à 20261022120000 (dernière migration) : test src/serveur/migrations.test.ts.
--
-- 1. Mode de tarification BAREME : ajouté à la contrainte de produit_versions. Les versions existantes gardent leur mode.
-- 2. bareme_documents : une ligne par état du barème d'une version (BROUILLON, puis PUBLIE). Un brouillon au plus et un publié au
--    plus par version. Une ligne PUBLIE ne se modifie ni ne se supprime (déclencheur). L'empreinte est le SHA-256 du JSON
--    canonique du contenu (calculée par le code, recalculée à la lecture : un contenu altéré hors application est détecté).

ALTER TABLE "produit_versions" DROP CONSTRAINT "produit_versions_mode_tarification_valide";
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_mode_tarification_valide" CHECK ("mode_tarification" IN ('FORMULE', 'GARANTIES', 'BAREME'));

CREATE TABLE "bareme_documents" (
    "id" SERIAL NOT NULL,
    "version_id" INTEGER NOT NULL,
    "statut" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "contenu" JSONB NOT NULL,
    "empreinte" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,
    "modifie_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publie_par" TEXT,
    "publie_le" TIMESTAMP(3),
    "motif_publication" TEXT,

    CONSTRAINT "bareme_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bareme_documents_statut_valide" CHECK ("statut" IN ('BROUILLON', 'PUBLIE')),
    CONSTRAINT "bareme_documents_empreinte_valide" CHECK ("empreinte" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "bareme_documents_contenu_objet" CHECK (jsonb_typeof("contenu") = 'object'),
    -- Un barème publié dit qui l'a publié, quand et pourquoi ; un brouillon n'a encore rien de tout cela.
    CONSTRAINT "bareme_documents_publication_coherente" CHECK (
        ("statut" = 'BROUILLON' AND "publie_par" IS NULL AND "publie_le" IS NULL AND "motif_publication" IS NULL)
        OR ("statut" = 'PUBLIE' AND "publie_par" IS NOT NULL AND "publie_le" IS NOT NULL AND length(btrim("motif_publication")) > 0)
    )
);

ALTER TABLE "bareme_documents" ADD CONSTRAINT "bareme_documents_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "produit_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Un seul brouillon, et un seul barème publié, par version.
CREATE UNIQUE INDEX "bareme_documents_un_brouillon" ON "bareme_documents"("version_id") WHERE "statut" = 'BROUILLON';
CREATE UNIQUE INDEX "bareme_documents_un_publie" ON "bareme_documents"("version_id") WHERE "statut" = 'PUBLIE';

-- Un barème ne se rattache qu'à une version en mode BAREME, naît en brouillon, et n'a plus de brouillon une fois publié.
CREATE FUNCTION bareme_documents_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode_version text;
BEGIN
  SELECT mode_tarification INTO mode_version FROM produit_versions WHERE id = NEW.version_id;
  IF mode_version IS DISTINCT FROM 'BAREME' THEN
    RAISE EXCEPTION 'barème : la version % n''est pas en mode BAREME', NEW.version_id;
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
CREATE TRIGGER bareme_documents_creation BEFORE INSERT ON "bareme_documents"
  FOR EACH ROW EXECUTE FUNCTION bareme_documents_creation();

-- Un barème publié ne se modifie ni ne se supprime ; une ligne ne change ni de version ni de numéro.
CREATE FUNCTION bareme_documents_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.statut = 'PUBLIE' THEN
    RAISE EXCEPTION 'barème publié : % interdit (une correction est une nouvelle version du produit)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.version_id <> OLD.version_id) THEN
    RAISE EXCEPTION 'barème : une ligne ne change pas de version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bareme_documents_fige BEFORE UPDATE OR DELETE ON "bareme_documents"
  FOR EACH ROW EXECUTE FUNCTION bareme_documents_fige();
