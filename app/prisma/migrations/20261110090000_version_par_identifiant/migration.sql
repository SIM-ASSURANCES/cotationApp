-- D67 : une cotation et une facture désignent leur version de produit par son IDENTIFIANT (version_id), plus par sa date d'effet.
-- Préparation des plusieurs versions d'un même produit le même jour : (produit_id, date_effet) cesse d'être la seule façon de retrouver une version.
-- Rien de visible ne change : version_date_effet est CONSERVÉE (affichage, historique, date des paramètres des documents).
--
-- Étapes : colonne facultative, remplissage depuis (produit_id, version_date_effet), contrôle (la migration ÉCHOUE si une ligne ne trouve pas sa
-- version : jamais de NULL silencieux), NOT NULL, clé étrangère RESTRICT, déclencheur de gel.
-- Le remplissage touche des lignes figées (cotation émise, acceptée, refusée ou expirée, facture émise ou annulée) : leurs déclencheurs de gel
-- sont suspendus pour ce seul remplissage, puis rétablis dans la même transaction. Si la migration échoue, tout est annulé, déclencheurs compris.

ALTER TABLE "cotations" ADD COLUMN "version_id" INTEGER;
ALTER TABLE "factures" ADD COLUMN "version_id" INTEGER;

ALTER TABLE "cotations" DISABLE TRIGGER "cotations_figees";
ALTER TABLE "factures" DISABLE TRIGGER "factures_intangibles";

UPDATE "cotations" c
SET "version_id" = v."id"
FROM "produit_versions" v
WHERE v."produit_id" = c."produit_id" AND v."date_effet" = c."version_date_effet";

UPDATE "factures" f
SET "version_id" = v."id"
FROM "produit_versions" v
WHERE v."produit_id" = f."produit_id" AND v."date_effet" = f."version_date_effet";

ALTER TABLE "cotations" ENABLE TRIGGER "cotations_figees";
ALTER TABLE "factures" ENABLE TRIGGER "factures_intangibles";

DO $$
DECLARE
  nombre_cotations integer;
  nombre_factures integer;
  exemples_cotations text;
  exemples_factures text;
BEGIN
  SELECT count(*) INTO nombre_cotations FROM "cotations" WHERE "version_id" IS NULL;
  SELECT count(*) INTO nombre_factures FROM "factures" WHERE "version_id" IS NULL;
  IF nombre_cotations > 0 OR nombre_factures > 0 THEN
    SELECT string_agg("id"::text, ', ' ORDER BY "id") INTO exemples_cotations FROM (SELECT "id" FROM "cotations" WHERE "version_id" IS NULL ORDER BY "id" LIMIT 10) t;
    SELECT string_agg("id"::text, ', ' ORDER BY "id") INTO exemples_factures FROM (SELECT "id" FROM "factures" WHERE "version_id" IS NULL ORDER BY "id" LIMIT 10) t;
    RAISE EXCEPTION 'migration version_par_identifiant : % cotation(s) (identifiants : %) et % facture(s) (identifiants : %) ne trouvent aucune version de produit pour leur (produit_id, version_date_effet) : migration annulée, aucune donnée modifiée. Corrigez ces lignes (version absente ou date erronée) puis relancez la migration.',
      nombre_cotations, COALESCE(exemples_cotations, 'aucun'), nombre_factures, COALESCE(exemples_factures, 'aucun');
  END IF;
END
$$;

ALTER TABLE "cotations" ALTER COLUMN "version_id" SET NOT NULL;
ALTER TABLE "factures" ALTER COLUMN "version_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "cotations_version_id_idx" ON "cotations"("version_id");
CREATE INDEX "factures_version_id_idx" ON "factures"("version_id");

-- AddForeignKey : une version référencée par une cotation ou une facture ne se supprime pas.
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "produit_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factures" ADD CONSTRAINT "factures_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "produit_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Figement d'une cotation émise : version_id est figé avec version_date_effet. Reprise À L'IDENTIQUE de cotation_figee() de
-- 20261030090000_cotation_figee_client_id_retabli, avec NEW/OLD.version_id ajoutés à côté de version_date_effet. Rien d'autre ne change.
-- (facture_intangible() compare toute la ligne : version_id d'une facture émise ou annulée est déjà protégé, sans changer ce déclencheur.)
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
  IF (NEW.numero, NEW.produit_id, NEW.version_date_effet, NEW.version_id, NEW.client_id, NEW.souscripteur, NEW.date_effet,
      NEW.date_echeance, NEW.nombre_tranches, NEW.lignes, NEW.motif_forcage, NEW.assures, NEW.risque,
      NEW.donnees_calcul, NEW.resultat, NEW.ttc_total, NEW.echeancier, NEW.raisons_validation,
      NEW.auteur_id, NEW.auteur_identifiant, NEW.valide_par_id, NEW.valide_le, NEW.date_etablissement,
      NEW.date_validite, NEW.emise_le, NEW.type_contrat, NEW.contributeurs,
      NEW.beneficiaires, NEW.contacts_urgence,
      NEW.composition_par_id, NEW.composition_par, NEW.composition_le, NEW.composition_motif)
     IS DISTINCT FROM
     (OLD.numero, OLD.produit_id, OLD.version_date_effet, OLD.version_id, OLD.client_id, OLD.souscripteur, OLD.date_effet,
      OLD.date_echeance, OLD.nombre_tranches, OLD.lignes, OLD.motif_forcage, OLD.assures, OLD.risque,
      OLD.donnees_calcul, OLD.resultat, OLD.ttc_total, OLD.echeancier, OLD.raisons_validation,
      OLD.auteur_id, OLD.auteur_identifiant, OLD.valide_par_id, OLD.valide_le, OLD.date_etablissement,
      OLD.date_validite, OLD.emise_le, OLD.type_contrat, OLD.contributeurs,
      OLD.beneficiaires, OLD.contacts_urgence,
      OLD.composition_par_id, OLD.composition_par, OLD.composition_le, OLD.composition_motif) THEN
    RAISE EXCEPTION 'cotation figée : les données d''une cotation émise ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
