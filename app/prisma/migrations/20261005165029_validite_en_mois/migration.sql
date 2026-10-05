/*
  Warnings:

  - You are about to drop the column `validite_jours` on the `produit_versions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "produit_versions" DROP COLUMN "validite_jours",
ADD COLUMN     "validite_mois" INTEGER NOT NULL DEFAULT 3;

-- Les versions existantes prennent la valeur par défaut de 3 mois (90 jours environ) : décision du 05/10/2026,
-- « date + 3 mois » comme dans le cas T1. Aucune ligne n est modifiée (déclencheur de l historique).
