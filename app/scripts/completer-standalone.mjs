// Complète la sortie autonome de `next build` (output: "standalone").
// Next.js n'y copie ni public/ ni .next/static/ (CSS, JavaScript du navigateur) :
// sans eux, `node .next/standalone/server.js` servirait des pages sans style.
// En Node.js plutôt qu'avec `cp` : la même commande sous Windows et sous Linux.
import { cpSync } from "node:fs";

const sortie = ".next/standalone";

cpSync("public", `${sortie}/public`, { recursive: true });
cpSync(".next/static", `${sortie}/.next/static`, { recursive: true });

console.log(`Sortie autonome complétée : ${sortie} (public/ et .next/static/ copiés).`);
