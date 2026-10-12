import { ImageResponse } from "next/og";

import { COULEURS_ICONE, TRACES_PICTOGRAMME, VUE_PICTOGRAMME } from "@/composants/ui/pictogramme";

/**
 * Icône d'onglet générée à partir du pictogramme du logo SIM Assurances (le triangle seul, jamais le texte), blanc sur le bleu
 * principal. Remplace l'ancien `favicon.ico` : la géométrie et les couleurs viennent d'une source unique
 * (`composants/ui/pictogramme.ts`), comme pour la barre latérale et le filigrane. Next la sert à `/icon?<empreinte>`, sans
 * extension : le matcher du proxy (`src/proxy.ts`) l'exclut pour que la page de connexion puisse l'afficher.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Le pictogramme occupe 72 % de la largeur de l'icône ; la hauteur suit le rapport de la vue (jamais déformé).
const [, , largeurVue, hauteurVue] = VUE_PICTOGRAMME.split(" ").map(Number);
const largeur = Math.round(size.width * 0.72);
const hauteur = Math.round((largeur * hauteurVue) / largeurVue);

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COULEURS_ICONE.fond,
        }}
      >
        <svg width={largeur} height={hauteur} viewBox={VUE_PICTOGRAMME} fill="none">
          {TRACES_PICTOGRAMME.map((d) => (
            <path key={d} d={d} fill={COULEURS_ICONE.pictogramme} />
          ))}
        </svg>
      </div>
    ),
    { ...size },
  );
}
