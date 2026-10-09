import Link from "next/link";
import { notFound } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { LignesAssures } from "@/composants/LignesDynamiques";
import { TachesPolice } from "@/composants/TachesPolice";
import { LIBELLE_MOTIF_ADHERENTS } from "@/domaine/cotation/adherents";
import { numeroCertificatParDefaut, racineCertificat } from "@/domaine/cotation/police";
import { peutAgir, peutLire } from "@/domaine/droits";
import { lireAdherents, policeDeCotation } from "@/serveur/adherents";
import { listerLots } from "@/serveur/imports";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";
import { tachesDePolice } from "@/serveur/taches-police";

import { LIBELLE_STATUT_LOT } from "../../../imports/libelles";
import { controlerLeFichier, emettreLeCertificat, incorporerLesAdherents, mettreAJourLesCp, retirerLesAdherents } from "./actions";

const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";

export default async function PageAdherents(props: PageProps<"/cotations/[id]/adherents">) {
  const { id } = await props.params;
  const utilisateur = await exigerDroit("EMETTRE_CONTRAT", peutLire);
  const cotationId = Number(id);
  const policeId = Number.isInteger(cotationId) ? await policeDeCotation(utilisateur, cotationId) : null;
  const vue = policeId === null ? null : await lireAdherents(utilisateur, policeId);
  if (!vue || policeId === null) notFound();
  const agit = peutAgir(await niveauDuProfil(utilisateur.profil, "EMETTRE_CONTRAT"));
  const derniere = vue.versions[vue.versions.length - 1];
  const cpAJour = vue.cp !== null && vue.cp.versionAdherents === derniere?.numero;
  const [lots, taches] = await Promise.all([listerLots(utilisateur, { policeId }), tachesDePolice(utilisateur, policeId)]);
  const produitCode = vue.police.produitCode;

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href={`/cotations/${cotationId}`} className="text-sim-bleu underline">← Cotation</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Adhérents de la police mère {vue.police.numero}</h1>
      <p className="mb-6 text-sm text-zinc-700">
        Période de la police : du {vue.police.dateEffet} au {vue.police.dateEcheance}. La liste évolue par versions : chaque incorporation ou retrait crée une nouvelle version,
        l'historique reste consultable. Les conditions particulières de la police mère reprennent la liste courante en annexe.
      </p>
      <TachesPolice taches={taches} cotationId={cotationId} />

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Liste courante ({vue.courants.length} adhérents, version {derniere?.numero ?? "—"})</h2>
        <FormulaireAction action={retirerLesAdherents} libelleBouton="Retirer les adhérents cochés" discret>
          <input type="hidden" name="cotationId" value={cotationId} />
          <input type="hidden" name="policeId" value={policeId} />
          <div className="mb-3 overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="bg-sim-bleu text-left text-white">
                  {agit ? <th className="p-2">Retrait</th> : null}
                  <th className="p-2">N°</th><th className="p-2">Nom et prénoms</th><th className="p-2">Naissance</th><th className="p-2">Sexe</th><th className="p-2">Lien</th><th className="p-2">Formule</th><th className="p-2">Certificat</th>
                </tr>
              </thead>
              <tbody>
                {vue.courants.map((a) => {
                  const certificat = vue.certificats[a.ordre];
                  return (
                    <tr key={a.ordre} className="border-b border-bordure">
                      {agit ? <td className="p-2"><input type="checkbox" name="retrait" value={a.ordre} aria-label={`Retirer l'adhérent ${a.ordre}`} /></td> : null}
                      <td className="p-2">{a.ordre}</td><td className="p-2">{a.nom_prenoms}</td><td className="p-2">{a.date_naissance || "—"}</td><td className="p-2">{a.sexe || "—"}</td><td className="p-2">{a.lien || "—"}</td><td className="p-2">{a.formule || "—"}</td>
                      <td className="p-2">{certificat ? <a href={`/api/documents/${certificat.id}`} className="text-sim-bleu underline">{certificat.numero} (v{certificat.version})</a> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {agit ? <Champ nom="dateEffet" libelle="Date d'effet du retrait (AAAA-MM-JJ)" autoComplete="off" valeur={derniere?.dateEffet} /> : null}
        </FormulaireAction>
      </section>

      {agit ? (
        <section className="mb-8 max-w-5xl rounded border border-bordure p-4">
          <h2 className="mb-2 text-lg font-semibold">Incorporer des adhérents</h2>
          <FormulaireAction action={incorporerLesAdherents} libelleBouton="Incorporer">
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <LignesAssures initiales={[{ nom: "", naissance: "", sexe: "", lien: "", formule: "" }]} formules={vue.formules.map((code) => ({ code, libelle: code }))} />
            <div className="max-w-xs">
              <Champ nom="dateEffet" libelle="Date d'effet de l'incorporation (AAAA-MM-JJ)" autoComplete="off" valeur={derniere?.dateEffet} />
            </div>
          </FormulaireAction>
        </section>
      ) : null}

      {agit ? (
        <section className="mb-8 max-w-3xl rounded border border-bordure p-4">
          <h2 className="mb-2 text-lg font-semibold">Import en masse (fichier Excel ou CSV)</h2>
          <p className="mb-3 text-sm text-zinc-700">
            Une ligne par adhérent. La colonne du numéro de certificat peut rester vide : le numéro proposé est alors la racine de la police mère suivie du numéro d'ordre de l'adhérent sur 5 chiffres. Le fichier est d'abord <strong>contrôlé</strong> : rien n'est créé avant votre
            confirmation sur l'écran de contrôle. Les lignes valides deviennent alors <strong>une seule</strong> incorporation, et un certificat
            d'adhésion est produit pour chacune, en tâche de fond.{" "}
            <a href={`/api/imports/modele?produit=${encodeURIComponent(produitCode)}`} className="text-sim-bleu underline">
              Télécharger le fichier modèle ({produitCode})
            </a>
          </p>
          <FormulaireAction action={controlerLeFichier} libelleBouton="Contrôler le fichier">
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <label className="mb-4 block text-sm font-medium">
              Fichier des adhérents (.xlsx ou .csv, 10 Mo au plus)
              <input name="fichier" type="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="mt-1 block w-full text-base" />
            </label>
            <div className="max-w-xs">
              <Champ nom="dateEffet" libelle="Date d'effet de l'incorporation (AAAA-MM-JJ)" autoComplete="off" valeur={derniere?.dateEffet} />
            </div>
          </FormulaireAction>
          {lots.length > 0 ? (
            <table className="mt-4 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-zinc-600"><th className="p-1">Import</th><th className="p-1">Fichier</th><th className="p-1">Lignes</th><th className="p-1">En erreur</th><th className="p-1">État</th></tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id} className="border-t border-bordure">
                    <td className="p-1"><Link href={`/imports/${l.id}`} className="text-sim-bleu underline">n° {l.id}</Link></td>
                    <td className="p-1">{l.fichierNom}</td><td className="p-1">{l.total}</td><td className="p-1">{l.erreurs}</td><td className="p-1">{LIBELLE_STATUT_LOT[l.statut]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      <section className="mb-8 max-w-3xl rounded border border-bordure p-4">
        <h2 className="mb-2 text-lg font-semibold">Conditions particulières de la police mère</h2>
        {vue.cp === null ? (
          <p className="text-sm text-zinc-700">Pas encore émises : depuis la fiche de la cotation, émettez-les ; la liste courante sera en annexe.</p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              Dernière édition : version {vue.cp.version}, avec la version {vue.cp.versionAdherents ?? "?"} de la liste. {cpAJour ? "Elle est à jour." : "La liste a changé depuis : une nouvelle version est nécessaire."}
            </p>
            {!cpAJour && agit ? (
              <FormulaireAction action={mettreAJourLesCp} libelleBouton="Émettre une nouvelle version des CP (annexe à jour)">
                <input type="hidden" name="cotationId" value={cotationId} />
                <input type="hidden" name="policeId" value={policeId} />
              </FormulaireAction>
            ) : null}
          </>
        )}
      </section>

      {agit ? (
        <section className="mb-8 max-w-3xl rounded border border-bordure p-4">
          <h2 className="mb-2 text-lg font-semibold">Certificat d'adhésion (unitaire)</h2>
          <p className="mb-3 text-sm text-zinc-700">
            Un certificat par adhérent, avec son propre numéro et son propre QR code. Le numéro reprend la racine de la police mère ({racineCertificat(vue.police.numero) ?? "aucune : le numéro de la police ne se termine pas par G ou I et 5 chiffres"}) suivie du
            numéro personnel de l'adhérent sur 5 chiffres. Laissé vide, c'est son numéro d'ordre (proposé dans la liste) ; vous pouvez en saisir un autre. Pour de nombreux adhérents : l'import en masse ci-dessus.
          </p>
          <FormulaireAction action={emettreLeCertificat} libelleBouton="Émettre le certificat" discret>
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <label className="mb-3 block text-sm font-medium">
              Adhérent
              <select name="ordre" required defaultValue="" className={entree}>
                <option value="" disabled>— Choisir —</option>
                {vue.courants.filter((a) => !vue.certificats[a.ordre]).map((a) => (<option key={a.ordre} value={a.ordre}>{a.ordre} — {a.nom_prenoms} (proposé : {numeroCertificatParDefaut(vue.police.numero, a.ordre) ?? "à saisir"})</option>))}
              </select>
            </label>
            <Champ nom="numero" libelle="Numéro du certificat (vide : numéro proposé)" autoComplete="off" requis={false} />
          </FormulaireAction>
        </section>
      ) : null}

      <section className="max-w-3xl">
        <h2 className="mb-2 text-lg font-semibold">Historique des versions</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-zinc-600"><th className="p-1">Version</th><th className="p-1">Changement</th><th className="p-1">Prend effet le</th><th className="p-1">Adhérents concernés</th><th className="p-1">Total</th><th className="p-1">Par</th></tr>
          </thead>
          <tbody>
            {[...vue.versions].reverse().map((v) => (
              <tr key={v.numero} className="border-t border-bordure">
                <td className="p-1">{v.numero}</td><td className="p-1">{LIBELLE_MOTIF_ADHERENTS[v.motif]}</td><td className="p-1">{v.dateEffet}</td><td className="p-1">{v.concernes.length > 0 ? v.concernes.join(", ") : "—"}</td><td className="p-1">{v.adherents.length}</td><td className="p-1">{v.creePar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
