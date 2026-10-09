-- Session 6.0 (D28) : réponses de la Technique du 09/10/2026 et décisions de Thierry.
-- Horodatage postérieur à 20261009140000 (dernière migration de la 5b) : test src/serveur/migrations.test.ts.

-- ================================================================ §2.1 et §2.4 : avance sur police, report des paiements

-- Trop-perçu accepté (H33) : la part d'un paiement qui dépasse le restant dû de la facture va en avance sur la police.
-- Le paiement garde son montant entier (le reçu l'affiche) ; seule la part « montant - excedent » règle la facture.
ALTER TABLE "paiements" ADD COLUMN "excedent" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_excedent_borne" CHECK ("excedent" >= 0 AND "excedent" < "montant");

-- Mouvements de l'avance d'une police, en ajout seul. Crédits : EXCEDENT (trop-perçu d'un paiement), REPORT (somme encaissée
-- sur une facture annulée par un avoir, H47). Débits : IMPUTATION (sur une facture émise de la même police), RESTITUTION
-- (remboursement au client). Le solde (crédits - débits) n'est jamais négatif : contrôlé par la base à chaque débit.
CREATE TABLE "mouvements_avance" (
    "id" SERIAL NOT NULL,
    "police_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "montant" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "paiement_id" INTEGER,
    "facture_annulee_id" INTEGER,
    "facture_id" INTEGER,
    "report_id" INTEGER,
    "canal" TEXT,
    "reference" TEXT,
    "cree_par_id" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mouvements_avance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mouvements_avance_police_id_idx" ON "mouvements_avance"("police_id");
CREATE INDEX "mouvements_avance_facture_id_idx" ON "mouvements_avance"("facture_id");
CREATE INDEX "mouvements_avance_facture_annulee_id_idx" ON "mouvements_avance"("facture_annulee_id");

ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_paiement_id_fkey" FOREIGN KEY ("paiement_id") REFERENCES "paiements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_facture_annulee_id_fkey" FOREIGN KEY ("facture_annulee_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "mouvements_avance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_montant_positif" CHECK ("montant" > 0);
ALTER TABLE "mouvements_avance" ADD CONSTRAINT "mouvements_avance_type_coherent" CHECK (
    ("type" = 'EXCEDENT' AND "paiement_id" IS NOT NULL AND "facture_annulee_id" IS NULL AND "facture_id" IS NULL AND "report_id" IS NULL AND "canal" IS NULL)
    OR ("type" = 'REPORT' AND "facture_annulee_id" IS NOT NULL AND "facture_id" IS NULL AND "report_id" IS NULL AND "canal" IS NULL)
    OR ("type" = 'IMPUTATION' AND "facture_id" IS NOT NULL AND "facture_annulee_id" IS NULL AND "canal" IS NULL)
    OR ("type" = 'RESTITUTION' AND "paiement_id" IS NULL AND "facture_annulee_id" IS NULL AND "facture_id" IS NULL AND "report_id" IS NULL
        AND "canal" IN ('ESPECES', 'CHEQUE', 'VIREMENT', 'MOBILE_MONEY') AND "reference" IS NOT NULL)
);
-- Un excédent par paiement ; un report d'un même paiement par facture annulée ; un report imputé une fois par facture.
CREATE UNIQUE INDEX "mouvements_avance_un_excedent" ON "mouvements_avance"("paiement_id") WHERE "type" = 'EXCEDENT';
CREATE UNIQUE INDEX "mouvements_avance_un_report_imput" ON "mouvements_avance"("facture_id", "report_id") WHERE "type" = 'IMPUTATION' AND "report_id" IS NOT NULL;

CREATE FUNCTION mouvement_avance_ajout_seul() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mouvement d''avance : ni modification ni suppression (ajout seul)' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER mouvements_avance_ajout_seul BEFORE UPDATE OR DELETE ON "mouvements_avance"
  FOR EACH ROW EXECUTE FUNCTION mouvement_avance_ajout_seul();

-- Sommes qui règlent une facture : la part de ses paiements hors excédent, et les imputations d'avance qu'elle a reçues.
CREATE FUNCTION facture_reglee(id_facture INTEGER) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT SUM("montant" - "excedent") FROM "paiements" WHERE "facture_id" = id_facture), 0)
       + COALESCE((SELECT SUM("montant") FROM "mouvements_avance" WHERE "type" = 'IMPUTATION' AND "facture_id" = id_facture), 0);
$$;

-- Solde de l'avance d'une police : crédits moins débits.
CREATE FUNCTION avance_disponible(id_police INTEGER) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN "type" IN ('EXCEDENT', 'REPORT') THEN "montant" ELSE -"montant" END), 0)
  FROM "mouvements_avance" WHERE "police_id" = id_police;
$$;

-- Filet de sécurité de la base (l'application contrôle avant, avec un message clair). La ligne de la police est verrouillée :
-- deux débits simultanés passent l'un après l'autre. Un débit ne dépasse jamais l'avance disponible ; une imputation vise une
-- facture émise, en cours, de la même police, et ne la règle jamais au-delà de son TTC.
CREATE FUNCTION mouvement_avance_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f RECORD;
BEGIN
  PERFORM 1 FROM "polices" WHERE "id" = NEW."police_id" FOR UPDATE;
  IF NEW."type" IN ('IMPUTATION', 'RESTITUTION') AND avance_disponible(NEW."police_id") < NEW."montant" THEN
    RAISE EXCEPTION 'avance insuffisante sur la police % : % demandés', NEW."police_id", NEW."montant" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."type" = 'IMPUTATION' THEN
    SELECT "statut", "type", "ttc", "numero", "police_id" INTO f FROM "factures" WHERE "id" = NEW."facture_id" FOR UPDATE;
    IF f."statut" <> 'EMISE' OR f."type" = 'AVOIR' OR f."police_id" <> NEW."police_id" THEN
      RAISE EXCEPTION 'imputation refusée : la facture % n''est pas une facture émise et en cours de cette police', f."numero" USING ERRCODE = 'check_violation';
    END IF;
    IF facture_reglee(NEW."facture_id") + NEW."montant" > f."ttc" THEN
      RAISE EXCEPTION 'imputation refusée : elle dépasse le restant dû de la facture %', f."numero" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mouvements_avance_controles BEFORE INSERT ON "mouvements_avance"
  FOR EACH ROW EXECUTE FUNCTION mouvement_avance_controle();

-- Contrôle des paiements, remplacé (H33) : le trop-perçu est accepté, mais seulement en EXCÉDENT déclaré. La part qui règle
-- la facture (montant - excedent) ne dépasse jamais le restant dû ; un excédent n'existe que si le paiement solde la facture.
CREATE OR REPLACE FUNCTION paiement_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f RECORD;
  deja NUMERIC;
BEGIN
  SELECT "statut", "type", "ttc", "numero" INTO f FROM "factures" WHERE "id" = NEW."facture_id" FOR UPDATE;
  IF f."statut" <> 'EMISE' OR f."type" = 'AVOIR' THEN
    RAISE EXCEPTION 'paiement refusé : la facture % n''est pas une facture émise et en cours', f."numero" USING ERRCODE = 'check_violation';
  END IF;
  deja := facture_reglee(NEW."facture_id");
  IF deja + NEW."montant" - NEW."excedent" > f."ttc" THEN
    RAISE EXCEPTION 'paiement refusé : trop-perçu non déclaré en excédent sur la facture %', f."numero" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."excedent" > 0 AND deja + NEW."montant" - NEW."excedent" <> f."ttc" THEN
    RAISE EXCEPTION 'paiement refusé : un excédent n''existe que si le paiement solde la facture %', f."numero" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
