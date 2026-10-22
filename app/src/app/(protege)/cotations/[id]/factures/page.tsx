import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AvertissementsReports } from "@/composants/AvertissementsReports";
import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, Champ as ChampSaisie, EnTetePage, ListeDeroulante, PastilleStatut, Tableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { CANAUX_PAIEMENT, LIBELLE_CANAL } from "@/domaine/facturation/factures";
import { facturesDePolice } from "@/serveur/factures";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { creerFacture, restituerLAvance } from "../../../factures/actions";

const f = (m: string) => formaterMontant(montant(m));

/** « Envoyé à » (CDC §11.2) : facultatif ; masqué sur la facture s'il est vide ou identique à « Facturé à ». */
function EnvoyeA() {
  return (
    <fieldset className="mb-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">« Envoyé à » (facultatif, s'il diffère du souscripteur)</legend>
      <ChampSaisie label="Destinataire" name="envoyeNom" autoComplete="off" />
      <ChampSaisie label="Adresse" name="envoyeAdresse" autoComplete="off" />
    </fieldset>
  );
}

export default async function PageFacturesDePolice(props: PageProps<"/cotations/[id]/factures">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let vue;
  try {
    vue = Number.isInteger(Number(id)) ? await facturesDePolice(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!vue) notFound();
  const { police, possibles } = vue;
  const cache = (type: string) => (
    <>
      <input type="hidden" name="policeId" value={police.id} />
      <input type="hidden" name="type" value={type} />
    </>
  );

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`Factures de la police ${police.numero}`}
        sousTitre={`${police.souscripteur}, du ${formaterDate(police.dateEffet)} au ${formaterDate(police.dateEcheance)}. Une facture se prépare en brouillon (sans numéro) ; son numéro FAC est attribué à l'émission. Émise, elle ne se modifie plus : une correction passe par un avoir puis une nouvelle facture.`}
        filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Cotation", href: `/cotations/${police.cotationId}` }, { libelle: "Factures" }]}
      />

      <Carte titre="Factures et avoirs">
        <Tableau
          legende="Factures et avoirs de la police"
          lignes={vue.factures}
          cleLigne={(x) => String(x.id)}
          messageVide="Aucune facture pour cette police."
          colonnes={[
            {
              cle: "numero",
              entete: "Numéro",
              rendu: (x) => (
                <Link href={`/factures/${x.id}`} className="text-primary underline">
                  {x.numero ?? `Brouillon n° ${x.id}`}
                </Link>
              ),
            },
            { cle: "type", entete: "Type", rendu: (x) => x.libelleType },
            { cle: "statut", entete: "Statut", rendu: (x) => <PastilleStatut libelle={x.libelleStatut} /> },
            { cle: "periode", entete: "Période", rendu: (x) => `${formaterDate(x.dateEffet)} → ${formaterDate(x.dateEcheance)}` },
            { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (x) => f(x.ttc) },
            { cle: "restant", entete: "Restant dû", alignement: "droite", rendu: (x) => (x.restantDu === null ? "—" : f(x.restantDu)) },
            { cle: "pdf", entete: "PDF", rendu: (x) => (x.pdfEnAttente > 0 ? "En attente" : x.numero ? "Produit" : "—") },
          ]}
        />
      </Carte>

      {/* Ancre « #avance » : des liens d'autres écrans y mènent. */}
      <div id="avance" className="space-y-6">
        <Carte titre="Avance de la police">
          <p className="mb-4 text-sm">
            <strong>Solde créditeur :</strong> {f(vue.avance.disponible)} F. Un trop-perçu, ou la somme déjà payée d&apos;une facture annulée par un avoir, vient ici ; elle s&apos;impute sur une facture de la police (depuis la facture) ou se restitue.
          </p>
          {vue.avance.mouvements.length > 0 ? (
            <Tableau
              legende="Mouvements de l'avance"
              lignes={vue.avance.mouvements}
              cleLigne={(m) => String(m.id)}
              colonnes={[
                { cle: "date", entete: "Date", rendu: (m) => formaterDate(m.date) },
                { cle: "mouvement", entete: "Mouvement", rendu: (m) => m.libelle },
                { cle: "montant", entete: "Montant", alignement: "droite", rendu: (m) => `${m.credit ? "+" : "−"} ${f(m.montant)}` },
                { cle: "facture", entete: "Facture", rendu: (m) => m.facture ?? "—" },
                { cle: "recu", entete: "Reçu d'origine", rendu: (m) => m.recu ?? "—" },
                { cle: "canal", entete: "Canal, référence", rendu: (m) => (m.canal ? `${m.canal}${m.reference ? `, ${m.reference}` : ""}` : "—") },
                { cle: "par", entete: "Par", rendu: (m) => m.par },
              ]}
            />
          ) : null}
        </Carte>

        {vue.droits.restituer && montant(vue.avance.disponible).greaterThan(0) ? (
          <Carte titre="Restituer l'avance" description="Remboursement au client, tracé au journal. Aucun document n'est produit.">
            <AvertissementsReports reports={vue.avance.reportsEnAttente} />
            <FormulaireAction action={restituerLAvance} libelleBouton="Enregistrer la restitution">
              <input type="hidden" name="policeId" value={police.id} />
              <input type="hidden" name="cotationId" value={police.cotationId} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <ChampDate nom="date" libelle="Date (JJ/MM/AAAA)" valeur={aujourdhui()} max={aujourdhui()} />
                <Champ nom="montant" libelle={`Montant (au plus ${f(vue.avance.disponible)} F)`} valeur={vue.avance.disponible} autoComplete="off" />
                <div className="mb-4">
                  <ListeDeroulante label="Canal" name="canal" required defaultValue="" invite="— Choisir —" options={CANAUX_PAIEMENT.map((k) => ({ valeur: k, libelle: LIBELLE_CANAL[k] }))} />
                </div>
                <Champ nom="reference" libelle="Référence (obligatoire sauf espèces)" requis={false} autoComplete="off" />
              </div>
            </FormulaireAction>
          </Carte>
        ) : null}
      </div>

      {vue.droits.creer ? (
        <>
          <Carte titre="Affaire nouvelle">
            {possibles.affaireNouvelle ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer la facture (brouillon)">
                {cache("AFFAIRE_NOUVELLE")}
                <p className="mb-3 text-sm text-neutral">Montants et échéancier de la police (moteur de calcul), à l'identique des conditions particulières.</p>
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">{police.cpEmises ? "La facture d'affaire nouvelle existe déjà (voir ci-dessus)." : "Émettez d'abord les conditions particulières de la police."}</p>
            )}
          </Carte>

          <Carte titre="Renouvellement">
            {possibles.renouvellement ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer le renouvellement (brouillon)">
                {cache("RENOUVELLEMENT")}
                <p className="mb-3 text-sm text-neutral">
                  Période proposée : du {formaterDate(possibles.renouvellement.dateEffet)} au {formaterDate(possibles.renouvellement.dateEcheance)}.{" "}
                  {police.composee
                    ? "La composition de la période précédente sera reprise en brouillon et devra être confirmée par la Technique (« Composer une prime »)."
                    : "Au tarif en vigueur à cette date. Formules et effectifs de la période précédente, modifiables dans le brouillon."}
                </p>
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">Le renouvellement suit une facture émise (affaire nouvelle ou renouvellement précédent).</p>
            )}
          </Carte>

          <Carte titre="Avenant d'incorporation">
            {possibles.avenants.length > 0 ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer l'avenant (brouillon)">
                {cache("AVENANT")}
                <div className="mb-3 max-w-xl">
                  <ListeDeroulante
                    label="Incorporation à facturer"
                    name="adherentsVersion"
                    required
                    defaultValue=""
                    invite="— Choisir —"
                    options={possibles.avenants.map((a) => ({ valeur: String(a.numero), libelle: `Version ${a.numero} : ${a.adherents} adhérent(s), effet le ${formaterDate(a.dateEffet)}` }))}
                  />
                </div>
                {police.composee ? (
                  <p className="mb-3 text-sm text-neutral">La facture d&apos;avenant sera préparée sans montant ; la Technique composera la prime additionnelle dans le brouillon.</p>
                ) : (
                  <div className="mb-3 text-sm">
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" name="prorata" value="oui" defaultChecked className="size-4 accent-primary" /> Prorata temporis
                    </label>
                    <p className="mt-1 text-neutral">
                      Cochée : prime additionnelle au prorata, du jour de l&apos;incorporation à l&apos;échéance de la période facturée. Décochée : prime entière de la période. Le choix est figé dans le brouillon ; pour le changer, abandonnez le brouillon et refaites l&apos;avenant.
                    </p>
                  </div>
                )}
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">Aucune incorporation d'adhérents à facturer.</p>
            )}
          </Carte>
        </>
      ) : null}
    </main>
  );
}
