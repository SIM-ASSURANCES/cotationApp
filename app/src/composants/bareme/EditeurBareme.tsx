"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { EtatFormulaire } from "@/composants/types";
import { Bandeau, Bouton, LienBouton } from "@/composants/ui";
import { schemaBareme, verifierBareme, type Bareme, type Probleme, type Resultat } from "@/domaine/bareme";

import type { ContexteEdition } from "./commun";
import { OngletChamps } from "./OngletChamps";
import { OngletGaranties } from "./OngletGaranties";
import { OngletIntermediaires } from "./OngletIntermediaires";
import { OngletEssais, OngletSousJacents, OngletTables } from "./OngletsLecture";
import { PanneauControles } from "./PanneauControles";

const ONGLETS = [
  { id: "champs", libelle: "Champs", lecture: false },
  { id: "intermediaires", libelle: "Intermédiaires", lecture: false },
  { id: "garanties", libelle: "Garanties", lecture: false },
  { id: "sous-jacents", libelle: "Sous-jacents", lecture: true },
  { id: "tables", libelle: "Tables", lecture: true },
  { id: "essais", libelle: "Jeux d'essai", lecture: true },
] as const;
type IdOnglet = (typeof ONGLETS)[number]["id"];

/**
 * Éditeur de barème à l'écran (B4, D58). Il édite le MÊME document que l'import : l'état est le document, les contrôles sont ceux
 * de `verifierBareme` (domaine, recalculés à chaque modification), l'enregistrement passe par le service du serveur (schéma zod et
 * mêmes messages). Aucune règle de barème n'est écrite ici.
 */
export function EditeurBareme({
  versionId,
  initial,
  lectureSeule,
  codesFiges,
  categoriesTaxe,
  lienPublier,
  enregistrer,
  rejouer,
}: {
  versionId: number;
  initial: Bareme;
  /** Barème publié : consultable, jamais modifiable. */
  lectureSeule: boolean;
  codesFiges: string[];
  categoriesTaxe: string[];
  lienPublier: string;
  enregistrer: (versionId: number, document: string) => Promise<EtatFormulaire>;
  rejouer: (versionId: number) => Promise<EtatFormulaire>;
}) {
  const [doc, setDoc] = useState<Bareme>(initial);
  const [enregistre, setEnregistre] = useState(() => JSON.stringify(initial));
  const [onglet, setOnglet] = useState<IdOnglet>("champs");
  const [refus, setRefus] = useState<string[]>([]);
  const [retour, setRetour] = useState<{ etat: EtatFormulaire; origine: "enregistrement" | "essais" } | null>(null);
  const [enCours, setEnCours] = useState<"enregistrement" | "essais" | null>(null);
  const boutons = useRef<Record<string, HTMLButtonElement | null>>({});

  const courant = useMemo(() => JSON.stringify(doc), [doc]);
  const modifie = courant !== enregistre;

  const { structure, problemes } = useMemo(() => {
    const lu = schemaBareme.safeParse(JSON.parse(courant));
    if (!lu.success) {
      const structure: Probleme[] = lu.error.issues.map((i) => ({ code: "SCHEMA", message: `${i.path.length > 0 ? i.path.join(".") : "(document)"} : ${i.message}` }));
      return { structure, problemes: [] as Probleme[] };
    }
    return { structure: [] as Probleme[], problemes: verifierBareme(lu.data, { publication: true }) };
  }, [courant]);

  useEffect(() => {
    if (!modifie) return;
    const garde = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", garde);
    return () => window.removeEventListener("beforeunload", garde);
  }, [modifie]);

  const ctx: ContexteEdition = {
    doc,
    maj: (f) => {
      setRefus([]);
      setDoc(f);
    },
    appliquer: (r: Resultat) => {
      if (r.ok) {
        setRefus([]);
        setDoc(r.bareme);
      } else setRefus(r.refus);
    },
    refuser: setRefus,
    figes: useMemo(() => new Set(codesFiges), [codesFiges]),
    categoriesTaxe,
  };

  const lancerEnregistrement = async () => {
    setEnCours("enregistrement");
    setRetour(null);
    const envoye = courant;
    try {
      const etat = await enregistrer(versionId, envoye);
      setRetour({ etat, origine: "enregistrement" });
      if (etat.succes) setEnregistre(envoye);
    } finally {
      setEnCours(null);
    }
  };
  const lancerEssais = async () => {
    setEnCours("essais");
    setRetour(null);
    try {
      setRetour({ etat: await rejouer(versionId), origine: "essais" });
    } finally {
      setEnCours(null);
    }
  };

  const surTouche = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const aller = e.key === "ArrowRight" ? (i + 1) % ONGLETS.length : e.key === "ArrowLeft" ? (i - 1 + ONGLETS.length) % ONGLETS.length : e.key === "Home" ? 0 : e.key === "End" ? ONGLETS.length - 1 : null;
    if (aller === null) return;
    e.preventDefault();
    setOnglet(ONGLETS[aller].id);
    boutons.current[ONGLETS[aller].id]?.focus();
  };

  const bandeauRetour = retour ? (
    retour.etat.erreur ? (
      <Bandeau ton="danger" role="alert" titre={retour.etat.erreur}>
        {retour.etat.details?.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {retour.etat.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </Bandeau>
    ) : (
      <Bandeau ton={retour.etat.details?.length ? "avertissement" : "succes"} role="status" titre={retour.etat.succes}>
        {retour.etat.details?.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {retour.etat.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </Bandeau>
    )
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-elevated sm:flex-row sm:flex-wrap sm:items-center">
        {lectureSeule ? (
          <p className="text-sm text-neutral">Barème publié : consultation seule. Pour le corriger, créez une nouvelle version à partir de lui (fiche du produit).</p>
        ) : (
          <>
            <Bouton onClick={lancerEnregistrement} disabled={!modifie || enCours !== null || structure.length > 0} attente={enCours === "enregistrement"}>
              {enCours === "enregistrement" ? "Enregistrement…" : "Enregistrer"}
            </Bouton>
            <Bouton variante="secondaire" onClick={lancerEssais} disabled={modifie || enCours !== null} attente={enCours === "essais"} title={modifie ? "Enregistrez d'abord : les essais se rejouent sur le brouillon enregistré" : undefined}>
              {enCours === "essais" ? "Calcul des essais…" : "Rejouer les essais"}
            </Bouton>
            <LienBouton href={lienPublier} variante="secondaire">
              Publier (fiche du produit)
            </LienBouton>
            <p className="text-sm text-neutral sm:ml-auto" role="status">
              {modifie ? "Modifications non enregistrées." : "Tout est enregistré."}
            </p>
          </>
        )}
      </div>
      {modifie && !lectureSeule ? <p className="text-sm text-muted-foreground">« Rejouer les essais » calcule le brouillon enregistré : enregistrez avant de rejouer.</p> : null}
      {bandeauRetour}
      {refus.length > 0 ? (
        <Bandeau ton="avertissement" role="alert" titre="Modification refusée">
          <ul className="list-disc space-y-1 pl-5">
            {refus.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => setRefus([])}>
            Fermer ce message
          </button>
        </Bandeau>
      ) : null}

      <PanneauControles problemes={problemes} structure={structure} />

      <div className="relative overflow-x-auto">
        <div role="tablist" aria-label="Parties du barème" className="flex min-w-max gap-1 border-b border-border">
          {ONGLETS.map((o, i) => (
            <button
              key={o.id}
              ref={(el) => {
                boutons.current[o.id] = el;
              }}
              type="button"
              role="tab"
              id={`onglet-${o.id}`}
              aria-selected={onglet === o.id}
              aria-controls={`panneau-${o.id}`}
              tabIndex={onglet === o.id ? 0 : -1}
              onClick={() => setOnglet(o.id)}
              onKeyDown={(e) => surTouche(e, i)}
              className={`min-h-10 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition-colors duration-150 ease-out-strong sm:min-h-0 ${onglet === o.id ? "border-primary text-primary" : "border-transparent text-neutral hover:text-foreground"}`}
            >
              {o.libelle}
              {o.lecture ? <span className="ml-1 text-xs font-normal">(lecture)</span> : null}
            </button>
          ))}
        </div>
      </div>

      {ONGLETS.map((o) => (
        <div key={o.id} role="tabpanel" id={`panneau-${o.id}`} aria-labelledby={`onglet-${o.id}`} hidden={onglet !== o.id} className="rounded-2xl border border-border bg-surface p-4 shadow-elevated">
          {o.id === "champs" ? <OngletChamps ctx={ctx} disabled={lectureSeule} /> : null}
          {o.id === "intermediaires" ? <OngletIntermediaires ctx={ctx} disabled={lectureSeule} /> : null}
          {o.id === "garanties" ? <OngletGaranties ctx={ctx} disabled={lectureSeule} /> : null}
          {o.id === "sous-jacents" ? <OngletSousJacents doc={doc} /> : null}
          {o.id === "tables" ? <OngletTables doc={doc} /> : null}
          {o.id === "essais" ? <OngletEssais doc={doc} /> : null}
        </div>
      ))}
    </div>
  );
}
