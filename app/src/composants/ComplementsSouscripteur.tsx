import { GROUPES_SANGUINS, NOMBRE_MAX_ENFANTS, type SouscripteurComplements } from "@/domaine/cotation/saisie";

import { Champ } from "./FormulaireAction";

/**
 * Compléments du souscripteur (dictionnaire §6.3.2, session 4a) : tous facultatifs à la saisie. Les noms des
 * champs sont `souscripteur_<nom du dictionnaire>`. Un champ laissé vide est enregistré vide (D15) ; seul un
 * champ jamais proposé (données d'avant la 4a) bloque la génération d'un modèle qui l'utilise.
 */
export function ComplementsSouscripteur({ valeurs }: { valeurs?: SouscripteurComplements }) {
  const v = valeurs ?? {};
  return (
    <details open className="mb-4 max-w-4xl">
      <summary className="mb-2 cursor-pointer text-sm font-semibold">Compléments du souscripteur (facultatifs)</summary>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Champ nom="souscripteur_num_identification" libelle="N° de pièce d'identité" requis={false} valeur={v.num_identification} autoComplete="off" />
        <Champ nom="souscripteur_date_naissance" libelle="Date de naissance (AAAA-MM-JJ)" requis={false} valeur={v.date_naissance} autoComplete="off" />
        <Champ nom="souscripteur_lieu_naissance" libelle="Lieu de naissance" requis={false} valeur={v.lieu_naissance} autoComplete="off" />
        <Champ nom="souscripteur_profession" libelle="Profession" requis={false} valeur={v.profession} autoComplete="off" />
        <Champ nom="souscripteur_activite" libelle="Activité" requis={false} valeur={v.activite} autoComplete="off" />
        <Champ nom="souscripteur_employeur" libelle="Employeur" requis={false} valeur={v.employeur} autoComplete="off" />
        <Champ nom="souscripteur_bp" libelle="Boîte postale" requis={false} valeur={v.bp} autoComplete="off" />
        <Champ nom="souscripteur_localite" libelle="Localité" requis={false} valeur={v.localite} autoComplete="off" />
        <Champ nom="souscripteur_sous_prefecture" libelle="Sous-préfecture" requis={false} valeur={v.sous_prefecture} autoComplete="off" />
        <Champ nom="souscripteur_whatsapp" libelle="WhatsApp" requis={false} valeur={v.whatsapp} autoComplete="off" />
        <Champ nom="souscripteur_mobile_money" libelle="Mobile money" requis={false} valeur={v.mobile_money} autoComplete="off" />
        <Champ nom="souscripteur_situation_matrimoniale" libelle="Situation matrimoniale" requis={false} valeur={v.situation_matrimoniale} autoComplete="off" />
        <Champ nom="souscripteur_nb_enfants" libelle={`Nombre d'enfants (0 à ${NOMBRE_MAX_ENFANTS})`} requis={false} valeur={v.nb_enfants == null ? "" : String(v.nb_enfants)} autoComplete="off" />
        <label className="mb-4 block text-sm font-medium">
          Groupe sanguin
          <select name="souscripteur_groupe_sanguin" defaultValue={v.groupe_sanguin ?? ""} className="mt-1 block w-full rounded border border-bordure bg-white px-3 py-2 text-base">
            <option value="">—</option>
            {GROUPES_SANGUINS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
