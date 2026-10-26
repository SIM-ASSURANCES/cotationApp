import { aujourdhui, ajouterJours } from "../calcul/dates";
import type { ParametresBareme } from "./bareme";
import { lireBareme, type Bareme } from "./schema";

/**
 * SECURPRO INVENTÉ (propositions-bareme.md §1) : aucun chiffre du simulateur. Les valeurs de listes, les classes, les limites et les
 * montants sont posés à la main pour les tests ; le jeu d'essai 1 est calé sur 139 420 F TTC. Servi aux tests uniquement.
 */
const montantsDe = (...v: string[]) => v;
const oui = (code: string) => ({ code, type: "OUI_NON", bloc: "local" });
const montant = (code: string) => ({ code, type: "MONTANT", bloc: "capitaux" });
const montantGaranti = (code: string, garantie: string, ...valeurs: string[]) => ({ code, type: "LISTE", numerique: true, bloc: "garanties", si: { souscrit: garantie }, valeurs });
const unique = (code: string, nom: string, assiette: string, unite: string, fixe: string) => ({ code, nom, souscription: "OPTIONNELLE", composantes: [{ code: "base", assiette, taux: { unite, fixe } }] });

export const documentSecurpro = {
  schema: 1,
  produit: { taxe: "IARD", accessoires: { mode: "PAR_GARANTIE", montant: "2500" } },
  blocs: [
    { code: "local", libelle: "Local et sécurité" },
    { code: "capitaux", libelle: "Capitaux" },
    { code: "garanties", libelle: "Garanties" },
  ],
  champs: [
    {
      code: "type_commerce",
      type: "LISTE",
      bloc: "local",
      valeurs: [
        { v: "BUREAU", l: "Bureau", classe: 1 },
        { v: "EPICERIE", l: "Épicerie", classe: 2 },
        { v: "ELECTRONIQUE", l: "Électronique", classe: 2 },
        { v: "MECHES", l: "Mèches", classe: 3 },
        { v: "SUPERETTE", l: "Superette", classe: 3 },
        { v: "QUINCAILLERIE", l: "Quincaillerie", classe: 4 },
      ],
    },
    { code: "occupation", type: "LISTE", bloc: "local", valeurs: ["LOCATAIRE", "PROPRIETAIRE"] },
    { code: "situation", type: "LISTE", bloc: "local", valeurs: ["BOUTIQUE", "MARCHE"] },
    oui("gardien"),
    oui("extincteurs"),
    oui("camera"),
    oui("volet"),
    { ...montant("loyer_mensuel"), si: { champ: "occupation", egal: "LOCATAIRE" } },
    { ...montant("valeur_batiment"), si: { champ: "occupation", egal: "PROPRIETAIRE" } },
    montant("stocks"),
    montant("materiel"),
    montant("mobilier"),
    montant("amenagement"),
    montant("informatique"),
    montantGaranti("dde_montant", "dde", ...montantsDe("500000", "1000000", "2000000")),
    montantGaranti("de_montant", "de", ...montantsDe("500000", "1000000")),
    montantGaranti("bdg_montant", "bdg", ...montantsDe("250000", "500000")),
    montantGaranti("tempete_montant", "tempete", ...montantsDe("2000000", "5000000")),
    montantGaranti("tri_montant", "tri", ...montantsDe("5000000", "10000000")),
    montantGaranti("vol_caisse_montant", "vol.caisse", ...montantsDe("50000", "100000", "200000")),
  ],
  intermediaires: [
    { code: "capital_immo", op: ["PREMIER", ["FOIS", "loyer_mensuel", { k: "120" }], "valeur_batiment"] },
    { code: "contenu", op: ["SOMME", "stocks", "materiel", "mobilier", "amenagement", "informatique"] },
    { code: "capitaux_totaux", op: ["SOMME", "capital_immo", "contenu"] },
  ],
  tables: [
    { code: "taux_incendie", cles: ["type_commerce.classe"], lignes: { "1": "0.72", "2": "0.864", "3": "1.0368", "4": "1.24416" } },
    { code: "secu_incendie", cles: ["gardien", "extincteurs"], lignes: { "OUI|OUI": "0.80", "OUI|NON": "0.90", "NON|OUI": "0.90", "NON|NON": "1" } },
    { code: "coef_vol_contenu", cles: ["type_commerce"], lignes: { BUREAU: "1", EPICERIE: "1", ELECTRONIQUE: "1.2", MECHES: "1.2", SUPERETTE: "1", QUINCAILLERIE: "1" } },
    { code: "coef_vol_caisse", cles: ["type_commerce"], lignes: { BUREAU: "1", EPICERIE: "1", ELECTRONIQUE: "1", MECHES: "1", SUPERETTE: "1.25", QUINCAILLERIE: "1.25" } },
    {
      code: "limites",
      cles: ["type_commerce.classe", "situation"],
      lignes: {
        "1|BOUTIQUE": "100000000",
        "2|BOUTIQUE": "80000000",
        "3|BOUTIQUE": "60000000",
        "4|BOUTIQUE": "50000000",
        "1|MARCHE": "5000000",
        "2|MARCHE": "5000000",
        "3|MARCHE": "5000000",
        "4|MARCHE": "5000000",
      },
    },
  ],
  sousJacents: [
    { code: "classe", effet: "E1", table: "taux_incendie", cibles: ["incendie.base"] },
    { code: "securite", effet: "E2", table: "secu_incendie", cibles: ["incendie.base"] },
    { code: "electronique", effet: "E2", table: "coef_vol_contenu", cibles: ["vol.contenu"] },
    { code: "commerce_caisse", effet: "E2", table: "coef_vol_caisse", cibles: ["vol.caisse"] },
    {
      code: "plafond",
      effet: "E4",
      quand: [">", "capitaux_totaux", ["TABLE", "limites"]],
      message: "Les capitaux dépassent la limite de la classe : ce risque ne peut pas être assuré dans ce barème.",
    },
  ],
  garanties: [
    { code: "incendie", nom: "Incendie", souscription: "OBLIGATOIRE", taxe: "INCENDIE", composantes: [{ code: "base", assiette: "capitaux_totaux", taux: { source: "E1", unite: "PERMILLE" } }] },
    {
      code: "vol",
      nom: "Vol",
      souscription: "OPTIONNELLE",
      composantes: [
        { code: "contenu", souscription: "OPTIONNELLE", assiette: ["PCT_PLAFOND", "contenu", "15", "2000000"], taux: { fixe: "1", unite: "POURCENT" } },
        { code: "caisse", souscription: "OPTIONNELLE", assiette: "vol_caisse_montant", taux: { fixe: "2.5", unite: "POURCENT" }, minimum: "2500" },
      ],
    },
    unique("dde", "Dégâts des eaux", "dde_montant", "PERMILLE", "6"),
    unique("de", "Dommages électriques", "de_montant", "PERMILLE", "10"),
    unique("bdg", "Bris de glaces", "bdg_montant", "PERMILLE", "20"),
    unique("tempete", "Tempête", "tempete_montant", "PERMILLE", "0.72"),
    unique("tri", "Tous risques informatique", "tri_montant", "PERMILLE", "4"),
  ],
  jeuxEssai: [
    {
      nom: "Électronique, locataire, boutique",
      entrees: {
        champs: {
          type_commerce: "ELECTRONIQUE",
          occupation: "LOCATAIRE",
          situation: "BOUTIQUE",
          gardien: true,
          extincteurs: false,
          camera: true,
          volet: false,
          loyer_mensuel: "150000",
          stocks: "6866500",
          materiel: "1000000",
          mobilier: "500000",
          amenagement: "500000",
          informatique: "0",
          vol_caisse_montant: "200000",
          dde_montant: "2000000",
          de_montant: "1000000",
          bdg_montant: "500000",
          tri_montant: "10000000",
        },
        souscrit: ["incendie", "vol.contenu", "vol.caisse", "dde", "de", "bdg", "tri"],
      },
      attendu: {
        lignes: [
          { g: "incendie", nette: "20891", acc: "2500", taxe: "2924", ttc: "26315" },
          { g: "vol", nette: "20960", acc: "2500", taxe: "1701", ttc: "25161" },
          { g: "dde", nette: "12000", acc: "2500", taxe: "1051", ttc: "15551" },
          { g: "de", nette: "10000", acc: "2500", taxe: "906", ttc: "13406" },
          { g: "bdg", nette: "10000", acc: "2500", taxe: "906", ttc: "13406" },
          { g: "tri", nette: "40000", acc: "2500", taxe: "3081", ttc: "45581" },
        ],
        ttc: "139420",
      },
    },
    {
      nom: "Bureau, propriétaire, minimum de la caisse",
      entrees: {
        champs: {
          type_commerce: "BUREAU",
          occupation: "PROPRIETAIRE",
          situation: "BOUTIQUE",
          gardien: true,
          extincteurs: true,
          camera: false,
          volet: false,
          valeur_batiment: "20000000",
          stocks: "1000000",
          materiel: "0",
          mobilier: "0",
          amenagement: "0",
          informatique: "0",
          vol_caisse_montant: "50000",
        },
        souscrit: ["incendie", "vol.caisse"],
      },
      attendu: {
        lignes: [
          { g: "incendie", nette: "12096", acc: "2500", taxe: "1825", ttc: "16421" },
          { g: "vol", nette: "2500", acc: "2500", taxe: "363", ttc: "5363" },
        ],
        ttc: "21784",
      },
    },
    {
      nom: "En marché : capitaux au-dessus de la limite",
      entrees: {
        champs: {
          type_commerce: "ELECTRONIQUE",
          occupation: "LOCATAIRE",
          situation: "MARCHE",
          gardien: true,
          extincteurs: false,
          camera: true,
          volet: false,
          loyer_mensuel: "150000",
          stocks: "6866500",
          materiel: "1000000",
          mobilier: "500000",
          amenagement: "500000",
          informatique: "0",
        },
        souscrit: [],
      },
      attendu: { refus: "ne peut pas être assuré dans ce barème" },
    },
  ],
};

export const baremeSecurpro = (): Bareme => lireBareme(structuredClone(documentSecurpro));

/** Règles du produit pour les tests : arrondi 1 F au plus proche par ligne, pas de prorata, période d'un an qui commence demain. */
export function parametresEssai(surcharge: Partial<ParametresBareme> = {}): ParametresBareme {
  const effet = ajouterJours(aujourdhui(), 1);
  return {
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
    prorata: { actif: false },
    dateEffet: effet,
    dateEcheance: ajouterJours(effet, 364),
    taxes: {
      IARD: { tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES" },
      INCENDIE: { tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES" },
    },
    ...surcharge,
  };
}
