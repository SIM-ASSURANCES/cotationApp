-- CreateTable
CREATE TABLE "taxes" (
    "id" SERIAL NOT NULL,
    "branche" TEXT NOT NULL,
    "taux_pourcent" DECIMAL(9,6) NOT NULL,
    "assiette" TEXT NOT NULL DEFAULT 'NETTE_ACCESSOIRES',
    "date_effet" DATE NOT NULL,
    "date_fin" DATE,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produits" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "gamme" TEXT NOT NULL,
    "branche" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "produits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produit_versions" (
    "id" SERIAL NOT NULL,
    "produit_id" INTEGER NOT NULL,
    "date_effet" DATE NOT NULL,
    "arrondi_precision" INTEGER NOT NULL,
    "arrondi_sens" TEXT NOT NULL,
    "arrondi_niveau" TEXT NOT NULL,
    "arrondi_composante" TEXT NOT NULL,
    "prorata_actif" BOOLEAN NOT NULL,
    "prime_minimale" DECIMAL(18,6),
    "fractionnement_tranches_max" INTEGER NOT NULL DEFAULT 1,
    "fractionnement_repartition" JSONB,
    "fractionnement_decalages_mois" JSONB,
    "frais_fractionnement" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "validite_jours" INTEGER NOT NULL DEFAULT 90,
    "formules_max" INTEGER NOT NULL DEFAULT 3,
    "seuil_validation_ttc" DECIMAL(18,6),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "produit_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formules" (
    "id" SERIAL NOT NULL,
    "produit_version_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "taux_couverture" DECIMAL(6,3),
    "prime_unitaire" DECIMAL(18,6) NOT NULL,
    "accessoire_mode" TEXT NOT NULL,
    "accessoire_valeur" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "formules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "taxes_branche_date_effet_key" ON "taxes"("branche", "date_effet");

-- CreateIndex
CREATE UNIQUE INDEX "produits_code_key" ON "produits"("code");

-- CreateIndex
CREATE UNIQUE INDEX "produit_versions_produit_id_date_effet_key" ON "produit_versions"("produit_id", "date_effet");

-- CreateIndex
CREATE UNIQUE INDEX "formules_produit_version_id_code_key" ON "formules"("produit_version_id", "code");

-- AddForeignKey
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formules" ADD CONSTRAINT "formules_produit_version_id_fkey" FOREIGN KEY ("produit_version_id") REFERENCES "produit_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historique du paramétrage (CDC §7) : une ligne DÉJÀ EN VIGUEUR (date d'effet atteinte) ne se modifie
-- ni ne se supprime jamais, quel que soit le code qui s'exécute. Pour changer un taux ou un tarif,
-- on ajoute une ligne avec une nouvelle date d'effet. Une ligne à date future reste corrigeable.
CREATE FUNCTION parametrage_historise() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  date_ligne date;
BEGIN
  IF TG_TABLE_NAME = 'formules' THEN
    SELECT date_effet INTO date_ligne FROM produit_versions WHERE id = OLD.produit_version_id;
  ELSE
    date_ligne := OLD.date_effet;
  END IF;
  IF date_ligne <= CURRENT_DATE THEN
    RAISE EXCEPTION 'paramétrage historisé : % interdit sur % (en vigueur depuis le %)', TG_OP, TG_TABLE_NAME, date_ligne
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER taxes_historisees BEFORE UPDATE OR DELETE ON "taxes"
  FOR EACH ROW EXECUTE FUNCTION parametrage_historise();
CREATE TRIGGER produit_versions_historisees BEFORE UPDATE OR DELETE ON "produit_versions"
  FOR EACH ROW EXECUTE FUNCTION parametrage_historise();
CREATE TRIGGER formules_historisees BEFORE UPDATE OR DELETE ON "formules"
  FOR EACH ROW EXECUTE FUNCTION parametrage_historise();
