/**
 * Paramètres de la Société (CDC §6.1 : « les éléments communs ne sont jamais écrits en dur »), qui
 * remplissent societe.* et les mentions du document (lieu, signataire). Historisés (table des
 * paramètres, une valeur par date d'effet).
 */

export type Societe = {
  raison_sociale: string;
  forme: string;
  capital: string;
  capital_libere: string;
  adresse: string;
  bp: string;
  telephone: string;
  email_reclamation: string;
  site: string;
  rccm: string;
  ncc: string;
  agrement: string;
  rib: { banque: string; numero: string }[];
  mobile_money: { operateur: string; numero_marchand: string }[];
  recours: { libelle: string; url: string }[];
};

export type MentionsDocument = { lieu_emission: string; signataire_nom: string; signataire_fonction: string };

export type ParametresSociete = { societe: Societe; document: MentionsDocument };

export const CLE_SOCIETE = "societe";

/** Valeurs du CDC §6.3.1 ; le reste est à saisir (écran « Société »). */
export const SOCIETE_DEFAUT: ParametresSociete = {
  societe: {
    raison_sociale: "SIM Assurances Côte d'Ivoire",
    forme: "SA",
    capital: "727000000",
    capital_libere: "77",
    adresse: "",
    bp: "",
    telephone: "",
    email_reclamation: "",
    site: "",
    rccm: "",
    ncc: "",
    agrement: "",
    rib: [],
    mobile_money: [],
    recours: [],
  },
  document: { lieu_emission: "Abidjan", signataire_nom: "", signataire_fonction: "" },
};

/** Lignes « a ; b » d'une zone de texte → liste d'objets. */
export function lireLignes<K extends string>(texte: string, cles: readonly [K, K]): Record<K, string>[] {
  return texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [a, ...b] = l.split(";");
      return { [cles[0]]: (a ?? "").trim(), [cles[1]]: b.join(";").trim() } as Record<K, string>;
    });
}

export function problemesSociete(p: ParametresSociete): string[] {
  const erreurs: string[] = [];
  if (p.societe.raison_sociale.trim().length < 3) erreurs.push("Raison sociale obligatoire.");
  for (const [nom, valeur] of [["capital", p.societe.capital], ["capital libéré", p.societe.capital_libere]] as const) {
    if (valeur !== "" && !/^\d+(\.\d+)?$/.test(valeur)) erreurs.push(`Le ${nom} s'écrit en chiffres, sans espace (ex. 727000000).`);
  }
  for (const [champ, valeur] of Object.entries({ ...p.societe, ...p.document })) {
    if (typeof valeur === "string" && valeur.length > 300) erreurs.push(`Le champ « ${champ} » est trop long.`);
  }
  return erreurs;
}

/** Lecture tolérante d'une valeur stockée : les champs manquants prennent la valeur par défaut. */
export function lireSociete(json: string | null): ParametresSociete {
  if (!json) return SOCIETE_DEFAUT;
  const lu = JSON.parse(json) as Partial<ParametresSociete>;
  return { societe: { ...SOCIETE_DEFAUT.societe, ...lu.societe }, document: { ...SOCIETE_DEFAUT.document, ...lu.document } };
}

/** Images de la Société (signature scannée, cachet), en PNG. */
export const IMAGES_SOCIETE = ["signature_sim", "cachet_sim"] as const;
export type ImageSociete = (typeof IMAGES_SOCIETE)[number];
export const cleImage = (nom: ImageSociete) => `image.${nom}`;
