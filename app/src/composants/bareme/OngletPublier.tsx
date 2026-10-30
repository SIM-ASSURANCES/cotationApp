"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { EtatFormulaire } from "@/composants/types";
import { Bandeau, Bouton, Champ } from "@/composants/ui";
import type { ControlesDePublication, Probleme } from "@/domaine/bareme";

import { SOUS_TITRE, type EtatPublication, type RetourControles } from "./commun";

const LONGUEUR_MAX_MOTIF = 500;

const Liste = ({ elements }: { elements: string[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {elements.map((m, i) => (
      <li key={i}>{m}</li>
    ))}
  </ul>
);

/**
 * Onglet « Publier » (B5, D59) : rejouer tous les essais et contrôler les balises des modèles publiés, saisir le motif, publier, puis
 * basculer la version au barème. Les trois gestes passent par les services existants (aucune règle nouvelle ici) : la publication
 * revalide le brouillon enregistré, rejoue les essais et contrôle les balises elle-même ; ce qui s'affiche ici n'est qu'un avant-goût.
 */
export function OngletPublier({
  versionId,
  publication,
  modifie,
  problemes,
  structure,
  controler,
  publier,
  basculer,
}: {
  versionId: number;
  publication: EtatPublication;
  /** Des modifications ne sont pas enregistrées : la publication porte sur le brouillon ENREGISTRÉ. */
  modifie: boolean;
  problemes: Probleme[];
  structure: Probleme[];
  controler: (versionId: number) => Promise<RetourControles>;
  publier: (versionId: number, motif: string) => Promise<EtatFormulaire>;
  basculer: (versionId: number) => Promise<EtatFormulaire>;
}) {
  const routeur = useRouter();
  const [motif, setMotif] = useState("");
  const [controles, setControles] = useState<{ controles?: ControlesDePublication; etat?: EtatFormulaire; pour: string } | null>(null);
  const [retour, setRetour] = useState<EtatFormulaire | null>(null);
  const [enCours, setEnCours] = useState<"controle" | "publication" | "bascule" | null>(null);

  const empreinte = publication.brouillon?.empreinte ?? null;
  const bloque = structure.length + problemes.length;
  // Un contrôle vaut pour une empreinte précise du brouillon enregistré : un autre enregistrement le périme.
  const controleCourant = controles && controles.pour === empreinte ? controles : null;
  const controleVert = controleCourant?.controles !== undefined && controleCourant.controles.ecarts.length === 0 && controleCourant.controles.balises.length === 0;

  const lancerControle = async () => {
    setEnCours("controle");
    setRetour(null);
    try {
      const r = await controler(versionId);
      setControles({ ...r, pour: empreinte ?? "" });
    } finally {
      setEnCours(null);
    }
  };
  const lancerPublication = async () => {
    setEnCours("publication");
    setRetour(null);
    try {
      const etat = await publier(versionId, motif);
      setRetour(etat);
      if (etat.succes) routeur.refresh();
    } finally {
      setEnCours(null);
    }
  };
  const lancerBascule = async () => {
    setEnCours("bascule");
    setRetour(null);
    try {
      const etat = await basculer(versionId);
      setRetour(etat);
      if (etat.succes) routeur.refresh();
    } finally {
      setEnCours(null);
    }
  };

  const bandeauRetour = retour ? (
    retour.erreur ? (
      <Bandeau ton="danger" role="alert" titre={retour.erreur}>
        {retour.details?.length ? <Liste elements={retour.details} /> : null}
      </Bandeau>
    ) : (
      <Bandeau ton="succes" role="status" titre={retour.succes}>
        {retour.details?.length ? <Liste elements={retour.details} /> : null}
      </Bandeau>
    )
  ) : null;

  return (
    <section aria-labelledby="publier" className="space-y-4">
      <h3 id="publier" className={SOUS_TITRE}>
        Publier
      </h3>

      {publication.publie ? (
        <Bandeau ton="succes" role="status" titre="Barème publié : il ne se modifie plus">
          Publié le {publication.publie.publieLe} par {publication.publie.publiePar}. Empreinte : <span className="break-all font-mono">{publication.publie.empreinte}</span>. Motif : {publication.publie.motif}.
        </Bandeau>
      ) : !publication.brouillon ? (
        <Bandeau ton="avertissement">Aucun brouillon enregistré : enregistrez le barème avant de le publier.</Bandeau>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            La publication porte sur le brouillon <strong>enregistré</strong> (empreinte <span className="break-all font-mono">{empreinte}</span>). Elle rejoue tous les essais, contrôle les modèles Word publiés qui citent des champs du risque, puis fige le barème : il ne se modifiera plus (une correction est une nouvelle version du produit).
          </p>
          {modifie ? <Bandeau ton="avertissement">Des modifications ne sont pas enregistrées : enregistrez avant de contrôler ou de publier.</Bandeau> : null}
          {bloque > 0 ? (
            <Bandeau ton="danger" role="alert" titre={`${bloque} problème(s) bloquent la publication`}>
              Ils sont listés dans le panneau « Contrôles » au-dessus des onglets.
            </Bandeau>
          ) : null}

          <div className="space-y-3 rounded-lg border border-border p-3">
            <h4 className="text-sm font-bold text-foreground">1. Rejouer tous les essais et contrôler les modèles</h4>
            <Bouton variante="secondaire" onClick={lancerControle} disabled={modifie || enCours !== null || structure.length > 0} attente={enCours === "controle"}>
              {enCours === "controle" ? "Contrôle en cours…" : "Rejouer tous les essais et contrôler"}
            </Bouton>
            {controleCourant?.etat?.erreur ? (
              <Bandeau ton="danger" role="alert" titre={controleCourant.etat.erreur}>
                {controleCourant.etat.details?.length ? <Liste elements={controleCourant.etat.details} /> : null}
              </Bandeau>
            ) : null}
            {controleCourant?.controles ? (
              <div className="space-y-2" aria-live="polite">
                {controleVert ? (
                  <Bandeau ton="succes" role="status">
                    {controleCourant.controles.nombreEssais} jeu(x) d&apos;essai : tous verts. Aucun modèle publié ne cite un champ absent de ce barème.
                  </Bandeau>
                ) : null}
                {controleCourant.controles.ecarts.length > 0 ? (
                  <Bandeau ton="danger" role="alert" titre={`${controleCourant.controles.ecarts.length} écart(s) entre les essais et le calcul`}>
                    <Liste elements={controleCourant.controles.ecarts.map((x) => `Essai « ${x.essai} »${x.ligne ? `, ligne « ${x.ligne} »` : ""}, ${x.champ} : attendu ${x.attendu}, obtenu ${x.obtenu}`)} />
                  </Bandeau>
                ) : null}
                {controleCourant.controles.balises.length > 0 ? (
                  <Bandeau ton="danger" role="alert" titre={`${controleCourant.controles.balises.length} balise(s) de modèles publiés sans champ dans ce barème`}>
                    <Liste elements={controleCourant.controles.balises.map((b) => `Le ${b}`)} />
                  </Bandeau>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <h4 className="text-sm font-bold text-foreground">2. Motif et publication</h4>
            <div className="max-w-2xl">
              <Champ label="Motif de la publication (obligatoire)" value={motif} maxLength={LONGUEUR_MAX_MOTIF} autoComplete="off" onChange={(e) => setMotif(e.target.value)} />
            </div>
            <Bouton onClick={lancerPublication} disabled={modifie || motif.trim() === "" || bloque > 0 || enCours !== null} attente={enCours === "publication"}>
              {enCours === "publication" ? "Publication…" : "Publier le barème"}
            </Bouton>
            {motif.trim() === "" ? <p className="text-sm text-muted-foreground">Le motif est exigé : il est conservé avec la publication et son empreinte.</p> : null}
          </div>
        </>
      )}

      {publication.publie ? (
        publication.auBareme ? (
          <Bandeau ton="info">Cette version est tarifée au barème.</Bandeau>
        ) : publication.peutBasculer ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <h4 className="text-sm font-bold text-foreground">Basculer la version au barème</h4>
            <p className="text-sm text-muted-foreground">Le mode de la version du {publication.dateEffet} devient « Au barème ». Possible tant que la version n&apos;est pas en vigueur.</p>
            <Bouton onClick={lancerBascule} disabled={enCours !== null} attente={enCours === "bascule"}>
              {enCours === "bascule" ? "Bascule…" : "Basculer la version au barème"}
            </Bouton>
          </div>
        ) : (
          <Bandeau ton="avertissement">Cette version est déjà en vigueur dans un autre mode : son mode ne peut plus changer. Créez une version à une date postérieure.</Bandeau>
        )
      ) : null}
      {bandeauRetour}
    </section>
  );
}
