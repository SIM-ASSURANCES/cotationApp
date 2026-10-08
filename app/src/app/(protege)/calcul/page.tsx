import Link from "next/link";

import { dateValide } from "@/domaine/calcul/dates";
import { formaterMontant, type Montant } from "@/domaine/calcul/montant";
import { LIBELLE_TYPE_CONTRAT, TYPES_CONTRAT, estTypeContrat } from "@/domaine/calcul/taxes";
import { peutLire } from "@/domaine/droits";
import { calculerPourProduit, aujourdhui, listerVersions, listerProduits, type ReponseCalcul } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

const premier = (valeur: string | string[] | undefined) => (Array.isArray(valeur) ? valeur[0] : valeur) ?? "";
const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";
const f = (m: Montant) => formaterMontant(m);

function Resultats({ r }: { r: ReponseCalcul }) {
  const { resultat: x } = r;
  const toutes = [...x.lignes, ...(x.fraisFractionnement ? [x.fraisFractionnement] : [])];
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Résultat</h2>
      <p className="mb-3 text-sm text-zinc-700">
        Paramétrage du produit en vigueur le {r.versionDu} · taxe {r.taxe.branche} ({r.taxe.typeContrat ? LIBELLE_TYPE_CONTRAT[r.taxe.typeContrat].toLowerCase() : "tous types"}) {r.taxe.tauxPourcent.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",")} % (en vigueur le {r.taxe.dateEffet}) ·{" "}
        {x.joursCouverts} jour(s) couverts, coefficient de prorata {x.coefProrata.toDecimalPlaces(5).toString().replace(".", ",")}
      </p>
      {r.doubleValidationRequise ? (
        <p role="status" className="mb-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm font-medium">
          Le TTC dépasse le seuil du produit : ce document passerait en « À valider » (double validation, CDC §4.1).
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-right text-white">
              <th className="p-2 text-left">Formule</th>
              <th className="p-2">Effectif</th>
              <th className="p-2">Prime nette (HT)</th>
              <th className="p-2">Accessoires</th>
              <th className="p-2">Taxe</th>
              <th className="p-2">TTC</th>
              <th className="p-2">TTC par unité</th>
            </tr>
          </thead>
          <tbody>
            {toutes.map((l) => (
              <tr key={l.code} className="border-b border-bordure text-right">
                <td className="p-2 text-left font-medium">{r.libelles[l.code] ?? "Frais de fractionnement"}</td>
                <td className="p-2">{l.code === "FRAIS_FRACTIONNEMENT" ? "—" : l.effectif}</td>
                <td className="p-2">{f(l.arrondi.nette)}</td>
                <td className="p-2">{f(l.arrondi.accessoires)}</td>
                <td className="p-2">{f(l.arrondi.taxe)}</td>
                <td className="p-2 font-semibold">{f(l.arrondi.ttc)}</td>
                <td className="p-2">{l.code === "FRAIS_FRACTIONNEMENT" ? "—" : f(l.ttcParUnite)}</td>
              </tr>
            ))}
            <tr className="bg-surface text-right font-semibold">
              <td className="p-2 text-left">Total</td>
              <td className="p-2" />
              <td className="p-2">{f(x.totaux.arrondi.nette)}</td>
              <td className="p-2">{f(x.totaux.arrondi.accessoires)}</td>
              <td className="p-2">{f(x.totaux.arrondi.taxe)}</td>
              <td className="p-2">{f(x.totaux.arrondi.ttc)}</td>
              <td className="p-2" />
            </tr>
          </tbody>
        </table>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-sim-bleu">Montants exacts avant arrondi</summary>
        <table className="mt-2 w-full max-w-2xl border-collapse">
          <tbody>
            {toutes.map((l) => (
              <tr key={l.code} className="border-b border-bordure text-right">
                <td className="p-1 text-left">{r.libelles[l.code] ?? "Frais de fractionnement"}</td>
                <td className="p-1">{formaterMontant(l.exact.nette, 4)}</td>
                <td className="p-1">{formaterMontant(l.exact.accessoires, 4)}</td>
                <td className="p-1">{formaterMontant(l.exact.taxe, 4)}</td>
                <td className="p-1">{formaterMontant(l.exact.ttc, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {r.echeancier ? (
        <div className="mt-6">
          <h3 className="mb-2 font-semibold">Échéancier ({r.echeancier.length} tranches)</h3>
          <table className="w-full max-w-md border-collapse text-sm">
            <thead>
              <tr className="bg-sim-bleu text-left text-white">
                <th className="p-2">N°</th>
                <th className="p-2">Date</th>
                <th className="p-2 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {r.echeancier.map((t) => (
                <tr key={t.numero} className="border-b border-bordure">
                  <td className="p-2">{t.numero}</td>
                  <td className="p-2">{t.date}</td>
                  <td className="p-2 text-right">{f(t.montant)}</td>
                </tr>
              ))}
              <tr className="bg-surface font-semibold">
                <td className="p-2" colSpan={2}>
                  Somme des tranches (= TTC)
                </td>
                <td className="p-2 text-right">{f(r.echeancier.reduce((s, t) => s.plus(t.montant), x.totaux.arrondi.ttc.minus(x.totaux.arrondi.ttc)))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default async function PageCalcul(props: PageProps<"/calcul">) {
  const utilisateur = await exigerUtilisateur();
  const [parametrage, cotation] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
    niveauDuProfil(utilisateur.profil, "CREER_COTATION"),
  ]);
  if (!peutLire(parametrage) && !peutLire(cotation)) {
    return (
      <main>
        <h1 className="mb-2 text-2xl font-semibold text-red-700">Accès refusé</h1>
        <p>Votre profil n'a pas accès au calcul.</p>
      </main>
    );
  }

  const q = await props.searchParams;
  const codeProduit = premier(q.produit);
  const produits = await listerProduits(utilisateur);

  if (!codeProduit) {
    return (
      <main>
        <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Calcul de prime</h1>
        <p className="mb-4 text-sm text-zinc-700">Choisissez un produit. Les montants viennent du moteur de calcul, avec le paramétrage en vigueur.</p>
        <ul className="list-disc pl-6">
          {produits
            .filter((p) => p.actif && p.versions.length > 0)
            .map((p) => (
              <li key={p.code}>
                <Link className="font-medium text-sim-bleu underline" href={`/calcul?produit=${p.code}`}>
                  {p.code}
                </Link>{" "}
                — {p.libelle}
              </li>
            ))}
        </ul>
        {produits.every((p) => !p.actif || p.versions.length === 0) ? <p className="text-sm text-zinc-600">Aucun produit paramétré pour l'instant.</p> : null}
      </main>
    );
  }

  const donnees = await listerVersions(utilisateur, codeProduit);
  const dateEffet = premier(q.dateEffet);
  const dateEcheance = premier(q.dateEcheance);
  const dateDocument = premier(q.dateDocument) || aujourdhui();
  const tranches = premier(q.tranches) || "1";
  const typeContrat = premier(q.typeContrat);
  const formules = donnees?.versions[0]?.formules ?? [];

  let resultat: ReponseCalcul | null = null;
  let erreur: string | null = null;
  if (donnees && dateEffet && dateEcheance) {
    const lignes = formules
      .map((fm) => ({ codeFormule: fm.code, texte: premier(q[`eff_${fm.code}`]).trim() }))
      .filter((l) => l.texte !== "");
    if (lignes.some((l) => !/^\d+$/.test(l.texte))) {
      erreur = "Les effectifs doivent être des nombres entiers.";
    } else if (!dateValide(dateEffet) || !dateValide(dateEcheance) || !dateValide(dateDocument)) {
      erreur = "Dates invalides : utilisez le format AAAA-MM-JJ.";
    } else if (lignes.length === 0) {
      erreur = "Saisissez l'effectif d'au moins une formule.";
    } else if (!estTypeContrat(typeContrat)) {
      erreur = "Choisissez le type de contrat : il détermine le taux de taxe.";
    } else {
      try {
        resultat = await calculerPourProduit(utilisateur, {
          codeProduit,
          dateEffet,
          dateEcheance,
          dateDocument,
          typeContrat,
          lignes: lignes.map((l) => ({ codeFormule: l.codeFormule, effectif: Number(l.texte) })),
          nombreTranches: Number(tranches),
        });
      } catch (e) {
        if (e instanceof ErreurMetier) erreur = e.message;
        else if (e instanceof ErreurAcces) erreur = "Vous n'avez pas le droit de calculer.";
        else throw e;
      }
    }
  }

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href="/calcul" className="text-sim-bleu underline">
          ← Produits
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold text-sim-bleu">Calcul : {codeProduit}</h1>
      {!donnees ? (
        <p>Produit introuvable.</p>
      ) : (
        <form method="get" className="max-w-3xl">
          <input type="hidden" name="produit" value={codeProduit} />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <label className="mb-4 block text-sm font-medium">
              Date d'effet
              <input name="dateEffet" defaultValue={dateEffet} placeholder="2026-07-22" required className={entree} />
            </label>
            <label className="mb-4 block text-sm font-medium">
              Date d'échéance
              <input name="dateEcheance" defaultValue={dateEcheance} placeholder="2026-12-31" required className={entree} />
            </label>
            <label className="mb-4 block text-sm font-medium">
              Date du document (paramètres en vigueur à cette date)
              <input name="dateDocument" defaultValue={dateDocument} className={entree} />
            </label>
            <label className="mb-4 block text-sm font-medium">
              Type de contrat (choisit le taux de taxe)
              <select name="typeContrat" defaultValue={typeContrat} required className={entree}>
                <option value="">— Choisir —</option>
                {TYPES_CONTRAT.map((t) => (
                  <option key={t} value={t}>
                    {LIBELLE_TYPE_CONTRAT[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-4 block text-sm font-medium">
              Nombre de tranches
              <input name="tranches" defaultValue={tranches} inputMode="numeric" className={entree} />
            </label>
          </div>
          <h2 className="mb-2 font-semibold">Effectifs (laisser vide pour exclure une formule)</h2>
          <div className="mb-4 grid gap-x-6 sm:grid-cols-2">
            {formules.map((fm) => (
              <label key={fm.code} className="mb-3 block text-sm font-medium">
                {fm.code} — {fm.libelle}
                <input name={`eff_${fm.code}`} defaultValue={premier(q[`eff_${fm.code}`])} inputMode="numeric" className={entree} />
              </label>
            ))}
          </div>
          <button type="submit" className="rounded bg-sim-bleu px-4 py-2 font-semibold text-white hover:bg-sim-marine">
            Calculer
          </button>
        </form>
      )}
      {erreur ? (
        <p role="alert" className="mt-4 font-medium text-red-700">
          {erreur}
        </p>
      ) : null}
      {resultat ? <Resultats r={resultat} /> : null}
    </main>
  );
}
