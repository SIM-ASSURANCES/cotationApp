import { redirect } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { consulterSociete } from "@/serveur/societe";
import { ErreurAcces } from "@/serveur/types";

import { enregistrerLaSociete, enregistrerUneImage } from "./actions";

const zone = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2 font-mono text-sm";
const lignes = (liste: Record<string, string>[], cles: [string, string]) => liste.map((x) => `${x[cles[0]]} ; ${x[cles[1]]}`).join("\n");

/** Paramètres de la Société (CDC §6.1 : jamais écrits en dur dans les modèles) : societe.*, mentions, images. */
export default async function PageSociete() {
  const utilisateur = await exigerUtilisateur();
  let lu;
  try {
    lu = await consulterSociete(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  const ecriture = peutAgir(await niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"));
  const { societe: s, document: m } = lu.parametres;

  return (
    <main className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Société</h1>
      <p className="mb-6 text-sm text-zinc-700">
        Valeurs de <code>societe.*</code> et mentions des documents (lieu d&apos;émission, signataire), en vigueur aujourd&apos;hui. Une
        modification s&apos;ajoute avec sa date d&apos;effet : les documents déjà émis ne changent jamais.
      </p>
      <FormulaireAction action={enregistrerLaSociete} libelleBouton={ecriture ? "Enregistrer" : "Consultation seule"}>
        <fieldset disabled={!ecriture} className="grid gap-x-6 sm:grid-cols-2">
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
          <label className="mb-4 block text-sm font-medium">
            Comptes bancaires (une ligne : banque ; n° de compte)
            <textarea name="rib" rows={3} defaultValue={lignes(s.rib, ["banque", "numero"])} className={zone} />
          </label>
          <label className="mb-4 block text-sm font-medium">
            Mobile Money (une ligne : opérateur ; n° marchand)
            <textarea name="mobile_money" rows={3} defaultValue={lignes(s.mobile_money, ["operateur", "numero_marchand"])} className={zone} />
          </label>
          <label className="mb-4 block text-sm font-medium sm:col-span-2">
            Recours (une ligne : organisme ; adresse du site)
            <textarea name="recours" rows={3} defaultValue={lignes(s.recours, ["libelle", "url"])} className={zone} />
          </label>
          <Champ nom="lieu_emission" libelle="Lieu d'émission des documents" valeur={m.lieu_emission} autoComplete="off" />
          <Champ nom="signataire_nom" libelle="Signataire (nom)" requis={false} valeur={m.signataire_nom} autoComplete="off" />
          <Champ nom="signataire_fonction" libelle="Signataire (fonction)" requis={false} valeur={m.signataire_fonction} autoComplete="off" />
          <Champ nom="dateEffet" libelle="À partir du (AAAA-MM-JJ)" valeur={aujourdhui()} autoComplete="off" />
        </fieldset>
      </FormulaireAction>

      <h2 className="mb-2 mt-8 text-lg font-semibold">Images</h2>
      <p className="mb-3 text-sm text-zinc-700">
        Signature scannée : {lu.images.signature_sim ? "paramétrée" : "absente"} · cachet : {lu.images.cachet_sim ? "paramétré" : "absent"}. Un modèle
        qui utilise <code>{"{{ signature_sim }}"}</code> ou <code>{"{{ cachet_sim }}"}</code> ne peut pas être émis sans elle.
      </p>
      {ecriture ? (
        <FormulaireAction action={enregistrerUneImage} libelleBouton="Enregistrer l'image">
          <div className="grid gap-x-6 sm:grid-cols-3">
            <label className="mb-4 block text-sm font-medium">
              Image
              <select name="nom" className="mt-1 block w-full rounded border border-bordure bg-white px-3 py-2">
                <option value="signature_sim">Signature scannée</option>
                <option value="cachet_sim">Cachet</option>
              </select>
            </label>
            <label className="mb-4 block text-sm font-medium">
              Fichier PNG (2 Mo au plus)
              <input name="fichier" type="file" accept="image/png" required className="mt-1 block w-full" />
            </label>
            <Champ nom="dateEffet" libelle="À partir du (AAAA-MM-JJ)" valeur={aujourdhui()} autoComplete="off" />
          </div>
        </FormulaireAction>
      ) : null}
    </main>
  );
}
