import Link from "next/link";

import { ComplementsSouscripteur } from "@/composants/ComplementsSouscripteur";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUnClient } from "./actions";

export default async function PageClients() {
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const [clients, niveau] = await Promise.all([listerClients(utilisateur), niveauDuProfil(utilisateur.profil, "CREER_COTATION")]);

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href="/cotations" className="text-primary underline">← Cotations</Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Clients</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral">
        Clients enregistrés, que l'on peut choisir à la cotation. Un prospect, lui, se saisit librement sur la cotation (CDC §9.1).
      </p>
      {peutAgir(niveau) ? (
        <section className="mb-8 max-w-4xl rounded border border-border bg-muted p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter un client</h2>
          <FormulaireAction action={creerUnClient} libelleBouton="Ajouter">
            <label className="mb-4 block text-sm font-medium">
              Type
              <select name="souscripteur_type" defaultValue="PHYSIQUE" className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2">
                <option value="PHYSIQUE">Personne physique</option>
                <option value="MORALE">Personne morale</option>
              </select>
            </label>
            <Champ nom="souscripteur_nom" libelle="Nom (personne physique)" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_prenoms" libelle="Prénoms" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_raison_sociale" libelle="Raison sociale (personne morale)" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_telephone" libelle="Téléphone" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_email" libelle="E-mail" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_adresse" libelle="Adresse" requis={false} autoComplete="off" />
            <ComplementsSouscripteur />
          </FormulaireAction>
        </section>
      ) : null}
      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Nom</th><th className="p-2">Type</th><th className="p-2">Téléphone</th><th className="p-2">E-mail</th></tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-border">
              <td className="p-2 font-medium">{c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`}</td>
              <td className="p-2">{c.souscripteur.type === "MORALE" ? "Morale" : "Physique"}</td>
              <td className="p-2">{c.souscripteur.telephone || "—"}</td>
              <td className="p-2">{c.souscripteur.email || "—"}</td>
            </tr>
          ))}
          {clients.length === 0 ? (<tr><td colSpan={4} className="p-4 text-center text-neutral">Aucun client enregistré.</td></tr>) : null}
        </tbody>
      </table>
    </main>
  );
}
