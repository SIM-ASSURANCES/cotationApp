-- CreateTable
CREATE TABLE "modeles" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "produit_id" INTEGER,
    "niveau_relance" INTEGER,
    "liste_annexe" TEXT,
    "bloc_nom" TEXT,
    "bloc_cle" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "modeles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modele_versions" (
    "id" SERIAL NOT NULL,
    "modele_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "statut" TEXT NOT NULL,
    "fichier" BYTEA NOT NULL,
    "nom_fichier" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "empreinte" TEXT NOT NULL,
    "commentaire" TEXT NOT NULL,
    "date_effet" DATE NOT NULL,
    "analyse" JSONB NOT NULL,
    "auteur_id" INTEGER NOT NULL,
    "auteur_identifiant" TEXT NOT NULL,
    "depose_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soumis_le" TIMESTAMP(3),
    "motif_renvoi" TEXT,
    "valideur_id" INTEGER,
    "valideur_identifiant" TEXT,
    "publie_le" TIMESTAMP(3),
    "visa" TEXT,
    "date_document" DATE,
    "pdf" BYTEA,
    "pdf_empreinte" TEXT,

    CONSTRAINT "modele_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modeles_code_key" ON "modeles"("code");

-- CreateIndex
CREATE INDEX "modeles_type_idx" ON "modeles"("type");

-- CreateIndex
CREATE INDEX "modele_versions_statut_idx" ON "modele_versions"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "modele_versions_modele_id_numero_key" ON "modele_versions"("modele_id", "numero");

-- AddForeignKey
ALTER TABLE "modeles" ADD CONSTRAINT "modeles_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modele_versions" ADD CONSTRAINT "modele_versions_modele_id_fkey" FOREIGN KEY ("modele_id") REFERENCES "modeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Valeurs permises (règles du domaine : src/domaine/documents/modeles.ts).
ALTER TABLE "modele_versions" ADD CONSTRAINT "modele_versions_statut_check" CHECK ("statut" IN ('BROUILLON', 'SOUMIS', 'PUBLIE'));
ALTER TABLE "modele_versions" ADD CONSTRAINT "modele_versions_taille_check" CHECK ("taille" > 0);
ALTER TABLE "modele_versions" ADD CONSTRAINT "modele_versions_empreinte_check" CHECK ("empreinte" ~ '^[0-9a-f]{64}$');

-- Deux versions publiées d'un même modèle ne partagent jamais une date d'effet : la version en
-- vigueur à une date est toujours unique (CDC §6.6).
CREATE UNIQUE INDEX "modele_versions_publiee_date_key" ON "modele_versions"("modele_id", "date_effet") WHERE "statut" = 'PUBLIE';

-- Un modèle n'est jamais supprimé ; son identité (type, code, produit, liste, bloc) ne change pas.
CREATE FUNCTION modele_identite_figee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'modèle : suppression interdite (les documents émis y renvoient)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.type, NEW.code, NEW.produit_id, NEW.niveau_relance, NEW.liste_annexe, NEW.bloc_nom, NEW.bloc_cle, NEW.cree_le, NEW.cree_par)
     IS DISTINCT FROM
     (OLD.type, OLD.code, OLD.produit_id, OLD.niveau_relance, OLD.liste_annexe, OLD.bloc_nom, OLD.bloc_cle, OLD.cree_le, OLD.cree_par) THEN
    RAISE EXCEPTION 'modèle : son identité ne se modifie pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER modeles_identite_figee BEFORE UPDATE OR DELETE ON "modeles"
  FOR EACH ROW EXECUTE FUNCTION modele_identite_figee();

-- Version d'un modèle (CDC §6.6) : conservée indéfiniment, jamais écrasée.
--   * jamais supprimée ; le fichier déposé, son empreinte, son auteur ne changent jamais ;
--   * cycle : BROUILLON → SOUMIS → PUBLIE, ou SOUMIS → BROUILLON (renvoi) ;
--   * publiée par un AUTRE utilisateur que l'auteur (séparation des tâches, CDC §4.1) ;
--   * une version publiée ne change plus du tout, PDF des CG/CS compris (produit une seule fois,
--     à la publication) : un document émis se régénère avec la version de son époque (T10).
CREATE FUNCTION modele_version_figee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'version de modèle : suppression interdite' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.statut <> 'BROUILLON' OR NEW.pdf IS NOT NULL OR NEW.valideur_id IS NOT NULL THEN
      RAISE EXCEPTION 'version de modèle : une version déposée commence en brouillon' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.statut = 'PUBLIE' THEN
    RAISE EXCEPTION 'version de modèle publiée : aucune modification possible' USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.modele_id, NEW.numero, NEW.fichier, NEW.nom_fichier, NEW.taille, NEW.empreinte, NEW.commentaire,
      NEW.analyse, NEW.auteur_id, NEW.auteur_identifiant, NEW.depose_le, NEW.visa, NEW.date_document)
     IS DISTINCT FROM
     (OLD.modele_id, OLD.numero, OLD.fichier, OLD.nom_fichier, OLD.taille, OLD.empreinte, OLD.commentaire,
      OLD.analyse, OLD.auteur_id, OLD.auteur_identifiant, OLD.depose_le, OLD.visa, OLD.date_document) THEN
    RAISE EXCEPTION 'version de modèle : le fichier déposé et ses informations ne se modifient pas (déposer une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT ((OLD.statut = NEW.statut)
          OR (OLD.statut = 'BROUILLON' AND NEW.statut = 'SOUMIS')
          OR (OLD.statut = 'SOUMIS' AND NEW.statut IN ('BROUILLON', 'PUBLIE'))) THEN
    RAISE EXCEPTION 'version de modèle : passage de % à % interdit', OLD.statut, NEW.statut USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.statut = 'PUBLIE' THEN
    IF NEW.valideur_id IS NULL OR NEW.valideur_id = NEW.auteur_id OR NEW.publie_le IS NULL THEN
      RAISE EXCEPTION 'version de modèle : publiée par un autre utilisateur que son auteur' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.pdf IS NOT NULL OR NEW.pdf_empreinte IS NOT NULL OR NEW.valideur_id IS NOT NULL OR NEW.publie_le IS NOT NULL THEN
    RAISE EXCEPTION 'version de modèle : PDF et valideur seulement à la publication' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER modele_versions_figees BEFORE INSERT OR UPDATE OR DELETE ON "modele_versions"
  FOR EACH ROW EXECUTE FUNCTION modele_version_figee();
