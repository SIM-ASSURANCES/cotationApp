import Link from "next/link";
import type { ReactNode } from "react";

import { Carte, Pastille, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import type { GroupeBranche, GroupeProduit } from "@/domaine/documents/regroupement-modeles";
import type { LigneAPublier, LigneModele } from "@/serveur/modeles";

import { PastilleVersion } from "./pastille-version";

const lienModele = (m: LigneModele) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    <Link href={`/modeles/${m.id}`} className="font-semibold text-primary hover:underline">
      {m.code || "—"}
    </Link>
    {m.codeCgManquant ? <PastilleStatut libelle="Code CG manquant" /> : null}
  </span>
);

const enVigueur = (m: LigneModele) => (m.enVigueur ? `v${m.enVigueur.numero} depuis le ${formaterDate(m.enVigueur.dateEffet)}` : "aucune");
const derniere = (m: LigneModele) =>
  m.derniere ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>v{m.derniere.numero}</span>
      <PastilleVersion statut={m.derniere.statut} libelle={m.derniere.libelleStatut} />
    </span>
  ) : (
    "aucun dépôt"
  );

/** Colonnes du tableau des modèles « libres » (communs d'une branche, transversaux). */
export const COLONNES_MODELES: ColonneTableau<LigneModele>[] = [
  { cle: "code", entete: "Code", rendu: lienModele },
  {
    cle: "type",
    entete: "Type",
    rendu: (m) => (
      <>
        <span className="font-medium text-foreground">{m.libelleType}</span>
        {m.precision ? <span className="block text-xs text-muted-foreground">{m.precision}</span> : null}
      </>
    ),
  },
  { cle: "libelle", entete: "Libellé", rendu: (m) => m.libelle },
  { cle: "produit", entete: "Produit", rendu: (m) => m.produitCode ?? "commun" },
  { cle: "vigueur", entete: "En vigueur", rendu: enVigueur },
  { cle: "derniere", entete: "Dernière version", rendu: derniere },
];

/** Une ligne du tableau d'un produit : un modèle attendu (déposé ou manquant) ou un autre modèle du produit. */
type LigneProduit = { cle: string; type: ReactNode; modele: LigneModele | null };

function lignesDuProduit(g: GroupeProduit<LigneModele>): LigneProduit[] {
  const attendus = g.attendus.flatMap<LigneProduit>((s) =>
    s.modeles.length === 0
      ? [{ cle: `${s.type}-manquant`, type: <span className="font-medium text-foreground">{s.libelle}</span>, modele: null }]
      : s.modeles.map((m) => ({ cle: `${s.type}-${m.id}`, type: <span className="font-medium text-foreground">{s.libelle}</span>, modele: m })),
  );
  const autres = g.autres.map<LigneProduit>((m) => ({
    cle: `autre-${m.id}`,
    type: (
      <>
        <span className="text-foreground">{m.libelleType}</span>
        {m.precision ? <span className="block text-xs text-muted-foreground">{m.precision}</span> : null}
      </>
    ),
    modele: m,
  }));
  return [...attendus, ...autres];
}

const COLONNES_PRODUIT: ColonneTableau<LigneProduit>[] = [
  { cle: "type", entete: "Modèle", rendu: (l) => l.type },
  { cle: "code", entete: "Code", rendu: (l) => (l.modele ? lienModele(l.modele) : <PastilleStatut libelle="Manquant" />) },
  { cle: "libelle", entete: "Libellé", rendu: (l) => l.modele?.libelle ?? "" },
  { cle: "vigueur", entete: "En vigueur", rendu: (l) => (l.modele ? enVigueur(l.modele) : "") },
  { cle: "derniere", entete: "Dernière version", rendu: (l) => (l.modele ? derniere(l.modele) : "") },
];

function CarteProduit({ g }: { g: GroupeProduit<LigneModele> }) {
  return (
    <Carte
      titre={`${g.produit.code} — ${g.produit.libelle}`}
      description={
        g.manquants === 0 ? (
          "Cotation, CP et certificat sont déposés."
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <PastilleStatut libelle="Manquant">{`${g.manquants} modèle${g.manquants > 1 ? "s" : ""} manquant${g.manquants > 1 ? "s" : ""}`}</PastilleStatut>
            <span>sur les trois attendus : cotation, CP, certificat.</span>
          </span>
        )
      }
    >
      <Tableau colonnes={COLONNES_PRODUIT} lignes={lignesDuProduit(g)} cleLigne={(l) => l.cle} legende={`Modèles du produit ${g.produit.code}`} />
    </Carte>
  );
}

/**
 * Les modèles d'une branche rangés par produit (D63) : une carte par produit (ses modèles déposés et ceux qui manquent), puis les
 * modèles sans produit (conditions générales, modèles communs). `titre` : intitulé de la branche, quand plusieurs se suivent.
 */
export function GroupeBrancheModeles({ groupe, titre }: { groupe: GroupeBranche<LigneModele>; titre?: string }) {
  if (groupe.produits.length === 0 && groupe.communs.length === 0) return null;
  return (
    <section className="space-y-4" aria-label={titre}>
      {titre ? <h2 className="text-lg font-bold text-foreground">{titre}</h2> : null}
      {groupe.produits.map((g) => (
        <CarteProduit key={g.produit.code} g={g} />
      ))}
      {groupe.communs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-base font-bold text-foreground">{groupe.branche ? "Modèles communs de la branche" : "Modèles sans produit"}</h3>
          <Tableau colonnes={COLONNES_MODELES} lignes={groupe.communs} cleLigne={(m) => String(m.id)} legende={`Modèles sans produit${titre ? ` : ${titre}` : ""}`} />
        </div>
      ) : null}
    </section>
  );
}

/** Vue « À valider / À publier » : les versions soumises que le profil peut publier (le valideur n'est jamais l'auteur). */
export function TableauAPublier({ lignes }: { lignes: LigneAPublier[] }) {
  const colonnes: ColonneTableau<LigneAPublier>[] = [
    { cle: "code", entete: "Modèle", rendu: lienModele },
    { cle: "type", entete: "Type", rendu: (m) => m.libelleType },
    { cle: "produit", entete: "Produit", rendu: (m) => m.produitCode ?? "commun" },
    {
      cle: "branche",
      entete: "Branche",
      rendu: (m) => (m.branchePrincipaleLibelle ? m.branchePrincipaleLibelle : <Pastille>Transversal / commun</Pastille>),
    },
    { cle: "version", entete: "Version soumise", rendu: (m) => `v${m.version.numero}` },
    { cle: "auteur", entete: "Déposée par", rendu: (m) => m.version.auteur },
    { cle: "soumis", entete: "Soumise le", rendu: (m) => (m.version.soumisLe ? formaterDate(m.version.soumisLe.toISOString().slice(0, 10)) : "—") },
    {
      cle: "ouvrir",
      entete: "Action",
      rendu: (m) => (
        <Link href={`/modeles/${m.id}`} className="font-semibold text-primary hover:underline">
          Examiner et publier
        </Link>
      ),
    },
  ];
  return <Tableau colonnes={colonnes} lignes={lignes} cleLigne={(m) => `${m.id}-${m.version.id}`} messageVide="Aucune version n'attend votre publication." legende="Versions à publier" />;
}
