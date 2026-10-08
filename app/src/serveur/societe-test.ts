// Aide des tests d'intégration : paramètre la signature scannée de SIM (image PNG inventée) si elle ne l'est pas encore.
// Les CP utilisent {{ signature_sim }} (CDC §10.1) ; un paramètre n'est jamais écrasé le même jour, d'où ce « si absente ».
import { aujourdhui } from "./parametrage";
import { SOCIETE_DEFAUT } from "@/domaine/documents/societe";

import { enregistrerImageSociete, enregistrerSociete, lireImageSociete, lireParametresSociete } from "./societe";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/** En-tête seul : suffit au double du générateur des tests d'intégration, qui n'ouvre pas l'image. */
const PNG_INVENTE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Vrai PNG de 1 × 1 pixel : indispensable au vrai générateur (tests de bout en bout). */
export const PNG_REEL_1PX = new Uint8Array(
  Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000a49444154789c636800000082008177cd72b60000000049454e44ae426082", "hex"),
);

export async function assurerSignature(acteur: UtilisateurCourant, png: Uint8Array = PNG_INVENTE): Promise<void> {
  if ((await lireImageSociete("signature_sim")) !== null) return;
  try {
    await enregistrerImageSociete(acteur, "signature_sim", png, aujourdhui(), null);
  } catch (erreur) {
    // Un autre fichier de test l'a paramétrée entre-temps : c'est ce qu'on voulait.
    if (!(erreur instanceof ErreurMetier && /déjà enregistrée/.test(erreur.message))) throw erreur;
  }
}

/**
 * Paramètres de la Société INVENTÉS pour les tests de bout en bout : RCCM et réclamation (CP), NCC, RIB et Mobile Money
 * (factures, session 4b). Une seule valeur par jour : le premier fichier de test l'enregistre, les suivants la trouvent.
 */
export async function assurerSocieteDeTest(acteur: UtilisateurCourant): Promise<void> {
  const actuelle = await lireParametresSociete();
  if (actuelle.societe.rib.length > 0 && actuelle.societe.rccm !== "") return;
  await enregistrerSociete(
    acteur,
    {
      ...SOCIETE_DEFAUT,
      societe: {
        ...SOCIETE_DEFAUT.societe,
        rccm: "CI-ABJ-0000-B-00000",
        ncc: "0000000A",
        email_reclamation: "reclamations@exemple.ci",
        rib: [{ banque: "Banque inventée", numero: "CI000 00000 000000000000 00" }],
        mobile_money: [{ operateur: "Opérateur inventé", numero_marchand: "000000" }],
      },
    },
    aujourdhui(),
    null,
  );
}
