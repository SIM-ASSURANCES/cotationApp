import { baremeVide, champNeuf, garantieNeuve, type Resultat } from "./edition";
import { ajouterEssai, ajouterLigneAttendue, changerSaisie, poserMontantAttendu, poserRefusAttendu, poserTtcAttendu } from "./edition-essais";
import { ajouterSousJacent, changerCondition } from "./edition-sousjacents";
import { collerPlage, analyserPlage, creerTable, poserCase, remplirCasesVides } from "./edition-tables";
import { schemaBareme, type Bareme, type Champ, type Condition, type Garantie } from "./schema";

/**
 * SECURPRO INVENTÉ, SAISI COMME LA TECHNIQUE LE FAIT À L'ÉCRAN (session B5) : on part d'un barème vide et on n'applique que les opérations
 * de l'éditeur (champs, valeurs intermédiaires, garanties, tables remplies à la main ou collées d'un tableur, sous-jacents guidés, jeux
 * d'essai dont l'attendu est TAPÉ). Aucun chiffre ne vient du moteur. Servi aux tests uniquement (comme `securpro-fixture.ts`, dont il
 * reprend les valeurs inventées et qu'il doit égaler au résultat : 139 420 F TTC pour le premier essai).
 */

/** Applique une opération de l'éditeur ; un refus arrête le test avec le message de l'écran. */
export function appliquer(b: Bareme, r: Resultat): Bareme {
  if (!r.ok) throw new Error(`Opération refusée par l'éditeur : ${r.refus.join(" | ")}`);
  return r.bareme;
}

type Types = { taxe: string; taxeIncendie: string };

/** Montants que la Technique tape pour chaque ligne du premier essai (calculés à la main dans le simulateur inventé, jamais par le moteur). */
export const ATTENDU_ESSAI_1 = {
  ttc: "139 420",
  lignes: [
    { g: "incendie", nette: "20891", acc: "2500", taxe: "2924", ttc: "26315" },
    { g: "vol", nette: "20960", acc: "2500", taxe: "1701", ttc: "25161" },
    { g: "dde", nette: "12000", acc: "2500", taxe: "1051", ttc: "15551" },
    { g: "de", nette: "10000", acc: "2500", taxe: "906", ttc: "13406" },
    { g: "bdg", nette: "10000", acc: "2500", taxe: "906", ttc: "13406" },
    { g: "tri", nette: "40000", acc: "2500", taxe: "3081", ttc: "45581" },
  ],
};

const oui = (code: string, libelle: string): Champ => ({ ...champNeuf(code, libelle, "OUI_NON"), bloc: "local" });
const montant = (code: string, libelle: string, extra: Partial<Champ> = {}): Champ => ({ ...champNeuf(code, libelle, "MONTANT"), bloc: "capitaux", ...extra });
const montantGaranti = (code: string, libelle: string, garantie: string, ...valeurs: string[]): Champ => ({ ...champNeuf(code, libelle, "LISTE"), numerique: true, bloc: "garanties", si: { souscrit: garantie }, valeurs });

export function secuproSaisiALEcran(types: Types): Bareme {
  let b: Bareme = schemaBareme.parse(baremeVide(types.taxe));
  const op = (r: Resultat) => (b = appliquer(b, r));

  // Onglet Champs : blocs, listes (avec l'attribut tarifaire « classe »), oui / non, montants, conditions d'affichage.
  b = { ...b, produit: { taxe: types.taxe, accessoires: { mode: "PAR_GARANTIE", montant: "2500" } } };
  b = { ...b, blocs: [{ code: "local", libelle: "Local et sécurité" }, { code: "capitaux", libelle: "Capitaux" }, { code: "garanties", libelle: "Garanties" }] };
  const commerces = [
    ["BUREAU", "Bureau", "1"],
    ["EPICERIE", "Épicerie", "2"],
    ["ELECTRONIQUE", "Électronique", "2"],
    ["MECHES", "Mèches", "3"],
    ["SUPERETTE", "Superette", "3"],
    ["QUINCAILLERIE", "Quincaillerie", "4"],
  ];
  b = {
    ...b,
    champs: [
      { ...champNeuf("type_commerce", "Type de commerce", "LISTE"), bloc: "local", valeurs: commerces.map(([v, l, classe]) => ({ v, l, classe })) },
      { ...champNeuf("occupation", "Occupation", "LISTE"), bloc: "local", valeurs: ["LOCATAIRE", "PROPRIETAIRE"] },
      { ...champNeuf("situation", "Situation", "LISTE"), bloc: "local", valeurs: ["BOUTIQUE", "MARCHE"] },
      oui("gardien", "Gardien"),
      oui("extincteurs", "Extincteurs"),
      oui("camera", "Caméra"),
      oui("volet", "Volet"),
      montant("loyer_mensuel", "Loyer mensuel", { si: { champ: "occupation", egal: "LOCATAIRE" } }),
      montant("valeur_batiment", "Valeur du bâtiment", { si: { champ: "occupation", egal: "PROPRIETAIRE" } }),
      montant("stocks", "Stocks"),
      montant("materiel", "Matériel"),
      montant("mobilier", "Mobilier"),
      montant("amenagement", "Aménagement"),
      montant("informatique", "Informatique"),
      montantGaranti("dde_montant", "Montant dégâts des eaux", "dde", "500000", "1000000", "2000000"),
      montantGaranti("de_montant", "Montant dommages électriques", "de", "500000", "1000000"),
      montantGaranti("bdg_montant", "Montant bris de glaces", "bdg", "250000", "500000"),
      montantGaranti("tempete_montant", "Montant tempête", "tempete", "2000000", "5000000"),
      montantGaranti("tri_montant", "Montant tous risques informatique", "tri", "5000000", "10000000"),
      montantGaranti("vol_caisse_montant", "Montant vol caisse", "vol.caisse", "50000", "100000", "200000"),
    ],
  };

  // Onglet Intermédiaires.
  b = {
    ...b,
    intermediaires: [
      { code: "capital_immo", op: ["PREMIER", ["FOIS", "loyer_mensuel", { k: "120" }], "valeur_batiment"] },
      { code: "contenu", op: ["SOMME", "stocks", "materiel", "mobilier", "amenagement", "informatique"] },
      { code: "capitaux_totaux", op: ["SOMME", "capital_immo", "contenu"] },
    ],
  };

  // Onglet Garanties : la garantie de départ est remplacée ; Incendie lit son taux dans un sous-jacent E1 ; Vol a deux composantes.
  const unique = (code: string, nom: string, assiette: string, fixe: string): Garantie => ({
    ...garantieNeuve(code, nom),
    souscription: "OPTIONNELLE",
    composantes: [{ code: "base", assiette, taux: { unite: "PERMILLE", fixe } }],
  });
  b = {
    ...b,
    garanties: [
      { ...garantieNeuve("incendie", "Incendie"), taxe: types.taxeIncendie, composantes: [{ code: "base", assiette: "capitaux_totaux", taux: { unite: "PERMILLE", source: "E1" } }] },
      {
        ...garantieNeuve("vol", "Vol"),
        souscription: "OPTIONNELLE",
        composantes: [
          { code: "contenu", souscription: "OPTIONNELLE", assiette: ["PCT_PLAFOND", "contenu", "15", "2000000"], taux: { unite: "POURCENT", fixe: "1" } },
          { code: "caisse", souscription: "OPTIONNELLE", assiette: "vol_caisse_montant", taux: { unite: "POURCENT", fixe: "2.5" }, minimum: "2500" },
        ],
      },
      unique("dde", "Dégâts des eaux", "dde_montant", "6"),
      unique("de", "Dommages électriques", "de_montant", "10"),
      unique("bdg", "Bris de glaces", "bdg_montant", "20"),
      unique("tempete", "Tempête", "tempete_montant", "0.72"),
      unique("tri", "Tous risques informatique", "tri_montant", "4"),
    ],
  };

  // Onglet Sous-jacents (guidé par l'effet) puis Tables (cases tapées, « Remplir avec 1 », plage collée d'un tableur).
  op(ajouterSousJacent(b, { effet: "E1", nom: "classe", champs: ["type_commerce.classe"], cible: "incendie.base" }));
  op(collerPlage(b, "classe", analyserPlage("0,72\n0,864\n1,0368\n1,24416")));

  op(ajouterSousJacent(b, { effet: "E2", nom: "securite", champs: ["gardien", "extincteurs"], cible: "incendie.base" }));
  op(collerPlage(b, "securite", analyserPlage("\tOui\tNon\nOui\t0,80\t0,90\nNon\t0,90\t1")));

  op(ajouterSousJacent(b, { effet: "E2", nom: "electronique", champs: ["type_commerce"], cible: "vol.contenu" }));
  op(remplirCasesVides(b, "electronique", "1"));
  op(poserCase(b, "electronique", "ELECTRONIQUE", "1,2"));
  op(poserCase(b, "electronique", "MECHES", "1,2"));

  op(ajouterSousJacent(b, { effet: "E2", nom: "commerce_caisse", champs: ["type_commerce"], cible: "vol.caisse" }));
  op(remplirCasesVides(b, "commerce_caisse", "1"));
  op(poserCase(b, "commerce_caisse", "SUPERETTE", "1,25"));
  op(poserCase(b, "commerce_caisse", "QUINCAILLERIE", "1,25"));

  op(creerTable(b, "limites", ["type_commerce.classe", "situation"]));
  op(collerPlage(b, "limites", analyserPlage("\tBOUTIQUE\tMARCHE\n1\t100 000 000\t5 000 000\n2\t80 000 000\t5 000 000\n3\t60 000 000\t5 000 000\n4\t50 000 000\t5 000 000")));
  op(ajouterSousJacent(b, { effet: "E4", nom: "plafond", message: "Les capitaux dépassent la limite de la classe : ce risque ne peut pas être assuré dans ce barème." }));
  op(changerCondition(b, "plafond", [">", "capitaux_totaux", ["TABLE", "limites"]] as Condition));

  // Onglet Jeux d'essai : la saisie comme le Commercial, l'attendu TAPÉ.
  const champsEssai1 = {
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
  };
  const e1 = "Électronique, locataire, boutique";
  op(ajouterEssai(b, e1));
  op(changerSaisie(b, e1, { champs: champsEssai1, souscrit: ["vol.contenu", "vol.caisse", "dde", "de", "bdg", "tri"] }));
  op(poserTtcAttendu(b, e1, ATTENDU_ESSAI_1.ttc));
  for (const l of ATTENDU_ESSAI_1.lignes) {
    op(ajouterLigneAttendue(b, e1, l.g));
    for (const m of ["nette", "acc", "taxe", "ttc"] as const) op(poserMontantAttendu(b, e1, l.g, m, l[m]));
  }

  const e2 = "Bureau, propriétaire, minimum de la caisse";
  op(ajouterEssai(b, e2));
  op(
    changerSaisie(b, e2, {
      champs: { type_commerce: "BUREAU", occupation: "PROPRIETAIRE", situation: "BOUTIQUE", gardien: true, extincteurs: true, camera: false, volet: false, valeur_batiment: "20000000", stocks: "1000000", materiel: "0", mobilier: "0", amenagement: "0", informatique: "0", vol_caisse_montant: "50000" },
      souscrit: ["vol.caisse"],
    }),
  );
  op(poserTtcAttendu(b, e2, "21784"));
  for (const l of [{ g: "incendie", nette: "12096", acc: "2500", taxe: "1825", ttc: "16421" }, { g: "vol", nette: "2500", acc: "2500", taxe: "363", ttc: "5363" }]) {
    op(ajouterLigneAttendue(b, e2, l.g));
    for (const m of ["nette", "acc", "taxe", "ttc"] as const) op(poserMontantAttendu(b, e2, l.g, m, l[m]));
  }

  const e3 = "En marché : capitaux au-dessus de la limite";
  op(ajouterEssai(b, e3));
  op(
    changerSaisie(b, e3, {
      champs: { type_commerce: "ELECTRONIQUE", occupation: "LOCATAIRE", situation: "MARCHE", gardien: true, extincteurs: false, camera: true, volet: false, loyer_mensuel: "150000", stocks: "6866500", materiel: "1000000", mobilier: "500000", amenagement: "500000", informatique: "0" },
      souscrit: [],
    }),
  );
  op(poserRefusAttendu(b, e3, "ne peut pas être assuré dans ce barème"));
  return b;
}
