"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import type { EnvoyeA } from "@/domaine/facturation/factures";
import {
  creerFactureAffaireNouvelle,
  creerFactureAvenant,
  creerFactureRenouvellement,
  emettreAvoir,
  emettreFacture,
  enregistrerPaiement,
  modifierFacture,
  relancerPdf,
  type ResultatEmission,
} from "@/serveur/factures";
import type { IssueProduction } from "@/serveur/production";

import { avecMessage, champ, executerAction } from "../executer";

/** « Envoyé à » saisi : null si les deux champs sont vides. */
function lireEnvoyeA(d: FormData): EnvoyeA | null {
  const nom = champ(d, "envoyeNom");
  const adresse = champ(d, "envoyeAdresse");
  return nom === "" && adresse === "" ? null : { nom, adresse };
}

/** Effectifs saisis pour un renouvellement (colonnes formule_code / formule_effectif) ; null s'ils ne sont pas saisis. */
function lireLignes(d: FormData): { codeFormule: string; effectif: number }[] | null {
  const codes = d.getAll("formule_code").map((v) => String(v).trim());
  if (codes.length === 0) return null;
  const effectifs = d.getAll("formule_effectif").map((v) => Number(String(v).trim()));
  return codes.map((codeFormule, i) => ({ codeFormule, effectif: effectifs[i] }));
}

const tranches = (d: FormData) => (champ(d, "nombreTranches") ? Number(champ(d, "nombreTranches")) : null);
const identifiant = (d: FormData, nom: string) => Number(champ(d, nom));

/** Bilan des PDF à produire après l'émission : « PDF en attente » n'est pas un échec de l'émission. */
function bilan(productions: IssueProduction[]): string[] {
  return productions.filter((p) => !p.ok).map((p) => `PDF en attente pour ${p.numero} (version ${p.version}) : ${"erreur" in p ? p.erreur : ""}. Le numéro est attribué ; relancez la production depuis cette page.`);
}

export async function creerFacture(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const policeId = identifiant(d, "policeId");
  const type = champ(d, "type");
  const r = await avecMessage(async (acteur, ip) => {
    if (type === "AFFAIRE_NOUVELLE") return creerFactureAffaireNouvelle(acteur, policeId, lireEnvoyeA(d), ip);
    if (type === "RENOUVELLEMENT") return creerFactureRenouvellement(acteur, policeId, { lignes: lireLignes(d), nombreTranches: tranches(d), envoyeA: lireEnvoyeA(d) }, ip);
    return creerFactureAvenant(acteur, policeId, identifiant(d, "adherentsVersion"), lireEnvoyeA(d), ip);
  });
  if (!r.ok) return r.etat;
  redirect(`/factures/${r.valeur}`);
}

export async function modifierLaFacture(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = identifiant(d, "factureId");
  return executerAction(
    async (acteur, ip) => void (await modifierFacture(acteur, id, { lignes: lireLignes(d), nombreTranches: tranches(d), envoyeA: lireEnvoyeA(d) }, ip)),
    "Brouillon modifié.",
    `/factures/${id}`,
  );
}

export async function emettreLaFacture(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = identifiant(d, "factureId");
  let r: ResultatEmission | null = null;
  return executerAction(
    async (acteur, ip) => {
      r = await emettreFacture(acteur, id, ip);
      return r.statut === "EMISE" ? bilan(r.productions) : [];
    },
    () =>
      r?.statut === "A_VALIDER"
        ? `Le TTC (${r.ttc} F) dépasse le seuil du produit (${r.seuil ?? "?"} F) : facture « À valider ». Un profil habilité, autre que vous, l'émettra.`
        : `Facture émise : ${r?.statut === "EMISE" ? r.numero : ""}.`,
    `/factures/${id}`,
  );
}

export async function emettreLAvoir(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = identifiant(d, "factureId");
  const r = await avecMessage(async (acteur, ip) => emettreAvoir(acteur, id, champ(d, "motif"), ip));
  if (!r.ok) return r.etat;
  redirect(`/factures/${r.valeur.avoirId}`);
}

export async function enregistrerLePaiement(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = identifiant(d, "factureId");
  let numero = "";
  let restant = "";
  return executerAction(
    async (acteur, ip) => {
      const r = await enregistrerPaiement(acteur, id, { date: champ(d, "date"), montant: champ(d, "montant"), canal: champ(d, "canal"), reference: champ(d, "reference"), payeur: champ(d, "payeur") }, ip);
      numero = r.numeroRecu;
      restant = r.restantDu;
      return bilan(r.productions);
    },
    () => `Paiement enregistré : reçu ${numero}, restant dû ${restant} F. La facture est rééditée (version suivante).`,
    `/factures/${id}`,
  );
}

export async function relancerLesPdf(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = identifiant(d, "factureId");
  return executerAction(async (acteur, ip) => bilan(await relancerPdf(acteur, id, ip)), "Production relancée.", `/factures/${id}`);
}
