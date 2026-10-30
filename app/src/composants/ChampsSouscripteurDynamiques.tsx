"use client";

import { useId, useState } from "react";

import { Champ, ChampDate } from "@/composants/FormulaireAction";
import { ChampFormulaire, classesControle, ListeDeroulante, Pastille } from "@/composants/ui";
import { aujourdhui, formaterDate } from "@/domaine/calcul/dates";
import { GROUPES_SANGUINS, NOMBRE_MAX_ENFANTS, type Souscripteur } from "@/domaine/cotation/saisie";

export type ClientOption = {
  id: number;
  souscripteur: Souscripteur;
};

export type ChampsSouscripteurDynamiquesProps = {
  /** Liste des clients enregistrés (pour l'écran cotation). Absent sur l'écran d'ajout de client. */
  clients?: ClientOption[];
  /** Client pré-sélectionné (modification de brouillon). */
  initialClientId?: string;
  /** Valeurs initiales du souscripteur. */
  valeurs?: Partial<Souscripteur>;
};

export function ChampsSouscripteurDynamiques({
  clients,
  initialClientId = "",
  valeurs,
}: ChampsSouscripteurDynamiquesProps) {
  const [clientId, setClientId] = useState(initialClientId);
  const clientSelectionne = clients?.find((c) => String(c.id) === clientId);

  // Type actif : si un client est sélectionné, on prend son type, sinon celui saisi/initial
  const [typeSaisi, setTypeSaisi] = useState<"PHYSIQUE" | "MORALE">(valeurs?.type ?? "PHYSIQUE");
  const type = clientSelectionne ? clientSelectionne.souscripteur.type : typeSaisi;

  const [detailsOuverts, setDetailsOuverts] = useState(false);
  const idType = useId();

  // Valeurs effectives (client enregistré ou saisie)
  const source = clientSelectionne ? clientSelectionne.souscripteur : valeurs ?? {};

  const handleChangementClient = (nouvelId: string) => {
    setClientId(nouvelId);
    if (!nouvelId) {
      setDetailsOuverts(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Sélection d'un client existant (si disponible) */}
      {clients && clients.length > 0 ? (
        <div className="max-w-md">
          <ListeDeroulante
            label="Client enregistré"
            name="clientId"
            value={clientId}
            onChange={(e) => handleChangementClient(e.target.value)}
            options={[
              { valeur: "", libelle: "— Nouveau prospect (saisie ci-dessous) —" },
              ...clients.map((c) => ({
                valeur: String(c.id),
                libelle: `${c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`} (${c.souscripteur.telephone || "sans tél."})`,
              })),
            ]}
          />
        </div>
      ) : null}

      {/* Si un client enregistré est sélectionné : carte récapitulative épurée */}
      {clientSelectionne ? (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {clientSelectionne.souscripteur.type === "MORALE"
                    ? clientSelectionne.souscripteur.raison_sociale
                    : `${clientSelectionne.souscripteur.nom} ${clientSelectionne.souscripteur.prenoms}`}
                </span>
                <Pastille ton="principal">Client #{clientSelectionne.id} enregistré</Pastille>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {clientSelectionne.souscripteur.type === "MORALE" ? "Personne morale" : "Personne physique"} • Tél : {clientSelectionne.souscripteur.telephone || "—"} • E-mail : {clientSelectionne.souscripteur.email || "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetailsOuverts((v) => !v)}
              className="text-xs text-primary font-medium hover:underline"
            >
              {detailsOuverts ? "Masquer les détails du client ▲" : "Voir les détails ▼"}
            </button>
          </div>

          {/* Champs masqués nécessaires au formulaire parent */}
          <input type="hidden" name="souscripteur_type" value={clientSelectionne.souscripteur.type} />
          <input type="hidden" name="souscripteur_nom" value={clientSelectionne.souscripteur.nom} />
          <input type="hidden" name="souscripteur_prenoms" value={clientSelectionne.souscripteur.prenoms} />
          <input type="hidden" name="souscripteur_raison_sociale" value={clientSelectionne.souscripteur.raison_sociale} />
          <input type="hidden" name="souscripteur_telephone" value={clientSelectionne.souscripteur.telephone} />
          <input type="hidden" name="souscripteur_email" value={clientSelectionne.souscripteur.email} />
          <input type="hidden" name="souscripteur_adresse" value={clientSelectionne.souscripteur.adresse} />
          <input type="hidden" name="souscripteur_num_identification" value={clientSelectionne.souscripteur.num_identification ?? ""} />
          <input type="hidden" name="souscripteur_date_naissance" value={clientSelectionne.souscripteur.date_naissance ?? ""} />
          <input type="hidden" name="souscripteur_lieu_naissance" value={clientSelectionne.souscripteur.lieu_naissance ?? ""} />
          <input type="hidden" name="souscripteur_profession" value={clientSelectionne.souscripteur.profession ?? ""} />
          <input type="hidden" name="souscripteur_activite" value={clientSelectionne.souscripteur.activite ?? ""} />
          <input type="hidden" name="souscripteur_employeur" value={clientSelectionne.souscripteur.employeur ?? ""} />
          <input type="hidden" name="souscripteur_bp" value={clientSelectionne.souscripteur.bp ?? ""} />
          <input type="hidden" name="souscripteur_localite" value={clientSelectionne.souscripteur.localite ?? ""} />
          <input type="hidden" name="souscripteur_sous_prefecture" value={clientSelectionne.souscripteur.sous_prefecture ?? ""} />
          <input type="hidden" name="souscripteur_whatsapp" value={clientSelectionne.souscripteur.whatsapp ?? ""} />
          <input type="hidden" name="souscripteur_mobile_money" value={clientSelectionne.souscripteur.mobile_money ?? ""} />
          <input type="hidden" name="souscripteur_situation_matrimoniale" value={clientSelectionne.souscripteur.situation_matrimoniale ?? ""} />
          <input type="hidden" name="souscripteur_nb_enfants" value={clientSelectionne.souscripteur.nb_enfants ?? ""} />
          <input type="hidden" name="souscripteur_groupe_sanguin" value={clientSelectionne.souscripteur.groupe_sanguin ?? ""} />

          {detailsOuverts ? (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3 text-xs text-muted-foreground pt-1">
              <div><span className="font-semibold text-foreground">Adresse :</span> {clientSelectionne.souscripteur.adresse || "—"}</div>
              <div><span className="font-semibold text-foreground">Localité / BP :</span> {[clientSelectionne.souscripteur.localite, clientSelectionne.souscripteur.bp].filter(Boolean).join(" - ") || "—"}</div>
              <div><span className="font-semibold text-foreground">Pièce d&apos;identité :</span> {clientSelectionne.souscripteur.num_identification || "—"}</div>
              {clientSelectionne.souscripteur.date_naissance ? (
                <div><span className="font-semibold text-foreground">Date de naissance :</span> {formaterDate(clientSelectionne.souscripteur.date_naissance)}</div>
              ) : null}
              {clientSelectionne.souscripteur.profession ? (
                <div><span className="font-semibold text-foreground">Profession :</span> {clientSelectionne.souscripteur.profession}</div>
              ) : null}
              {clientSelectionne.souscripteur.whatsapp ? (
                <div><span className="font-semibold text-foreground">WhatsApp :</span> {clientSelectionne.souscripteur.whatsapp}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        /* 2. Saisie Prospect (Physique vs Morale) */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <ChampFormulaire label="Nature du souscripteur" requis htmlFor={idType} className="max-w-xs">
              <select
                id={idType}
                name="souscripteur_type"
                value={type}
                onChange={(e) => setTypeSaisi(e.target.value as "PHYSIQUE" | "MORALE")}
                className={classesControle(false)}
              >
                <option value="PHYSIQUE">Personne physique (Particulier)</option>
                <option value="MORALE">Personne morale (Entreprise, Association)</option>
              </select>
            </ChampFormulaire>

            <div className="pt-5">
              <span className="text-xs text-muted-foreground">
                {type === "PHYSIQUE"
                  ? "Saisie des informations de la personne physique."
                  : "Saisie de la raison sociale et des identifiants fiscaux."}
              </span>
            </div>
          </div>

          {/* SECTION A : PERSONNE PHYSIQUE */}
          {type === "PHYSIQUE" ? (
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Identité de la personne physique</p>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Champ nom="souscripteur_nom" libelle="Nom de famille" requis valeur={source.nom} autoComplete="family-name" />
                <Champ nom="souscripteur_prenoms" libelle="Prénoms" requis={false} valeur={source.prenoms} autoComplete="given-name" />
                <Champ nom="souscripteur_num_identification" libelle="N° de pièce d'identité (CNI, Passeport...)" requis={false} valeur={source.num_identification} autoComplete="off" />
                <ChampDate nom="souscripteur_date_naissance" libelle="Date de naissance (JJ/MM/AAAA)" requis={false} valeur={source.date_naissance} max={aujourdhui()} />
                <Champ nom="souscripteur_lieu_naissance" libelle="Lieu de naissance" requis={false} valeur={source.lieu_naissance} autoComplete="off" />
                <Champ nom="souscripteur_profession" libelle="Profession" requis={false} valeur={source.profession} autoComplete="off" />
                <Champ nom="souscripteur_employeur" libelle="Employeur" requis={false} valeur={source.employeur} autoComplete="off" />
                <Champ nom="souscripteur_activite" libelle="Activité" requis={false} valeur={source.activite} autoComplete="off" />
                <Champ nom="souscripteur_situation_matrimoniale" libelle="Situation matrimoniale" requis={false} valeur={source.situation_matrimoniale} autoComplete="off" />
                <Champ nom="souscripteur_nb_enfants" libelle={`Nombre d'enfants (0 à ${NOMBRE_MAX_ENFANTS})`} requis={false} valeur={source.nb_enfants == null ? "" : String(source.nb_enfants)} autoComplete="off" />
                <div className="mb-4">
                  <ListeDeroulante
                    label="Groupe sanguin"
                    name="souscripteur_groupe_sanguin"
                    defaultValue={source.groupe_sanguin ?? ""}
                    options={[{ valeur: "", libelle: "—" }, ...GROUPES_SANGUINS.map((g) => ({ valeur: g, libelle: g }))]}
                  />
                </div>
              </div>
              {/* Champs cachés non concernés pour garantir la conformité */}
              <input type="hidden" name="souscripteur_raison_sociale" value="" />
            </div>
          ) : (
            /* SECTION B : PERSONNE MORALE */
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Identité de l&apos;entreprise / Personne morale</p>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Champ nom="souscripteur_raison_sociale" libelle="Raison sociale de l'entreprise" requis valeur={source.raison_sociale} autoComplete="organization" />
                <Champ nom="souscripteur_activite" libelle="Secteur d'activité" requis={false} valeur={source.activite} autoComplete="off" />
                <Champ nom="souscripteur_num_identification" libelle="N° d'identification fiscale (RCCM / NCC / IFU)" requis={false} valeur={source.num_identification} autoComplete="off" />
              </div>
              {/* Champs cachés non concernés pour personne morale */}
              <input type="hidden" name="souscripteur_nom" value="" />
              <input type="hidden" name="souscripteur_prenoms" value="" />
              <input type="hidden" name="souscripteur_date_naissance" value="" />
              <input type="hidden" name="souscripteur_lieu_naissance" value="" />
              <input type="hidden" name="souscripteur_profession" value="" />
              <input type="hidden" name="souscripteur_employeur" value="" />
              <input type="hidden" name="souscripteur_situation_matrimoniale" value="" />
              <input type="hidden" name="souscripteur_nb_enfants" value="" />
              <input type="hidden" name="souscripteur_groupe_sanguin" value="" />
            </div>
          )}

          {/* SECTION C : COORDONNÉES & ADRESSE (COMMUNES) */}
          <div className="rounded-lg border border-border p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Coordonnées et adresse</p>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Champ nom="souscripteur_telephone" libelle="Téléphone principal" requis={false} valeur={source.telephone} autoComplete="tel" />
              <Champ nom="souscripteur_email" libelle="Adresse e-mail" requis={false} valeur={source.email} autoComplete="email" />
              <Champ nom="souscripteur_adresse" libelle="Adresse géographique" requis={false} valeur={source.adresse} autoComplete="street-address" />
              <Champ nom="souscripteur_bp" libelle="Boîte postale (BP)" requis={false} valeur={source.bp} autoComplete="off" />
              <Champ nom="souscripteur_localite" libelle="Ville / Localité" requis={false} valeur={source.localite} autoComplete="address-level2" />
              <Champ nom="souscripteur_sous_prefecture" libelle="Sous-préfecture" requis={false} valeur={source.sous_prefecture} autoComplete="off" />
              <Champ nom="souscripteur_whatsapp" libelle="Numéro WhatsApp" requis={false} valeur={source.whatsapp} autoComplete="off" />
              <Champ nom="souscripteur_mobile_money" libelle="Compte Mobile Money" requis={false} valeur={source.mobile_money} autoComplete="off" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

