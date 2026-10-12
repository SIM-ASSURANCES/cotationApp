import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { ComplementsSouscripteur } from "@/composants/ComplementsSouscripteur";
import { LignesAssures, LignesBeneficiaires, LignesContactsUrgence, LignesRisque } from "@/composants/LignesDynamiques";
import { montant } from "@/domaine/calcul/montant";
import { ChoixContrat } from "@/composants/ChoixContrat";
import type { LigneClient } from "@/serveur/clients";
import type { IntermediaireDocument } from "@/domaine/intermediaires";
import type { DetailCotation } from "@/serveur/cotations";

import { enregistrerCotation } from "./actions";

const entree = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";
const LIBELLE_MODE_ACCESSOIRE: Record<string, string> = { AUCUN: "aucun", FIXE: "F par contrat", PAR_TETE: "F par tête", PAR_FAMILLE: "F par famille", POURCENT: "% de la nette" };

/** Formulaire de cotation, pour une création ou la modification d'un brouillon (valeurs par défaut dans `base`). */
export function FormulaireCotation({
  produit,
  formules,
  clients,
  tranchesMax,
  formulesMax,
  intermediaires,
  parGaranties = false,
  base,
}: {
  produit: { code: string; libelle: string };
  formules: { code: string; libelle: string; primeUnitaire: string; accessoireMode: string; accessoireValeur: string }[];
  clients: LigneClient[];
  tranchesMax: number;
  formulesMax: number;
  /** Intermédiaires actifs du référentiel (session 6.0). */
  intermediaires: IntermediaireDocument[];
  /** Produit en mode GARANTIES (session 6.2b) : pas de formules, la prime est composée ensuite par la Technique. */
  parGaranties?: boolean;
  base?: DetailCotation;
}) {
  const ligneDe = (code: string) => base?.lignes.find((l) => l.code === code);
  // Un intermédiaire déjà choisi et désactivé depuis reste proposé sur son brouillon.
  const choixPossibles = [...intermediaires, ...(base?.intermediaires ?? []).filter((i) => !intermediaires.some((x) => x.code === i.code))];
  const s = base?.souscripteur;
  return (
    <FormulaireAction action={enregistrerCotation} libelleBouton={base ? "Enregistrer le brouillon" : "Créer le brouillon"}>
      <input type="hidden" name="codeProduit" value={produit.code} />
      {base ? <input type="hidden" name="id" value={base.id} /> : null}

      <h2 className="mb-2 text-lg font-semibold">Souscripteur</h2>
      <label className="mb-4 block max-w-md text-sm font-medium">
        Client enregistré (laisser vide pour un prospect saisi ci-dessous)
        <select name="clientId" defaultValue={base?.clientId ?? ""} className={entree}>
          <option value="">— Prospect (saisie libre) —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`}
            </option>
          ))}
        </select>
      </label>
      <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
        <label className="mb-4 block text-sm font-medium">
          Type
          <select name="souscripteur_type" defaultValue={s?.type ?? "PHYSIQUE"} className={entree}>
            <option value="PHYSIQUE">Personne physique</option>
            <option value="MORALE">Personne morale</option>
          </select>
        </label>
        <Champ nom="souscripteur_nom" libelle="Nom (personne physique)" requis={false} valeur={s?.nom} autoComplete="off" />
        <Champ nom="souscripteur_prenoms" libelle="Prénoms" requis={false} valeur={s?.prenoms} autoComplete="off" />
        <Champ nom="souscripteur_raison_sociale" libelle="Raison sociale (personne morale)" requis={false} valeur={s?.raison_sociale} autoComplete="off" />
        <Champ nom="souscripteur_telephone" libelle="Téléphone" requis={false} valeur={s?.telephone} autoComplete="off" />
        <Champ nom="souscripteur_email" libelle="E-mail" requis={false} valeur={s?.email} autoComplete="off" />
        <Champ nom="souscripteur_adresse" libelle="Adresse" requis={false} valeur={s?.adresse} autoComplete="off" />
      </div>
      <ComplementsSouscripteur valeurs={s} />

      <h2 className="mb-2 text-lg font-semibold">Contrat</h2>
      <ChoixContrat typeContrat={base?.typeContrat ?? ""} regimeTaxe={base?.regimeTaxe ?? ""} />

      <h2 className="mb-2 text-lg font-semibold">Intermédiaires (0 à 2)</h2>
      <div className="mb-4 grid max-w-3xl gap-x-6 sm:grid-cols-2">
        {[0, 1].map((n) => (
          <label key={n} className="mb-2 block text-sm font-medium">
            Intermédiaire {n + 1} (facultatif)
            <select name="intermediaire" defaultValue={base?.intermediaires[n]?.code ?? ""} className={entree}>
              <option value="">— Aucun —</option>
              {choixPossibles.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.nom} ({i.code}, {i.role})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-semibold">Période et fractionnement</h2>
      <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-3">
        <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" valeur={base?.dateEffet} autoComplete="off" />
        <Champ nom="dateEcheance" libelle="Date d'échéance (AAAA-MM-JJ)" valeur={base?.dateEcheance} autoComplete="off" />
        <Champ nom="nombreTranches" libelle={`Nombre de tranches (1 à ${tranchesMax})`} valeur={String(base?.nombreTranches ?? 1)} autoComplete="off" />
      </div>

      {parGaranties ? (
        <section className="mb-4 max-w-3xl rounded border border-border bg-muted p-4 text-sm">
          <h2 className="mb-1 text-lg font-semibold">Prime</h2>
          <p>
            Ce produit se tarife par garanties : la prime n&apos;est pas calculée automatiquement. Créez le brouillon (souscripteur, assurés, dates) ; la
            Technique <strong>composera</strong> ensuite la prime, garantie par garantie, depuis la fiche de la cotation. Tant que la prime n&apos;est pas
            composée, la cotation ne peut pas être soumise.
          </p>
        </section>
      ) : null}
      {parGaranties ? null : <><h2 className="mb-1 text-lg font-semibold">Formules</h2>
      <p className="mb-2 text-sm text-neutral">
        Saisissez l'effectif des formules à chiffrer (de 1 à {formulesMax}) ; laissez vide pour exclure une formule. La prime forcée est
        facultative : elle remplace le tarif, exige un motif et passe la cotation « À valider ». Les accessoires reprennent la valeur du
        paramétrage ; vous pouvez la modifier (la modification est journalisée, les seuils de validation s'appliquent au TTC obtenu).
      </p>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground">
              <th className="p-2">Formule</th>
              <th className="p-2">Prime unitaire (tarif)</th>
              <th className="p-2">Effectif</th>
              <th className="p-2">Prime unitaire forcée</th>
              <th className="p-2">Accessoires (valeur)</th>
            </tr>
          </thead>
          <tbody>
            {formules.map((f) => {
              const forcee = ligneDe(f.code)?.primeForcee;
              return (
                <tr key={f.code} className="border-b border-border">
                  <td className="p-2 font-medium">
                    {f.code} — {f.libelle}
                  </td>
                  <td className="p-2">{montant(f.primeUnitaire).toString().replace(".", ",")}</td>
                  <td className="p-1">
                    <input name={`eff_${f.code}`} defaultValue={ligneDe(f.code)?.effectif} inputMode="numeric" aria-label={`Effectif ${f.code}`} className="w-28 rounded border border-border px-2 py-1" />
                  </td>
                  <td className="p-1">
                    <input name={`forcee_${f.code}`} defaultValue={forcee ? montant(forcee).toString() : ""} inputMode="decimal" aria-label={`Prime forcée ${f.code}`} className="w-40 rounded border border-border px-2 py-1" />
                  </td>
                  <td className="p-1">
                    <input
                      name={`acc_${f.code}`}
                      defaultValue={montant(ligneDe(f.code)?.accessoireSaisi ?? f.accessoireValeur).toString().replace(".", ",")}
                      inputMode="decimal"
                      aria-label={`Accessoires ${f.code}`}
                      className="w-32 rounded border border-border px-2 py-1"
                    />
                    <span className="ml-1 text-xs text-neutral">{LIBELLE_MODE_ACCESSOIRE[f.accessoireMode] ?? f.accessoireMode}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Champ nom="motifForcage" libelle="Motif du forçage (obligatoire si une prime est forcée)" requis={false} valeur={base?.motifForcage ?? ""} autoComplete="off" /></>}

      <h2 className="mb-2 mt-2 text-lg font-semibold">Assurés (facultatif)</h2>
      <LignesAssures
        formules={formules}
        initiales={(base?.assures ?? []).map((a) => ({ nom: a.nom_prenoms, naissance: a.date_naissance, sexe: a.sexe, lien: a.lien, identification: a.num_identification ?? "", formule: a.formule }))}
      />

      <h2 className="mb-2 text-lg font-semibold">Bénéficiaires (SECURVIE, RELAXACCIDENT)</h2>
      <p className="mb-2 text-sm text-neutral">Facultatif à ce stade : ils peuvent aussi être saisis à l'acceptation. Dès qu'il y en a, la somme des quotes-parts doit faire 100 %.</p>
      <LignesBeneficiaires initiales={(base?.beneficiaires ?? []).map((b) => ({ nom: b.nom_prenoms, lien: b.lien, contact: b.contact, quote: b.quote_part }))} />

      <h2 className="mb-2 text-lg font-semibold">Contacts d'urgence (RELAXVOYAGE)</h2>
      <LignesContactsUrgence initiales={(base?.contactsUrgence ?? []).map((c) => ({ nom: c.nom_prenoms, contact: c.contact }))} />

      <h2 className="mb-2 text-lg font-semibold">Risque (champs propres au produit)</h2>
      <LignesRisque initiales={Object.entries(base?.risque ?? {}).map(([cle, valeur]) => ({ cle, valeur }))} />
    </FormulaireAction>
  );
}
