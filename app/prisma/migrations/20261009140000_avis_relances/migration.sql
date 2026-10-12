-- Session 5b (CDC §12, D25) : avis d'échéance et relances, lots de génération. Horodatage postérieur à 20261009130000
-- (corrections de la 5a) : test src/serveur/migrations.test.ts. Paramètres J-x et niveaux de relance : table
-- « parametres » existante (clé relances.<PRODUIT>, historisée), aucune table nouvelle.

-- Échéance appelée et niveau de relance d'un avis ou d'une relance figés.
ALTER TABLE "documents_a_produire" ADD COLUMN "echeance_numero" INTEGER;
ALTER TABLE "documents_a_produire" ADD COLUMN "niveau_relance" INTEGER;
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_appel" CHECK (
  ("type" = 'AVIS_ECHEANCE' AND "facture_id" IS NOT NULL AND "echeance_numero" IS NOT NULL AND "niveau_relance" IS NULL)
  OR ("type" = 'RELANCE' AND "facture_id" IS NOT NULL AND "echeance_numero" IS NOT NULL AND "niveau_relance" BETWEEN 1 AND 9)
  OR ("type" NOT IN ('AVIS_ECHEANCE', 'RELANCE') AND "echeance_numero" IS NULL AND "niveau_relance" IS NULL)
);

-- Un seul avis par échéance ; un seul document par (échéance, niveau) : relancer une tâche ou un lot ne crée jamais de doublon.
CREATE UNIQUE INDEX "documents_a_produire_un_avis" ON "documents_a_produire"("facture_id", "echeance_numero") WHERE "type" = 'AVIS_ECHEANCE' AND "version" = 1;
CREATE UNIQUE INDEX "documents_a_produire_une_relance" ON "documents_a_produire"("facture_id", "echeance_numero", "niveau_relance") WHERE "type" = 'RELANCE' AND "version" = 1;

-- Lot de génération d'avis et de relances (sélection dans la liste du jour), traité par la file de tâches.
CREATE TABLE "lots_echeances" (
    "id" SERIAL NOT NULL,
    "statut" TEXT NOT NULL,
    "date_liste" DATE NOT NULL,
    "cree_par_id" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "debut" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    CONSTRAINT "lots_echeances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lots_echeances_statut" CHECK ("statut" IN ('EN_COURS', 'TERMINE'))
);

-- Éléments d'un lot : avancement lu ici (jamais un compteur à part).
CREATE TABLE "lots_echeances_elements" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "echeance_numero" INTEGER NOT NULL,
    "niveau_relance" INTEGER,
    "statut" TEXT NOT NULL DEFAULT 'A_FAIRE',
    "numero" TEXT,
    "message" TEXT,
    CONSTRAINT "lots_echeances_elements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lots_echeances_elements_type" CHECK ("type" IN ('AVIS_ECHEANCE', 'RELANCE')),
    CONSTRAINT "lots_echeances_elements_statut" CHECK ("statut" IN ('A_FAIRE', 'PRODUIT', 'DEJA_PRODUIT', 'SANS_OBJET', 'ECHEC'))
);
CREATE INDEX "lots_echeances_elements_lot_id_idx" ON "lots_echeances_elements"("lot_id");

ALTER TABLE "lots_echeances_elements" ADD CONSTRAINT "lots_echeances_elements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots_echeances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots_echeances_elements" ADD CONSTRAINT "lots_echeances_elements_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
