import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AvertissementsReports } from "@/composants/AvertissementsReports";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, Champ as ChampSaisie, EnTetePage, ListeDefinitions, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau, type ElementDefinition } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { CANAUX_PAIEMENT, LIBELLE_CANAL, LONGUEUR_MIN_MOTIF_ABANDON, LONGUEUR_MIN_MOTIF_AVOIR } from "@/domaine/facturation/factures";
import { aujourdhui } from "@/serveur/parametrage";
import { lireFacture } from "@/serveur/factures";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { abandonnerLaFacture, emettreLAvoir, emettreLaFacture, enregistrerLePaiement, imputerLAvance, modifierLaFacture, relancerLesPdf } from "../actions";

const f = (m: string) => formaterMontant(montant(m));

/** Ligne des tableaux de montants : les lignes de détail, puis une ligne « Total » (en gras, sans zébrure propre). */
type LigneMontant = { cle: string; total: boolean };
type LigneGarantie = LigneMontant & { libelle: string; branche: string; montantGaranti: string; nette: string; accessoires: string; taux: string; taxe: string; ttc: string };
type LigneFormule = LigneMontant & { libelle: string; effectif: number | null; nette: string; accessoires: string; taxe: string; ttc: string };

/** Contenu d'une cellule de tableau de montants : en gras sur la ligne « Total ». */
const cellule = (ligne: LigneMontant, contenu: ReactNode) => <span className={ligne.total ? "font-semibold" : undefined}>{contenu}</span>;

export default async function PageFacture(props: PageProps<"/factures/[id]">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let x;
  try {
    x = Number.isInteger(Number(id)) ? await lireFacture(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!x) notFound();
  const c = x.contenu;
  const cache = <input type="hidden" name="factureId" value={x.id} />;
  const titre = x.numero ?? `Brouillon n° ${x.id}`;
  const avoir = x.type === "AVOIR";

  // Fiche d'en-tête : les lignes conditionnelles gardent exactement la condition d'affichage d'avant la refonte.
  const fiche: ElementDefinition[] = [
    {
      libelle: "Statut",
      valeur: (
        <>
          <PastilleStatut libelle={x.libelleStatut} />
          {x.avoir ? <> par l&apos;avoir <Link href={`/factures/${x.avoir.id}`} className="text-primary underline">{x.avoir.numero}</Link></> : null}
        </>
      ),
    },
    { libelle: "Police", valeur: `${x.policeNumero} (${x.produitCode})` },
    { libelle: "Facturé à", valeur: `${x.souscripteur}${c.souscripteur.adresse ? `, ${c.souscripteur.adresse}` : ""}` },
    { libelle: "Envoyé à", valeur: c.envoyeA ? `${c.envoyeA.nom}, ${c.envoyeA.adresse}` : "— (identique ou non saisi : bloc masqué)" },
    { libelle: "Période", valeur: `du ${c.dateEffet} au ${c.dateEcheance} (${c.joursCouverts} jours)` },
    { libelle: "Émise le", valeur: `${x.dateEmission ?? "—"}${x.emisePar ? ` par ${x.emisePar}` : ""}` },
    { libelle: "Préparée par", valeur: x.creePar },
    ...(x.factureOrigine ? [{ libelle: "Facture annulée", valeur: <Link href={`/factures/${x.factureOrigine.id}`} className="text-primary underline">{x.factureOrigine.numero}</Link> }] : []),
    ...(x.motif ? [{ libelle: "Motif de l'avoir", valeur: x.motif }] : []),
    ...(x.remplace ? [{ libelle: "Remplace", valeur: <><Link href={`/factures/${x.remplace.id}`} className="text-primary underline">{x.remplace.numero}</Link> (annulée)</> }] : []),
    ...(x.remplacante
      ? [{ libelle: "Remplacée par", valeur: <><Link href={`/factures/${x.remplacante.id}`} className="text-primary underline">{x.remplacante.numero ?? "brouillon"}</Link> ({x.remplacante.statut})</> }]
      : []),
  ];

  const modeGaranties = Boolean(c.garanties && c.garanties.length > 0);
  const lignesGaranties: LigneGarantie[] = (c.garanties ?? []).map((g, i) => ({
    cle: `g${i}`,
    total: false,
    libelle: g.libelle,
    branche: g.branche,
    montantGaranti: g.montantGaranti != null ? f(g.montantGaranti) : "—",
    nette: g.nette,
    accessoires: g.accessoires,
    taux: `${montant(g.tauxTaxe).toString().replace(".", ",")} %`,
    taxe: g.taxe,
    ttc: g.ttc,
  }));
  if (modeGaranties) lignesGaranties.push({ cle: "total", total: true, libelle: "Total", branche: "", montantGaranti: "", nette: c.totaux.nette, accessoires: c.totaux.accessoires, taux: "", taxe: c.totaux.taxe, ttc: c.totaux.ttc });
  const colonnesGaranties: ColonneTableau<LigneGarantie>[] = [
    { cle: "garantie", entete: "Garantie", rendu: (l) => cellule(l, l.libelle) },
    { cle: "branche", entete: "Catégorie de taxe", rendu: (l) => cellule(l, l.branche) },
    { cle: "montantGaranti", entete: "Montant garanti", alignement: "droite", rendu: (l) => cellule(l, l.montantGaranti) },
    { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => cellule(l, f(l.nette)) },
    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => cellule(l, f(l.accessoires)) },
    { cle: "taux", entete: "Taux", alignement: "droite", rendu: (l) => cellule(l, l.taux) },
    { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => cellule(l, f(l.taxe)) },
    { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (l) => cellule(l, f(l.ttc)) },
  ];

  const lignesFormules: LigneFormule[] = [
    ...c.formules.map((l) => ({ cle: l.code, total: false, libelle: l.libelle, effectif: l.effectif, nette: l.nette, accessoires: l.accessoires, taxe: l.taxe, ttc: l.ttc })),
    { cle: "total", total: true, libelle: "Total", effectif: null, nette: c.totaux.nette, accessoires: c.totaux.accessoires, taxe: c.totaux.taxe, ttc: c.totaux.ttc },
  ];
  const colonnesFormules: ColonneTableau<LigneFormule>[] = [
    { cle: "formule", entete: "Formule", rendu: (l) => cellule(l, l.libelle) },
    { cle: "effectif", entete: "Effectif", alignement: "droite", rendu: (l) => cellule(l, l.effectif) },
    { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => cellule(l, f(l.nette)) },
    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => cellule(l, f(l.accessoires)) },
    { cle: "taxe", entete: `Taxe (${c.taxe.tauxPourcent !== null ? `${c.taxe.tauxPourcent} %` : "plusieurs taux"})`, alignement: "droite", rendu: (l) => cellule(l, f(l.taxe)) },
    { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (l) => cellule(l, f(l.ttc)) },
  ];

  type Echeance = NonNullable<typeof x.etat>["echeances"][number];
  const colonnesEcheances: ColonneTableau<Echeance>[] = [
    { cle: "numero", entete: "Échéance", rendu: (e) => e.numero },
    { cle: "date", entete: "Date", rendu: (e) => e.date },
    { cle: "montant", entete: "Montant", alignement: "droite", rendu: (e) => f(e.montant) },
    { cle: "paye", entete: "Payé", alignement: "droite", rendu: (e) => f(e.paye) },
    { cle: "restant", entete: "Restant", alignement: "droite", rendu: (e) => f(e.restant) },
    { cle: "statut", entete: "Statut", rendu: (e) => <PastilleStatut libelle={e.statut} /> },
  ];

  // L'indice sert de clé : une imputation d'avance n'a ni reçu, et peut partager date et montant avec un autre paiement.
  type Paiement = NonNullable<typeof x.etat>["paiements"][number];
  const lignesPaiements = (x.etat?.paiements ?? []).map((p, i) => ({ p, i }));
  const colonnesPaiements: ColonneTableau<{ p: Paiement; i: number }>[] = [
    { cle: "recu", entete: "Reçu", rendu: ({ p }) => p.numero || "—" },
    { cle: "date", entete: "Date", rendu: ({ p }) => p.date },
    {
      cle: "montant",
      entete: "Montant",
      alignement: "droite",
      rendu: ({ p }) => (
        <>
          {f(p.montant)}
          {p.excedent && montant(p.excedent).greaterThan(0) ? <span className="block text-xs text-neutral">dont {f(p.excedent)} F en avance</span> : null}
        </>
      ),
    },
    { cle: "canal", entete: "Canal", rendu: ({ p }) => LIBELLE_CANAL[p.canal] },
    { cle: "reference", entete: "Référence", rendu: ({ p }) => p.reference || "—" },
    { cle: "payeur", entete: "Payeur", rendu: ({ p }) => p.payeur || "—" },
    { cle: "restantApres", entete: "Restant dû après", alignement: "droite", rendu: ({ p }) => f(p.restantDu) },
  ];

  type DocumentFacture = (typeof x.documents)[number];
  const colonnesDocuments: ColonneTableau<DocumentFacture>[] = [
    { cle: "document", entete: "Document", rendu: (d) => `${d.type === "RECU" ? "Reçu" : d.type === "AVOIR" ? "Avoir" : "Facture"} ${d.numero}` },
    { cle: "version", entete: "Version", rendu: (d) => `v${d.version}` },
    {
      cle: "fichier",
      entete: "Fichier",
      rendu: (d) => (d.documentId ? <a href={`/api/documents/${d.documentId}`} className="text-primary underline">télécharger le PDF</a> : <PastilleStatut libelle="PDF en attente" />),
    },
  ];

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`${x.libelleType} ${titre}`}
        filAriane={[{ libelle: `Factures de la police ${x.policeNumero}`, href: `/cotations/${x.cotationId}/factures` }, { libelle: titre }]}
      />

      {x.abandon || x.statut === "A_VALIDER" || x.pdfEnAttente > 0 ? (
        <div className="space-y-4">
          {x.abandon ? (
            <Bandeau ton="neutre" role="status">
              <strong>Brouillon abandonné</strong> par {x.abandon.par} le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(x.abandon.le)}. Motif : {x.abandon.motif}. L&apos;abandon est définitif et aucun numéro n&apos;a été consommé ;
              une nouvelle facture peut être préparée pour la même période.
            </Bandeau>
          ) : null}
          {x.statut === "A_VALIDER" ? (
            <Bandeau ton="avertissement">
              <strong>À valider :</strong> TTC {f(x.ttc)} F au-dessus du seuil du produit ({x.seuil ? f(x.seuil) : "?"} F). Demande de {x.demandePar}. Un profil habilité, autre que le demandeur, émet la facture (CDC §4.1).
            </Bandeau>
          ) : null}
          {x.pdfEnAttente > 0 ? (
            <Bandeau ton="avertissement">
              <p className="mb-2"><strong>PDF en attente :</strong> le numéro est attribué et la facture est {avoir ? "émise" : x.libelleStatut.toLowerCase()} ; seul le fichier PDF reste à produire, à l&apos;identique.</p>
              <ul className="mb-2 list-disc pl-5">
                {x.documents.filter((d) => d.statut === "EN_ATTENTE").map((d) => <li key={`${d.numero}-${d.version}`}>{d.numero} version {d.version} : {d.tentatives} essai(s), {d.derniereErreur ?? "pas encore tenté"}</li>)}
              </ul>
              <FormulaireAction action={relancerLesPdf} libelleBouton="Relancer la production des PDF">{cache}</FormulaireAction>
            </Bandeau>
          ) : null}
        </div>
      ) : null}

      <Carte>
        <ListeDefinitions elements={fiche} />
      </Carte>

      <Carte titre="Montants (moteur de calcul)">
        {modeGaranties ? (
          <Tableau colonnes={colonnesGaranties} lignes={lignesGaranties} cleLigne={(l) => l.cle} legende="Montants par garantie" />
        ) : (
          <Tableau colonnes={colonnesFormules} lignes={lignesFormules} cleLigne={(l) => l.cle} legende="Montants par formule" />
        )}
      </Carte>

      {x.etat ? (
        <Carte titre="Échéances et paiements">
          <div className="space-y-4">
            <p className="text-sm">
              <strong>Payé :</strong> {f(x.etat.totalPaye)} F — <strong>Restant dû :</strong> {f(x.etat.restantDu)} F
              {montant(x.avance.disponible).greaterThan(0) ? <> — <strong>Avance de la police :</strong> {f(x.avance.disponible)} F (<Link href={`/cotations/${x.cotationId}/factures#avance`} className="text-primary underline">détail</Link>)</> : null}
            </p>
            {x.etat.echeances.length > 0 ? <Tableau colonnes={colonnesEcheances} lignes={x.etat.echeances} cleLigne={(e) => String(e.numero)} legende="Échéances" /> : null}
            <Tableau colonnes={colonnesPaiements} lignes={lignesPaiements} cleLigne={({ i }) => String(i)} messageVide="Aucun paiement." legende="Paiements" />
            {x.remplace ? <p className="text-sm text-neutral">Les paiements de la facture annulée {x.remplace.numero} sont repris ici à l&apos;émission (leurs reçus restent valables).</p> : null}
            {x.reports.length > 0 ? (
              <p className="text-sm text-neutral">
                Sommes reportées en avance sur la police à l&apos;annulation : {x.reports.map((r) => `${f(r.montant)} F (${r.recu ?? "avance"}, ${r.date})`).join(" ; ")}. La facture de remplacement les reprend à son émission.
              </p>
            ) : null}
          </div>
        </Carte>
      ) : null}

      {x.documents.length > 0 ? (
        <Carte titre="Documents">
          <Tableau colonnes={colonnesDocuments} lignes={x.documents} cleLigne={(d) => `${d.numero}-${d.version}`} legende="Documents de la facture" />
        </Carte>
      ) : null}

      <div className="grid max-w-3xl gap-6">
        {x.actions.modifier ? (
          <Carte titre="Modifier le brouillon">
            <FormulaireAction action={modifierLaFacture} libelleBouton="Enregistrer" discret>
              {cache}
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <ChampSaisie label="« Envoyé à » : destinataire" name="envoyeNom" defaultValue={c.envoyeA?.nom ?? ""} />
                <ChampSaisie label="Adresse" name="envoyeAdresse" defaultValue={c.envoyeA?.adresse ?? ""} />
              </div>
              {x.type === "RENOUVELLEMENT" ? (
                <>
                  {c.formules.map((l) => (
                    <div key={l.code} className="mb-2">
                      <input type="hidden" name="formule_code" value={l.code} />
                      <ChampSaisie label={`Effectif ${l.libelle}`} name="formule_effectif" type="number" min={1} defaultValue={l.effectif} />
                    </div>
                  ))}
                  <div className="mb-3">
                    <ChampSaisie label="Nombre de tranches" name="nombreTranches" type="number" min={1} defaultValue={Math.max(1, c.echeances.length)} />
                  </div>
                </>
              ) : null}
            </FormulaireAction>
          </Carte>
        ) : null}

        {x.actions.abandonner ? (
          <Carte
            titre="Abandonner le brouillon"
            description={
              <>
                Le brouillon passe au statut « Abandonnée », définitivement : aucun numéro n&apos;est consommé, la place de la facture se libère (une nouvelle facture peut être préparée pour la même
                période). Le motif est obligatoire ({LONGUEUR_MIN_MOTIF_ABANDON} caractères au moins) et l&apos;abandon est journalisé.
              </>
            }
          >
            <FormulaireAction action={abandonnerLaFacture} libelleBouton="Abandonner le brouillon" discret>
              {cache}
              <Champ nom="motif" libelle="Motif de l'abandon (obligatoire)" autoComplete="off" />
            </FormulaireAction>
          </Carte>
        ) : null}

        {x.actions.emettre ? (
          <Carte
            titre="Émettre"
            description={
              x.actions.emettreSousSeuil
                ? `Le TTC dépasse le seuil du produit (${x.seuil ? f(x.seuil) : "?"} F) : votre demande passera « À valider ».`
                : "Le numéro FAC est attribué maintenant ; la facture ne se modifiera plus."
            }
          >
            <FormulaireAction action={emettreLaFacture} libelleBouton={x.actions.emettreSousSeuil ? "Demander la validation" : "Émettre la facture"}>{cache}</FormulaireAction>
          </Carte>
        ) : null}

        {x.actions.payer ? (
          <Carte
            titre="Enregistrer un paiement"
            description="Un reçu REC est produit, et la facture est rééditée (version suivante, restant dû à jour). Un montant supérieur au restant dû est accepté : l'excédent devient une avance sur la police (H33), visible sur le reçu."
          >
            <FormulaireAction action={enregistrerLePaiement} libelleBouton="Enregistrer le paiement">
              {cache}
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Champ nom="date" libelle="Date (AAAA-MM-JJ)" valeur={aujourdhui()} autoComplete="off" />
                <Champ nom="montant" libelle={`Montant (restant dû : ${x.etat ? f(x.etat.restantDu) : "?"} F)`} autoComplete="off" />
                <div className="mb-4">
                  <ListeDeroulante label="Canal" name="canal" required invite="— Choisir —" options={CANAUX_PAIEMENT.map((k) => ({ valeur: k, libelle: LIBELLE_CANAL[k] }))} />
                </div>
                <Champ nom="reference" libelle="Référence (obligatoire sauf espèces)" requis={false} autoComplete="off" />
                <Champ nom="payeur" libelle="Payeur (par défaut : Facturé à)" requis={false} autoComplete="off" />
              </div>
            </FormulaireAction>
          </Carte>
        ) : null}

        {x.actions.imputer ? (
          <Carte
            titre="Imputer l'avance de la police"
            description={`Avance disponible : ${f(x.avance.disponible)} F ; restant dû : ${x.etat ? f(x.etat.restantDu) : "?"} F. L'imputation apparaît dans les paiements de la facture (rééditée, version suivante) ; aucun reçu n'est produit.`}
          >
            <AvertissementsReports reports={x.avance.reportsEnAttente} />
            <FormulaireAction action={imputerLAvance} libelleBouton="Imputer l'avance">
              {cache}
              <Champ nom="montant" libelle="Montant à imputer" valeur={x.avance.proposee} autoComplete="off" />
            </FormulaireAction>
          </Carte>
        ) : null}

        {x.actions.avoir ? (
          <Carte
            ton="danger"
            titre="Annuler par un avoir"
            description={`Avoir AV de la totalité de la facture (montants négatifs). La facture devient « Annulée – avoir AV-… », y compris sur sa page de vérification, et reste conservée. Pour corriger : avoir, puis nouvelle facture depuis la police.${
              x.etat && montant(x.etat.totalPaye).greaterThan(0) ? ` Les ${f(x.etat.totalPaye)} F déjà payés sont reportés : la nouvelle facture les reprendra (les reçus restent valables).` : ""
            }`}
          >
            <FormulaireAction action={emettreLAvoir} libelleBouton="Émettre l'avoir">
              {cache}
              <Champ nom="motif" libelle={`Motif (${LONGUEUR_MIN_MOTIF_AVOIR} caractères au moins)`} autoComplete="off" />
            </FormulaireAction>
          </Carte>
        ) : null}
      </div>
    </main>
  );
}
