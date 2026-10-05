import Link from "next/link";
import { notFound } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { formaterMontant, montant, type Montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, peutAccepter, peutEtreValidee, peutModifier } from "@/domaine/cotation/statuts";
import { LIBELLE_RAISON } from "@/domaine/cotation/validation";
import { peutAgir, peutLire, peutValider } from "@/domaine/droits";
import { listerMotifsRefus } from "@/serveur/clients";
import { lireCotation } from "@/serveur/cotations";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { accepterCotation, refuserCotation, renvoyerCotation, soumettreCotation, validerCotation } from "../actions";

const f = (m: Montant) => formaterMontant(m);
const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";
const formatDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : "—");

export default async function PageCotation(props: PageProps<"/cotations/[id]">) {
  const { id } = await props.params;
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const c = Number.isInteger(Number(id)) ? await lireCotation(utilisateur, Number(id)) : null;
  if (!c) {
    notFound();
  }

  const [niveauCotation, niveauForcage, motifs] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "CREER_COTATION"),
    niveauDuProfil(utilisateur.profil, "FORCER_PRIME"),
    listerMotifsRefus(),
  ]);
  const estAuteur = c.auteurId === utilisateur.id;
  const agit = peutAgir(niveauCotation);
  const x = c.resultat;
  const forcees = c.lignes.filter((l) => l.primeForcee !== null);
  const nom = c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`.trim();

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href="/cotations" className="text-sim-bleu underline">
          ← Cotations
        </Link>
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-sim-bleu">{c.numero ?? `Brouillon n° ${c.id}`}</h1>
        <span className="rounded bg-surface px-3 py-1 text-sm font-semibold">{LIBELLE_STATUT[c.statutEffectif]}</span>
      </div>
      {c.filigrane ? (
        <p role="alert" className="mb-4 rounded border-2 border-red-600 p-3 text-center text-2xl font-bold tracking-widest text-red-600">
          {c.filigrane}
        </p>
      ) : null}

      <section className="mb-6 grid max-w-4xl gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <p><strong>Produit :</strong> {c.produit.code} — {c.produit.libelle}</p>
        <p><strong>Souscripteur :</strong> {nom} ({c.souscripteur.type === "MORALE" ? "personne morale" : "personne physique"})</p>
        <p><strong>Période :</strong> du {formatDate(c.dateEffet)} au {formatDate(c.dateEcheance)} ({x.joursCouverts} jours)</p>
        <p><strong>Établie le :</strong> {formatDate(c.dateEtablissement)}</p>
        <p><strong>Valide jusqu'au :</strong> {formatDate(c.dateValidite)}</p>
        <p><strong>Paramétrage du produit du :</strong> {formatDate(c.versionDateEffet)}</p>
        <p><strong>Auteur :</strong> {c.auteurIdentifiant}</p>
        {c.numeroPolice ? <p><strong>Police créée :</strong> {c.numeroPolice}</p> : null}
        {c.statut === "REFUSEE" ? <p><strong>Refus :</strong> {c.motifRefusCode}{c.refusCommentaire ? ` — ${c.refusCommentaire}` : ""}</p> : null}
      </section>

      {c.raisonsValidation.length > 0 ? (
        <p className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <strong>Validation exigée :</strong> {c.raisonsValidation.map((r) => LIBELLE_RAISON[r]).join(", ")}.
        </p>
      ) : null}

      <h2 className="mb-2 text-lg font-semibold">Primes</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
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
            {[...x.lignes, ...(x.fraisFractionnement ? [x.fraisFractionnement] : [])].map((l) => (
              <tr key={l.code} className="border-b border-bordure text-right">
                <td className="p-2 text-left font-medium">{c.libelles[l.code] ?? "Frais de fractionnement"}</td>
                <td className="p-2">{l.code === "FRAIS_FRACTIONNEMENT" ? "—" : l.effectif}</td>
                <td className="p-2">{f(l.arrondi.nette)}</td>
                <td className="p-2">{f(l.arrondi.accessoires)}</td>
                <td className="p-2">{f(l.arrondi.taxe)}</td>
                <td className="p-2 font-semibold">{f(l.arrondi.ttc)}</td>
                <td className="p-2">{l.code === "FRAIS_FRACTIONNEMENT" ? "—" : f(l.ttcParUnite)}</td>
              </tr>
            ))}
            <tr className="bg-surface text-right font-semibold">
              <td className="p-2 text-left">Total général</td>
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
      {forcees.length > 0 ? (
        <p className="mt-3 rounded border border-bordure bg-surface p-3 text-sm">
          <strong>Prime forcée (information interne, non affichée au client) :</strong>{" "}
          {forcees.map((l) => `${l.code} : tarif ${montant(l.primeTarif).toString()} → forcée ${montant(l.primeForcee!).toString()}`).join(" ; ")}. Motif : {c.motifForcage}.
        </p>
      ) : null}
      {c.echeancier ? (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold">Échéancier ({c.echeancier.length} tranches)</h3>
          <table className="w-full max-w-md border-collapse text-sm">
            <tbody>
              {c.echeancier.map((t) => (
                <tr key={t.numero} className="border-b border-bordure">
                  <td className="p-2">{t.numero}</td>
                  <td className="p-2">{formatDate(t.date)}</td>
                  <td className="p-2 text-right">{f(t.montant)}</td>
                </tr>
              ))}
              <tr className="bg-surface font-semibold">
                <td className="p-2" colSpan={2}>Somme (= TTC)</td>
                <td className="p-2 text-right">{f(c.echeancier.reduce((s, t) => s.plus(t.montant), x.totaux.arrondi.ttc.minus(x.totaux.arrondi.ttc)))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {c.assures.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Assurés</h2>
          <table className="w-full max-w-3xl border-collapse text-sm">
            <thead>
              <tr className="text-left text-zinc-600"><th className="p-1">N°</th><th className="p-1">Nom et prénoms</th><th className="p-1">Naissance</th><th className="p-1">Sexe</th><th className="p-1">Lien</th><th className="p-1">Formule</th></tr>
            </thead>
            <tbody>
              {c.assures.map((a) => (
                <tr key={a.ordre} className="border-t border-bordure">
                  <td className="p-1">{a.ordre}</td><td className="p-1">{a.nom_prenoms}</td><td className="p-1">{a.date_naissance || "—"}</td><td className="p-1">{a.sexe || "—"}</td><td className="p-1">{a.lien || "—"}</td><td className="p-1">{a.formule || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {Object.keys(c.risque).length > 0 ? (
        <p className="mt-4 text-sm">
          <strong>Risque :</strong> {Object.entries(c.risque).map(([k, v]) => `risque.${k} = ${v}`).join(" ; ")}
        </p>
      ) : null}

      <section className="mt-8 grid max-w-3xl gap-6">
        <p className="text-sm text-zinc-600">L'aperçu et l'émission du PDF (fusion du modèle Word) arrivent avec la phase 3 : la cotation est déjà numérotée et figée à l'émission.</p>

        {peutModifier(c.statut) && estAuteur && agit ? (
          <div className="flex flex-wrap items-start gap-4 rounded border border-bordure p-4">
            <Link href={`/cotations/${c.id}/modifier`} className="rounded border border-sim-bleu px-4 py-2 font-semibold text-sim-bleu hover:bg-surface">Modifier le brouillon</Link>
            <FormulaireAction action={soumettreCotation} libelleBouton="Soumettre (émettre)">
              <input type="hidden" name="id" value={c.id} />
              <p className="mb-2 text-sm text-zinc-700">Le calcul est refait avec les paramètres du jour. Sous le seuil et sans forçage, la cotation est émise tout de suite ; sinon elle passe « À valider ».</p>
            </FormulaireAction>
          </div>
        ) : null}

        {peutEtreValidee(c.statut) ? (
          <div className="rounded border border-bordure p-4">
            <h2 className="mb-2 font-semibold">Cotation à valider</h2>
            {estAuteur ? (
              <p className="mb-3 text-sm">Vous êtes l'auteur : un autre valideur (Technique ou Direction Générale) doit valider. Vous pouvez la renvoyer en brouillon pour la modifier.</p>
            ) : null}
            {peutValider(niveauForcage) && !estAuteur ? (
              <FormulaireAction action={validerCotation} libelleBouton="Valider et émettre" className="mb-4">
                <input type="hidden" name="id" value={c.id} />
              </FormulaireAction>
            ) : null}
            {estAuteur || peutValider(niveauForcage) ? (
              <FormulaireAction action={renvoyerCotation} libelleBouton="Renvoyer en brouillon" discret>
                <input type="hidden" name="id" value={c.id} />
                <label className="mb-3 block text-sm font-medium">
                  {estAuteur ? "Commentaire (facultatif)" : "Raison du renvoi (obligatoire)"}
                  <input name="commentaire" className={entree} autoComplete="off" />
                </label>
              </FormulaireAction>
            ) : (
              <p className="text-sm text-zinc-600">En attente de validation.</p>
            )}
          </div>
        ) : null}

        {peutAccepter(c.statutEffectif) && agit ? (
          <div className="grid gap-6 rounded border border-bordure p-4 sm:grid-cols-2">
            <FormulaireAction action={accepterCotation} libelleBouton="Accepter et créer la police">
              <input type="hidden" name="id" value={c.id} />
              <h2 className="mb-2 font-semibold">Le client accepte</h2>
              <p className="mb-2 text-sm text-zinc-700">Formule(s) retenue(s) :</p>
              {c.lignes.map((l) => (
                <label key={l.code} className="mb-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="retenue" value={l.code} defaultChecked /> {c.libelles[l.code] ?? l.code}
                </label>
              ))}
              <div className="mb-3" />
            </FormulaireAction>
            <FormulaireAction action={refuserCotation} libelleBouton="Enregistrer le refus" discret>
              <input type="hidden" name="id" value={c.id} />
              <h2 className="mb-2 font-semibold">Le client refuse</h2>
              <label className="mb-3 block text-sm font-medium">
                Motif (obligatoire)
                <select name="motif" defaultValue="" className={entree} required>
                  <option value="" disabled>— Choisir —</option>
                  {motifs.map((m) => (<option key={m.code} value={m.code}>{m.libelle}</option>))}
                </select>
              </label>
              <label className="mb-3 block text-sm font-medium">
                Commentaire
                <input name="commentaire" className={entree} autoComplete="off" />
              </label>
            </FormulaireAction>
          </div>
        ) : null}

        {c.statutEffectif === "EXPIREE" ? (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm">Cotation expirée : elle ne peut plus être acceptée ni transformée en police. Créez une nouvelle cotation.</p>
        ) : null}
      </section>
    </main>
  );
}
