-- Session 4.0 : réponses de la Technique du 08/10/2026 (docs/decisions.md, D18).

-- ---------------------------------------------------------------- Taxes : clé (branche, type de contrat, date d'effet)
ALTER TABLE "taxes" ADD COLUMN "type_contrat" TEXT,
  ADD COLUMN "taux_mixte" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "commentaire" TEXT,
  ALTER COLUMN "taux_pourcent" DROP NOT NULL;

ALTER TABLE "taxes" ADD CONSTRAINT "taxes_type_contrat_valide"
  CHECK ("type_contrat" IS NULL OR "type_contrat" IN ('INDIVIDUEL', 'FAMILLE', 'GROUPE', 'GROUPE_OUVERT'));
-- Une ligne a un taux unique, ou bien elle est « à taux mixte » (incendie / dommages aux biens), jamais les deux.
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_taux_ou_mixte" CHECK ("taux_mixte" = ("taux_pourcent" IS NULL));
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_periode_valide" CHECK ("date_fin" IS NULL OR "date_fin" >= "date_effet");

-- Pour une même clé (branche, type de contrat), deux périodes de validité ne se chevauchent jamais
-- (recette 2.2b) : le moteur trouve toujours une seule ligne. Sans date de fin, la période est ouverte.
DROP INDEX "taxes_branche_date_effet_key";
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_sans_chevauchement" EXCLUDE USING gist (
  "branche" WITH =,
  (COALESCE("type_contrat", '')) WITH =,
  daterange("date_effet", "date_fin", '[]') WITH &&
);
CREATE INDEX "taxes_branche_idx" ON "taxes"("branche");

-- Historique : une ligne en vigueur ne se modifie ni ne se supprime. Seule exception : sa CLÔTURE, une
-- fois (date de fin vide -> date de fin), quand un nouveau taux lui succède. Le reste ne bouge pas.
CREATE FUNCTION taxe_historisee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.date_fin IS NULL AND NEW.date_fin IS NOT NULL
     AND (NEW.id, NEW.branche, NEW.type_contrat, NEW.taux_pourcent, NEW.taux_mixte, NEW.commentaire, NEW.assiette,
          NEW.date_effet, NEW.cree_le, NEW.cree_par)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.branche, OLD.type_contrat, OLD.taux_pourcent, OLD.taux_mixte, OLD.commentaire, OLD.assiette,
          OLD.date_effet, OLD.cree_le, OLD.cree_par) THEN
    RETURN NEW;
  END IF;
  IF OLD.date_effet <= CURRENT_DATE THEN
    RAISE EXCEPTION 'paramétrage historisé : % interdit sur taxes (en vigueur depuis le %) ; seule la clôture d''une ligne sans date de fin est permise', TG_OP, OLD.date_effet
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER taxes_historisees ON "taxes";
CREATE TRIGGER taxes_historisees BEFORE UPDATE OR DELETE ON "taxes"
  FOR EACH ROW EXECUTE FUNCTION taxe_historisee();

-- ---------------------------------------------------------------- Cotations et polices
ALTER TABLE "cotations" ADD COLUMN "type_contrat" TEXT,
  ADD COLUMN "contributeurs" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_type_contrat_valide"
  CHECK ("type_contrat" IS NULL OR "type_contrat" IN ('INDIVIDUEL', 'FAMILLE', 'GROUPE', 'GROUPE_OUVERT'));
-- Les cotations existantes : leur auteur est leur seul contributeur connu.
UPDATE "cotations" SET "contributeurs" = ARRAY["auteur_id"] WHERE "statut" IN ('BROUILLON', 'A_VALIDER');

ALTER TABLE "polices" ADD COLUMN "type_contrat" TEXT;
ALTER TABLE "polices" ADD CONSTRAINT "polices_type_contrat_valide"
  CHECK ("type_contrat" IS NULL OR "type_contrat" IN ('INDIVIDUEL', 'FAMILLE', 'GROUPE', 'GROUPE_OUVERT'));

-- Figement d'une cotation émise : on y ajoute le type de contrat et les contributeurs.
CREATE OR REPLACE FUNCTION cotation_figee() RETURNS trigger
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
      NEW.date_validite, NEW.emise_le, NEW.type_contrat, NEW.contributeurs)
     IS DISTINCT FROM
     (OLD.numero, OLD.produit_id, OLD.version_date_effet, OLD.client_id, OLD.souscripteur, OLD.date_effet,
      OLD.date_echeance, OLD.nombre_tranches, OLD.lignes, OLD.motif_forcage, OLD.assures, OLD.risque,
      OLD.donnees_calcul, OLD.resultat, OLD.ttc_total, OLD.echeancier, OLD.raisons_validation,
      OLD.auteur_id, OLD.auteur_identifiant, OLD.valide_par_id, OLD.valide_le, OLD.date_etablissement,
      OLD.date_validite, OLD.emise_le, OLD.type_contrat, OLD.contributeurs) THEN
    RAISE EXCEPTION 'cotation figée : les données d''une cotation émise ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
