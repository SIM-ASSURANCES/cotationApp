import { crc32, deflateRawSync } from "node:zlib";

/**
 * Fabrique un ZIP valide à partir de parties données (aide de test, données inventées). `tailleDeclaree` permet de MENTIR sur la
 * taille décompressée dans le répertoire central, comme le ferait un fichier piégé.
 */
export function fabriquerZip(parties: { nom: string; donnees: Buffer; tailleDeclaree?: number }[], commentaire = ""): Uint8Array {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const p of parties) {
    const nom = Buffer.from(p.nom, "utf8");
    const compresse = deflateRawSync(p.donnees);
    const somme = crc32(p.donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(somme, 14);
    local.writeUInt32LE(compresse.length, 18);
    local.writeUInt32LE(p.donnees.length, 22);
    local.writeUInt16LE(nom.length, 26);
    locaux.push(local, nom, compresse);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(somme, 16);
    central.writeUInt32LE(compresse.length, 20);
    central.writeUInt32LE(p.tailleDeclaree ?? p.donnees.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, nom);
    decalage += 30 + nom.length + compresse.length;
  }
  const repertoire = Buffer.concat(centraux);
  const texte = Buffer.from(commentaire, "utf8");
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(parties.length, 8);
  fin.writeUInt16LE(parties.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  fin.writeUInt16LE(texte.length, 20);
  return new Uint8Array(Buffer.concat([...locaux, repertoire, fin, texte]));
}
