-- CreateTable
CREATE TABLE "parametres" (
    "id" SERIAL NOT NULL,
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "date_effet" DATE NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "parametres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parametres_cle_date_effet_key" ON "parametres"("cle", "date_effet");
