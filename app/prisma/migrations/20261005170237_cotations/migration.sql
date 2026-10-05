-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenoms" TEXT NOT NULL DEFAULT '',
    "raison_sociale" TEXT NOT NULL DEFAULT '',
    "telephone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "adresse" TEXT NOT NULL DEFAULT '',
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "cle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "motifs_refus" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motifs_refus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotations" (
    "id" SERIAL NOT NULL,
    "numero" TEXT,
    "statut" TEXT NOT NULL,
    "produit_id" INTEGER NOT NULL,
    "version_date_effet" DATE NOT NULL,
    "client_id" INTEGER,
    "souscripteur" JSONB NOT NULL,
    "date_effet" DATE NOT NULL,
    "date_echeance" DATE NOT NULL,
    "nombre_tranches" INTEGER NOT NULL DEFAULT 1,
    "lignes" JSONB NOT NULL,
    "motif_forcage" TEXT,
    "assures" JSONB NOT NULL DEFAULT '[]',
    "risque" JSONB NOT NULL DEFAULT '{}',
    "donnees_calcul" JSONB,
    "resultat" JSONB,
    "ttc_total" DECIMAL(18,2),
    "echeancier" JSONB,
    "raisons_validation" JSONB NOT NULL DEFAULT '[]',
    "auteur_id" INTEGER NOT NULL,
    "auteur_identifiant" TEXT NOT NULL,
    "valide_par_id" INTEGER,
    "valide_le" TIMESTAMP(3),
    "date_etablissement" DATE,
    "date_validite" DATE,
    "emise_le" TIMESTAMP(3),
    "formules_retenues" JSONB,
    "acceptee_le" TIMESTAMP(3),
    "motif_refus_code" TEXT,
    "refus_commentaire" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polices" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "cotation_id" INTEGER NOT NULL,
    "produit_code" TEXT NOT NULL,
    "souscripteur" JSONB NOT NULL,
    "assures" JSONB NOT NULL,
    "risque" JSONB NOT NULL,
    "formules_retenues" JSONB NOT NULL,
    "donnees_calcul" JSONB NOT NULL,
    "resultat" JSONB NOT NULL,
    "ttc_total" DECIMAL(18,2) NOT NULL,
    "echeancier" JSONB NOT NULL,
    "date_effet" DATE NOT NULL,
    "date_echeance" DATE NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "polices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "motifs_refus_code_key" ON "motifs_refus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cotations_numero_key" ON "cotations"("numero");

-- CreateIndex
CREATE INDEX "cotations_statut_idx" ON "cotations"("statut");

-- CreateIndex
CREATE INDEX "cotations_date_validite_idx" ON "cotations"("date_validite");

-- CreateIndex
CREATE INDEX "cotations_produit_id_idx" ON "cotations"("produit_id");

-- CreateIndex
CREATE UNIQUE INDEX "polices_numero_key" ON "polices"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "polices_cotation_id_key" ON "polices"("cotation_id");

-- AddForeignKey
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polices" ADD CONSTRAINT "polices_cotation_id_fkey" FOREIGN KEY ("cotation_id") REFERENCES "cotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cotation FIGÉE dès qu'elle est émise (CDC §4.1 : « un document validé est figé ») :
--   * brouillon et « À valider » : modifiables ; seul un brouillon peut être supprimé ;
--   * « Émise » : seules les données d'issue (statut, formules retenues, acceptation, refus) peuvent changer,
--     et seulement vers « Acceptée », « Refusée » ou « Expirée » ;
--   * « Acceptée », « Refusée », « Expirée » : plus aucune modification.
-- Une cotation expirée ne peut donc JAMAIS être acceptée, même en SQL direct (T11).
CREATE FUNCTION cotation_figee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'BROUILLON' THEN
      RAISE EXCEPTION 'cotation figée : suppression interdite (statut %)', OLD.statut USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.statut IN ('BROUILLON', 'A_VALIDER') THEN
    RETURN NEW;
  END IF;

  IF OLD.statut IN ('ACCEPTEE', 'REFUSEE', 'EXPIREE') THEN
    RAISE EXCEPTION 'cotation figée : modification interdite (statut %)', OLD.statut USING ERRCODE = 'restrict_violation';
  END IF;

  -- OLD.statut = 'EMISE'
  IF NEW.statut NOT IN ('EMISE', 'ACCEPTEE', 'REFUSEE', 'EXPIREE') THEN
    RAISE EXCEPTION 'cotation figée : une cotation émise ne revient pas au statut %', NEW.statut USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.numero, NEW.produit_id, NEW.version_date_effet, NEW.client_id, NEW.souscripteur, NEW.date_effet,
      NEW.date_echeance, NEW.nombre_tranches, NEW.lignes, NEW.motif_forcage, NEW.assures, NEW.risque,
      NEW.donnees_calcul, NEW.resultat, NEW.ttc_total, NEW.echeancier, NEW.raisons_validation,
      NEW.auteur_id, NEW.auteur_identifiant, NEW.valide_par_id, NEW.valide_le, NEW.date_etablissement,
      NEW.date_validite, NEW.emise_le)
     IS DISTINCT FROM
     (OLD.numero, OLD.produit_id, OLD.version_date_effet, OLD.client_id, OLD.souscripteur, OLD.date_effet,
      OLD.date_echeance, OLD.nombre_tranches, OLD.lignes, OLD.motif_forcage, OLD.assures, OLD.risque,
      OLD.donnees_calcul, OLD.resultat, OLD.ttc_total, OLD.echeancier, OLD.raisons_validation,
      OLD.auteur_id, OLD.auteur_identifiant, OLD.valide_par_id, OLD.valide_le, OLD.date_etablissement,
      OLD.date_validite, OLD.emise_le) THEN
    RAISE EXCEPTION 'cotation figée : les données d''une cotation émise ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cotations_figees BEFORE UPDATE OR DELETE ON "cotations"
  FOR EACH ROW EXECUTE FUNCTION cotation_figee();
