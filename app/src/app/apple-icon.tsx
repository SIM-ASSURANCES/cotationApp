import { ImageResponse } from "next/og";

import { COULEURS_ICONE, TRACES_PICTOGRAMME, VUE_PICTOGRAMME } from "@/composants/ui/pictogramme";

/**
 * Icône « ajouter à l'écran d'accueil » des appareils Apple (180 × 180) : même pictogramme et même principe que `icon.tsx`.
 * Next la sert à `/apple-icon?<empreinte>`, exclue du proxy d'authentification comme `/icon`.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Le pictogramme occupe 72 % de la largeur de l'icône ; la hauteur suit le rapport de la vue (jamais déformé).
const [, , largeurVue, hauteurVue] = VUE_PICTOGRAMME.split(" ").map(Number);
const largeur = Math.round(size.width * 0.72);
const hauteur = Math.round((largeur * hauteurVue) / largeurVue);

export default function AppleIcon() {
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
