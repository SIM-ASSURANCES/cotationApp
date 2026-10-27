import { redirect } from "next/navigation";

import { Carte, EnTetePage, Tableau, type ColonneTableau } from "@/composants/ui";
import { CHAMPS, FILTRES, FILTRES_JINJA, type Section } from "@/domaine/documents/dictionnaire";
import { BALISES_FIXES } from "@/domaine/documents/modeles";
import { peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";

const code = "break-words rounded bg-muted px-1 font-mono text-[0.85em] text-foreground";

type Filtre = (typeof FILTRES)[number];
type Champ = (typeof CHAMPS)[number];

// `align-top` : les lignes de ces tableaux font plusieurs lignes de texte ; `min-w-40` : à 390 px le tableau défile au lieu d'écraser les colonnes.
const COLONNES_FILTRES: ColonneTableau<Filtre>[] = [
  { cle: "nom", entete: "Filtre", className: "align-top", rendu: (f) => <span className="font-mono">{f.nom}</span> },
  { cle: "syntaxe", entete: "Dans le Word", className: "min-w-40 align-top", rendu: (f) => <span className="font-mono text-xs">{f.syntaxe}</span> },
  { cle: "rendu", entete: "Rendu", className: "min-w-40 align-top", rendu: (f) => f.rendu },
  { cle: "note", entete: "À savoir", className: "min-w-40 align-top", rendu: (f) => f.note },
];

const COLONNES_CHAMPS: ColonneTableau<Champ>[] = [
  { cle: "chemin", entete: "Champ", className: "align-top", rendu: (c) => <span className="font-mono text-xs">{c.chemin}</span> },
  { cle: "type", entete: "Type", className: "align-top", rendu: (c) => c.type },
  { cle: "description", entete: "Description", className: "min-w-48 align-top", rendu: (c) => c.description },
  { cle: "exemple", entete: "Exemple (aperçu)", className: "min-w-32 align-top", rendu: (c) => <span className="text-neutral">{c.exemple === undefined || c.exemple === "" ? "" : String(c.exemple)}</span> },
];

/** Aide intégrée (CDC §6.2, §6.3) : générée à partir du dictionnaire du code, sa source unique. */
export default async function PageAide() {
  const utilisateur = await exigerUtilisateur();
  const [depot, publication] = await Promise.all([niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"), niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE")]);
  if (!peutLire(depot) && !peutLire(publication)) redirect("/acces-refuse");

  const sections = [...new Set(CHAMPS.map((c) => c.section))] as Section[];

  return (
    <main className="max-w-5xl space-y-6">
      <EnTetePage filAriane={[{ libelle: "Modèles Word", href: "/modeles" }, { libelle: "Aide" }]} titre="Aide à la rédaction des modèles Word" />

      <Carte titre="Règles">
        <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
          <li>
            Une valeur s'écrit <code className={code}>{"{{ souscripteur.nom }}"}</code>, avec les noms du dictionnaire ci-dessous, et seulement
            eux : un autre nom fait refuser le dépôt, avec son emplacement.
          </li>
          <li>
            Tapez chaque balise <strong>au clavier, d'un seul tenant</strong>. Jamais avec Ctrl+F9 (champ Word) : le dépôt est refusé
            (« balise saisie comme champ Word »). Si Word découpe une balise (mise en forme, correction), effacez-la et retapez-la.
          </li>
          <li>
            Condition : <code className={code}>{"{% if police.nantissement %} … {% endif %}"}</code>. Ligne de tableau répétée :{" "}
            <code className={code}>{"{%tr for a in assures %}"}</code> seul dans une ligne, la ligne du modèle (
            <code className={code}>{"{{ a.nom_prenoms }}"}</code>…), puis <code className={code}>{"{%tr endfor %}"}</code> seul dans une ligne.
            Paragraphes répétés : <code className={code}>{"{%p for … %}"}</code> et <code className={code}>{"{%p endfor %}"}</code>, chacun seul dans
            son paragraphe.
          </li>
          <li>
            Listes longues : au-delà du seuil (10 par défaut), une boucle <code className={code}>{"{%tr for %}"}</code> ou{" "}
            <code className={code}>{"{%p for %}"}</code> sur les assurés, bénéficiaires, formules ou échéances est remplacée par « Voir annexe –
            Liste des assurés (N personnes) », et la liste complète part dans l'annexe (modèle de type « Annexe »), à la fin du PDF. Une boucle
            écrite dans une ligne de texte ne peut pas passer en annexe.
          </li>
          <li>
            Sous-modèle : <code className={code}>{'{{ bloc("garanties", f.code) }}'}</code> <strong>seul dans son paragraphe</strong> (il y
            insère un tableau ou des paragraphes). Le sous-modèle est un modèle de type « Sous-modèle », de nom « garanties » et de clé le code
            de la formule.
          </li>
          <li>
            Aucun calcul dans un modèle (pas de <code className={code}>+ - * /</code>) : tous les montants viennent du moteur de calcul, déjà
            arrondis. Pas de <code className={code}>default</code> : une donnée absente arrête la génération avec son nom, plutôt qu'un blanc.
            Une valeur vide passée dans un filtre s'écrit vide si le champ est facultatif ; sinon la génération s'arrête en nommant le champ.
            Un refus liste d'un coup tous les champs à compléter.
          </li>
          <li>
            Conditions générales et spéciales : documents fixes, convertis une seule fois en PDF à la publication. Seules balises permises :{" "}
            <code className={code}>{BALISES_FIXES.CG.join(", ")}</code> (CG) et <code className={code}>{BALISES_FIXES.CS.join(", ")}</code> (CS).
          </li>
          <li>
            Facture et reçu (extensions D23) : le bloc « Envoyé à » s'écrit{" "}
            <code className={code}>{"{%p if envoye_a %}"}</code>, puis <code className={code}>{"{{ envoye_a.nom }}"}</code> et{" "}
            <code className={code}>{"{{ envoye_a.adresse }}"}</code>, puis <code className={code}>{"{%p endif %}"}</code>, chacun seul dans son
            paragraphe : <code className={code}>envoye_a</code> est vide quand le destinataire n'est pas saisi ou qu'il est le même que « Facturé
            à », et le bloc disparaît. Dans le tableau des formules, la base de la taxe s'écrit{" "}
            <code className={code}>{"{{ f.base_taxe | montant }}"}</code> ; dans celui des paiements, la personne qui a payé :{" "}
            <code className={code}>{"{{ p.payeur }}"}</code>.
          </li>
          <li>
            Avis d&apos;échéance et relances (extension D25) : l&apos;échéance appelée s&apos;écrit{" "}
            <code className={code}>{"{{ echeance_appelee.date | date }}"}</code> et{" "}
            <code className={code}>{"{{ echeance_appelee.restant_du | montant }}"}</code> ; une relance dispose en plus de{" "}
            <code className={code}>{"{{ relance.libelle }}"}</code> et <code className={code}>{"{{ relance.jours_retard }}"}</code>. Un modèle de
            relance par niveau (1, 2, 3…), du produit ou commun. Ces champs ne sont pas fournis aux autres documents.
          </li>
          <li>Polices : utilisez celles installées sur le générateur (Calibri, Tahoma, Arial, Times New Roman, MS Gothic…). Une autre police fait l'objet d'un avertissement au dépôt : la mise en page pourrait différer de Word.</li>
        </ul>
      </Carte>

      <Carte titre="Filtres">
        <Tableau colonnes={COLONNES_FILTRES} lignes={FILTRES} cleLigne={(f) => f.nom} legende="Filtres disponibles dans les modèles" />
        <p className="mt-3 text-sm text-muted-foreground">
          Filtres de Jinja également permis : <code className={code}>{FILTRES_JINJA.join(", ")}</code> (par exemple{" "}
          <code className={code}>{"{{ assures | length }}"}</code>).
        </p>
      </Carte>

      <Carte
        titre="Dictionnaire des champs (CDC §6.3)"
        description={
          <>
            « assures[].nom_prenoms » : champ de chaque assuré, à écrire dans une boucle (<code className={code}>{"{{ a.nom_prenoms }}"}</code>).
            Les champs <code className={code}>risque.*</code> sont propres à chaque produit (minuscules, chiffres et _). Pour un produit tarifé au barème, chaque champ du barème est une balise <code className={code}>risque.&lt;code&gt;</code> (le code du champ dans le barème) : elle donne la valeur saisie à la cotation (code de la liste, OUI ou NON, montant), et reste vide pour un champ qui ne s&apos;applique pas ou facultatif laissé vide. Une balise qui n&apos;est pas un champ du barème publié du produit est signalée au dépôt.
          </>
        }
      >
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section}>
              <h3 className="mb-2 font-semibold text-foreground">{section}</h3>
              <Tableau colonnes={COLONNES_CHAMPS} lignes={CHAMPS.filter((c) => c.section === section)} cleLigne={(c) => c.chemin} legende={`Champs de la section ${section}`} />
            </div>
          ))}
        </div>
      </Carte>
    </main>
  );
}
