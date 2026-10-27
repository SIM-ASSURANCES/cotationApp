import Link from "next/link";
import { notFound } from "next/navigation";

import { ChampNumeroPolice } from "@/composants/ChampNumeroPolice";
import { ComplementsSouscripteur } from "@/composants/ComplementsSouscripteur";
import { FormulaireAction } from "@/composants/FormulaireAction";
import { LignesBeneficiaires, LignesContactsUrgence } from "@/composants/LignesDynamiques";
import { LignesComposition } from "@/composants/LignesComposition";
import { TachesPolice } from "@/composants/TachesPolice";
import { Bandeau, Carte, Champ, EnTetePage, LienBouton, ListeDefinitions, ListeDeroulante, PastilleStatut, Tableau, type ElementDefinition } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant, type Montant } from "@/domaine/calcul/montant";
import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT } from "@/domaine/calcul/taxes";
import { estContratDeGroupe } from "@/domaine/cotation/adherents";
import { avertissementNumeroContrat, FORMAT_NUMERO_POLICE_DEFAUT } from "@/domaine/cotation/police";
import { LIBELLE_STATUT, peutAccepter, peutEtreValidee, peutModifier } from "@/domaine/cotation/statuts";
import { LIBELLE_RAISON } from "@/domaine/cotation/validation";
import { peutAgir, peutLire, peutValider } from "@/domaine/droits";
import { listerMotifsRefus } from "@/serveur/clients";
import { listerBranches } from "@/serveur/parametrage";
import { lireCotation } from "@/serveur/cotations";
import { chargerPartiesLiees } from "@/serveur/fiche-cotation";
import { niveauDuProfil } from "@/serveur/droits";
import { lireFormatNumeroPolice } from "@/serveur/societe";
import { exigerDroit } from "@/serveur/session";

import { accepterCotation, composerPrime, emettreCpDeCotation, emettrePdfDeCotation, reediterDocument, refuserCotation, renvoyerCotation, soumettreCotation, validerCotation } from "../actions";

const f = (m: Montant) => formaterMontant(m);
const formatDateHeure = (d: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(d);
const formatDate = (iso: string | null) => formaterDate(iso);

export default async function PageCotation(props: PageProps<"/cotations/[id]">) {
  const { id } = await props.params;
  const compositionVidee = (await props.searchParams).composition === "videe";
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const c = Number.isInteger(Number(id)) ? await lireCotation(utilisateur, Number(id)) : null;
  if (!c) {
    notFound();
  }

  // Parties liées (documents, contrat, tâches, factures) : chargées selon les droits du profil (voir chargerPartiesLiees).
  const [niveauCotation, niveauValidation, niveauComposition, niveauContrat, motifs, formatPolice, liees] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "CREER_COTATION"),
    niveauDuProfil(utilisateur.profil, "VALIDER_COTATION"),
    niveauDuProfil(utilisateur.profil, "COMPOSER_PRIME"),
    niveauDuProfil(utilisateur.profil, "EMETTRE_CONTRAT"),
    listerMotifsRefus(),
    lireFormatNumeroPolice(),
    chargerPartiesLiees(utilisateur, c),
  ]);
  const { documents, vueFactures, accesFactures: peutFactures, etatContrat, taches } = liees;
  const pdfCotation = documents.filter((d) => d.type === "COTATION");
  const pdfCp = documents.filter((d) => d.type === "CP");
  const emise = c.numero !== null && c.statut !== "BROUILLON" && c.statut !== "A_VALIDER";
  const derniere = (numero: string) => Math.max(...documents.filter((x) => x.numero === numero).map((x) => x.version));
  const estAuteur = c.auteurId === utilisateur.id;
  // H9 : qui a créé ou modifié la cotation ne la valide pas.
  const estContributeur = estAuteur || c.contributeurs.includes(utilisateur.id);
  const agit = peutAgir(niveauCotation);
  // Produit tarifé par garanties (session 6.2b) : la prime se compose, elle ne se calcule pas.
  const composition = c.composition;
  const aComposer = composition !== null && composition.lignes.length === 0;
  // Une prime calculée au barème ne se compose pas à la main : pas de secours (Q3, réponse A), un risque refusé par le barème ne s'assure pas.
  const peutComposer = composition !== null && composition.bareme === null && peutModifier(c.statut) && peutAgir(niveauComposition);
  const branchesActives = peutComposer ? (await listerBranches(utilisateur)).filter((b) => b.actif) : [];
  const x = c.resultat;
  const forcees = c.lignes.filter((l) => l.primeForcee !== null);
  const accessoiresSaisis = c.lignes.filter((l) => l.accessoireSaisi != null);
  const nom = c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`.trim();
  const titre = c.numero ?? `Brouillon n° ${c.id}`;

  // Le Tableau n'a pas de pied : le total général est une dernière ligne repérée par `total` (rendue en gras).
  type LignePrime = { cle: string; total: boolean; libelle: string; branche: string; montantGaranti: string; effectif: string; nette: string; accessoires: string; taux: string; taxe: string; ttc: string; ttcParUnite: string };
  const gras = (total: boolean, contenu: string) => (total ? <strong>{contenu}</strong> : contenu);
  const totalGeneral: LignePrime = {
    cle: "TOTAL", total: true, libelle: "Total général", branche: "", montantGaranti: "", effectif: "", taux: "", ttcParUnite: "",
    nette: f(x.totaux.arrondi.nette), accessoires: f(x.totaux.arrondi.accessoires), taxe: f(x.totaux.arrondi.taxe), ttc: f(x.totaux.arrondi.ttc),
  };
  const lignesGaranties: LignePrime[] = composition
    ? [
        ...x.lignes.map((l, i) => ({
          cle: l.code, total: false, libelle: composition.lignes[i].libelle, branche: composition.lignes[i].branche,
          montantGaranti: composition.lignes[i].montantGaranti != null ? f(montant(composition.lignes[i].montantGaranti!)) : "—",
          effectif: "",
          nette: f(l.arrondi.nette), accessoires: f(l.arrondi.accessoires), taux: `${montant(composition.lignes[i].tauxPourcent).toString().replace(".", ",")} %`,
          taxe: f(l.arrondi.taxe), ttc: f(l.arrondi.ttc), ttcParUnite: "",
        })),
        totalGeneral,
      ]
    : [];
  const lignesFormules: LignePrime[] = [
    ...[...x.lignes, ...(x.fraisFractionnement ? [x.fraisFractionnement] : [])].map((l) => ({
      cle: l.code, total: false, libelle: c.libelles[l.code] ?? "Frais de fractionnement", branche: "", montantGaranti: "",
      effectif: l.code === "FRAIS_FRACTIONNEMENT" ? "—" : String(l.effectif),
      nette: f(l.arrondi.nette), accessoires: f(l.arrondi.accessoires), taux: "", taxe: f(l.arrondi.taxe), ttc: f(l.arrondi.ttc),
      ttcParUnite: l.code === "FRAIS_FRACTIONNEMENT" ? "—" : f(l.ttcParUnite),
    })),
    totalGeneral,
  ];
  // Échéancier : tranches puis ligne « Somme (= TTC) ».
  const lignesEcheancier = c.echeancier
    ? [
        ...c.echeancier.map((t) => ({ cle: String(t.numero), total: false, numero: String(t.numero), date: formatDate(t.date), montant: f(t.montant) })),
        {
          cle: "SOMME", total: true, numero: "Somme (= TTC)", date: "",
          montant: f(c.echeancier.reduce((s, t) => s.plus(t.montant), x.totaux.arrondi.ttc.minus(x.totaux.arrondi.ttc))),
        },
      ]
    : [];

  // Caractéristiques de la cotation (libellé : valeur) ; les lignes conditionnelles gardent leur condition d'origine.
  const caracteristiques: ElementDefinition[] = [
    { libelle: "Produit", valeur: `${c.produit.code} — ${c.produit.libelle}` },
    { libelle: "Type de contrat", valeur: c.typeContrat ? LIBELLE_TYPE_CONTRAT[c.typeContrat] : "non renseigné (cotation antérieure)" },
    { libelle: "Régime de taxe", valeur: c.regimeTaxe ? LIBELLE_REGIME_TAXE[c.regimeTaxe] : "non renseigné (cotation antérieure à la session 6.0 : taux choisi par le type de contrat)" },
    { libelle: "Souscripteur", valeur: `${nom} (${c.souscripteur.type === "MORALE" ? "personne morale" : "personne physique"})` },
    { libelle: "Période", valeur: `du ${formatDate(c.dateEffet)} au ${formatDate(c.dateEcheance)} (${x.joursCouverts} jours)` },
    { libelle: "Établie le", valeur: formatDate(c.dateEtablissement) },
    { libelle: "Valide jusqu'au", valeur: formatDate(c.dateValidite) },
    { libelle: "Paramétrage du produit du", valeur: formatDate(c.versionDateEffet) },
    { libelle: "Auteur", valeur: c.auteurIdentifiant },
    { libelle: "Intermédiaire(s)", valeur: c.intermediaires.length > 0 ? c.intermediaires.map((i) => `${i.nom} (${i.code}, ${i.role})`).join(" ; ") : "aucun" },
    ...(c.numeroPolice ? [{ libelle: "Police créée", valeur: c.numeroPolice }] : []),
    ...(c.statut === "REFUSEE" ? [{ libelle: "Refus", valeur: `${c.motifRefusCode}${c.refusCommentaire ? ` — ${c.refusCommentaire}` : ""}` }] : []),
  ];
  const avertissementPolice = c.numeroPolice ? avertissementNumeroContrat(c.numeroPolice) : null;

  // Informations complémentaires : seules les rubriques renseignées apparaissent.
  const complements: ElementDefinition[] = [
    ...(c.contactsUrgence && c.contactsUrgence.length > 0 ? [{ libelle: "Contacts d'urgence", valeur: c.contactsUrgence.map((u) => `${u.nom_prenoms} (${u.contact})`).join(" ; ") }] : []),
    ...(Object.keys(c.risque).length > 0 ? [{ libelle: "Risque", valeur: Object.entries(c.risque).map(([k, v]) => `risque.${k} = ${v}`).join(" ; ") }] : []),
  ];

  return (
    <main className="space-y-6">
      <EnTetePage titre={titre} filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: titre }]} actions={<PastilleStatut libelle={LIBELLE_STATUT[c.statutEffectif]} />} />

      {c.filigrane ? (
        <Bandeau ton="danger" role="alert" className="justify-center">
          <span className="text-2xl font-bold tracking-widest">{c.filigrane}</span>
        </Bandeau>
      ) : null}
      {compositionVidee && aComposer ? (
        <Bandeau ton="avertissement" role="status">
          <strong>La composition de la prime a été vidée.</strong> La période, le régime de taxe ou le type de contrat a changé : les montants composés ne valaient que pour les conditions d&apos;origine
          (aucun prorata n&apos;est appliqué). La prime est de nouveau « À composer » ; l&apos;ancienne composition, avec son auteur et son motif, est gardée au journal.
        </Bandeau>
      ) : null}
      {c.messageBrouillonAFormules ? (
        <Bandeau ton="avertissement" role="alert">
          <strong>Brouillon à recréer.</strong> {c.messageBrouillonAFormules}.
        </Bandeau>
      ) : null}
      <TachesPolice taches={taches} cotationId={c.id} chemin={`/cotations/${c.id}`} />

      <Carte titre="Caractéristiques">
        <ListeDefinitions elements={caracteristiques} />
        {avertissementPolice ? (
          <Bandeau ton="avertissement" role="status" className="mt-4">
            {avertissementPolice}
          </Bandeau>
        ) : null}
        {c.numeroPolice ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {estContratDeGroupe(c.typeContrat) ? <LienBouton href={`/cotations/${c.id}/adherents`}>Adhérents, certificats d'adhésion et annexe des CP</LienBouton> : null}
            <LienBouton href={`/cotations/${c.id}/factures`}>Factures, avoirs et paiements de la police</LienBouton>
          </div>
        ) : null}
      </Carte>

      {c.numeroPolice && (vueFactures || !peutFactures) ? (
        <Carte titre="Contrat, avenants et facturation de la police">
          <div className="space-y-4">
            <p className="text-sm">
              <strong>Police n° {c.numeroPolice}</strong> ({c.produit.code}) — {nom} — du {formatDate(c.dateEffet)} au {formatDate(c.dateEcheance)}.
            </p>

            {pdfCp.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-foreground">Conditions Particulières (CP) :</span>
                {pdfCp.map((cp) => (
                  <a
                    key={`${cp.numero}-${cp.version}`}
                    href={`/api/documents/${cp.id}`}
                    className="font-medium text-primary underline"
                  >
                    Télécharger {cp.numero} (v{cp.version})
                  </a>
                ))}
              </div>
            ) : null}

            {estContratDeGroupe(c.typeContrat) && peutLire(niveauContrat) ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-foreground">Avenants :</span>
                <Link href={`/cotations/${c.id}/adherents`} className="font-medium text-primary underline">
                  Adhérents et avenants d'incorporation / retrait
                </Link>
              </div>
            ) : null}

            {!vueFactures ? (
              <p className="text-sm text-neutral">Factures, avoirs, reçus et relances : accès réservé.</p>
            ) : vueFactures.factures.length > 0 ? (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-foreground">Factures et avoirs de la police</h4>
                <Tableau
                  legende="Factures de la police"
                  lignes={vueFactures.factures}
                  cleLigne={(x) => String(x.id)}
                  colonnes={[
                    {
                      cle: "numero",
                      entete: "Numéro",
                      rendu: (x) => (
                        <Link href={`/factures/${x.id}`} className="font-medium text-primary underline">
                          {x.numero ?? `Brouillon n° ${x.id}`}
                        </Link>
                      ),
                    },
                    { cle: "type", entete: "Type", rendu: (x) => x.libelleType },
                    { cle: "statut", entete: "Statut", rendu: (x) => <PastilleStatut libelle={x.libelleStatut} /> },
                    { cle: "periode", entete: "Période", rendu: (x) => `${formatDate(x.dateEffet)} → ${formatDate(x.dateEcheance)}` },
                    { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (x) => `${f(montant(x.ttc))} F` },
                    {
                      cle: "actions",
                      entete: "Action",
                      alignement: "droite",
                      rendu: (x) => (
                        <LienBouton href={`/factures/${x.id}`} variante="secondaire">
                          Voir
                        </LienBouton>
                      ),
                    },
                  ]}
                />
              </div>
            ) : (
              <p className="text-sm text-neutral">Aucune facture émise pour le moment pour ce contrat.</p>
            )}

            {vueFactures ? (
              <div className="pt-2">
                <LienBouton href={`/cotations/${c.id}/factures`}>
                  Gérer toutes les factures, avoirs et paiements de la police
                </LienBouton>
              </div>
            ) : null}
          </div>
        </Carte>
      ) : null}

      {c.raisonsValidation.length > 0 ? (
        <Bandeau ton="avertissement">
          <strong>Validation exigée :</strong> {c.raisonsValidation.map((r) => LIBELLE_RAISON[r]).join(", ")}.
        </Bandeau>
      ) : null}

      <Carte titre="Primes">
        {composition ? (
          aComposer ? (
            <Bandeau ton="avertissement" role="status">
              <strong>Prime à composer.</strong> Ce produit se tarife par garanties : la Technique doit composer la prime (une ligne par garantie souscrite) avant que la cotation puisse être soumise.
            </Bandeau>
          ) : (
            <Tableau
              legende="Primes par garantie"
              lignes={lignesGaranties}
              cleLigne={(l) => l.cle}
              colonnes={[
                { cle: "garantie", entete: "Garantie", className: "font-medium", rendu: (l) => gras(l.total, l.libelle) },
                { cle: "branche", entete: "Catégorie de taxe", rendu: (l) => l.branche },
                { cle: "montantGaranti", entete: "Montant garanti", alignement: "droite", rendu: (l) => l.montantGaranti },
                { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => gras(l.total, l.nette) },
                { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => gras(l.total, l.accessoires) },
                { cle: "taux", entete: "Taux", alignement: "droite", rendu: (l) => l.taux },
                { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => gras(l.total, l.taxe) },
                { cle: "ttc", entete: "TTC", alignement: "droite", className: "font-semibold", rendu: (l) => gras(l.total, l.ttc) },
              ]}
            />
          )
        ) : (
          <Tableau
            legende="Primes par formule"
            lignes={lignesFormules}
            cleLigne={(l) => l.cle}
            colonnes={[
              { cle: "formule", entete: "Formule", className: "font-medium", rendu: (l) => gras(l.total, l.libelle) },
              { cle: "effectif", entete: "Effectif", alignement: "droite", rendu: (l) => l.effectif },
              { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => gras(l.total, l.nette) },
              { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => gras(l.total, l.accessoires) },
              { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => gras(l.total, l.taxe) },
              { cle: "ttc", entete: "TTC", alignement: "droite", className: "font-semibold", rendu: (l) => gras(l.total, l.ttc) },
              { cle: "unite", entete: "TTC par unité", alignement: "droite", rendu: (l) => l.ttcParUnite },
            ]}
          />
        )}
        {composition?.bareme ? (
          <Bandeau ton="neutre" className="mt-3">
            <strong>Prime calculée au barème publié</strong> (empreinte {composition.bareme.empreinte}). La saisie et les taux de taxe sont figés avec la cotation ; le barème n&apos;est plus relu une fois la cotation émise.
            {peutModifier(c.statut) ? " Brouillon : la prime est recalculée du barème en vigueur à chaque enregistrement et à la soumission." : ""}
          </Bandeau>
        ) : null}
        {composition && !aComposer && composition.composePar ? (
          <Bandeau ton="neutre" className="mt-3">
            <strong>Prime composée par {composition.composePar}</strong>
            {composition.composeLe ? ` le ${formatDateHeure(composition.composeLe)}` : ""}. Motif : {composition.motif}.{" "}
            {peutModifier(c.statut)
              ? "Brouillon : les taux de taxe sont résolus de nouveau à chaque modification et à la soumission (branche de chaque ligne, régime de taxe, date d'effet) ; ils sont figés à l'émission."
              : "Les taux de taxe ont été résolus à la date d'effet de la police (branche de chaque ligne, régime de taxe de la cotation) et sont figés avec la cotation."}
          </Bandeau>
        ) : null}
        {forcees.length > 0 ? (
          <Bandeau ton="neutre" className="mt-3">
            <strong>Prime forcée (information interne, non affichée au client) :</strong>{" "}
            {forcees.map((l) => `${l.code} : tarif ${montant(l.primeTarif).toString()} → forcée ${montant(l.primeForcee!).toString()}`).join(" ; ")}. Motif : {c.motifForcage}.
          </Bandeau>
        ) : null}
        {accessoiresSaisis.length > 0 ? (
          <Bandeau ton="neutre" className="mt-3">
            <strong>Accessoires modifiés dans la cotation :</strong>{" "}
            {accessoiresSaisis.map((l) => `${l.code} : paramétrage ${montant(l.accessoireTarif ?? "0").toString()} → ${montant(l.accessoireSaisi!).toString()}`).join(" ; ")} (journalisé).
          </Bandeau>
        ) : null}
        {c.echeancier ? (
          <div className="mt-6 max-w-md">
            <h3 className="mb-2 font-semibold">Échéancier ({c.echeancier.length} tranches)</h3>
            <Tableau
              legende="Échéancier"
              lignes={lignesEcheancier}
              cleLigne={(t) => t.cle}
              colonnes={[
                { cle: "numero", entete: "Tranche", rendu: (t) => gras(t.total, t.numero) },
                { cle: "date", entete: "Date", rendu: (t) => t.date },
                { cle: "montant", entete: "Montant", alignement: "droite", rendu: (t) => gras(t.total, t.montant) },
              ]}
            />
          </div>
        ) : null}
      </Carte>

      {c.assures.length > 0 ? (
        <Carte titre="Assurés">
          <Tableau
            legende="Assurés"
            lignes={c.assures}
            cleLigne={(a) => String(a.ordre)}
            colonnes={[
              { cle: "ordre", entete: "N°", rendu: (a) => a.ordre },
              { cle: "nom", entete: "Nom et prénoms", rendu: (a) => a.nom_prenoms },
              { cle: "naissance", entete: "Naissance", rendu: (a) => formaterDate(a.date_naissance) },
              { cle: "sexe", entete: "Sexe", rendu: (a) => a.sexe || "—" },
              { cle: "lien", entete: "Lien", rendu: (a) => a.lien || "—" },
              { cle: "identification", entete: "Pièce d'identité", rendu: (a) => a.num_identification || "—" },
              { cle: "formule", entete: "Formule", rendu: (a) => a.formule || "—" },
            ]}
          />
        </Carte>
      ) : null}
      {c.beneficiaires && c.beneficiaires.length > 0 ? (
        <Carte titre="Bénéficiaires">
          <Tableau
            legende="Bénéficiaires"
            lignes={c.beneficiaires}
            cleLigne={(b) => String(b.ordre)}
            colonnes={[
              { cle: "ordre", entete: "N°", rendu: (b) => b.ordre },
              { cle: "nom", entete: "Nom et prénoms", rendu: (b) => b.nom_prenoms },
              { cle: "lien", entete: "Lien", rendu: (b) => b.lien || "—" },
              { cle: "contact", entete: "Contact", rendu: (b) => b.contact || "—" },
              { cle: "quote", entete: "Quote-part", alignement: "droite", rendu: (b) => `${b.quote_part} %` },
            ]}
          />
        </Carte>
      ) : null}
      {complements.length > 0 ? (
        <Carte titre="Informations complémentaires">
          <ListeDefinitions elements={complements} colonnes={1} />
        </Carte>
      ) : null}

      <Carte titre="Documents PDF">
        <div className="mb-3 flex flex-wrap items-end gap-4">
          {aComposer ? null : (
            // Route d'API (PDF) : pas de préchargement, qui ferait générer l'aperçu pour rien.
            <LienBouton href={`/api/cotations/${c.id}/apercu`} target="_blank" prefetch={false}>
              Aperçu PDF (filigrane « APERÇU »)
            </LienBouton>
          )}
          {emise && pdfCotation.length === 0 && agit ? (
            <FormulaireAction action={emettrePdfDeCotation} libelleBouton="Émettre le PDF de la cotation" discret>
              <input type="hidden" name="id" value={c.id} />
            </FormulaireAction>
          ) : null}
          {c.numeroPolice && pdfCp.length === 0 && peutAgir(niveauContrat) && !(etatContrat?.requise && etatContrat.validation?.statut === "A_VALIDER") ? (
            <FormulaireAction
              action={emettreCpDeCotation}
              libelleBouton={
                etatContrat?.requise
                  ? `Demander la validation du contrat (police ${c.numeroPolice})`
                  : etatContrat?.validation?.statut === "A_VALIDER"
                    ? `Valider et émettre les conditions particulières (police ${c.numeroPolice})`
                    : `Émettre les conditions particulières (police ${c.numeroPolice})`
              }
              discret
            >
              <input type="hidden" name="id" value={c.id} />
            </FormulaireAction>
          ) : null}
        </div>
        {pdfCp.length === 0 && etatContrat?.validation?.statut === "A_VALIDER" ? (
          <Bandeau ton="avertissement" role="status" className="mb-3">
            <strong>Contrat à valider.</strong> Son TTC ({formaterMontant(montant(etatContrat.ttc))} F) dépasse le seuil de validation ({formaterMontant(montant(etatContrat.validation.seuil))} F) ; demandé par {etatContrat.validation.demandeePar} le{" "}
            {formatDateHeure(etatContrat.validation.demandeeLe)}. Un profil habilité qui n'est pas le demandeur doit l'émettre.
          </Bandeau>
        ) : null}
        {documents.length > 0 ? (
          <Tableau
            legende="Documents PDF de la cotation"
            lignes={documents}
            cleLigne={(d) => String(d.id)}
            colonnes={[
              { cle: "document", entete: "Document", rendu: (d) => `${d.libelleType} ${d.numero} v${d.version}${d.filigrane ? ` (${d.filigrane})` : ""}` },
              { cle: "date", entete: "Émis le", rendu: (d) => formaterDate(d.dateEmission) },
              { cle: "statut", entete: "Statut", rendu: (d) => <PastilleStatut libelle={d.statut.libelle} /> },
              {
                cle: "pdf",
                entete: "Fichier",
                rendu: (d) => (
                  <a href={`/api/documents/${d.id}`} className="text-primary underline">
                    PDF
                  </a>
                ),
              },
              {
                cle: "empreinte",
                entete: "Empreinte",
                rendu: (d) => (
                  <span className="font-mono text-xs" title="Empreinte SHA-256">
                    {d.empreinte.slice(0, 16)}…
                  </span>
                ),
              },
              {
                cle: "action",
                entete: "Action",
                rendu: (d) =>
                  d.version === derniere(d.numero) && (d.type === "CP" ? peutAgir(niveauContrat) : agit) ? (
                    <FormulaireAction action={reediterDocument} libelleBouton="Rééditer" discret>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="documentId" value={d.id} />
                    </FormulaireAction>
                  ) : null,
              },
            ]}
          />
        ) : (
          <p className="text-sm text-neutral">
            {emise ? "Aucun PDF émis pour l'instant." : "Le PDF définitif (numéro, QR code) est émis avec la cotation ; avant, seul l'aperçu est possible."}
          </p>
        )}
      </Carte>

      {peutComposer ? (
        <Carte
          titre={aComposer ? "Composer la prime" : "Recomposer la prime"}
          description="Saisissez, pour chaque garantie souscrite (et chaque surprime ou majoration, qui est une ligne comme une autre), la prime nette et les accessoires calculés dans le simulateur de la Technique. Le module résout le taux de taxe de la branche de chaque ligne (régime de taxe de la cotation, date d'effet), calcule la taxe, arrondit selon la règle du produit et totalise. Aucun prorata n'est appliqué : les montants sont ceux de la période du contrat. Le motif est obligatoire et la composition est journalisée ; vous ne pourrez pas valider cette cotation."
        >
          <FormulaireAction action={composerPrime} libelleBouton={aComposer ? "Enregistrer la composition" : "Recomposer la prime"}>
            <input type="hidden" name="id" value={c.id} />
            <div className="mb-4">
              <LignesComposition
                initiales={(composition?.lignes ?? []).map((l) => ({
                  libelle: l.libelle,
                  branche: l.branche,
                  montantGaranti: l.montantGaranti != null ? montant(l.montantGaranti).toString() : "",
                  primeNette: montant(l.primeNette).toString(),
                  accessoires: montant(l.accessoires).toString(),
                }))}
                garanties={c.garantiesDuProduit.map((g) => ({
                  libelle: g.libelle,
                  branche: g.branche,
                  montantGaranti: g.montantGaranti != null ? montant(g.montantGaranti).toString() : null,
                  accessoires: g.accessoires != null ? montant(g.accessoires).toString() : null,
                }))}
                branches={branchesActives.map((b) => ({ code: b.code, libelle: b.libelle }))}
                saisieLibre={c.garantiesSaisieLibre}
              />
            </div>
            <div className="mb-4 max-w-2xl">
              <Champ label="Motif de la composition (obligatoire)" name="motif" required minLength={3} maxLength={500} autoComplete="off" />
            </div>
          </FormulaireAction>
        </Carte>
      ) : null}

      {peutModifier(c.statut) && agit && !c.brouillonAFormulesSousGaranties ? (
        <Carte>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <LienBouton href={`/cotations/${c.id}/modifier`}>Modifier le brouillon</LienBouton>
            {aComposer ? (
              <Bandeau ton="info" role="status" className="w-full min-w-0 sm:w-auto sm:flex-1">
                La prime n&apos;est pas encore composée : la soumission (et l&apos;aperçu PDF) sont impossibles tant que la Technique ne l&apos;a pas composée.
              </Bandeau>
            ) : (
              <FormulaireAction action={soumettreCotation} libelleBouton="Soumettre (émettre)">
                <input type="hidden" name="id" value={c.id} />
                <p className="mb-2 text-sm text-neutral">
                  {composition
                    ? "Les taux de taxe sont résolus de nouveau avec les paramètres du jour (les montants saisis ne changent pas). Sous le seuil, la cotation est émise tout de suite ; sinon elle passe « À valider »."
                    : "Le calcul est refait avec les paramètres du jour. Sous le seuil et sans forçage, la cotation est émise tout de suite ; sinon elle passe « À valider »."}
                </p>
              </FormulaireAction>
            )}
          </div>
        </Carte>
      ) : null}

      {peutEtreValidee(c.statut) ? (
        <Carte titre="Cotation à valider">
          {estContributeur ? (
            <Bandeau ton="info" className="mb-3">
              Vous avez {estAuteur ? "créé" : "modifié"} cette cotation : un autre valideur (profil Technique) doit la valider.{estAuteur ? " Vous pouvez la renvoyer en brouillon pour la modifier." : ""}
            </Bandeau>
          ) : null}
          {peutValider(niveauValidation) && !estContributeur ? (
            <FormulaireAction action={validerCotation} libelleBouton="Valider et émettre" className="mb-4">
              <input type="hidden" name="id" value={c.id} />
            </FormulaireAction>
          ) : null}
          {estAuteur || peutValider(niveauValidation) ? (
            <FormulaireAction action={renvoyerCotation} libelleBouton="Renvoyer en brouillon" discret>
              <input type="hidden" name="id" value={c.id} />
              <div className="mb-3 max-w-md">
                <Champ label={estAuteur ? "Commentaire (facultatif)" : "Motif du renvoi (obligatoire)"} name="commentaire" autoComplete="off" />
              </div>
            </FormulaireAction>
          ) : (
            <p className="text-sm text-neutral">En attente de validation.</p>
          )}
        </Carte>
      ) : null}

      {peutAccepter(c.statutEffectif) && agit ? (
        <>
          <Carte titre="Le client accepte">
            <FormulaireAction action={accepterCotation} libelleBouton="Accepter et créer la police">
              <input type="hidden" name="id" value={c.id} />
              {composition ? (
                <p className="mb-2 text-sm text-neutral">La prime composée est acceptée en entier : elle est reprise telle quelle dans la police, sans nouveau calcul.</p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-neutral">Formule(s) retenue(s) :</p>
                  {c.lignes.map((l) => (
                    <label key={l.code} className="mb-1 flex min-h-10 items-center gap-2 text-sm sm:min-h-0">
                      <input type="checkbox" name="retenue" value={l.code} defaultChecked className="size-4 accent-primary" /> {c.libelles[l.code] ?? l.code}
                    </label>
                  ))}
                </>
              )}
              <div className="mb-3 mt-3 max-w-2xl">
                <ChampNumeroPolice label="Numéro de police attribué par SIM (obligatoire)">
                  <p className="text-xs text-neutral">
                    Format contrôlé : <code>{formatPolice}</code>
                    {formatPolice === FORMAT_NUMERO_POLICE_DEFAUT ? " (par défaut)" : ""}. Le module ne génère jamais ce numéro.
                  </p>
                </ChampNumeroPolice>
              </div>
              <p className="mb-2 mt-4 text-sm font-semibold">À compléter à la souscription (repris de la cotation, modifiable)</p>
              <ComplementsSouscripteur valeurs={c.souscripteur} />
              <p className="mb-1 text-sm font-medium">Bénéficiaires (la somme des quotes-parts fait 100 %)</p>
              <LignesBeneficiaires initiales={(c.beneficiaires ?? []).map((b) => ({ nom: b.nom_prenoms, lien: b.lien, contact: b.contact, quote: b.quote_part }))} />
              <p className="mb-1 mt-4 text-sm font-medium">Contacts d'urgence</p>
              <LignesContactsUrgence initiales={(c.contactsUrgence ?? []).map((u) => ({ nom: u.nom_prenoms, contact: u.contact }))} />
            </FormulaireAction>
          </Carte>
          <Carte titre="Le client refuse">
            <FormulaireAction action={refuserCotation} libelleBouton="Enregistrer le refus" discret>
              <input type="hidden" name="id" value={c.id} />
              <div className="mb-3 max-w-md">
                <ListeDeroulante label="Motif (obligatoire)" name="motif" required defaultValue="" invite="— Choisir —" options={motifs.map((m) => ({ valeur: m.code, libelle: m.libelle }))} />
              </div>
              <div className="mb-3 max-w-md">
                <Champ label="Commentaire" name="commentaire" autoComplete="off" />
              </div>
            </FormulaireAction>
          </Carte>
        </>
      ) : null}

      {c.statutEffectif === "EXPIREE" ? <Bandeau ton="danger">Cotation expirée : elle ne peut plus être acceptée ni transformée en police. Créez une nouvelle cotation.</Bandeau> : null}
    </main>
  );
}
