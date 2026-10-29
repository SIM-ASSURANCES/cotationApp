"use client";

import { useState } from "react";

import { Bandeau, Bouton, ChampFormulaire, classesControle, ListeDeroulante } from "@/composants/ui";
import type { IntermediaireDocument } from "@/domaine/intermediaires";
import { creerIntermediaireDepuisCotation } from "@/app/(protege)/cotations/actions";

const ROLES_SUGGERES = [
  "Courtier",
  "Apporteur",
  "Agent général",
  "Conseiller",
  "Banque partenaire",
  "Gestionnaire",
] as const;

export type SelectionIntermediairesProps = {
  initialChoix: IntermediaireDocument[];
  valeursInitiales?: [string, string];
};

/**
 * Sélection de 0 à 2 intermédiaires pour une cotation (CDC §10.1).
 * Permet également la création inline d'un intermédiaire en base sans quitter le formulaire.
 */
export function SelectionIntermediaires({ initialChoix, valeursInitiales }: SelectionIntermediairesProps) {
  const [choix, setChoix] = useState<IntermediaireDocument[]>(initialChoix);
  const [selection1, setSelection1] = useState(valeursInitiales?.[0] ?? "");
  const [selection2, setSelection2] = useState(valeursInitiales?.[1] ?? "");

  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [code, setCode] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succesMsg, setSuccesMsg] = useState<string | null>(null);

  const optionsChoix = [
    { valeur: "", libelle: "— Aucun —" },
    ...choix.map((i) => ({ valeur: i.code, libelle: `${i.nom} (${i.code}, ${i.role})` })),
  ];

  const handleCreer = async () => {
    setErreur(null);
    setSuccesMsg(null);

    const c = code.trim().toUpperCase();
    const n = nom.trim();
    const r = role.trim();

    if (!c) {
      setErreur("Le code d'intermédiaire est obligatoire.");
      return;
    }
    if (!n) {
      setErreur("Le nom de l'intermédiaire est obligatoire.");
      return;
    }
    if (!r) {
      setErreur("Le rôle de l'intermédiaire est obligatoire.");
      return;
    }

    setEnCours(true);
    try {
      const res = await creerIntermediaireDepuisCotation({ code: c, nom: n, role: r });
      if (!res.succes) {
        setErreur(res.erreur);
        return;
      }

      const nouveau = res.intermediaire;
      setChoix((prev) => [...prev.filter((item) => item.code !== nouveau.code), nouveau]);

      // Sélectionner automatiquement le nouvel intermédiaire
      if (!selection1) {
        setSelection1(nouveau.code);
      } else if (!selection2 && selection1 !== nouveau.code) {
        setSelection2(nouveau.code);
      } else {
        setSelection1(nouveau.code);
      }

      setSuccesMsg(`Intermédiaire « ${nouveau.nom} » (${nouveau.code}) créé en base et sélectionné.`);
      setCode("");
      setNom("");
      setRole("");

      setTimeout(() => {
        setSuccesMsg(null);
        setPanneauOuvert(false);
      }, 2000);
    } catch {
      setErreur("Une erreur imprévue est survenue lors de la création de l'intermédiaire.");
    } finally {
      setEnCours(false);
    }
  };

  const doublon = Boolean(selection1 && selection2 && selection1 === selection2);

  return (
    <div className="space-y-4">
      <div className="grid max-w-3xl gap-x-6 gap-y-4 sm:grid-cols-2">
        <ListeDeroulante
          label="Intermédiaire 1 (facultatif)"
          name="intermediaire"
          value={selection1}
          onChange={(e) => setSelection1(e.target.value)}
          options={optionsChoix}
        />
        <ListeDeroulante
          label="Intermédiaire 2 (facultatif)"
          name="intermediaire"
          value={selection2}
          onChange={(e) => setSelection2(e.target.value)}
          options={optionsChoix}
        />
      </div>

      {doublon ? (
        <Bandeau ton="avertissement" className="max-w-3xl">
          Le même intermédiaire est sélectionné deux fois. Veuillez en choisir un distinct ou laisser la seconde option vide.
        </Bandeau>
      ) : null}

      <div className="flex max-w-3xl items-center justify-between gap-4 pt-1">
        <p className="text-xs text-muted-foreground">
          Associez jusqu&apos;à 2 intermédiaires. L&apos;intermédiaire manquant peut être créé directement en base ci-dessous.
        </p>
        {!panneauOuvert ? (
          <Bouton
            type="button"
            variante="secondaire"
            onClick={() => {
              setPanneauOuvert(true);
              setErreur(null);
              setSuccesMsg(null);
            }}
            className="text-xs shrink-0"
          >
            + Nouvel intermédiaire
          </Bouton>
        ) : null}
      </div>

      {panneauOuvert ? (
        <div className="max-w-3xl rounded-lg border border-border bg-card p-4 space-y-3 shadow-subtle">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Ajouter un intermédiaire au référentiel</h4>
              <p className="text-xs text-muted-foreground">
                L&apos;intermédiaire sera enregistré en base de données et immédiatement proposé sur ce contrat.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPanneauOuvert(false);
                setErreur(null);
                setSuccesMsg(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground p-1"
            >
              Fermer ✕
            </button>
          </div>

          {erreur ? <Bandeau ton="danger">{erreur}</Bandeau> : null}
          {succesMsg ? <Bandeau ton="succes">{succesMsg}</Bandeau> : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <ChampFormulaire label="Code (ex. BENI-01)" requis htmlFor="champ-nouveau-code">
              <input
                id="champ-nouveau-code"
                type="text"
                value={code}
                maxLength={30}
                placeholder="BENI-01"
                autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreer();
                  }
                }}
                className={classesControle(false, "uppercase font-mono text-sm")}
              />
            </ChampFormulaire>

            <ChampFormulaire label="Nom complet" requis htmlFor="champ-nouveau-nom">
              <input
                id="champ-nouveau-nom"
                type="text"
                value={nom}
                maxLength={200}
                placeholder="Cabinet ABC Courtage"
                autoComplete="off"
                onChange={(e) => setNom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreer();
                  }
                }}
                className={classesControle(false, "text-sm")}
              />
            </ChampFormulaire>

            <ChampFormulaire label="Rôle" requis htmlFor="champ-nouveau-role">
              <div className="space-y-1.5">
                <input
                  id="champ-nouveau-role"
                  type="text"
                  value={role}
                  maxLength={100}
                  placeholder="ex. Courtier, Apporteur"
                  autoComplete="off"
                  onChange={(e) => setRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreer();
                    }
                  }}
                  className={classesControle(false, "text-sm")}
                />
                <select
                  aria-label="Suggestion de rôle"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setRole(e.target.value);
                  }}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-muted-foreground"
                >
                  <option value="">— Suggestions de rôle —</option>
                  {ROLES_SUGGERES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </ChampFormulaire>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Bouton
              type="button"
              variante="secondaire"
              onClick={() => {
                setPanneauOuvert(false);
                setErreur(null);
                setSuccesMsg(null);
              }}
              disabled={enCours}
            >
              Annuler
            </Bouton>
            <Bouton
              type="button"
              variante="principal"
              onClick={handleCreer}
              attente={enCours}
            >
              Enregistrer et sélectionner
            </Bouton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

