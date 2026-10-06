-- AlterTable
ALTER TABLE "produit_versions" ADD COLUMN     "cg_modele_code" TEXT,
ADD COLUMN     "cg_visa" TEXT,
ADD COLUMN     "cs_modele_code" TEXT,
ADD COLUMN     "cs_visa" TEXT;

-- CreateTable
CREATE TABLE "documents_emis" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origine_id" INTEGER,
    "jeton" TEXT NOT NULL,
    "chemin" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "produit_code" TEXT NOT NULL,
    "police_numero" TEXT,
    "souscripteur_nom" TEXT NOT NULL,
    "souscripteur_masque" TEXT NOT NULL,
    "cotation_id" INTEGER,
    "police_id" INTEGER,
    "date_emission" DATE NOT NULL,
    "date_validite" DATE,
    "modele_version_id" INTEGER NOT NULL,
    "versions_associees" JSONB NOT NULL,
    "parametres_date" DATE NOT NULL,
    "donnees" JSONB NOT NULL,
    "filigrane" TEXT,
    "emis_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emis_par" TEXT NOT NULL,
    "annule_par_numero" TEXT,
    "annule_le" TIMESTAMP(3),

    CONSTRAINT "documents_emis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_emis_jeton_key" ON "documents_emis"("jeton");

-- CreateIndex
CREATE UNIQUE INDEX "documents_emis_chemin_key" ON "documents_emis"("chemin");

-- CreateIndex
CREATE INDEX "documents_emis_type_idx" ON "documents_emis"("type");

-- CreateIndex
CREATE INDEX "documents_emis_police_numero_idx" ON "documents_emis"("police_numero");

-- CreateIndex
CREATE INDEX "documents_emis_souscripteur_nom_idx" ON "documents_emis"("souscripteur_nom");

-- CreateIndex
CREATE INDEX "documents_emis_date_emission_idx" ON "documents_emis"("date_emission");

-- CreateIndex
CREATE UNIQUE INDEX "documents_emis_numero_version_key" ON "documents_emis"("numero", "version");

-- AddForeignKey
ALTER TABLE "documents_emis" ADD CONSTRAINT "documents_emis_modele_version_id_fkey" FOREIGN KEY ("modele_version_id") REFERENCES "modele_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents_emis" ADD CONSTRAINT "documents_emis_version_check" CHECK ("version" >= 1);
ALTER TABLE "documents_emis" ADD CONSTRAINT "documents_emis_empreinte_check" CHECK ("empreinte" ~ '^[0-9a-f]{64}$');
ALTER TABLE "documents_emis" ADD CONSTRAINT "documents_emis_jeton_check" CHECK (length("jeton") >= 32);

-- Document émis : AJOUT SEUL (CDC §11.5, §14.3). Jamais supprimé, jamais modifié ; une réédition est
-- une nouvelle ligne. Seule exception : l'annulation par un avoir (T12), renseignée UNE fois.
CREATE FUNCTION document_emis_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document émis : suppression interdite' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'annule_par_numero' - 'annule_le') IS DISTINCT FROM (to_jsonb(OLD) - 'annule_par_numero' - 'annule_le') THEN
    RAISE EXCEPTION 'document émis : aucune modification possible (une réédition crée une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.annule_par_numero IS NOT NULL THEN
    RAISE EXCEPTION 'document émis : déjà annulé par %', OLD.annule_par_numero USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.annule_par_numero IS NULL OR NEW.annule_le IS NULL THEN
    RAISE EXCEPTION 'document émis : une annulation exige le numéro de l''avoir et sa date' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_emis_figes BEFORE UPDATE OR DELETE ON "documents_emis"
  FOR EACH ROW EXECUTE FUNCTION document_emis_fige();
