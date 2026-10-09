-- Session 5a (CDC §13, §14.3, §15.1, D11, D24) : âges limites des formules, import en masse des adhérents d'une police
-- mère (lots), écritures différées du stockage (T14). Horodatage postérieur à 20261009110000 (dernière migration de la
-- 4b) : test src/serveur/migrations.test.ts.

-- Âges limites d'une formule (contrôle de l'import, H62) : facultatifs, en années révolues.
ALTER TABLE "formules" ADD COLUMN "age_min" INTEGER;
ALTER TABLE "formules" ADD COLUMN "age_max" INTEGER;
ALTER TABLE "formules" ADD CONSTRAINT "formules_ages_valides" CHECK (
  ("age_min" IS NULL OR "age_min" BETWEEN 0 AND 120)
  AND ("age_max" IS NULL OR "age_max" BETWEEN 0 AND 120)
  AND ("age_min" IS NULL OR "age_max" IS NULL OR "age_min" <= "age_max")
);

-- Un seul certificat d'adhésion (version 1) par adhérent d'une police : relancer un import ne crée jamais de doublon.
CREATE UNIQUE INDEX "documents_emis_certificat_par_adherent" ON "documents_emis"("police_id", "adherent_ordre") WHERE "type" = 'CERTIFICAT' AND "version" = 1;

-- CreateTable
CREATE TABLE "lots_import" (
    "id" SERIAL NOT NULL,
    "police_id" INTEGER NOT NULL,
    "produit_code" TEXT NOT NULL,
    "date_effet" DATE NOT NULL,
    "fichier_nom" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "valides" INTEGER NOT NULL,
    "erreurs" INTEGER NOT NULL,
    "version_adherents" INTEGER,
    "zip_chemin" TEXT,
    "zip_empreinte" TEXT,
    "zip_taille" INTEGER,
    "cree_par_id" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirme_par_id" INTEGER,
    "confirme_par" TEXT,
    "debut" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "derniere_erreur" TEXT,
    CONSTRAINT "lots_import_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lots_import_statut" CHECK ("statut" IN ('CONTROLE', 'EN_COURS', 'TERMINE', 'ABANDONNE')),
    CONSTRAINT "lots_import_compteurs" CHECK ("total" = "valides" + "erreurs")
);

-- Lignes d'un lot : données lues, erreurs de contrôle ; avancement lu ici (jamais un compteur à part).
CREATE TABLE "lots_import_lignes" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "numero_ligne" INTEGER NOT NULL,
    "donnees" JSONB NOT NULL,
    "erreurs" JSONB NOT NULL,
    "statut" TEXT NOT NULL,
    "adherent_ordre" INTEGER,
    "document_id" INTEGER,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "derniere_erreur" TEXT,
    CONSTRAINT "lots_import_lignes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lots_import_lignes_statut" CHECK ("statut" IN ('VALIDE', 'ERREUR', 'PRODUIT', 'ECHEC'))
);

-- T14 (D11) : PDF d'un document ÉMIS dont l'écriture dans le stockage a échoué. Le contenu est gardé ici (le
-- document reste téléchargeable) jusqu'à la reprise réussie, qui supprime la ligne.
CREATE TABLE "ecritures_differees" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "chemin" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "contenu" BYTEA NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 1,
    "derniere_erreur" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dernier_essai" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ecritures_differees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lots_import_police_id_idx" ON "lots_import"("police_id");
CREATE UNIQUE INDEX "lots_import_lignes_lot_id_numero_ligne_key" ON "lots_import_lignes"("lot_id", "numero_ligne");
CREATE UNIQUE INDEX "lots_import_lignes_document_id_key" ON "lots_import_lignes"("document_id");
CREATE INDEX "lots_import_lignes_lot_id_statut_idx" ON "lots_import_lignes"("lot_id", "statut");
CREATE UNIQUE INDEX "ecritures_differees_document_id_key" ON "ecritures_differees"("document_id");

-- AddForeignKey
ALTER TABLE "lots_import" ADD CONSTRAINT "lots_import_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots_import_lignes" ADD CONSTRAINT "lots_import_lignes_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots_import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots_import_lignes" ADD CONSTRAINT "lots_import_lignes_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents_emis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecritures_differees" ADD CONSTRAINT "ecritures_differees_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents_emis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
