-- Session 6.2b (D32) : composition manuelle de la prime des produits tarifés par garanties, et abandon d'un brouillon de facture (H87).
-- Horodatage postérieur à 20261012100000 (dernière migration, session 6.2a) : test src/serveur/migrations.test.ts.

-- ================================================================ 1. Composition manuelle d'une cotation

-- Qui a composé la prime, quand, pourquoi (motif obligatoire). Les montants composés sont dans `donnees_calcul`
-- (entrée de type COMPOSITION) et `resultat`, figés avec le reste de la cotation (T10 : jamais recalculés).
ALTER TABLE "cotations" ADD COLUMN "composition_par_id" INTEGER;
ALTER TABLE "cotations" ADD COLUMN "composition_par" TEXT;
ALTER TABLE "cotations" ADD COLUMN "composition_le" TIMESTAMP(3);
ALTER TABLE "cotations" ADD COLUMN "composition_motif" TEXT;
ALTER TABLE "cotations" ADD CONSTRAINT "cotations_composition_coherente" CHECK (
    ("composition_par_id" IS NULL AND "composition_par" IS NULL AND "composition_le" IS NULL AND "composition_motif" IS NULL)
    OR ("composition_par_id" IS NOT NULL AND "composition_par" IS NOT NULL AND "composition_le" IS NOT NULL AND "composition_motif" IS NOT NULL AND length(trim("composition_motif")) >= 3)
);

-- Figement d'une cotation émise : la composition y est ajoutée (même fonction que la 4a, plus ces quatre colonnes).
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
      NEW.beneficiaires, NEW.contacts_urgence,
      NEW.composition_par_id, NEW.composition_par, NEW.composition_le, NEW.composition_motif)
     IS DISTINCT FROM
     (OLD.numero, OLD.produit_id, OLD.version_date_effet, OLD.client_id, OLD.souscripteur, OLD.date_effet,
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

-- ================================================================ 2. Garanties paramétrées d'un produit (version historisée)

-- Liste des garanties du produit : [{ "libelle": "Incendie", "branche": "INCENDIE" | null }]. Vide : saisie libre. Une branche par défaut
-- (facultative) est proposée sur la ligne de prime. `garanties_saisie_libre` faux : la composition n'accepte que les libellés de la liste.
-- Ajouter des colonnes avec une valeur par défaut ne déclenche pas le déclencheur d'historisation (UPDATE et DELETE seulement).
ALTER TABLE "produit_versions" ADD COLUMN "garanties" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "produit_versions" ADD COLUMN "garanties_saisie_libre" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "produit_versions" ADD CONSTRAINT "produit_versions_garanties_liste" CHECK (jsonb_typeof("garanties") = 'array');

-- ================================================================ 3. Abandon d'un brouillon de facture (H87)

-- Statut ABANDONNEE : un brouillon (ou une demande « À valider ») que l'on renonce à émettre. Motif obligatoire, journalisé, aucun
-- numéro consommé (la contrainte « numéro à l'émission » l'impose), définitif (déclencheur). Il libère la place de la facture
-- dans les index d'unicité, comme une facture annulée par un avoir.
ALTER TABLE "factures" ADD COLUMN "abandonne_par_id" INTEGER;
ALTER TABLE "factures" ADD COLUMN "abandonne_par" TEXT;
ALTER TABLE "factures" ADD COLUMN "abandonne_le" TIMESTAMP(3);
ALTER TABLE "factures" ADD COLUMN "motif_abandon" TEXT;

ALTER TABLE "factures" DROP CONSTRAINT "factures_statut_valide";
ALTER TABLE "factures" ADD CONSTRAINT "factures_statut_valide" CHECK ("statut" IN ('BROUILLON', 'A_VALIDER', 'EMISE', 'ANNULEE', 'ABANDONNEE'));
ALTER TABLE "factures" DROP CONSTRAINT "factures_numero_a_l_emission";
ALTER TABLE "factures" ADD CONSTRAINT "factures_numero_a_l_emission" CHECK (
    ("statut" IN ('BROUILLON', 'A_VALIDER', 'ABANDONNEE') AND "numero" IS NULL AND "emise_le" IS NULL)
    OR ("statut" IN ('EMISE', 'ANNULEE') AND "numero" IS NOT NULL AND "emise_le" IS NOT NULL AND "date_emission" IS NOT NULL)
);
ALTER TABLE "factures" ADD CONSTRAINT "factures_abandon_coherent" CHECK (
    ("statut" = 'ABANDONNEE') = ("abandonne_par_id" IS NOT NULL AND "abandonne_par" IS NOT NULL AND "abandonne_le" IS NOT NULL AND "motif_abandon" IS NOT NULL AND length(trim("motif_abandon")) >= 3)
    AND ("abandonne_par_id" IS NULL OR "statut" = 'ABANDONNEE')
);
-- Un avoir n'est pas un brouillon : il ne s'abandonne pas.
ALTER TABLE "factures" ADD CONSTRAINT "factures_avoir_non_abandonnable" CHECK ("type" <> 'AVOIR' OR "statut" <> 'ABANDONNEE');

DROP INDEX "factures_une_affaire_nouvelle";
DROP INDEX "factures_un_avenant_par_version";
DROP INDEX "factures_un_renouvellement_par_periode";
CREATE UNIQUE INDEX "factures_une_affaire_nouvelle" ON "factures"("police_id") WHERE "type" = 'AFFAIRE_NOUVELLE' AND "statut" NOT IN ('ANNULEE', 'ABANDONNEE');
CREATE UNIQUE INDEX "factures_un_avenant_par_version" ON "factures"("police_id", "adherents_version") WHERE "type" = 'AVENANT' AND "statut" NOT IN ('ANNULEE', 'ABANDONNEE');
CREATE UNIQUE INDEX "factures_un_renouvellement_par_periode" ON "factures"("police_id", "date_effet") WHERE "type" = 'RENOUVELLEMENT' AND "statut" NOT IN ('ANNULEE', 'ABANDONNEE');

-- Intangibilité (CDC §11.5) : on ajoute l'abandon. Seul un brouillon ou une demande « À valider » peut être abandonné ; une facture
-- abandonnée ne change plus jamais.
CREATE OR REPLACE FUNCTION facture_intangible() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'facture : suppression interdite (une correction passe par un avoir)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."statut" = 'ABANDONNEE' THEN
    RAISE EXCEPTION 'facture abandonnée : aucune modification possible (l''abandon est définitif)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."statut" = 'ABANDONNEE' AND OLD."statut" NOT IN ('BROUILLON', 'A_VALIDER') THEN
    RAISE EXCEPTION 'facture % : seul un brouillon ou une demande à valider peut être abandonné', COALESCE(OLD."numero", '(sans numéro)') USING ERRCODE = 'restrict_violation';
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
