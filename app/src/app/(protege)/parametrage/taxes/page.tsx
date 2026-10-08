import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { ASSIETTES_TAXE } from "@/domaine/calcul/calcul";
import { montant } from "@/domaine/calcul/montant";
import { LIBELLE_TYPE_CONTRAT, RATTACHEMENT_TYPE_CONTRAT, TYPES_CONTRAT, enVigueurLe, type TypeContrat } from "@/domaine/calcul/taxes";
import { peutAgir, peutLire } from "@/domaine/droits";
import { aujourdhui, listerTaxes, type LigneTaxe } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUneTaxe } from "./actions";

const LIBELLE_ASSIETTE = { NETTE_ACCESSOIRES: "Nette + accessoires", NETTE: "Nette seule" } as const;
const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";
const libelleType = (t: TypeContrat | null) => (t ? LIBELLE_TYPE_CONTRAT[t] : "Tous types");
const taux = (t: LigneTaxe) => (t.tauxMixte || t.tauxPourcent === null ? "Taux mixte" : `${montant(t.tauxPourcent).toString().replace(".", ",")} %`);

export default async function PageTaxes() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [taxes, niveau] = await Promise.all([listerTaxes(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const jour = aujourdhui();

  // Historique par clé (branche, type de contrat) : toutes les versions, la plus récente en premier.
  const groupes = new Map<string, LigneTaxe[]>();
  for (const t of taxes) {
    const cle = `${t.branche}|${t.typeContrat ?? ""}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), t]);
  }

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Table des taxes</h1>
      <p className="mb-2 max-w-3xl text-sm text-zinc-700">
        Taux de taxe par <strong>branche et type de contrat</strong> (CDC §8.3, réponse de la Technique du 08/10/2026), historisés : on ajoute une
        version avec une date d'effet, on ne modifie jamais une version en vigueur. Pour un même taux, deux périodes ne peuvent pas se chevaucher ;
        la version précédente sans date de fin est clôturée la veille de la nouvelle.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-zinc-700">
        Le taux appliqué est celui en vigueur à la <strong>date d'effet</strong> de la police, pour son type de contrat ; à défaut, celui du type
        rattaché (hypothèse H29 :{" "}
        {Object.entries(RATTACHEMENT_TYPE_CONTRAT)
          .map(([de, vers]) => `${LIBELLE_TYPE_CONTRAT[de as TypeContrat].toLowerCase()} → ${LIBELLE_TYPE_CONTRAT[vers].toLowerCase()}`)
          .join(", ")}
        ), puis celui de « tous types ». Une branche à taux mixte refuse le calcul tant que la ventilation n'est pas paramétrée.
      </p>

      {peutAgir(niveau) ? (
        <section className="mb-8 max-w-md rounded border border-bordure bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter une version de taux</h2>
          <FormulaireAction action={creerUneTaxe} libelleBouton="Ajouter">
            <Champ nom="branche" libelle="Branche (ex. SANTE, IA, DECES, IARD)" autoComplete="off" />
            <label className="mb-4 block text-sm font-medium">
              Type de contrat
              <select name="typeContrat" defaultValue="" className={entree}>
                <option value="">Tous types</option>
                {TYPES_CONTRAT.map((t) => (
                  <option key={t} value={t}>
                    {LIBELLE_TYPE_CONTRAT[t]}
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
        <p className="mb-6 rounded border border-bordure bg-surface p-3 text-sm">Consultation seule : votre profil peut proposer mais pas enregistrer de taux.</p>
      )}

      {[...groupes.values()].map((versions) => (
        <section key={`${versions[0].branche}|${versions[0].typeContrat ?? ""}`} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">
            {versions[0].branche} · {libelleType(versions[0].typeContrat)}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] max-w-5xl border-collapse text-sm">
              <thead>
                <tr className="bg-sim-bleu text-left text-white">
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
                  <tr key={t.id} className={`border-b border-bordure ${enVigueurLe(t, jour) ? "font-semibold" : ""}`}>
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
      {taxes.length === 0 ? <p className="text-sm text-zinc-600">Aucune taxe enregistrée.</p> : null}
    </main>
  );
}
