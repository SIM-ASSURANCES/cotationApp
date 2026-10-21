import Link from "next/link";
import type { ReactNode } from "react";

import { Bandeau, Bouton, Carte, Champ, ChampDate, EnTetePage, EtatVide, ListeDeroulante, Tableau, type ColonneTableau } from "@/composants/ui";
import { dateValide, formaterDate, normaliserDateSaisie } from "@/domaine/calcul/dates";
import { formaterMontant, type Montant } from "@/domaine/calcul/montant";
import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT, REGIMES_TAXE, estRegimeTaxe } from "@/domaine/calcul/taxes";
import { peutLire } from "@/domaine/droits";
import { calculerPourProduit, aujourdhui, listerVersions, listerProduits, type ReponseCalcul } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

const premier = (valeur: string | string[] | undefined) => (Array.isArray(valeur) ? valeur[0] : valeur) ?? "";
const f = (m: Montant) => formaterMontant(m);

/** Ligne du tableau des résultats : montants déjà formatés (séparateur de milliers inchangé), `total` pour la ligne de totaux. */
type LigneResultat = { cle: string; libelle: string; effectif: string; nette: string; accessoires: string; taxe: string; ttc: string; parUnite: string; total?: boolean };
/** Ligne de l'échéancier ; la dernière porte la somme des tranches. */
type LigneTranche = { cle: string; numero: string; date: string; montant: string; total?: boolean };

/** Les lignes de totaux et de sommes sont en gras : le `Tableau` n'a pas de pied, la ligne est la dernière de la liste. */
const gras = (total: boolean | undefined, contenu: ReactNode) => (total ? <span className="font-semibold">{contenu}</span> : contenu);

function Resultats({ r }: { r: ReponseCalcul }) {
  const { resultat: x } = r;
  const toutes = [...x.lignes, ...(x.fraisFractionnement ? [x.fraisFractionnement] : [])];

  const lignesResultat: LigneResultat[] = [
    ...toutes.map((l) => ({
      cle: l.code,
      libelle: r.libelles[l.code] ?? "Frais de fractionnement",
      effectif: l.code === "FRAIS_FRACTIONNEMENT" ? "—" : String(l.effectif),
      nette: f(l.arrondi.nette),
      accessoires: f(l.arrondi.accessoires),
      taxe: f(l.arrondi.taxe),
      ttc: f(l.arrondi.ttc),
      parUnite: l.code === "FRAIS_FRACTIONNEMENT" ? "—" : f(l.ttcParUnite),
    })),
    {
      cle: "TOTAL",
      libelle: "Total",
      effectif: "",
      nette: f(x.totaux.arrondi.nette),
      accessoires: f(x.totaux.arrondi.accessoires),
      taxe: f(x.totaux.arrondi.taxe),
      ttc: f(x.totaux.arrondi.ttc),
      parUnite: "",
      total: true,
    },
  ];
  const colonnesResultat: ColonneTableau<LigneResultat>[] = [
    { cle: "formule", entete: "Formule", rendu: (l) => gras(l.total, l.libelle), className: "whitespace-nowrap" },
    { cle: "effectif", entete: "Effectif", alignement: "droite", rendu: (l) => l.effectif },
    { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => gras(l.total, l.nette) },
    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => gras(l.total, l.accessoires) },
    { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => gras(l.total, l.taxe) },
    { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (l) => <span className="font-semibold">{l.ttc}</span> },
    { cle: "parUnite", entete: "TTC par unité", alignement: "droite", rendu: (l) => l.parUnite },
  ];

  // Montants exacts : 4 décimales, sans arrondi. Mêmes colonnes que ci-dessus moins l'effectif.
  const lignesExactes = toutes.map((l) => ({
    cle: l.code,
    libelle: r.libelles[l.code] ?? "Frais de fractionnement",
    nette: formaterMontant(l.exact.nette, 4),
    accessoires: formaterMontant(l.exact.accessoires, 4),
    taxe: formaterMontant(l.exact.taxe, 4),
    ttc: formaterMontant(l.exact.ttc, 4),
  }));
  type LigneExacte = (typeof lignesExactes)[number];
  const colonnesExactes: ColonneTableau<LigneExacte>[] = [
    { cle: "formule", entete: "Formule", rendu: (l) => l.libelle },
    { cle: "nette", entete: "Prime nette (HT)", alignement: "droite", rendu: (l) => l.nette },
    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => l.accessoires },
    { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => l.taxe },
    { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (l) => l.ttc },
  ];

  const lignesTranches: LigneTranche[] | null = r.echeancier
    ? [
        ...r.echeancier.map((t) => ({ cle: String(t.numero), numero: String(t.numero), date: formaterDate(t.date), montant: f(t.montant) })),
        {
          cle: "SOMME",
          numero: "Somme des tranches (= TTC)",
          date: "",
          montant: f(r.echeancier.reduce((s, t) => s.plus(t.montant), x.totaux.arrondi.ttc.minus(x.totaux.arrondi.ttc))),
          total: true,
        },
      ]
    : null;
  const colonnesTranches: ColonneTableau<LigneTranche>[] = [
    { cle: "numero", entete: "N°", rendu: (t) => gras(t.total, t.numero), className: "whitespace-nowrap" },
    { cle: "date", entete: "Date", rendu: (t) => t.date },
    { cle: "montant", entete: "Montant", alignement: "droite", rendu: (t) => gras(t.total, t.montant) },
  ];

  return (
    <Carte
      titre="Résultat"
      description={
        <>
          Paramétrage du produit en vigueur le {formaterDate(r.versionDu)} · taxe {r.taxe.branche} ({r.taxe.typeContrat ? `régime ${LIBELLE_TYPE_CONTRAT[r.taxe.typeContrat].toLowerCase()}` : "tous régimes"}) {r.taxe.tauxPourcent.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",")} % (en vigueur le {formaterDate(r.taxe.dateEffet)}) ·{" "}
          {x.joursCouverts} jour(s) couverts, coefficient de prorata {x.coefProrata.toDecimalPlaces(5).toString().replace(".", ",")}
        </>
      }
    >
      {r.doubleValidationRequise ? (
        <Bandeau ton="avertissement" role="status" className="mb-3">
          Le TTC dépasse le seuil de validation : ce document passerait en « À valider » (double validation, CDC §4.1).
        </Bandeau>
      ) : null}
      <Tableau colonnes={colonnesResultat} lignes={lignesResultat} cleLigne={(l) => l.cle} legende="Résultat du calcul" />
      <details className="mt-4 text-sm">
        <summary className="min-h-10 cursor-pointer py-2 font-medium text-primary lg:min-h-0 lg:py-0">Montants exacts avant arrondi</summary>
        <div className="mt-2 max-w-3xl">
          <Tableau colonnes={colonnesExactes} lignes={lignesExactes} cleLigne={(l) => l.cle} legende="Montants exacts avant arrondi" />
        </div>
      </details>
      {lignesTranches && r.echeancier ? (
        <div className="mt-6">
          <h3 className="mb-2 text-base font-bold text-foreground">Échéancier ({r.echeancier.length} tranches)</h3>
          <div className="max-w-md">
            <Tableau colonnes={colonnesTranches} lignes={lignesTranches} cleLigne={(t) => t.cle} legende="Échéancier" />
          </div>
        </div>
      ) : null}
    </Carte>
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
      <main className="space-y-6">
        <EnTetePage titre="Accès refusé" />
        <Bandeau ton="danger">Votre profil n&apos;a pas accès au calcul.</Bandeau>
      </main>
    );
  }

  const q = await props.searchParams;
  const codeProduit = premier(q.produit);
  const produits = await listerProduits(utilisateur);

  if (!codeProduit) {
    const calculables = produits.filter((p) => p.actif && p.versions.length > 0);
    type LigneProduit = (typeof calculables)[number];
    const colonnesProduits: ColonneTableau<LigneProduit>[] = [
      {
        cle: "code",
        entete: "Produit",
        rendu: (p) => (
          <Link className="font-medium text-primary underline" href={`/calcul?produit=${p.code}`}>
            {p.code}
          </Link>
        ),
      },
      { cle: "libelle", entete: "Libellé", rendu: (p) => p.libelle },
    ];
    return (
      <main className="space-y-6">
        <EnTetePage titre="Calcul de prime" sousTitre="Choisissez un produit. Les montants viennent du moteur de calcul, avec le paramétrage en vigueur." />
        <Tableau colonnes={colonnesProduits} lignes={calculables} cleLigne={(p) => p.code} messageVide="Aucun produit paramétré pour l'instant." legende="Produits calculables" />
      </main>
    );
  }

  const donnees = await listerVersions(utilisateur, codeProduit);
  const dateEffet = normaliserDateSaisie(premier(q.dateEffet));
  const dateEcheance = normaliserDateSaisie(premier(q.dateEcheance));
  const dateDocument = normaliserDateSaisie(premier(q.dateDocument)) || aujourdhui();
  const tranches = premier(q.tranches) || "1";
  const regimeTaxe = premier(q.regimeTaxe);
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
    } else if (!estRegimeTaxe(regimeTaxe)) {
      erreur = "Choisissez le régime de taxe : il détermine le taux de taxe.";
    } else {
      try {
        resultat = await calculerPourProduit(utilisateur, {
          codeProduit,
          dateEffet,
          dateEcheance,
          dateDocument,
          regimeTaxe,
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
    <main className="space-y-6">
      <EnTetePage filAriane={[{ libelle: "Produits", href: "/calcul" }, { libelle: codeProduit }]} titre={`Calcul : ${codeProduit}`} />
      {!donnees ? (
        <EtatVide message="Produit introuvable." />
      ) : (
        <Carte titre="Paramètres du calcul" className="max-w-3xl">
          {/* Formulaire GET natif : le calcul se rejoue à chaque affichage de la page, rien n'est enregistré. */}
          <form method="get">
            <input type="hidden" name="produit" value={codeProduit} />
            <div className="mb-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <ChampDate label="Date d'effet (JJ/MM/AAAA)" name="dateEffet" defaultValue={dateEffet} required />
              <ChampDate label="Date d'échéance (JJ/MM/AAAA)" name="dateEcheance" defaultValue={dateEcheance} required />
              <ChampDate label="Date du document (paramètres en vigueur à cette date)" name="dateDocument" defaultValue={dateDocument} />
              <ListeDeroulante
                label="Régime de taxe (choisit le taux de taxe)"
                name="regimeTaxe"
                defaultValue={regimeTaxe}
                required
                options={[{ valeur: "", libelle: "— Choisir —" }, ...REGIMES_TAXE.map((t) => ({ valeur: t, libelle: LIBELLE_REGIME_TAXE[t] }))]}
              />
              <Champ label="Nombre de tranches" name="tranches" defaultValue={tranches} inputMode="numeric" />
            </div>
            <h3 className="mb-3 text-base font-bold text-foreground">Effectifs (laisser vide pour exclure une formule)</h3>
            <div className="mb-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {formules.map((fm) => (
                <Champ key={fm.code} label={`${fm.code} — ${fm.libelle}`} name={`eff_${fm.code}`} defaultValue={premier(q[`eff_${fm.code}`])} inputMode="numeric" />
              ))}
            </div>
            <Bouton type="submit">Calculer</Bouton>
          </form>
        </Carte>
      )}
      {erreur ? <Bandeau ton="danger" role="alert">{erreur}</Bandeau> : null}
      {resultat ? <Resultats r={resultat} /> : null}
    </main>
  );
}
