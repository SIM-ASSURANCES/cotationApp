// Aide des tests d'intégration : paramètre la signature scannée de SIM (image PNG inventée) si elle ne l'est pas encore.
// Les CP utilisent {{ signature_sim }} (CDC §10.1) ; un paramètre n'est jamais écrasé le même jour, d'où ce « si absente ».
import { aujourdhui } from "./parametrage";
import { enregistrerImageSociete, lireImageSociete } from "./societe";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const PNG_INVENTE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function assurerSignature(acteur: UtilisateurCourant): Promise<void> {
  if ((await lireImageSociete("signature_sim")) !== null) return;
  try {
    await enregistrerImageSociete(acteur, "signature_sim", PNG_INVENTE, aujourdhui(), null);
  } catch (erreur) {
    // Un autre fichier de test l'a paramétrée entre-temps : c'est ce qu'on voulait.
    if (!(erreur instanceof ErreurMetier && /déjà enregistrée/.test(erreur.message))) throw erreur;
  }
}
