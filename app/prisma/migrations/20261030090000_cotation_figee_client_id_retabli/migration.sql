-- Rétablit cotation_figee() à l'identique de 20261012110000_composition_prime : client_id est de nouveau figé avec la cotation émise.
-- Annule l'exception de 20261029170000 (conversion prospect -> client à l'acceptation), retirée du code : CDC §65, H112, les prospects restent en saisie libre.
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
