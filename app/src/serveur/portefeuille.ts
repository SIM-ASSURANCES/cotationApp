import "server-only";

import { formaterDate } from "@/domaine/calcul/dates";
import { LIBELLE_STATUT, type StatutCotation } from "@/domaine/cotation/statuts";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import { peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, type UtilisateurCourant } from "./types";

export type BranchePortefeuille = {
  code: string;
  libelle: string;
  nombreProduits: number;
  nombreClients: number;
  nombrePolices: number;
};

export type ProduitPortefeuille = {
  code: string;
  libelle: string;
  gamme: string;
  modeTarification: "FORMULE" | "GARANTIES";
  nombreClients: number;
  nombreCotations: number;
  nombrePolices: number;
};

export type ClientPortefeuille = {
  identifiant: string;
  type: "MORALE" | "PHYSIQUE";
  nom: string;
  telephone: string;
  email: string;
  adresse: string;
  nombreCotations: number;
  nombrePolices: number;
  estClientEnregistre: boolean;
  clientId: number | null;
  cotationIdOrigine: number;
};

export type PieceClientPortefeuille = {
  branche: { code: string; libelle: string };
  produit: { code: string; libelle: string };
  client: {
    identifiant: string;
    nom: string;
    type: "MORALE" | "PHYSIQUE";
    telephone: string;
    email: string;
    adresse: string;
  };
  cotations: {
    id: number;
    numero: string | null;
    statut: string;
    statutLibelle: string;
    dateEffet: string;
    dateEcheance: string;
    ttc: string | null;
    creeLe: Date;
    police: {
      id: number;
      numero: string;
      dateEffet: string;
      dateEcheance: string;
    } | null;
  }[];
};

export async function exigerAccesPortefeuille(acteur: UtilisateurCourant): Promise<void> {
  const [cotation, contrat] = await Promise.all([
    niveauDuProfil(acteur.profil, "CREER_COTATION"),
    niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT"),
  ]);
  if (!peutLire(cotation) && !peutLire(contrat)) {
    throw new ErreurAcces("Droit insuffisant : consultation du portefeuille.");
  }
}

function nomSouscripteur(s: Souscripteur): string {
  if (s.type === "MORALE") return s.raison_sociale || s.nom || "Sans nom";
  return `${s.nom ?? ""} ${s.prenoms ?? ""}`.trim() || "Sans nom";
}

const depuisDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Niveau 1 : Liste des 5 branches principales avec leurs compteurs.
 */
export async function listerBranchesPortefeuille(acteur: UtilisateurCourant): Promise<BranchePortefeuille[]> {
  await exigerAccesPortefeuille(acteur);
  const prisma = obtenirPrisma();

  const [branches, produits, cotations] = await Promise.all([
    prisma.branchePrincipale.findMany({ orderBy: { code: "asc" } }),
    prisma.produit.findMany({
      where: { actif: true },
      select: { code: true, branchePrincipale: true },
    }),
    prisma.cotation.findMany({
      select: {
        id: true,
        clientId: true,
        souscripteur: true,
        produit: { select: { branchePrincipale: true } },
        police: { select: { id: true } },
      },
    }),
  ]);

  return branches.map((b) => {
    const prodsBranche = produits.filter((p) => p.branchePrincipale === b.code);
    const cotationsBranche = cotations.filter((c) => c.produit.branchePrincipale === b.code);

    // Clients uniques de cette branche : clients enregistrés distincts + prospects distincts par cotation
    const clientsEnregistres = new Set(
      cotationsBranche.filter((c) => c.clientId !== null).map((c) => c.clientId),
    );
    const prospects = cotationsBranche.filter((c) => c.clientId === null);
    const totalClients = clientsEnregistres.size + prospects.length;

    const policesCount = cotationsBranche.filter((c) => c.police !== null).length;

    return {
      code: b.code,
      libelle: b.libelle,
      nombreProduits: prodsBranche.length,
      nombreClients: totalClients,
      nombrePolices: policesCount,
    };
  });
}

/**
 * Niveau 2 : Produits rattachés à une branche avec compteurs.
 */
export async function listerProduitsPortefeuille(
  acteur: UtilisateurCourant,
  codeBranche: string,
): Promise<{ branche: { code: string; libelle: string }; produits: ProduitPortefeuille[] }> {
  await exigerAccesPortefeuille(acteur);
  const prisma = obtenirPrisma();

  const branche = await prisma.branchePrincipale.findUnique({ where: { code: codeBranche } });
  if (!branche) {
    throw new ErreurAcces(`Branche inconnue : ${codeBranche}`);
  }

  const produits = await prisma.produit.findMany({
    where: { branchePrincipale: codeBranche, actif: true },
    include: {
      versions: {
        orderBy: { dateEffet: "desc" },
        take: 1,
        select: { garanties: true },
      },
      cotations: {
        select: {
          id: true,
          clientId: true,
          police: { select: { id: true } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  const lignes: ProduitPortefeuille[] = produits.map((p) => {
    const derniereVersion = p.versions[0];
    const modeTarification: "FORMULE" | "GARANTIES" =
      derniereVersion && Array.isArray(derniereVersion.garanties) && derniereVersion.garanties.length > 0
        ? "GARANTIES"
        : "FORMULE";

    const clientsEnregistres = new Set(p.cotations.filter((c) => c.clientId !== null).map((c) => c.clientId));
    const prospects = p.cotations.filter((c) => c.clientId === null);
    const totalClients = clientsEnregistres.size + prospects.length;

    const policesCount = p.cotations.filter((c) => c.police !== null).length;

    return {
      code: p.code,
      libelle: p.libelle,
      gamme: p.gamme,
      modeTarification,
      nombreClients: totalClients,
      nombreCotations: p.cotations.length,
      nombrePolices: policesCount,
    };
  });

  return {
    branche: { code: branche.code, libelle: branche.libelle },
    produits: lignes,
  };
}

/**
 * Niveau 3 : Clients (enregistrés et prospects) ayant souscrit ou coté pour ce produit.
 */
export async function listerClientsPortefeuille(
  acteur: UtilisateurCourant,
  codeBranche: string,
  codeProduit: string,
): Promise<{
  branche: { code: string; libelle: string };
  produit: { code: string; libelle: string };
  clients: ClientPortefeuille[];
}> {
  await exigerAccesPortefeuille(acteur);
  const prisma = obtenirPrisma();

  const [branche, produit] = await Promise.all([
    prisma.branchePrincipale.findUnique({ where: { code: codeBranche } }),
    prisma.produit.findUnique({
      where: { code: codeProduit },
      include: {
        cotations: {
          include: {
            client: true,
            police: { select: { id: true } },
          },
          orderBy: { id: "desc" },
        },
      },
    }),
  ]);

  if (!branche) {
    throw new ErreurAcces(`Branche inconnue : ${codeBranche}`);
  }
  if (!produit || produit.branchePrincipale !== codeBranche) {
    throw new ErreurAcces(`Produit inconnu dans cette branche : ${codeProduit}`);
  }

  // Regroupement des cotations par client
  // - Si clientId != null -> clé "CLI-id"
  // - Si clientId == null -> clé "PROSP-cotationId"
  const groupes = new Map<
    string,
    {
      identifiant: string;
      type: "MORALE" | "PHYSIQUE";
      nom: string;
      telephone: string;
      email: string;
      adresse: string;
      nombreCotations: number;
      nombrePolices: number;
      estClientEnregistre: boolean;
      clientId: number | null;
      cotationIdOrigine: number;
    }
  >();

  for (const c of produit.cotations) {
    const s = c.souscripteur as unknown as Souscripteur;
    const estEnregistre = c.clientId !== null;
    const identifiant = estEnregistre ? `CLI-${c.clientId}` : `PROSP-${c.id}`;

    const existant = groupes.get(identifiant);
    if (!existant) {
      groupes.set(identifiant, {
        identifiant,
        type: s.type === "MORALE" ? "MORALE" : "PHYSIQUE",
        nom: nomSouscripteur(s),
        telephone: s.telephone || "—",
        email: s.email || "—",
        adresse: s.adresse || "—",
        nombreCotations: 1,
        nombrePolices: c.police !== null ? 1 : 0,
        estClientEnregistre: estEnregistre,
        clientId: c.clientId,
        cotationIdOrigine: c.id,
      });
    } else {
      existant.nombreCotations += 1;
      if (c.police !== null) {
        existant.nombrePolices += 1;
      }
    }
  }

  const clients = Array.from(groupes.values()).sort((a, b) => a.nom.localeCompare(b.nom));

  return {
    branche: { code: branche.code, libelle: branche.libelle },
    produit: { code: produit.code, libelle: produit.libelle },
    clients,
  };
}

/**
 * Niveau 4 : Pièces (cotations et polices) d'un client spécifique pour ce produit.
 */
export async function listerPiecesClientPortefeuille(
  acteur: UtilisateurCourant,
  codeBranche: string,
  codeProduit: string,
  identifiantClient: string,
): Promise<PieceClientPortefeuille> {
  await exigerAccesPortefeuille(acteur);
  const prisma = obtenirPrisma();

  const [branche, produit] = await Promise.all([
    prisma.branchePrincipale.findUnique({ where: { code: codeBranche } }),
    prisma.produit.findUnique({ where: { code: codeProduit } }),
  ]);

  if (!branche) {
    throw new ErreurAcces(`Branche inconnue : ${codeBranche}`);
  }
  if (!produit || produit.branchePrincipale !== codeBranche) {
    throw new ErreurAcces(`Produit ${codeProduit} non rattaché à la branche ${codeBranche}`);
  }

  const estEnregistre = identifiantClient.startsWith("CLI-");
  const estProspect = identifiantClient.startsWith("PROSP-");

  if (!estEnregistre && !estProspect) {
    throw new ErreurAcces(`Identifiant client invalide : ${identifiantClient}`);
  }

  let cotations;
  if (estEnregistre) {
    const clientId = parseInt(identifiantClient.slice(4), 10);
    if (isNaN(clientId)) {
      throw new ErreurAcces(`Identifiant client invalide : ${identifiantClient}`);
    }
    cotations = await prisma.cotation.findMany({
      where: {
        produitId: produit.id,
        clientId,
      },
      include: {
        police: { select: { id: true, numero: true, dateEffet: true, dateEcheance: true } },
      },
      orderBy: { id: "desc" },
    });
  } else {
    const cotationId = parseInt(identifiantClient.slice(6), 10);
    if (isNaN(cotationId)) {
      throw new ErreurAcces(`Identifiant prospect invalide : ${identifiantClient}`);
    }
    cotations = await prisma.cotation.findMany({
      where: {
        id: cotationId,
        produitId: produit.id,
      },
      include: {
        police: { select: { id: true, numero: true, dateEffet: true, dateEcheance: true } },
      },
    });
  }

  if (cotations.length === 0) {
    throw new ErreurAcces(`Aucune pièce trouvée pour le client ${identifiantClient} sur le produit ${codeProduit}`);
  }

  const premiere = cotations[0];
  const s = premiere.souscripteur as unknown as Souscripteur;

  const piecesCotations = cotations.map((c) => ({
    id: c.id,
    numero: c.numero,
    statut: c.statut,
    statutLibelle: LIBELLE_STATUT[c.statut as StatutCotation] ?? c.statut,
    dateEffet: formaterDate(depuisDate(c.dateEffet)),
    dateEcheance: formaterDate(depuisDate(c.dateEcheance)),
    ttc: c.ttcTotal !== null ? c.ttcTotal.toFixed(0) : null,
    creeLe: c.creeLe,
    police: c.police
      ? {
          id: c.police.id,
          numero: c.police.numero,
          dateEffet: formaterDate(depuisDate(c.police.dateEffet)),
          dateEcheance: formaterDate(depuisDate(c.police.dateEcheance)),
        }
      : null,
  }));

  return {
    branche: { code: branche.code, libelle: branche.libelle },
    produit: { code: produit.code, libelle: produit.libelle },
    client: {
      identifiant: identifiantClient,
      nom: nomSouscripteur(s),
      type: s.type === "MORALE" ? "MORALE" : "PHYSIQUE",
      telephone: s.telephone || "—",
      email: s.email || "—",
      adresse: s.adresse || "—",
    },
    cotations: piecesCotations,
  };
}
