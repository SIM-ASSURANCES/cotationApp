-- Session 6.2c-1 (H90) : renouvellement et avenant d'une police par garanties.
-- Horodatage postérieur à 20261020090000 (dernière migration, session SECURPRO).

ALTER TABLE "factures" ADD COLUMN "composition_par_id" INTEGER;
ALTER TABLE "factures" ADD COLUMN "composition_par" TEXT;
ALTER TABLE "factures" ADD COLUMN "composition_le" TIMESTAMP(3);
ALTER TABLE "factures" ADD COLUMN "composition_motif" TEXT;
ALTER TABLE "factures" ADD COLUMN "contributeurs" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "factures" ADD CONSTRAINT "factures_composition_coherente" CHECK (
    ("composition_par_id" IS NULL AND "composition_par" IS NULL AND "composition_le" IS NULL AND "composition_motif" IS NULL)
    OR ("composition_par_id" IS NOT NULL AND "composition_par" IS NOT NULL AND "composition_le" IS NOT NULL AND "composition_motif" IS NOT NULL AND length(trim("composition_motif")) >= 3)
);

ALTER TABLE "factures" DROP CONSTRAINT "factures_avoir_coherent";
ALTER TABLE "factures" ADD CONSTRAINT "factures_avoir_coherent" CHECK (
    ("type" = 'AVOIR' AND "facture_origine_id" IS NOT NULL AND "ttc" < 0 AND "motif" IS NOT NULL)
    OR ("type" <> 'AVOIR' AND "facture_origine_id" IS NULL AND ("ttc" > 0 OR ("statut" = 'BROUILLON' AND "ttc" = 0)))
);

