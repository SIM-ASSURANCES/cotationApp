import { redirect } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, Champ as ChampSaisie, EnTetePage, ListeDeroulante, Tableau, ZoneTexte, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { consulterFormatNumeroPolice, consulterFormatsNumero, consulterSociete } from "@/serveur/societe";
import { ErreurAcces } from "@/serveur/types";

import { enregistrerLaSociete, enregistrerLeFormatNumero, enregistrerLeFormatPolice, enregistrerUneImage } from "./actions";

const lignes = (liste: Record<string, string>[], cles: [string, string]) => liste.map((x) => `${x[cles[0]]} ; ${x[cles[1]]}`).join("\n");
const MONO = "font-mono text-xs";

/** Paramètres de la Société (CDC §6.1 : jamais écrits en dur dans les modèles) : societe.*, mentions, images. */
export default async function PageSociete() {
  const utilisateur = await exigerUtilisateur();
  let lu;
  try {
    lu = { ...(await consulterSociete(utilisateur)), formatPolice: await consulterFormatNumeroPolice(utilisateur), formats: await consulterFormatsNumero(utilisateur) };
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  const ecriture = peutAgir(await niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"));
  const { societe: s, document: m } = lu.parametres;

  type HistoriquePolice = (typeof lu.formatPolice.historique)[number];
  const colonnesPolice: ColonneTableau<HistoriquePolice>[] = [
    { cle: "dateEffet", entete: "À partir du", rendu: (h) => formaterDate(h.dateEffet) },
    { cle: "format", entete: "Format", rendu: (h) => <span className={MONO}>{h.valeur}</span> },
    { cle: "creePar", entete: "Saisi par", rendu: (h) => h.creePar },
    { cle: "creeLe", entete: "Saisi le", rendu: (h) => h.creeLe.toISOString().slice(0, 16).replace("T", " ") },
  ];
  type FormatNumero = (typeof lu.formats)[number];
  const colonnesFormats: ColonneTableau<FormatNumero>[] = [
    { cle: "document", entete: "Document", rendu: (x) => x.libelle },
    { cle: "enVigueur", entete: "Format en vigueur", rendu: (x) => <span className={MONO}>{x.enVigueur}</span> },
    { cle: "exemple", entete: "Exemple", rendu: (x) => <span className={MONO}>{x.exemple}</span> },
    {
      cle: "historique",
      entete: "Historique",
      rendu: (x) => <span className="text-xs">{x.historique.length === 0 ? "défaut" : x.historique.map((h) => `${formaterDate(h.dateEffet)} : ${h.valeur} (${h.creePar})`).join(" ; ")}</span>,
    },
  ];

  return (
    <main className="max-w-4xl space-y-6">
      <EnTetePage titre="Société" />
      <p className="text-sm text-muted-foreground">
        Valeurs de <code>societe.*</code> et mentions des documents (lieu d&apos;émission, signataire), en vigueur aujourd&apos;hui. Une
        modification s&apos;ajoute avec sa date d&apos;effet : les documents déjà émis ne changent jamais.
      </p>

      <Carte titre="Identité et mentions des documents">
        <FormulaireAction action={enregistrerLaSociete} libelleBouton={ecriture ? "Enregistrer" : "Consultation seule"}>
          <fieldset disabled={!ecriture} className="grid min-w-0 gap-x-6 sm:grid-cols-2">
            <Champ nom="raison_sociale" libelle="Raison sociale" valeur={s.raison_sociale} autoComplete="off" />
            <Champ nom="forme" libelle="Forme juridique" requis={false} valeur={s.forme} autoComplete="off" />
            <Champ nom="capital" libelle="Capital (en chiffres)" requis={false} valeur={s.capital} autoComplete="off" />
            <Champ nom="capital_libere" libelle="Part libérée (%)" requis={false} valeur={s.capital_libere} autoComplete="off" />
            <Champ nom="adresse" libelle="Adresse" requis={false} valeur={s.adresse} autoComplete="off" />
            <Champ nom="bp" libelle="Boîte postale" requis={false} valeur={s.bp} autoComplete="off" />
            <Champ nom="telephone" libelle="Téléphone" requis={false} valeur={s.telephone} autoComplete="off" />
            <Champ nom="email_reclamation" libelle="E-mail des réclamations" requis={false} valeur={s.email_reclamation} autoComplete="off" />
            <Champ nom="site" libelle="Site Internet" requis={false} valeur={s.site} autoComplete="off" />
            <Champ nom="rccm" libelle="RCCM" requis={false} valeur={s.rccm} autoComplete="off" />
            <Champ nom="ncc" libelle="NCC" requis={false} valeur={s.ncc} autoComplete="off" />
            <Champ nom="agrement" libelle="Agrément" requis={false} valeur={s.agrement} autoComplete="off" />
            <div className="mb-4">
              <ZoneTexte label="Comptes bancaires (une ligne : banque ; n° de compte)" name="rib" rows={3} defaultValue={lignes(s.rib, ["banque", "numero"])} className="font-mono" />
            </div>
            <div className="mb-4">
              <ZoneTexte label="Mobile Money (une ligne : opérateur ; n° marchand)" name="mobile_money" rows={3} defaultValue={lignes(s.mobile_money, ["operateur", "numero_marchand"])} className="font-mono" />
            </div>
            <div className="mb-4 sm:col-span-2">
              <ZoneTexte label="Recours (une ligne : organisme ; adresse du site)" name="recours" rows={3} defaultValue={lignes(s.recours, ["libelle", "url"])} className="font-mono" />
            </div>
            <Champ nom="lieu_emission" libelle="Lieu d'émission des documents" valeur={m.lieu_emission} autoComplete="off" />
            <Champ nom="signataire_nom" libelle="Signataire (nom)" requis={false} valeur={m.signataire_nom} autoComplete="off" />
            <Champ nom="signataire_fonction" libelle="Signataire (fonction)" requis={false} valeur={m.signataire_fonction} autoComplete="off" />
            <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA)" valeur={aujourdhui()} min={aujourdhui()} />
          </fieldset>
        </FormulaireAction>
      </Carte>

      <Carte
        titre="Images"
        description={
          <>
            Signature scannée : {lu.images.signature_sim ? "paramétrée" : "absente"} · cachet : {lu.images.cachet_sim ? "paramétré" : "absent"}. Un modèle
            qui utilise <code>{"{{ signature_sim }}"}</code> ou <code>{"{{ cachet_sim }}"}</code> ne peut pas être émis sans elle.
          </>
        }
      >
        {ecriture ? (
          <FormulaireAction action={enregistrerUneImage} libelleBouton="Enregistrer l'image">
            <div className="mb-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <ListeDeroulante
                label="Image"
                name="nom"
                options={[
                  { valeur: "signature_sim", libelle: "Signature scannée" },
                  { valeur: "cachet_sim", libelle: "Cachet" },
                ]}
              />
              <ChampSaisie
                label="Fichier PNG (2 Mo au plus)"
                name="fichier"
                type="file"
                accept="image/png"
                required
                className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium file:text-secondary-foreground"
              />
              <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA)" valeur={aujourdhui()} min={aujourdhui()} />
            </div>
          </FormulaireAction>
        ) : null}
      </Carte>

      <Carte
        titre="Format du numéro de police"
        description={
          <>
            Le numéro de police est attribué par SIM et saisi à l&apos;acceptation de la cotation : le module ne le génère jamais. Il est contrôlé par cette
            expression régulière (en vigueur : <code>{lu.formatPolice.enVigueur}</code>). Signification des 5 chiffres après G ou I : à confirmer (H31).
          </>
        }
      >
        {ecriture ? (
          <FormulaireAction action={enregistrerLeFormatPolice} libelleBouton="Enregistrer le format">
            <div className="mb-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Champ nom="format" libelle="Expression régulière (commence par ^, finit par $)" valeur={lu.formatPolice.enVigueur} autoComplete="off" />
              </div>
              <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA)" valeur={aujourdhui()} min={aujourdhui()} />
            </div>
          </FormulaireAction>
        ) : null}
        <div className="mt-4">
          {lu.formatPolice.historique.length > 0 ? (
            <Tableau colonnes={colonnesPolice} lignes={lu.formatPolice.historique} cleLigne={(h) => `${h.dateEffet}-${h.valeur}`} legende="Historique du format du numéro de police" />
          ) : (
            <p className="text-sm text-muted-foreground">Format par défaut, jamais modifié.</p>
          )}
        </div>
      </Carte>

      <Carte
        titre="Numéros des documents (cotation, facture, avoir, reçu)"
        description={
          <>
            Attribués par le module à l&apos;émission, sans trou. Repères : <code>{"{AAAA}"}</code> l&apos;année (obligatoire), <code>{"{MM}"}</code> le mois
            d&apos;émission (facultatif), <code>{"{NNNN}"}</code> le compteur sur 3 à 8 chiffres (obligatoire). Le compteur est annuel et ne change pas avec le format.
          </>
        }
      >
        <div className="mb-4">
          <Tableau colonnes={colonnesFormats} lignes={lu.formats} cleLigne={(x) => x.prefixe} legende="Formats de numéro des documents" />
        </div>
        {ecriture ? (
          <FormulaireAction action={enregistrerLeFormatNumero} libelleBouton="Enregistrer le format">
            <div className="mb-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <ListeDeroulante label="Document" name="prefixe" required invite="— Choisir —" options={lu.formats.map((x) => ({ valeur: x.prefixe, libelle: x.libelle }))} />
              <Champ nom="format" libelle="Format (ex. FAC-{AAAA}-{MM}-{NNNN})" autoComplete="off" />
              <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA)" valeur={aujourdhui()} min={aujourdhui()} />
            </div>
          </FormulaireAction>
        ) : null}
      </Carte>
    </main>
  );
}
