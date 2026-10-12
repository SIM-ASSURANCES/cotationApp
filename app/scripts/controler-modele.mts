// Pont entre generateur/scripts/verifier_modele.py et les règles de l'application (session 6.1) : lit sur l'entrée standard
// {"type": "CP", "analyse": {…}} (l'analyse du générateur) et écrit sur la sortie standard le résultat des mêmes
// contrôles que le dépôt d'un modèle. Rien n'est envoyé ni stocké : ni réseau, ni base, ni fichier.
// Lancement (depuis app/) : node --import tsx scripts/controler-modele.mts < entree.json
import { verifierModele } from "../src/domaine/documents/verification-modele";

const morceaux: Buffer[] = [];
for await (const morceau of process.stdin) morceaux.push(morceau as Buffer);

let sortie;
try {
  sortie = verifierModele(JSON.parse(Buffer.concat(morceaux).toString("utf-8")));
} catch {
  sortie = { ok: false, erreur: "Entrée illisible (JSON attendu : { type, analyse })." };
}
process.stdout.write(JSON.stringify(sortie));
