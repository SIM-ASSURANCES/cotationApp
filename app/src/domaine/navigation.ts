import { peutLire, type CodeAction, type CodeNiveau } from "./droits";

/**
 * Navigation de l'application (barre latérale) : règles PURES, sans React ni Next. Le layout de `(protege)` lit les niveaux de
 * droits du profil (serveur/droits) et les passe à `construireNavigation`, qui rend les branches à afficher. Les conditions
 * d'affichage sont celles de l'ancien bandeau (un lien n'apparaît que si le profil peut LIRE l'écran qu'il ouvre) ;
 * `navigation.test.ts` les compare, combinaison par combinaison, à la logique d'origine.
 */

/**
 * Icônes utilisées par la navigation. Chaque nom existe dans `NomIcone` (composants/ui/icones.tsx) : le domaine ne peut pas
 * importer ce composant, c'est TypeScript qui vérifie la compatibilité là où la barre latérale passe l'icône à <Icone nom=… />.
 */
export type IconeNavigation =
  | "maison"
  | "couches"
  | "portefeuille"
  | "document"
  | "recu"
  | "fichiers"
  | "graphique"
  | "reglages"
  | "bouclier"
  | "livre"
  | "calculatrice"
  | "televerser"
  | "calendrier"
  | "colis"
  | "arborescence"
  | "pourcentage"
  | "utilisateurs"
  | "immeuble"
  | "cadenas"
  | "base-de-donnees"
  | "journal";

export type LienNavigation = { href: string; libelle: string; icone: IconeNavigation };
export type GroupeNavigation = { titre?: string; liens: LienNavigation[] };
export type BrancheNavigation = { cle: string; libelle: string; icone: IconeNavigation; groupes: GroupeNavigation[] };
export type Navigation = { accueil: LienNavigation; branches: BrancheNavigation[] };

/** Les droits dont dépend l'affichage du menu : exactement ceux que lisait l'ancien layout. */
export const ACTIONS_DE_NAVIGATION = [
  "CREER_COTATION",
  "EMETTRE_CONTRAT",
  "EMETTRE_FACTURE",
  "EMETTRE_AVOIR",
  "ENREGISTRER_PAIEMENT",
  "DEPOSER_MODELE",
  "PUBLIER_MODELE",
  "PARAMETRER_PRODUITS",
  "GERER_UTILISATEURS",
  "CONSULTER_TABLEAUX_DE_BORD",
  "CONSULTER_AUDIT",
] as const satisfies readonly CodeAction[];

export type NiveauxNavigation = Record<(typeof ACTIONS_DE_NAVIGATION)[number], CodeNiveau>;

const ACCUEIL: LienNavigation = { href: "/", libelle: "Tableau de bord", icone: "maison" };

/**
 * Pages qui ne sont pas dans le menu (« Mon compte » s'ouvre depuis le menu du profil, « Clients » depuis la liste des cotations)
 * mais dont la barre du haut doit connaître le titre. Aucune n'est un lien du menu : l'ancien bandeau n'en avait pas.
 */
const PAGES_HORS_MENU = [
  { href: "/mon-compte", libelle: "Mon compte" },
  { href: "/clients", libelle: "Clients" },
] as const;

const TITRE_PAR_DEFAUT = "SIM Documents";

/**
 * Branches et liens autorisés pour ces niveaux de droits. Une branche sans lien n'est jamais rendue. (Un utilisateur qui doit
 * changer son mot de passe n'a PAS de menu : le layout lui rend la coquille de connexion et n'appelle pas cette fonction.)
 */
export function construireNavigation(niveaux: NiveauxNavigation): Navigation {
  const lit = (action: (typeof ACTIONS_DE_NAVIGATION)[number]): boolean => peutLire(niveaux[action]);

  const cotation = lit("CREER_COTATION");
  const contrat = lit("EMETTRE_CONTRAT");
  const facture = lit("EMETTRE_FACTURE");
  const avoir = lit("EMETTRE_AVOIR");
  const paiement = lit("ENREGISTRER_PAIEMENT");
  const parametrage = lit("PARAMETRER_PRODUITS");

  const production: LienNavigation[] = [];
  if (cotation) production.push({ href: "/cotations", libelle: "Cotations", icone: "document" });
  // Calcul : paramétrer les produits ou créer une cotation.
  if (parametrage || cotation) production.push({ href: "/calcul", libelle: "Calcul", icone: "calculatrice" });
  // Import en masse des adhérents (CDC §13) : droit des adhérents et des certificats, « Émettre un contrat ».
  if (contrat) production.push({ href: "/imports", libelle: "Imports", icone: "televerser" });
  // Avis d'échéance et relances (CDC §12) : droit « Émettre une facture » (H21).
  if (facture) production.push({ href: "/echeances", libelle: "Échéances", icone: "calendrier" });

  const facturation: LienNavigation[] = [];
  // Factures : un des trois droits de facturation (CDC §4) ; même règle que le service (serveur/factures.ts).
  if (facture || avoir || paiement) facturation.push({ href: "/factures", libelle: "Factures", icone: "recu" });

  const documents: LienNavigation[] = [];
  if (cotation || contrat || facture || avoir || paiement) {
    documents.push({ href: "/documents", libelle: "Documents émis", icone: "fichiers" });
  }
  if (lit("DEPOSER_MODELE") || lit("PUBLIER_MODELE")) documents.push({ href: "/modeles", libelle: "Modèles Word", icone: "livre" });

  // Les tableaux de bord sont la page d'accueil (« / ») : plus de branche Pilotage. Le journal d'audit ferme le menu.
  const audit: LienNavigation[] = lit("CONSULTER_AUDIT") ? [{ href: "/admin/audit", libelle: "Journal d'audit", icone: "journal" }] : [];

  const parametrer: LienNavigation[] = parametrage
    ? [
        { href: "/parametrage/produits", libelle: "Produits", icone: "colis" },
        { href: "/parametrage/branches", libelle: "Branches", icone: "arborescence" },
        { href: "/parametrage/taxes", libelle: "Taxes", icone: "pourcentage" },
        { href: "/parametrage/intermediaires", libelle: "Intermédiaires", icone: "utilisateurs" },
        { href: "/parametrage/societe", libelle: "Société", icone: "immeuble" },
      ]
    : [];

  // Administration : réservée à ceux qui gèrent les utilisateurs, niveau « Oui » exactement (un simple droit de lecture ne suffit pas).
  const administration: LienNavigation[] =
    niveaux.GERER_UTILISATEURS === "OUI"
      ? [
          { href: "/admin/utilisateurs", libelle: "Utilisateurs", icone: "utilisateurs" },
          { href: "/admin/droits", libelle: "Droits", icone: "cadenas" },
          { href: "/admin/stockage", libelle: "Stockage", icone: "base-de-donnees" },
        ]
      : [];

  const candidates: { cle: string; libelle: string; icone: IconeNavigation; liens: LienNavigation[] }[] = [
    { cle: "production", libelle: "Production", icone: "couches", liens: production },
    { cle: "facturation", libelle: "Facturation", icone: "portefeuille", liens: facturation },
    { cle: "documents", libelle: "Documents", icone: "arborescence", liens: documents },
    { cle: "parametrage", libelle: "Paramétrage", icone: "reglages", liens: parametrer },
    { cle: "administration", libelle: "Administration", icone: "bouclier", liens: administration },
    { cle: "audit", libelle: "Journal d'audit", icone: "journal", liens: audit },
  ];

  return {
    accueil: ACCUEIL,
    branches: candidates
      .filter((branche) => branche.liens.length > 0)
      .map(({ cle, libelle, icone, liens }) => ({ cle, libelle, icone, groupes: [{ liens }] })),
  };
}

/**
 * Le lien est-il celui de la page affichée ? « / » n'est actif que sur « / » (sinon il le serait partout) ; les autres le sont
 * sur leur adresse et sous elle (/cotations/12), jamais sur une adresse qui n'en est que le début d'un mot (/factures-x).
 */
export function lienEstActif(href: string, chemin: string): boolean {
  if (href === "/") return chemin === "/";
  return chemin === href || chemin.startsWith(`${href}/`);
}

/** La branche contient-elle la page affichée ? Sert à déplier la bonne branche à l'ouverture. */
export function brancheContientChemin(branche: BrancheNavigation, chemin: string): boolean {
  return branche.groupes.some((groupe) => groupe.liens.some((lien) => lienEstActif(lien.href, chemin)));
}

/**
 * Titre de la barre du haut : libellé du lien le plus spécifique (l'adresse la plus longue) qui correspond au chemin,
 * « Mon compte » et « Clients » pour ces deux pages hors menu, « SIM Documents » pour toute autre page inconnue (ou dont le lien n'est pas autorisé).
 */
export function titreDeLaPage(navigation: Navigation, chemin: string): string {
  const liens: { href: string; libelle: string }[] = [navigation.accueil, ...PAGES_HORS_MENU, ...navigation.branches.flatMap((b) => b.groupes.flatMap((g) => g.liens))];
  let retenu: { href: string; libelle: string } | null = null;
  for (const lien of liens) {
    if (!lienEstActif(lien.href, chemin)) continue;
    if (retenu === null || lien.href.length > retenu.href.length) retenu = lien;
  }
  return retenu?.libelle ?? TITRE_PAR_DEFAUT;
}
