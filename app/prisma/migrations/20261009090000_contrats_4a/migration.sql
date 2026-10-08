-- Session 4a (D22) : compléments du souscripteur, bénéficiaires, contacts d'urgence, adhérents d'un
-- contrat de groupe, certificat d'adhésion.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "activite" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bp" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "date_naissance" DATE,
ADD COLUMN     "employeur" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "groupe_sanguin" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lieu_naissance" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "localite" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mobile_money" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nb_enfants" INTEGER,
ADD COLUMN     "num_identification" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "profession" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "situation_matrimoniale" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sous_prefecture" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "whatsapp" TEXT NOT NULL DEFAULT '';

-- Null = « jamais fournis » (cotations et polices d'avant la 4a) ; [] = saisis et laissés vides.
ALTER TABLE "cotations" ADD COLUMN     "beneficiaires" JSONB,
ADD COLUMN     "contacts_urgence" JSONB;

ALTER TABLE "polices" ADD COLUMN     "beneficiaires" JSONB,
ADD COLUMN     "contacts_urgence" JSONB;

ALTER TABLE "documents_emis" ADD COLUMN     "adherent_ordre" INTEGER;

-- CreateTable
CREATE TABLE "adherents_versions" (
    "id" SERIAL NOT NULL,
    "police_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "date_effet" DATE NOT NULL,
    "adherents" JSONB NOT NULL,
    "concernes" JSONB NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par" TEXT NOT NULL,

    CONSTRAINT "adherents_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adherents_versions_motif_valide" CHECK ("motif" IN ('INITIALE', 'INCORPORATION', 'RETRAIT')),
    CONSTRAINT "adherents_versions_numero_positif" CHECK ("numero" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "adherents_versions_police_id_numero_key" ON "adherents_versions"("police_id", "numero");

-- AddForeignKey
ALTER TABLE "adherents_versions" ADD CONSTRAINT "adherents_versions_police_id_fkey" FOREIGN KEY ("police_id") REFERENCES "polices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Liste des adhérents en ajout seul : une version n'est jamais modifiée ni supprimée.
CREATE FUNCTION adherents_version_figee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'liste des adhérents : une version est en ajout seul (ni modification ni suppression)' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER adherents_versions_figees BEFORE UPDATE OR DELETE ON "adherents_versions"
  FOR EACH ROW EXECUTE FUNCTION adherents_version_figee();

-- Les polices de groupe existantes reçoivent leur version 1 : la liste des assurés de la police.
INSERT INTO "adherents_versions" ("police_id", "numero", "motif", "date_effet", "adherents", "concernes", "cree_par")
SELECT p."id", 1, 'INITIALE', p."date_effet", p."assures", '[]'::jsonb, 'migration'
FROM "polices" p
WHERE p."type_contrat" IN ('GROUPE', 'GROUPE_OUVERT');

-- Figement d'une cotation émise : on y ajoute les bénéficiaires et les contacts d'urgence.
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
      NEW.date_validite, NEW.emise_le, NEW.type_contrat, NEW.contributeurs,
      NEW.beneficiaires, NEW.contacts_urgence)
     IS DISTINCT FROM
     (OLD.numero, OLD.produit_id, OLD.version_date_effet, OLD.client_id, OLD.souscripteur, OLD.date_effet,
      OLD.date_echeance, OLD.nombre_tranches, OLD.lignes, OLD.motif_forcage, OLD.assures, OLD.risque,
      OLD.donnees_calcul, OLD.resultat, OLD.ttc_total, OLD.echeancier, OLD.raisons_validation,
      OLD.auteur_id, OLD.auteur_identifiant, OLD.valide_par_id, OLD.valide_le, OLD.date_etablissement,
      OLD.date_validite, OLD.emise_le, OLD.type_contrat, OLD.contributeurs,
      OLD.beneficiaires, OLD.contacts_urgence) THEN
    RAISE EXCEPTION 'cotation figée : les données d''une cotation émise ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
