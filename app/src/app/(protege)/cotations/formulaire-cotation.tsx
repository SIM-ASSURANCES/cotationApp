import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, Champ as ChampSaisie, ListeDeroulante } from "@/composants/ui";
import { ComplementsSouscripteur } from "@/composants/ComplementsSouscripteur";
import { LignesAssures, LignesBeneficiaires, LignesContactsUrgence, LignesRisque } from "@/composants/LignesDynamiques";
import { montant } from "@/domaine/calcul/montant";
import { ChoixContrat } from "@/composants/ChoixContrat";
import type { LigneClient } from "@/serveur/clients";
import type { IntermediaireDocument } from "@/domaine/intermediaires";
import type { DetailCotation } from "@/serveur/cotations";

import { enregistrerCotation } from "./actions";

// Tableau manuel (cellules = champs) aux classes du composant Tableau. Pas de zébrure : un champ teinté ne doit pas reposer sur un fond bg-muted.
const ENTETE = "border-b border-border bg-muted px-3 py-2 font-medium text-neutral";
const CELLULE = "border-b border-border px-2 py-1.5 align-middle";
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
    // Chaque rubrique est une carte : les champs (fond teinté) reposent toujours sur le fond blanc de la carte.
    <FormulaireAction action={enregistrerCotation} libelleBouton={base ? "Enregistrer le brouillon" : "Créer le brouillon"} className="space-y-6">
      <input type="hidden" name="codeProduit" value={produit.code} />
      {base ? <input type="hidden" name="id" value={base.id} /> : null}

      <Carte titre="Souscripteur">
        <div className="mb-4 max-w-md">
          <ListeDeroulante
            label="Client enregistré (laisser vide pour un prospect saisi ci-dessous)"
            name="clientId"
            defaultValue={base?.clientId ?? ""}
            options={[
              { valeur: "", libelle: "— Prospect (saisie libre) —" },
              ...clients.map((c) => ({ valeur: String(c.id), libelle: c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}` })),
            ]}
          />
        </div>
        <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
          <div className="mb-4">
            <ListeDeroulante
              label="Type"
              name="souscripteur_type"
              defaultValue={s?.type ?? "PHYSIQUE"}
              options={[
                { valeur: "PHYSIQUE", libelle: "Personne physique" },
                { valeur: "MORALE", libelle: "Personne morale" },
              ]}
            />
          </div>
          <Champ nom="souscripteur_nom" libelle="Nom (personne physique)" requis={false} valeur={s?.nom} autoComplete="off" />
          <Champ nom="souscripteur_prenoms" libelle="Prénoms" requis={false} valeur={s?.prenoms} autoComplete="off" />
          <Champ nom="souscripteur_raison_sociale" libelle="Raison sociale (personne morale)" requis={false} valeur={s?.raison_sociale} autoComplete="off" />
          <Champ nom="souscripteur_telephone" libelle="Téléphone" requis={false} valeur={s?.telephone} autoComplete="off" />
          <Champ nom="souscripteur_email" libelle="E-mail" requis={false} valeur={s?.email} autoComplete="off" />
          <Champ nom="souscripteur_adresse" libelle="Adresse" requis={false} valeur={s?.adresse} autoComplete="off" />
        </div>
        <ComplementsSouscripteur valeurs={s} />
      </Carte>

      <Carte titre="Contrat">
        <ChoixContrat typeContrat={base?.typeContrat ?? ""} regimeTaxe={base?.regimeTaxe ?? ""} />
      </Carte>

      <Carte titre="Intermédiaires (0 à 2)">
        <div className="grid max-w-3xl gap-x-6 gap-y-4 sm:grid-cols-2">
          {[0, 1].map((n) => (
            <ListeDeroulante
              key={n}
              label={`Intermédiaire ${n + 1} (facultatif)`}
              name="intermediaire"
              defaultValue={base?.intermediaires[n]?.code ?? ""}
              options={[{ valeur: "", libelle: "— Aucun —" }, ...choixPossibles.map((i) => ({ valeur: i.code, libelle: `${i.nom} (${i.code}, ${i.role})` }))]}
            />
          ))}
        </div>
      </Carte>

      <Carte titre="Période et fractionnement">
        <div className="grid max-w-4xl gap-x-6 sm:grid-cols-3">
          <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" valeur={base?.dateEffet} autoComplete="off" />
          <Champ nom="dateEcheance" libelle="Date d'échéance (AAAA-MM-JJ)" valeur={base?.dateEcheance} autoComplete="off" />
          <Champ nom="nombreTranches" libelle={`Nombre de tranches (1 à ${tranchesMax})`} valeur={String(base?.nombreTranches ?? 1)} autoComplete="off" />
        </div>
      </Carte>

      {parGaranties ? (
        <Carte titre="Prime" className="max-w-3xl">
          <p className="text-sm">
            Ce produit se tarife par garanties : la prime n&apos;est pas calculée automatiquement. Créez le brouillon (souscripteur, assurés, dates) ; la
            Technique <strong>composera</strong> ensuite la prime, garantie par garantie, depuis la fiche de la cotation. Tant que la prime n&apos;est pas
            composée, la cotation ne peut pas être soumise.
          </p>
          {base?.composition && base.composition.lignes.length > 0 ? (
            <Bandeau ton="avertissement" className="mt-3">
              <p className="font-medium">
                La prime est déjà composée : changer la <strong>période</strong>, le <strong>régime de taxe</strong> ou le <strong>type de contrat</strong> la vide (retour « À composer »,
                l&apos;ancienne composition reste au journal) ; changer le nombre de tranches la garde.
              </p>
            </Bandeau>
          ) : null}
        </Carte>
      ) : (
        <Carte
          titre="Formules"
          description={`Saisissez l'effectif des formules à chiffrer (de 1 à ${formulesMax}) ; laissez vide pour exclure une formule. La prime forcée est facultative : elle remplace le tarif, exige un motif et passe la cotation « À valider ». Les accessoires reprennent la valeur du paramétrage ; vous pouvez la modifier (la modification est journalisée, les seuils de validation s'appliquent au TTC obtenu).`}
        >
          <div className="relative mb-4 overflow-x-auto rounded-md border border-border shadow-elevated">
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className={`${ENTETE} text-left`}>Formule</th>
                  <th scope="col" className={`${ENTETE} text-right`}>Prime unitaire (tarif)</th>
                  <th scope="col" className={`${ENTETE} text-left`}>Effectif</th>
                  <th scope="col" className={`${ENTETE} text-left`}>Prime unitaire forcée</th>
                  <th scope="col" className={`${ENTETE} text-left`}>Accessoires (valeur)</th>
                </tr>
              </thead>
              <tbody className="bg-surface [&>tr:last-child>td]:border-b-0">
                {formules.map((f) => {
                  const forcee = ligneDe(f.code)?.primeForcee;
                  return (
                    <tr key={f.code}>
                      <td className={`${CELLULE} font-medium`}>
                        {f.code} — {f.libelle}
                      </td>
                      <td className={`${CELLULE} text-right tabular-nums`}>{montant(f.primeUnitaire).toString().replace(".", ",")}</td>
                      <td className={CELLULE}>
                        <div className="w-28">
                          <ChampSaisie name={`eff_${f.code}`} defaultValue={ligneDe(f.code)?.effectif} inputMode="numeric" aria-label={`Effectif ${f.code}`} />
                        </div>
                      </td>
                      <td className={CELLULE}>
                        <div className="w-40">
                          <ChampSaisie name={`forcee_${f.code}`} defaultValue={forcee ? montant(forcee).toString() : ""} inputMode="decimal" className="text-right tabular-nums" aria-label={`Prime forcée ${f.code}`} />
                        </div>
                      </td>
                      <td className={CELLULE}>
                        <div className="flex items-center gap-2">
                          <div className="w-32">
                            <ChampSaisie
                              name={`acc_${f.code}`} className="text-right tabular-nums"
                              defaultValue={montant(ligneDe(f.code)?.accessoireSaisi ?? f.accessoireValeur).toString().replace(".", ",")}
                              inputMode="decimal"
                              aria-label={`Accessoires ${f.code}`}
                            />
                          </div>
                          <span className="text-xs text-neutral">{LIBELLE_MODE_ACCESSOIRE[f.accessoireMode] ?? f.accessoireMode}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Champ nom="motifForcage" libelle="Motif du forçage (obligatoire si une prime est forcée)" requis={false} valeur={base?.motifForcage ?? ""} autoComplete="off" />
        </Carte>
      )}

      <Carte titre="Assurés (facultatif)">
        <LignesAssures
          // Par garanties (6.2b) : pas de formule d'assuré (la composition ne distingue pas de formules) ; la colonne n'est pas proposée.
          formules={parGaranties ? [] : formules}
          initiales={(base?.assures ?? []).map((a) => ({ nom: a.nom_prenoms, naissance: a.date_naissance, sexe: a.sexe, lien: a.lien, identification: a.num_identification ?? "", formule: a.formule }))}
        />
      </Carte>

      <Carte titre="Bénéficiaires (SECURVIE, RELAXACCIDENT)" description="Facultatif à ce stade : ils peuvent aussi être saisis à l'acceptation. Dès qu'il y en a, la somme des quotes-parts doit faire 100 %.">
        <LignesBeneficiaires initiales={(base?.beneficiaires ?? []).map((b) => ({ nom: b.nom_prenoms, lien: b.lien, contact: b.contact, quote: b.quote_part }))} />
      </Carte>

      <Carte titre="Contacts d'urgence (RELAXVOYAGE)">
        <LignesContactsUrgence initiales={(base?.contactsUrgence ?? []).map((c) => ({ nom: c.nom_prenoms, contact: c.contact }))} />
      </Carte>

      <Carte titre="Risque (champs propres au produit)">
        <LignesRisque initiales={Object.entries(base?.risque ?? {}).map(([cle, valeur]) => ({ cle, valeur }))} />
      </Carte>
    </FormulaireAction>
  );
}
