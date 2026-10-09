-- Session 4b (CDC §11, §12, D23) : factures, avoirs, paiements, reçus, et documents à produire.
-- Horodatage postérieur à 20261009100000 (dernière migration de la 4a) : l'ordre d'application sur une base neuve est
-- celui des noms (test src/serveur/migrations.test.ts).

-- CreateTable
CREATE TABLE "factures" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "numero" TEXT,
    "police_id" INTEGER NOT NULL,
    "produit_id" INTEGER NOT NULL,
    "version_date_effet" DATE NOT NULL,
    "facture_origine_id" INTEGER,
    "remplace_id" INTEGER,
    "adherents_version" INTEGER,
    "date_effet" DATE NOT NULL,
    "date_echeance" DATE NOT NULL,
    "contenu" JSONB NOT NULL,
    "ttc" DECIMAL(18,2) NOT NULL,
    "motif" TEXT,
    "cree_par_id" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demande_par_id" INTEGER,
    "demande_par" TEXT,
    "demande_le" TIMESTAMP(3),
    "emise_par_id" INTEGER,
    "emise_par" TEXT,
    "emise_le" TIMESTAMP(3),
    "date_emission" DATE,
    "annulee_par_id" INTEGER,
    "annulee_le" TIMESTAMP(3),

    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paiements" (
    "id" SERIAL NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "numero_recu" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "montant" DECIMAL(18,2) NOT NULL,
    "canal" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "payeur" TEXT NOT NULL,
    "cree_par_id" INTEGER NOT NULL,
    "cree_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paiements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents_a_produire" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "jeton" TEXT NOT NULL,
    "facture_id" INTEGER,
    "paiement_id" INTEGER,
    "produit_code" TEXT NOT NULL,
    "police_numero" TEXT,
    "police_id" INTEGER,
    "cotation_id" INTEGER,
    "souscripteur_nom" TEXT NOT NULL,
    "souscripteur_masque" TEXT NOT NULL,
    "date_emission" DATE NOT NULL,
    "parametres_date" DATE NOT NULL,
    "modele_version_id" INTEGER NOT NULL,
    "versions_associees" JSONB NOT NULL,
    "donnees" JSONB NOT NULL,
    "emis_par" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "derniere_erreur" TEXT,
    "document_id" INTEGER,
    "produit_le" TIMESTAMP(3),

    CONSTRAINT "documents_a_produire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factures_numero_key" ON "factures"("numero");

-- CreateIndex
CREATE INDEX "factures_police_id_idx" ON "factures"("police_id");

-- CreateIndex
CREATE INDEX "factures_statut_idx" ON "factures"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "paiements_numero_recu_key" ON "paiements"("numero_recu");

-- CreateIndex
CREATE INDEX "paiements_facture_id_idx" ON "paiements"("facture_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_a_produire_jeton_key" ON "documents_a_produire"("jeton");

-- CreateIndex
CREATE UNIQUE INDEX "documents_a_produire_document_id_key" ON "documents_a_produire"("document_id");

-- CreateIndex
CREATE INDEX "documents_a_produire_statut_idx" ON "documents_a_produire"("statut");

-- CreateIndex
CREATE INDEX "documents_a_produire_facture_id_idx" ON "documents_a_produire"("facture_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_a_produire_numero_version_key" ON "documents_a_produire"("numero", "version");

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_facture_origine_id_fkey" FOREIGN KEY ("facture_origine_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_remplace_id_fkey" FOREIGN KEY ("remplace_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_paiement_id_fkey" FOREIGN KEY ("paiement_id") REFERENCES "paiements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_modele_version_id_fkey" FOREIGN KEY ("modele_version_id") REFERENCES "modele_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents_emis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- Factures et avoirs : contrôles

ALTER TABLE "factures" ADD CONSTRAINT "factures_type_valide" CHECK ("type" IN ('AFFAIRE_NOUVELLE', 'RENOUVELLEMENT', 'AVENANT', 'AVOIR'));
ALTER TABLE "factures" ADD CONSTRAINT "factures_statut_valide" CHECK ("statut" IN ('BROUILLON', 'A_VALIDER', 'EMISE', 'ANNULEE'));
-- Un brouillon (ou une demande « À valider ») n'a pas de numéro ; une facture émise en a un, et sa date d'émission (CDC §11.4).
ALTER TABLE "factures" ADD CONSTRAINT "factures_numero_a_l_emission" CHECK (
    ("statut" IN ('BROUILLON', 'A_VALIDER') AND "numero" IS NULL AND "emise_le" IS NULL)
    OR ("statut" IN ('EMISE', 'ANNULEE') AND "numero" IS NOT NULL AND "emise_le" IS NOT NULL AND "date_emission" IS NOT NULL)
);
-- Un avoir annule une facture et porte des montants négatifs ; une facture, des montants positifs (CDC §11.3).
ALTER TABLE "factures" ADD CONSTRAINT "factures_avoir_coherent" CHECK (
    ("type" = 'AVOIR' AND "facture_origine_id" IS NOT NULL AND "ttc" < 0 AND "motif" IS NOT NULL)
    OR ("type" <> 'AVOIR' AND "facture_origine_id" IS NULL AND "ttc" > 0)
);
ALTER TABLE "factures" ADD CONSTRAINT "factures_annulation_coherente" CHECK (
    ("statut" = 'ANNULEE') = ("annulee_par_id" IS NOT NULL AND "annulee_le" IS NOT NULL)
);
ALTER TABLE "factures" ADD CONSTRAINT "factures_avenant_coherent" CHECK (("type" = 'AVENANT') = ("adherents_version" IS NOT NULL));
ALTER TABLE "factures" ADD CONSTRAINT "factures_annulee_par_id_fkey" FOREIGN KEY ("annulee_par_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une seule facture d'affaire nouvelle en cours par police (une facture annulée par un avoir laisse la place à sa remplaçante),
-- un seul avenant par version de la liste des adhérents, un seul renouvellement par date d'effet, un seul avoir par facture.
CREATE UNIQUE INDEX "factures_une_affaire_nouvelle" ON "factures"("police_id") WHERE "type" = 'AFFAIRE_NOUVELLE' AND "statut" <> 'ANNULEE';
CREATE UNIQUE INDEX "factures_un_avenant_par_version" ON "factures"("police_id", "adherents_version") WHERE "type" = 'AVENANT' AND "statut" <> 'ANNULEE';
CREATE UNIQUE INDEX "factures_un_renouvellement_par_periode" ON "factures"("police_id", "date_effet") WHERE "type" = 'RENOUVELLEMENT' AND "statut" <> 'ANNULEE';
CREATE UNIQUE INDEX "factures_un_avoir_par_facture" ON "factures"("facture_origine_id") WHERE "type" = 'AVOIR';

-- Intangibilité (CDC §11.5) : une facture ne se supprime jamais ; émise, elle ne se modifie plus, sauf son annulation
-- par un avoir (statut ANNULEE, avoir et date), une seule fois. Un brouillon se modifie, et ne reçoit un numéro qu'en
-- passant à l'état émis.
CREATE FUNCTION facture_intangible() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'facture : suppression interdite (une correction passe par un avoir)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."statut" IN ('EMISE', 'ANNULEE') THEN
    IF OLD."statut" = 'ANNULEE' THEN
      RAISE EXCEPTION 'facture % : annulée, aucune modification possible', OLD."numero" USING ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - 'statut' - 'annulee_par_id' - 'annulee_le') IS DISTINCT FROM (to_jsonb(OLD) - 'statut' - 'annulee_par_id' - 'annulee_le')
       OR NEW."statut" <> 'ANNULEE' THEN
      RAISE EXCEPTION 'facture % : émise, elle ne se modifie plus (correction : avoir puis nouvelle facture)', OLD."numero" USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER factures_intangibles BEFORE UPDATE OR DELETE ON "factures"
  FOR EACH ROW EXECUTE FUNCTION facture_intangible();

-- ---------------------------------------------------------------- Paiements : ajout seul, jamais de trop-perçu (H33)

ALTER TABLE "paiements" ADD CONSTRAINT "paiements_montant_positif" CHECK ("montant" > 0);
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_canal_valide" CHECK ("canal" IN ('ESPECES', 'CHEQUE', 'VIREMENT', 'MOBILE_MONEY'));

CREATE FUNCTION paiement_ajout_seul() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'paiement : ni modification ni suppression (ajout seul)' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER paiements_ajout_seul BEFORE UPDATE OR DELETE ON "paiements"
  FOR EACH ROW EXECUTE FUNCTION paiement_ajout_seul();

-- Filet de sécurité de la base (l'application contrôle avant, avec un message clair) : un paiement ne vise qu'une
-- facture émise et non annulée (pas un avoir), et le total payé ne dépasse jamais le TTC (trop-perçu refusé, H33).
CREATE FUNCTION paiement_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f RECORD;
  deja NUMERIC;
BEGIN
  SELECT "statut", "type", "ttc", "numero" INTO f FROM "factures" WHERE "id" = NEW."facture_id" FOR UPDATE;
  IF f."statut" <> 'EMISE' OR f."type" = 'AVOIR' THEN
    RAISE EXCEPTION 'paiement refusé : la facture % n''est pas une facture émise et en cours', f."numero" USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("montant"), 0) INTO deja FROM "paiements" WHERE "facture_id" = NEW."facture_id";
  IF deja + NEW."montant" > f."ttc" THEN
    RAISE EXCEPTION 'paiement refusé : trop-perçu sur la facture %', f."numero" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paiements_controles BEFORE INSERT ON "paiements"
  FOR EACH ROW EXECUTE FUNCTION paiement_controle();

-- ---------------------------------------------------------------- Documents à produire : figés, sauf leur production

ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_statut_valide" CHECK ("statut" IN ('EN_ATTENTE', 'PRODUIT'));
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_version_check" CHECK ("version" >= 1);
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_jeton_check" CHECK (length("jeton") >= 32);
ALTER TABLE "documents_a_produire" ADD CONSTRAINT "documents_a_produire_production_coherente" CHECK (
    ("statut" = 'EN_ATTENTE' AND "document_id" IS NULL AND "produit_le" IS NULL)
    OR ("statut" = 'PRODUIT' AND "document_id" IS NOT NULL AND "produit_le" IS NOT NULL)
);

-- Les données figées (numéro, version, jeton, données, modèles) ne changent jamais : une relance produit le MÊME
-- document. Seuls le suivi des tentatives et, une fois, le passage à PRODUIT sont permis.
CREATE FUNCTION document_a_produire_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document à produire : suppression interdite' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."statut" = 'PRODUIT' THEN
    RAISE EXCEPTION 'document % v% : déjà produit, aucune modification possible', OLD."numero", OLD."version" USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'statut' - 'tentatives' - 'derniere_erreur' - 'document_id' - 'produit_le')
     IS DISTINCT FROM (to_jsonb(OLD) - 'statut' - 'tentatives' - 'derniere_erreur' - 'document_id' - 'produit_le') THEN
    RAISE EXCEPTION 'document % v% : données figées à l''émission, aucune modification possible', OLD."numero", OLD."version" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_a_produire_figes BEFORE UPDATE OR DELETE ON "documents_a_produire"
  FOR EACH ROW EXECUTE FUNCTION document_a_produire_fige();
