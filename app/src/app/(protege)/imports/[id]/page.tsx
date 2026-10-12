import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { BarreProgression, RafraichissementAuto } from "@/composants/RafraichissementAuto";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { lireLot } from "@/serveur/imports";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { abandonnerLImport, confirmerLImport, relancerLesEchecs } from "../actions";
import { LIBELLE_STATUT_LOT } from "../libelles";

const duree = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);
const heure = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Écran de contrôle, puis d'avancement, puis de résultat d'un import en masse (CDC §13). */
export default async function PageImport(props: PageProps<"/imports/[id]">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let lot;
  try {
    lot = Number.isInteger(Number(id)) ? await lireLot(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!lot) notFound();
  const agit = peutAgir(await niveauDuProfil(utilisateur.profil, "EMETTRE_CONTRAT"));
  const enCours = lot.statut === "EN_COURS";

  return (
    <main className="max-w-5xl">
      <RafraichissementAuto actif={enCours} />
      <p className="mb-2 text-sm">
        <Link href={`/cotations/${lot.police.cotationId}/adherents`} className="text-primary underline">← Adhérents de la police {lot.police.numero}</Link>
        {" · "}
        <Link href="/imports" className="text-primary underline">Tous les imports</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-primary">Import n° {lot.id} : {LIBELLE_STATUT_LOT[lot.statut]}</h1>
      <p className="mb-6 text-sm text-neutral">
        Fichier « {lot.fichierNom} », déposé par {lot.creePar} le {heure(lot.creeLe)} ; incorporation au {lot.dateEffet} dans la police mère {lot.police.numero} ({lot.produitCode}).
      </p>

      <section className="mb-6 grid max-w-3xl grid-cols-3 gap-3 text-center">
        <div className="rounded border border-border p-3"><div className="text-2xl font-semibold">{lot.total}</div><div className="text-sm">lignes lues</div></div>
        <div className="rounded border border-border p-3"><div className="text-2xl font-semibold text-success">{lot.valides}</div><div className="text-sm">valides</div></div>
        <div className="rounded border border-border p-3"><div className="text-2xl font-semibold text-danger">{lot.erreurs}</div><div className="text-sm">en erreur</div></div>
      </section>

      {lot.statut === "CONTROLE" && agit ? (
        <section className="mb-6 max-w-3xl rounded border border-primary p-4">
          <h2 className="mb-2 text-lg font-semibold">Confirmer le traitement</h2>
          {lot.valides > 0 ? (
            <p className="mb-3 text-sm">
              Les <strong>{lot.valides}</strong> lignes valides seront incorporées à la police en <strong>une seule</strong> nouvelle version de la liste, puis
              un certificat d'adhésion sera produit pour chacune. {lot.erreurs > 0 ? `Les ${lot.erreurs} lignes en erreur ne seront pas traitées : corrigez-les et déposez-les dans un autre fichier.` : ""}
            </p>
          ) : (
            <p className="mb-3 text-sm">Aucune ligne valide : corrigez le fichier d'après le rapport et déposez-le de nouveau.</p>
          )}
          <div className="flex flex-wrap gap-4">
            {lot.valides > 0 ? (
              <FormulaireAction action={confirmerLImport} libelleBouton={`Traiter les ${lot.valides} lignes valides`}>
                <input type="hidden" name="lotId" value={lot.id} />
              </FormulaireAction>
            ) : null}
            <FormulaireAction action={abandonnerLImport} libelleBouton="Abandonner cet import" discret>
              <input type="hidden" name="lotId" value={lot.id} />
            </FormulaireAction>
          </div>
        </section>
      ) : null}

      {lot.statut === "EN_COURS" || lot.statut === "TERMINE" ? (
        <section className="mb-6 max-w-3xl rounded border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">{enCours ? "Avancement" : "Récapitulatif"}</h2>
          <BarreProgression faits={lot.produits + (enCours ? 0 : lot.echecs)} total={lot.valides} libelle="Certificats traités" />
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{lot.produits} certificat(s) d'adhésion émis{lot.versionAdherents ? `, adhérents incorporés dans la version ${lot.versionAdherents} de la liste` : ""} ;</li>
            <li>{lot.erreurs} ligne(s) en erreur au contrôle, non traitées ;</li>
            {lot.echecs > 0 ? <li className="text-danger">{lot.echecs} certificat(s) en échec à la génération (voir plus bas) ;</li> : null}
            {lot.confirmePar ? <li>confirmé par {lot.confirmePar}{lot.debut ? `, traitement commencé le ${heure(lot.debut)}` : ", en attente du travailleur"} ;</li> : null}
            {lot.dureeSecondes !== null ? <li>durée du traitement : {duree(lot.dureeSecondes)}.</li> : null}
          </ul>
          {enCours ? <p className="mt-2 text-sm text-neutral">Vous pouvez quitter cette page et continuer à travailler : le traitement se poursuit en tâche de fond.</p> : null}
          {lot.enAttenteEcriture > 0 ? (
            <p className="mt-2 text-sm text-warning">{lot.enAttenteEcriture} certificat(s) émis attendent encore le stockage : ils sont téléchargeables un par un, mais absents de l'archive.</p>
          ) : null}
          {lot.derniereErreur ? <p className="mt-2 text-sm text-warning">{lot.derniereErreur}</p> : null}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {lot.zip ? <a href={`/api/imports/${lot.id}/zip`} className="text-primary underline">Télécharger l'archive ZIP des certificats ({Math.round(lot.zip.taille / 1024)} Ko)</a> : null}
            <Link href={`/documents?police=${encodeURIComponent(lot.police.numero)}&type=CERTIFICAT`} className="text-primary underline">Voir les certificats dans « Documents émis »</Link>
          </div>
          {lot.statut === "TERMINE" && lot.echecs > 0 && agit ? (
            <div className="mt-3">
              <FormulaireAction action={relancerLesEchecs} libelleBouton="Relancer les certificats en échec" discret>
                <input type="hidden" name="lotId" value={lot.id} />
              </FormulaireAction>
            </div>
          ) : null}
        </section>
      ) : null}

      {lot.erreurs > 0 || lot.echecs > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Erreurs</h2>
          <p className="mb-2 text-sm">
            <a href={`/api/imports/${lot.id}/rapport`} className="text-primary underline">Télécharger le rapport d'erreurs (.xlsx)</a> : numéro de ligne du fichier, colonne, valeur et message.
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Ligne</th><th className="p-2">Colonne</th><th className="p-2">Valeur</th><th className="p-2">Message</th></tr>
            </thead>
            <tbody>
              {lot.lignesEnErreur.flatMap((l) =>
                l.erreurs.map((e, i) => (
                  <tr key={`${l.numero}-${i}`} className="border-b border-border align-top">
                    <td className="p-2">{l.numero}</td><td className="p-2 font-mono text-xs">{e.colonne}</td><td className="p-2">{e.valeur}</td><td className="p-2">{e.message}</td>
                  </tr>
                )),
              )}
              {lot.lignesEnEchec.map((l) => (
                <tr key={`echec-${l.numero}`} className="border-b border-border align-top text-danger">
                  <td className="p-2">{l.numero}</td><td className="p-2">certificat</td><td className="p-2">{l.nom}</td><td className="p-2">Génération en échec : {l.erreur}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lot.erreurs > lot.lignesEnErreur.length ? <p className="mt-1 text-xs text-neutral">Les 200 premières lignes en erreur sont affichées ; le rapport les contient toutes.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
