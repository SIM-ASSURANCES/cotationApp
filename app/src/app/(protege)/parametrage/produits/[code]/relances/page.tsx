import Link from "next/link";
import { notFound } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { NIVEAUX_MAX } from "@/domaine/facturation/echeances";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { consulterParametresRelance } from "@/serveur/echeances";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { enregistrerLesRelances } from "./actions";

const entree = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";

/** Avis d'échéance et relances d'un produit (CDC §12) : délai J-x, niveaux J+x ; historisés. Un modèle Word par niveau (H16). */
export default async function PageRelances(props: PageProps<"/parametrage/produits/[code]/relances">) {
  const { code } = await props.params;
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const lu = await consulterParametresRelance(utilisateur, decodeURIComponent(code));
  if (!lu) notFound();
  const ecriture = peutAgir(await niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"));
  const p = lu.enVigueur;

  return (
    <main className="max-w-4xl">
      <p className="mb-2 text-sm">
        <Link href={`/parametrage/produits/${code}`} className="text-primary underline">← Produit {lu.produitCode}</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-primary">Avis d&apos;échéance et relances — {lu.produitCode}</h1>
      <p className="mb-6 text-sm text-neutral">
        En vigueur aujourd&apos;hui{lu.parDefaut ? " (valeurs par défaut du CDC, jamais modifiées pour ce produit)" : ""} : avis à <strong>J-{p.delaiAvisJours}</strong> ;{" "}
        {p.niveaux.map((n) => `niveau ${n.niveau} à J+${n.jours} (${n.libelle})`).join(", ")}. Chaque niveau utilise le modèle Word de relance de
        ce niveau (Modèles Word, type « Relance »). Une modification s&apos;ajoute avec sa date d&apos;effet : jamais rétroactive.
      </p>

      {ecriture ? (
        <section className="mb-8 rounded border border-border bg-muted p-5">
          <h2 className="mb-3 text-lg font-semibold">Nouveaux paramètres</h2>
          <FormulaireAction action={enregistrerLesRelances} libelleBouton="Enregistrer">
            <input type="hidden" name="produit" value={lu.produitCode} />
            <div className="grid gap-x-6 sm:grid-cols-2">
              <label className="mb-4 block text-sm font-medium">
                Délai de l&apos;avis d&apos;échéance (jours avant l&apos;échéance)
                <input name="delaiAvisJours" defaultValue={p.delaiAvisJours} inputMode="numeric" className={entree} required />
              </label>
              <label className="mb-4 block text-sm font-medium">
                Date d&apos;effet (AAAA-MM-JJ)
                <input name="dateEffet" defaultValue={aujourdhui()} className={entree} required />
              </label>
            </div>
            <table className="mb-4 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Niveau</th><th className="p-2">Jours après l&apos;échéance</th><th className="p-2">Libellé</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: NIVEAUX_MAX }, (_, i) => i + 1).map((i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="p-2">{i}</td>
                    <td className="p-2"><input name={`jours${i}`} aria-label={`Jours du niveau ${i}`} defaultValue={p.niveaux[i - 1]?.jours ?? ""} inputMode="numeric" className={entree} /></td>
                    <td className="p-2"><input name={`libelle${i}`} aria-label={`Libellé du niveau ${i}`} defaultValue={p.niveaux[i - 1]?.libelle ?? ""} className={entree} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mb-3 text-sm text-neutral">Lignes vides ignorées ; les niveaux se suivent, chacun plus tardif que le précédent.</p>
          </FormulaireAction>
        </section>
      ) : null}

      <h2 className="mb-2 text-lg font-semibold">Historique</h2>
      {lu.historique.length === 0 ? (
        <p className="text-sm">Aucune modification : valeurs par défaut du CDC.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Date d&apos;effet</th><th className="p-2">Avis</th><th className="p-2">Relances</th><th className="p-2">Saisi par</th></tr>
          </thead>
          <tbody>
            {lu.historique.map((h) => (
              <tr key={h.dateEffet} className="border-b border-border">
                <td className="p-2">{h.dateEffet}</td>
                <td className="p-2">J-{h.valeur.delaiAvisJours}</td>
                <td className="p-2">{h.valeur.niveaux.map((n) => `${n.niveau} : J+${n.jours} (${n.libelle})`).join(" ; ")}</td>
                <td className="p-2">{h.creePar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
