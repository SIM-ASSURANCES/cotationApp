"use client";

import { Bandeau, Tableau, type ColonneTableau } from "@/composants/ui";
import type { Bareme, JeuEssai, SousJacent, Table } from "@/domaine/bareme";

import { Depliable, SOUS_TITRE, useOuverts } from "./commun";

/** Mention commune des trois onglets en lecture : leur écriture à l'écran est la session B5, le classeur d'ici là. */
function MentionClasseur({ nom }: { nom: string }) {
  return (
    <Bandeau ton="info">
      {nom} : en lecture seule ici. Modifiable par le classeur jusqu&apos;à la session B5 (exportez le barème publié, corrigez la feuille, réimportez-la).
    </Bandeau>
  );
}

const EFFET: Record<SousJacent["effet"], string> = {
  E1: "E1 — choisit le taux dans une table",
  E2: "E2 — coefficient (ou réduction)",
  E4: "E4 — contrôle avec message de refus",
  E5: "E5 — minimum, plafond ou ajout",
};

function cible(s: SousJacent): string {
  if (s.effet === "E4") return Array.isArray(s.quand) ? `quand ${s.quand[1] as string} ${s.quand[0]} ${s.quand[2] as string}` : `quand le champ « ${s.quand.champ} » ${"egal" in s.quand ? "vaut" : "ne vaut pas"} « ${"egal" in s.quand ? s.quand.egal : s.quand.different} »`;
  return `table « ${s.table} » → ${s.cibles.join(", ")}`;
}

export function OngletSousJacents({ doc }: { doc: Bareme }) {
  const colonnes: ColonneTableau<SousJacent>[] = [
    { cle: "code", entete: "Code", rendu: (s) => <span className="font-medium">{s.code}</span> },
    { cle: "effet", entete: "Effet", rendu: (s) => EFFET[s.effet] },
    { cle: "detail", entete: "Table et garanties visées / condition", rendu: cible },
    { cle: "message", entete: "Message de refus", rendu: (s) => (s.effet === "E4" ? s.message : "–") },
  ];
  return (
    <section aria-labelledby="sous-jacents" className="space-y-3">
      <h3 id="sous-jacents" className={SOUS_TITRE}>
        Sous-jacents ({doc.sousJacents.length})
      </h3>
      <MentionClasseur nom="Les sous-jacents" />
      <Tableau colonnes={colonnes} lignes={doc.sousJacents} cleLigne={(s) => s.code} messageVide="Aucun sous-jacent." legende="Sous-jacents du barème" />
    </section>
  );
}

export function OngletTables({ doc }: { doc: Bareme }) {
  const ouverts = useOuverts();
  return (
    <section aria-labelledby="tables" className="space-y-3">
      <h3 id="tables" className={SOUS_TITRE}>
        Tables ({doc.tables.length})
      </h3>
      <MentionClasseur nom="Les tables" />
      {doc.tables.length === 0 ? <p className="text-sm text-muted-foreground">Aucune table.</p> : null}
      {doc.tables.map((t: Table) => {
        const lignes = Object.entries(t.lignes).map(([cle, valeur]) => ({ cle, valeur }));
        return (
          <Depliable key={t.code} ouvert={ouverts.estOuvert(t.code)} onBascule={(o) => ouverts.bascule(t.code, o)} titre={t.code} sousTitre={`clés : ${t.cles.join(" × ")} — ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}`}>
            <Tableau
              colonnes={[
                { cle: "cle", entete: t.cles.join(" | "), rendu: (l) => l.cle },
                { cle: "valeur", entete: "Valeur", alignement: "droite", rendu: (l) => l.valeur },
              ]}
              lignes={lignes}
              cleLigne={(l) => l.cle}
              legende={`Lignes de la table ${t.code}`}
            />
          </Depliable>
        );
      })}
    </section>
  );
}

export function OngletEssais({ doc }: { doc: Bareme }) {
  const colonnes: ColonneTableau<JeuEssai>[] = [
    { cle: "nom", entete: "Jeu d'essai", rendu: (e) => <span className="font-medium">{e.nom}</span> },
    { cle: "champs", entete: "Champs saisis", alignement: "droite", rendu: (e) => Object.keys(e.entrees.champs).length },
    { cle: "souscrit", entete: "Souscriptions", alignement: "droite", rendu: (e) => e.entrees.souscrit.length },
    { cle: "attendu", entete: "Résultat attendu", rendu: (e) => (e.attendu.refus ? `Refus : « ${e.attendu.refus} »` : e.attendu.ttc ? `TTC ${e.attendu.ttc}` : `${e.attendu.lignes?.length ?? 0} ligne(s)`) },
  ];
  return (
    <section aria-labelledby="essais" className="space-y-3">
      <h3 id="essais" className={SOUS_TITRE}>
        Jeux d&apos;essai ({doc.jeuxEssai.length})
      </h3>
      <MentionClasseur nom="Les jeux d'essai" />
      <p className="text-sm text-muted-foreground">Un barème ne se publie que si tous ses jeux d&apos;essai retombent sur leurs chiffres : « Rejouer les essais » les calcule sur le brouillon enregistré. Un champ obligatoire ajouté fait échouer les essais qui ne le renseignent pas : rendez-le facultatif, ou ajoutez-le aux essais par le classeur.</p>
      <Tableau colonnes={colonnes} lignes={doc.jeuxEssai} cleLigne={(e) => e.nom} messageVide="Aucun jeu d'essai : la publication sera refusée." legende="Jeux d'essai du barème" />
    </section>
  );
}
