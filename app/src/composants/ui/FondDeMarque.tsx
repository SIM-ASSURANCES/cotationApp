import { TRACES_PICTOGRAMME, VUE_PICTOGRAMME } from "./pictogramme";

export type PositionFiligrane = "deborde-gauche" | "coin-bas-droit";

const CLASSES_POSITION: Record<PositionFiligrane, string> = {
  // Conteneur étroit (carte de connexion) : calé sur le bord gauche, volontairement coupé par le cadre.
  "deborde-gauche": "left-[-55%] top-1/2 h-[62%] w-auto -translate-y-1/2 sm:left-[-24%] sm:h-[105%]",
  // Coquille de l'application : seul coin du viewport qu'ni la barre latérale ni la barre du haut n'occupent.
  "coin-bas-droit": "bottom-[-22%] right-[-22%] h-[38%] w-auto sm:bottom-[-12%] sm:right-[-12%] sm:h-[48%]",
};

/**
 * Fond « papier à en-tête » de la marque : le fond reste BLANC (porté par le conteneur), seul un calque décoratif y pose le
 * pictogramme seul, en filigrane très pâle. Purement décoratif (`aria-hidden`), jamais derrière une zone de travail dense
 * sans réduire fortement l'opacité. Dans la coquille, le conteneur doit être `fixed -z-10` à l'intérieur d'un parent
 * `relative z-0` : sans ce contexte d'empilement propre, le filigrane passe sous le fond du parent et disparaît.
 */
export function FondDeMarque({
  className = "",
  classeOpacite = "opacity-[0.09]",
  position = "deborde-gauche",
}: {
  className?: string;
  /** Classe Tailwind d'opacité du filigrane. */
  classeOpacite?: string;
  position?: PositionFiligrane;
}) {
  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      <svg viewBox={VUE_PICTOGRAMME} className={`absolute text-muted-foreground ${CLASSES_POSITION[position]} ${classeOpacite}`}>
        {TRACES_PICTOGRAMME.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </svg>
    </div>
  );
}
