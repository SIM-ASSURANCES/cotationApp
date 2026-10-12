import Link from "next/link";
import { notFound } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { LignesFormules } from "@/composants/LignesFormules";
import { NIVEAUX_ARRONDI } from "@/domaine/calcul/calcul";
import { PRECISIONS, SENS_ARRONDI, montant } from "@/domaine/calcul/montant";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerVersions, type VersionProduit } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { ajouterUneVersion } from "./actions";

const select = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";
const LIBELLE_SENS = { PROCHE: "Au plus proche", SUPERIEUR: "Au supérieur", INFERIEUR: "À l'inférieur" } as const;
const LIBELLE_NIVEAU = { LIGNE: "Chaque ligne", TOTAL: "Total seulement" } as const;

/** Décimal en texte sans zéros inutiles (« 3000.000000 » devient « 3000 »). */
const net = (texte: string) => montant(texte).toString();

function Resume({ v }: { v: VersionProduit }) {
  return (
    <section className="mb-4 rounded border border-border p-4 text-sm">
      <h3 className="mb-2 font-semibold">Version en vigueur depuis le {v.dateEffet}</h3>
      <p className="mb-2 text-neutral">
        Arrondi : {v.arrondi.precision} F, {LIBELLE_SENS[v.arrondi.sens].toLowerCase()}, {LIBELLE_NIVEAU[v.arrondi.niveau].toLowerCase()} · Prorata {v.prorata.actif ? "actif" : "inactif"}
        {v.prorata.primeMinimale ? `, prime minimale ${net(v.prorata.primeMinimale)}` : ""} · Fractionnement jusqu'à {v.fractionnement.tranchesMax} tranche(s)
        {net(v.fractionnement.frais) !== "0" ? `, frais ${net(v.fractionnement.frais)}` : ""} · Validité {v.cotation.validiteMois} mois
        {v.seuilValidationTtc ? ` · Double validation au-delà de ${net(v.seuilValidationTtc)} F TTC` : ""}
      </p>
      <table className="w-full max-w-3xl border-collapse">
        <thead>
          <tr className="text-left text-neutral">
            <th className="p-1">Formule</th>
            <th className="p-1">Libellé</th>
            <th className="p-1">Prime unitaire</th>
            <th className="p-1">Accessoires</th>
            <th className="p-1">Âges</th>
          </tr>
        </thead>
        <tbody>
          {v.formules.map((f) => (
            <tr key={f.code} className="border-t border-border">
              <td className="p-1 font-medium">{f.code}</td>
              <td className="p-1">{f.libelle}</td>
              <td className="p-1">{net(f.primeUnitaire)}</td>
              <td className="p-1">
                {f.accessoireMode} {f.accessoireMode === "AUCUN" ? "" : net(f.accessoireValeur)}
              </td>
              <td className="p-1">{f.ageMin == null && f.ageMax == null ? "–" : `${f.ageMin ?? 0} à ${f.ageMax ?? "…"} ans`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function PageProduit(props: PageProps<"/parametrage/produits/[code]">) {
  const { code } = await props.params;
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const donnees = await listerVersions(utilisateur, code);
  if (!donnees) {
    notFound();
  }
  const niveau = await niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS");
  const { produit, versions } = donnees;
  const base = versions[0]; // la plus récente : point de départ de la nouvelle version

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href="/parametrage/produits" className="text-primary underline">
          ← Produits
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-primary">
        {produit.code} <span className="font-normal text-neutral">— {produit.libelle}</span>
      </h1>
      <p className="mb-6 text-sm text-neutral">
        Gamme {produit.gamme} · branche fiscale {produit.branche}. Le calcul utilise la version en vigueur à la date du document.
      </p>
      <p className="mb-6 text-sm">
        <Link href={`/parametrage/produits/${produit.code}/relances`} className="text-primary underline">Avis d&apos;échéance et relances de ce produit</Link> (délai J-x, niveaux de relance)
      </p>

      {peutAgir(niveau) ? (
        <section className="mb-8 rounded border border-border bg-muted p-5">
          <h2 className="mb-1 text-lg font-semibold">Ajouter une version</h2>
          <p className="mb-4 text-sm text-neutral">
            Une version en vigueur ne se modifie jamais : on en ajoute une avec sa date d'effet
            {base ? ", pré-remplie avec la dernière version" : ""}. Les primes unitaires se saisissent avec leurs décimales.
          </p>
          <FormulaireAction action={ajouterUneVersion} libelleBouton="Enregistrer la version">
            <input type="hidden" name="codeProduit" value={produit.code} />
            <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
              <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" autoComplete="off" />
              <Champ nom="primeMinimale" libelle="Prime minimale (facultative)" requis={false} valeur={base?.prorata.primeMinimale ? net(base.prorata.primeMinimale) : ""} autoComplete="off" />
              <label className="mb-4 block text-sm font-medium">
                Précision d'arrondi (F)
                <select name="precision" defaultValue={String(base?.arrondi.precision ?? 1)} className={select}>
                  {PRECISIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-4 block text-sm font-medium">
                Sens d'arrondi
                <select name="sens" defaultValue={base?.arrondi.sens ?? "PROCHE"} className={select}>
                  {SENS_ARRONDI.map((s) => (
                    <option key={s} value={s}>
                      {LIBELLE_SENS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-4 block text-sm font-medium">
                Niveau d'arrondi
                <select name="niveau" defaultValue={base?.arrondi.niveau ?? "LIGNE"} className={select}>
                  {NIVEAUX_ARRONDI.map((n) => (
                    <option key={n} value={n}>
                      {LIBELLE_NIVEAU[n]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mb-4 flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="prorataActif" defaultChecked={base?.prorata.actif ?? true} /> Prorata temporis actif (jours inclus / 365)
              </label>
              <Champ nom="tranchesMax" libelle="Nombre maximal de tranches (1 à 12)" valeur={String(base?.fractionnement.tranchesMax ?? 1)} autoComplete="off" />
              <Champ nom="repartition" libelle="Répartition en % (ex. 40 ; 30 ; 30), vide = tranches égales" requis={false} valeur={base?.fractionnement.repartitionPourcent?.join(" ; ") ?? ""} autoComplete="off" />
              <Champ nom="decalages" libelle="Décalages en mois (ex. 0 ; 3 ; 6), vide = réguliers" requis={false} valeur={base?.fractionnement.decalagesMois?.join(" ; ") ?? ""} autoComplete="off" />
              <Champ nom="frais" libelle="Frais de fractionnement (ajoutés aux accessoires)" valeur={base ? net(base.fractionnement.frais) : "0"} autoComplete="off" />
              <Champ nom="validiteMois" libelle="Validité d'une cotation (mois, à partir de la date d'établissement)" valeur={String(base?.cotation.validiteMois ?? 3)} autoComplete="off" />
              <Champ nom="formulesMax" libelle="Formules comparées au plus" valeur={String(base?.cotation.formulesMax ?? 3)} autoComplete="off" />
              <Champ nom="seuil" libelle="Seuil de TTC pour la double validation (facultatif)" requis={false} valeur={base?.seuilValidationTtc ? net(base.seuilValidationTtc) : ""} autoComplete="off" />
            </div>
            <h3 className="mb-1 font-semibold">Références contractuelles (CDC §7)</h3>
            <p className="mb-2 text-sm text-neutral">
              Modèles de conditions générales et spéciales joints au contrat (codes de la bibliothèque « Modèles Word ») et visas cités
              dans les CP. À l'émission, le visa doit être celui des CG jointes, sinon l'émission est refusée.
            </p>
            <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
              <Champ nom="cgModeleCode" libelle="Code du modèle de CG (facultatif)" requis={false} valeur={base?.references?.cgModeleCode ?? ""} autoComplete="off" />
              <Champ nom="cgVisa" libelle="Visa des CG cité dans les CP" requis={false} valeur={base?.references?.cgVisa ?? ""} autoComplete="off" />
              <Champ nom="csModeleCode" libelle="Code du modèle de CS (facultatif)" requis={false} valeur={base?.references?.csModeleCode ?? ""} autoComplete="off" />
              <Champ nom="csVisa" libelle="Visa des CS" requis={false} valeur={base?.references?.csVisa ?? ""} autoComplete="off" />
            </div>
            <h3 className="mb-2 font-semibold">Formules</h3>
            <LignesFormules
              initiales={(base?.formules ?? []).map((f) => ({
                code: f.code,
                libelle: f.libelle,
                tauxCouverture: f.tauxCouverture ? net(f.tauxCouverture) : "",
                primeUnitaire: net(f.primeUnitaire),
                accessoireMode: f.accessoireMode,
                accessoireValeur: net(f.accessoireValeur),
                ageMin: f.ageMin == null ? "" : String(f.ageMin),
                ageMax: f.ageMax == null ? "" : String(f.ageMax),
              }))}
            />
          </FormulaireAction>
        </section>
      ) : (
        <p className="mb-6 rounded border border-border bg-muted p-3 text-sm">Consultation seule.</p>
      )}

      <h2 className="mb-3 text-lg font-semibold">Historique des versions</h2>
      {versions.length === 0 ? (
        <p className="text-sm text-neutral">Aucune version : ce produit ne peut pas encore être calculé.</p>
      ) : (
        versions.map((v) => <Resume key={v.id} v={v} />)
      )}
    </main>
  );
}
