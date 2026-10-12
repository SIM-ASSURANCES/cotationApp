import { notFound } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, Champ, EnTetePage, Tableau, type ColonneTableau } from "@/composants/ui";
import { NIVEAUX_MAX } from "@/domaine/facturation/echeances";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { consulterParametresRelance } from "@/serveur/echeances";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { enregistrerLesRelances } from "./actions";

/** Avis d'échéance et relances d'un produit (CDC §12) : délai J-x, niveaux J+x ; historisés. Un modèle Word par niveau (H16). */
export default async function PageRelances(props: PageProps<"/parametrage/produits/[code]/relances">) {
  const { code } = await props.params;
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const lu = await consulterParametresRelance(utilisateur, decodeURIComponent(code));
  if (!lu) notFound();
  const ecriture = peutAgir(await niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"));
  const p = lu.enVigueur;

  type Historique = (typeof lu.historique)[number];
  const colonnesHistorique: ColonneTableau<Historique>[] = [
    { cle: "dateEffet", entete: "Date d'effet", rendu: (h) => h.dateEffet },
    { cle: "avis", entete: "Avis", rendu: (h) => `J-${h.valeur.delaiAvisJours}` },
    { cle: "relances", entete: "Relances", rendu: (h) => h.valeur.niveaux.map((n) => `${n.niveau} : J+${n.jours} (${n.libelle})`).join(" ; ") },
    { cle: "creePar", entete: "Saisi par", rendu: (h) => h.creePar },
  ];
  // Les cellules du formulaire portent des champs : le `Tableau` ne fait que les loger, les noms et valeurs sont ceux de l'ancien écran.
  const colonnesNiveaux: ColonneTableau<number>[] = [
    { cle: "niveau", entete: "Niveau", rendu: (i) => i },
    {
      cle: "jours",
      entete: "Jours après l'échéance",
      rendu: (i) => <Champ name={`jours${i}`} aria-label={`Jours du niveau ${i}`} defaultValue={p.niveaux[i - 1]?.jours ?? ""} inputMode="numeric" />,
    },
    {
      cle: "libelle",
      entete: "Libellé",
      rendu: (i) => <Champ name={`libelle${i}`} aria-label={`Libellé du niveau ${i}`} defaultValue={p.niveaux[i - 1]?.libelle ?? ""} />,
    },
  ];

  return (
    <main className="max-w-4xl space-y-6">
      <EnTetePage
        filAriane={[{ libelle: "Produits", href: "/parametrage/produits" }, { libelle: `Produit ${lu.produitCode}`, href: `/parametrage/produits/${code}` }, { libelle: "Relances" }]}
        titre={`Avis d'échéance et relances — ${lu.produitCode}`}
      />
      <p className="text-sm text-muted-foreground">
        En vigueur aujourd&apos;hui{lu.parDefaut ? " (valeurs par défaut du CDC, jamais modifiées pour ce produit)" : ""} : avis à <strong>J-{p.delaiAvisJours}</strong> ;{" "}
        {p.niveaux.map((n) => `niveau ${n.niveau} à J+${n.jours} (${n.libelle})`).join(", ")}. Chaque niveau utilise le modèle Word de relance de
        ce niveau (Modèles Word, type « Relance »). Une modification s&apos;ajoute avec sa date d&apos;effet : jamais rétroactive.
      </p>

      {ecriture ? (
        <Carte titre="Nouveaux paramètres">
          <FormulaireAction action={enregistrerLesRelances} libelleBouton="Enregistrer">
            <input type="hidden" name="produit" value={lu.produitCode} />
            <div className="mb-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Champ label="Délai de l'avis d'échéance (jours avant l'échéance)" name="delaiAvisJours" defaultValue={p.delaiAvisJours} inputMode="numeric" required />
              <Champ label="Date d'effet (AAAA-MM-JJ)" name="dateEffet" defaultValue={aujourdhui()} required />
            </div>
            <div className="mb-4">
              <Tableau colonnes={colonnesNiveaux} lignes={Array.from({ length: NIVEAUX_MAX }, (_, i) => i + 1)} cleLigne={(i) => String(i)} legende="Niveaux de relance" zebre={false} />
            </div>
            <p className="mb-3 text-sm text-muted-foreground">Lignes vides ignorées ; les niveaux se suivent, chacun plus tardif que le précédent.</p>
          </FormulaireAction>
        </Carte>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-foreground">Historique</h2>
        <Tableau colonnes={colonnesHistorique} lignes={lu.historique} cleLigne={(h) => h.dateEffet} messageVide="Aucune modification : valeurs par défaut du CDC." legende="Historique des paramètres de relance" />
      </section>
    </main>
  );
}
