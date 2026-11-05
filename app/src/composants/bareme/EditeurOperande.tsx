"use client";

import { Bouton, ChampMontant, ListeDeroulante, type OptionListe } from "@/composants/ui";
import {
  FORME_OPERATION,
  GENRES_OPERATION,
  LIBELLE_GENRE,
  ajouterOperande,
  changerGenre,
  estNumerique,
  genreDe,
  peutPlacerOperation,
  retirerOperande,
  texteConstante,
  type Bareme,
  type GenreOperande,
  type Operande,
} from "@/domaine/bareme";

import { decimalSaisi } from "./commun";

const GENRES: GenreOperande[] = ["CHAMP", "INTERMEDIAIRE", "CONSTANTE", ...GENRES_OPERATION];

/**
 * Montant d'une assiette (E3) choisi par listes et cases : un champ, une valeur intermédiaire, un nombre fixe, ou l'une des cinq
 * opérations fermées (SOMME, FOIS, PCT_PLAFOND, TABLE, PREMIER). Aucune syntaxe à taper. Les opérations s'imbriquent sur deux niveaux
 * au plus : au-delà, l'opération n'est pas proposée (le domaine refuse aussi), et on nomme une valeur intermédiaire.
 */
export function EditeurOperande({
  b,
  op,
  onChange,
  etiquette,
  intermediaires,
  niveau = 0,
  disabled,
}: {
  b: Bareme;
  op: Operande;
  onChange: (op: Operande) => void;
  etiquette: string;
  /** Valeurs intermédiaires lisibles ici (celles définies avant celle qu'on édite). */
  intermediaires: string[];
  niveau?: number;
  disabled?: boolean;
}) {
  const genre = genreDe(op, b);
  const champs = b.champs.filter(estNumerique).map((c) => c.code);
  const tables = b.tables.map((t) => t.code);
  const options = { champs, intermediaires, tables };
  const operationPermise = peutPlacerOperation(niveau);

  const optionsGenre: OptionListe[] = GENRES.map((g) => {
    const refuse =
      g !== genre &&
      ((GENRES_OPERATION as readonly string[]).includes(g) && !operationPermise
        ? true
        : (g === "CHAMP" && champs.length === 0) || (g === "INTERMEDIAIRE" && intermediaires.length === 0) || (g === "TABLE" && tables.length === 0));
    const raison = !operationPermise && (GENRES_OPERATION as readonly string[]).includes(g) ? " — 2 niveaux au plus" : g === "CHAMP" && champs.length === 0 ? " — aucun champ numérique" : g === "INTERMEDIAIRE" && intermediaires.length === 0 ? " — aucune valeur intermédiaire" : g === "TABLE" && tables.length === 0 ? " — aucune table" : "";
    return { valeur: g, libelle: `${LIBELLE_GENRE[g]}${refuse ? raison : ""}`, desactive: refuse };
  });

  const choisir = (code: string, liste: string[], intitule: string) => (
    <ListeDeroulante
      label={intitule}
      value={code}
      disabled={disabled}
      options={[...(liste.includes(code) ? [] : [{ valeur: code, libelle: code === "" ? "Choisir…" : `${code} (introuvable)` }]), ...liste.map((x) => ({ valeur: x, libelle: x }))]}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ListeDeroulante label={etiquette} value={genre ?? "CHAMP"} options={optionsGenre} disabled={disabled} onChange={(e) => onChange(changerGenre(op, e.target.value as GenreOperande, options))} />
        {genre === "CHAMP" && typeof op === "string" ? choisir(op, champs, "Champ") : null}
        {genre === "INTERMEDIAIRE" && typeof op === "string" ? choisir(op, intermediaires, "Valeur intermédiaire") : null}
        {genre === "CONSTANTE" ? (
          <ChampMontant label="Nombre" disabled={disabled} value={texteConstante(op)} onChange={(v) => onChange(decimalSaisi(v))} />
        ) : null}
        {genre === "TABLE" && Array.isArray(op) ? choisir(String(op[1] ?? ""), tables, "Table (lue par ses clés)") : null}
      </div>
      {genre === null ? <p className="text-sm text-danger">Opération inconnue dans ce document : choisissez un autre genre de montant.</p> : null}
      {Array.isArray(op) && genre !== null && genre !== "TABLE" ? (
        <div className="space-y-3 border-l-2 border-border pl-3">
          {op.slice(1).map((enfant, i) => {
            const forme = FORME_OPERATION[genre as keyof typeof FORME_OPERATION];
            const nom = forme.emplacements[i] ?? `Valeur ${i + 1}`;
            const variable = genre === "SOMME" || genre === "PREMIER";
            return (
              <div key={i} className="space-y-2">
                <EditeurOperande
                  b={b}
                  op={enfant}
                  etiquette={`${nom} — genre`}
                  intermediaires={intermediaires}
                  niveau={niveau + 1}
                  disabled={disabled}
                  onChange={(nouveau) => onChange(op.map((x, k) => (k === i + 1 ? nouveau : x)))}
                />
                {variable && op.length - 1 > 1 && !disabled ? (
                  <Bouton variante="secondaire" onClick={() => onChange(retirerOperande(op, [], i))} aria-label={`Retirer la valeur ${i + 1}`}>
                    Retirer la valeur {i + 1}
                  </Bouton>
                ) : null}
              </div>
            );
          })}
          {genre === "SOMME" || genre === "PREMIER" ? (
            <Bouton variante="secondaire" disabled={disabled} onClick={() => onChange(ajouterOperande(op, []))}>
              Ajouter une valeur
            </Bouton>
          ) : null}
                  </div>
      ) : null}
    </div>
  );
}

