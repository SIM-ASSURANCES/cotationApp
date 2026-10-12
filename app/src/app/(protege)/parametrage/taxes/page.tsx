import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { ASSIETTES_TAXE } from "@/domaine/calcul/calcul";
import { montant } from "@/domaine/calcul/montant";
import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT, REGIMES_TAXE, enVigueurLe, estRegimeTaxe, type TypeContrat } from "@/domaine/calcul/taxes";
import { peutAgir, peutLire } from "@/domaine/droits";
import { aujourdhui, listerBranches, listerTaxes, type LigneTaxe } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUneTaxe } from "./actions";

const LIBELLE_ASSIETTE = { NETTE_ACCESSOIRES: "Nette + accessoires", NETTE: "Nette seule" } as const;
const entree = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";
/** Régime de la ligne ; une ligne FAMILLE ou GROUPE_OUVERT d'avant la session 6.0 n'est plus retenue par le calcul. */
const libelleType = (t: TypeContrat | null) => (t === null ? "Tous régimes" : estRegimeTaxe(t) ? `Régime ${LIBELLE_REGIME_TAXE[t].toLowerCase()}` : `${LIBELLE_TYPE_CONTRAT[t]} (ancienne clé, non utilisée)`);
const taux = (t: LigneTaxe) => (t.tauxMixte || t.tauxPourcent === null ? "Taux mixte" : `${montant(t.tauxPourcent).toString().replace(".", ",")} %`);

export default async function PageTaxes() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [taxes, branches, niveau] = await Promise.all([listerTaxes(utilisateur), listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const jour = aujourdhui();

  // Historique par clé (branche, type de contrat) : toutes les versions, la plus récente en premier.
  const groupes = new Map<string, LigneTaxe[]>();
  for (const t of taxes) {
    const cle = `${t.branche}|${t.typeContrat ?? ""}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), t]);
  }

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Table des taxes</h1>
      <p className="mb-2 max-w-3xl text-sm text-neutral">
        Taux de taxe par <strong>branche et régime de taxe</strong> (CDC §8.3, réponses de la Technique des 08 et 09/10/2026), historisés : on ajoute une
        version avec une date d'effet, on ne modifie jamais une version en vigueur. Pour un même taux, deux périodes ne peuvent pas se chevaucher ;
        la version précédente sans date de fin est clôturée la veille de la nouvelle.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-neutral">
        Le taux appliqué est celui en vigueur à la <strong>date d'effet</strong> de la police, pour le <strong>régime de taxe</strong> choisi sur la
        cotation (Individuel ou Groupe, H29 fermée le 09/10/2026), puis celui de « tous régimes ». Le type de contrat ne choisit plus le taux.
        Une branche à taux mixte refuse le calcul tant que la ventilation n'est pas paramétrée.
      </p>

      {peutAgir(niveau) ? (
        <section className="mb-8 max-w-md rounded border border-border bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter une version de taux</h2>
          <FormulaireAction action={creerUneTaxe} libelleBouton="Ajouter">
            <label className="mb-4 block text-sm font-medium">
              Branche
              <select name="branche" defaultValue="" required className={entree}>
                <option value="" disabled>
                  Choisir une branche
                </option>
                {branches.filter((b) => b.actif).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} · {b.libelle}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-4 block text-sm font-medium">
              Régime de taxe
              <select name="typeContrat" defaultValue="" className={entree}>
                <option value="">Tous régimes</option>
                {REGIMES_TAXE.map((t) => (
                  <option key={t} value={t}>
                    {LIBELLE_REGIME_TAXE[t]}
                  </option>
                ))}
              </select>
            </label>
            <Champ nom="tauxPourcent" libelle="Taux en % (ex. 1,5) ; vide pour un taux mixte" requis={false} autoComplete="off" />
            <label className="mb-4 flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="tauxMixte" /> Taux mixte (plusieurs taux dans un même contrat : calcul refusé)
            </label>
            <Champ nom="commentaire" libelle="Commentaire (facultatif)" requis={false} autoComplete="off" />
            <label className="mb-4 block text-sm font-medium">
              Assiette
              <select name="assiette" defaultValue="NETTE_ACCESSOIRES" className={entree}>
                {ASSIETTES_TAXE.map((a) => (
                  <option key={a} value={a}>
                    {LIBELLE_ASSIETTE[a]}
                  </option>
                ))}
              </select>
            </label>
            <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" autoComplete="off" />
            <Champ nom="dateFin" libelle="Date de fin (facultative)" requis={false} autoComplete="off" />
          </FormulaireAction>
        </section>
      ) : (
        <p className="mb-6 rounded border border-border bg-muted p-3 text-sm">Consultation seule : votre profil peut proposer mais pas enregistrer de taux.</p>
      )}

      {[...groupes.values()].map((versions) => (
        <section key={`${versions[0].branche}|${versions[0].typeContrat ?? ""}`} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">
            {versions[0].branche} · {libelleType(versions[0].typeContrat)}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] max-w-5xl border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-left text-primary-foreground">
                  <th className="p-2">Période</th>
                  <th className="p-2">Taux</th>
                  <th className="p-2">Assiette</th>
                  <th className="p-2">Commentaire</th>
                  <th className="p-2">Saisi par</th>
                  <th className="p-2">Saisi le</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((t) => (
                  <tr key={t.id} className={`border-b border-border ${enVigueurLe(t, jour) ? "font-semibold" : ""}`}>
                    <td className="p-2">
                      du {t.dateEffet} {t.dateFin ? `au ${t.dateFin}` : "(sans date de fin)"}
                      {enVigueurLe(t, jour) ? " · en vigueur" : ""}
                    </td>
                    <td className="p-2">{taux(t)}</td>
                    <td className="p-2">{LIBELLE_ASSIETTE[t.assiette]}</td>
                    <td className="p-2 font-normal">{t.commentaire ?? "—"}</td>
                    <td className="p-2 font-normal">{t.creePar}</td>
                    <td className="p-2 font-normal">{t.creeLe.toISOString().slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {taxes.length === 0 ? <p className="text-sm text-neutral">Aucune taxe enregistrée.</p> : null}
    </main>
  );
}
