-- Corrections de la session 5a (H64, décision de Thierry du 09/10/2026) : un import confirmé crée sur la police deux
-- tâches visibles, « Nouvelle version des CP à émettre » et « Facture d'avenant à émettre ». Une tâche reste ouverte
-- tant que la pièce n'est pas émise ; son état est LU dans les documents et les factures, jamais stocké à part.
-- Horodatage postérieur à 20261009120000 (dernière migration de la 5a) : test src/serveur/migrations.test.ts.

CREATE TABLE "taches_police" (
    "id" SERIAL NOT NULL,
    "police_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "lot_id" INTEGER,
    "version_adherents" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "taches_police_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taches_police_type" CHECK ("type" IN ('CP_A_EMETTRE', 'FACTURE_AVENANT_A_EMETTRE'))
);

-- Une tâche de chaque type par version de la liste : rejouer la confirmation ne la crée pas deux fois.
CREATE UNIQUE INDEX "taches_police_unique" ON "taches_police"("police_id", "type", "version_adherents");
CREATE INDEX "taches_police_lot_id_idx" ON "taches_police"("lot_id");

ALTER TABLE "taches_police" ADD CONSTRAINT "taches_police_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "taches_police" ADD CONSTRAINT "taches_police_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots_import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
