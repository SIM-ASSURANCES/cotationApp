import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { BarreProgression, RafraichissementAuto } from "@/composants/RafraichissementAuto";
import { Bandeau, Carte, EnTetePage, LienBouton, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { lireLot, type VueLot } from "@/serveur/imports";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { abandonnerLImport, confirmerLImport, relancerLesEchecs } from "../actions";
import { LIBELLE_STATUT_LOT } from "../libelles";

const duree = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);
const heure = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Une ligne du tableau d'erreurs : une erreur de contrôle du fichier, ou un certificat en échec à la génération. */
type LigneErreur = { cle: string; numero: number; colonne: string; mono: boolean; valeur: string; message: string; echec: boolean };

const lignesDErreurs = (lot: VueLot): LigneErreur[] => [
  ...lot.lignesEnErreur.flatMap((l) =>
    l.erreurs.map((e, i) => ({ cle: `${l.numero}-${i}`, numero: l.numero, colonne: e.colonne, mono: true, valeur: e.valeur, message: e.message, echec: false })),
  ),
  ...lot.lignesEnEchec.map((l) => ({ cle: `echec-${l.numero}`, numero: l.numero, colonne: "certificat", mono: false, valeur: l.nom, message: `Génération en échec : ${l.erreur}`, echec: true })),
];

// Un certificat en échec garde le ton d'erreur de l'ancien affichage ; le libellé « Génération en échec » reste écrit dans le message.
const COLONNES_ERREURS: ColonneTableau<LigneErreur>[] = [
  { cle: "numero", entete: "Ligne", alignement: "droite", rendu: (l) => l.numero },
  { cle: "colonne", entete: "Colonne", rendu: (l) => (l.mono ? <span className="font-mono text-xs">{l.colonne}</span> : l.colonne) },
  { cle: "valeur", entete: "Valeur", rendu: (l) => l.valeur },
  { cle: "message", entete: "Message", className: "min-w-48", rendu: (l) => (l.echec ? <span className="text-danger">{l.message}</span> : l.message) },
];

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
    <main className="max-w-5xl space-y-6">
      <RafraichissementAuto actif={enCours} />
      <EnTetePage
        filAriane={[{ libelle: "Tous les imports", href: "/imports" }, { libelle: `Import n° ${lot.id}` }]}
        titre={`Import n° ${lot.id} : ${LIBELLE_STATUT_LOT[lot.statut]}`}
        sousTitre={`Fichier « ${lot.fichierNom} », déposé par ${lot.creePar} le ${heure(lot.creeLe)} ; incorporation au ${lot.dateEffet} dans la police mère ${lot.police.numero} (${lot.produitCode}).`}
        actions={
          <>
            <PastilleStatut libelle={LIBELLE_STATUT_LOT[lot.statut]} />
            <LienBouton href={`/cotations/${lot.police.cotationId}/adherents`}>Adhérents de la police {lot.police.numero}</LienBouton>
          </>
        }
      />

      <section aria-label="Résumé du contrôle" className="grid max-w-3xl grid-cols-3 gap-3 text-center">
        <Carte espacement="aucun" className="p-3">
          <div className="text-2xl font-semibold tabular-nums text-foreground">{lot.total}</div>
          <div className="text-sm text-muted-foreground">lignes lues</div>
        </Carte>
        <Carte espacement="aucun" className="p-3">
          <div className="text-2xl font-semibold tabular-nums text-success">{lot.valides}</div>
          <div className="text-sm text-muted-foreground">valides</div>
        </Carte>
        <Carte espacement="aucun" className="p-3">
          <div className="text-2xl font-semibold tabular-nums text-danger">{lot.erreurs}</div>
          <div className="text-sm text-muted-foreground">en erreur</div>
        </Carte>
      </section>

      {lot.statut === "CONTROLE" && agit ? (
        <Carte titre="Confirmer le traitement" className="max-w-3xl">
          {lot.valides > 0 ? (
            <p className="mb-4 text-sm text-foreground">
              Les <strong>{lot.valides}</strong> lignes valides seront incorporées à la police en <strong>une seule</strong> nouvelle version de la liste, puis
              un certificat d'adhésion sera produit pour chacune. {lot.erreurs > 0 ? `Les ${lot.erreurs} lignes en erreur ne seront pas traitées : corrigez-les et déposez-les dans un autre fichier.` : ""}
            </p>
          ) : (
            <p className="mb-4 text-sm text-foreground">Aucune ligne valide : corrigez le fichier d'après le rapport et déposez-le de nouveau.</p>
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
        </Carte>
      ) : null}

      {lot.statut === "EN_COURS" || lot.statut === "TERMINE" ? (
        <Carte titre={enCours ? "Avancement" : "Récapitulatif"} className="max-w-3xl">
          <BarreProgression faits={lot.produits + (enCours ? 0 : lot.echecs)} total={lot.valides} libelle="Certificats traités" />
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            <li>{lot.produits} certificat(s) d'adhésion émis{lot.versionAdherents ? `, adhérents incorporés dans la version ${lot.versionAdherents} de la liste` : ""} ;</li>
            <li>{lot.erreurs} ligne(s) en erreur au contrôle, non traitées ;</li>
            {lot.echecs > 0 ? <li className="text-danger">{lot.echecs} certificat(s) en échec à la génération (voir plus bas) ;</li> : null}
            {lot.confirmePar ? <li>confirmé par {lot.confirmePar}{lot.debut ? `, traitement commencé le ${heure(lot.debut)}` : ", en attente du travailleur"} ;</li> : null}
            {lot.dureeSecondes !== null ? <li>durée du traitement : {duree(lot.dureeSecondes)}.</li> : null}
          </ul>
          {enCours ? <p className="mt-3 text-sm text-muted-foreground">Vous pouvez quitter cette page et continuer à travailler : le traitement se poursuit en tâche de fond.</p> : null}
          {lot.enAttenteEcriture > 0 ? (
            <Bandeau ton="avertissement" className="mt-3">
              {lot.enAttenteEcriture} certificat(s) émis attendent encore le stockage : ils sont téléchargeables un par un, mais absents de l'archive.
            </Bandeau>
          ) : null}
          {lot.derniereErreur ? (
            <Bandeau ton="avertissement" className="mt-3">
              {lot.derniereErreur}
            </Bandeau>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {lot.zip ? <a href={`/api/imports/${lot.id}/zip`} className="text-primary underline">Télécharger l'archive ZIP des certificats ({Math.round(lot.zip.taille / 1024)} Ko)</a> : null}
            <Link href={`/documents?police=${encodeURIComponent(lot.police.numero)}&type=CERTIFICAT`} className="text-primary underline">Voir les certificats dans « Documents émis »</Link>
          </div>
          {lot.statut === "TERMINE" && lot.echecs > 0 && agit ? (
            <div className="mt-4">
              <FormulaireAction action={relancerLesEchecs} libelleBouton="Relancer les certificats en échec" discret>
                <input type="hidden" name="lotId" value={lot.id} />
              </FormulaireAction>
            </div>
          ) : null}
        </Carte>
      ) : null}

      {lot.erreurs > 0 || lot.echecs > 0 ? (
        <Carte titre="Erreurs">
          <p className="mb-4 text-sm text-foreground">
            <a href={`/api/imports/${lot.id}/rapport`} className="text-primary underline">Télécharger le rapport d'erreurs (.xlsx)</a> : numéro de ligne du fichier, colonne, valeur et message.
          </p>
          <Tableau colonnes={COLONNES_ERREURS} lignes={lignesDErreurs(lot)} cleLigne={(l) => l.cle} messageVide="Aucune ligne à afficher." legende="Lignes en erreur de l'import" />
          {lot.erreurs > lot.lignesEnErreur.length ? <p className="mt-2 text-xs text-muted-foreground">Les 200 premières lignes en erreur sont affichées ; le rapport les contient toutes.</p> : null}
        </Carte>
      ) : null}
    </main>
  );
}
