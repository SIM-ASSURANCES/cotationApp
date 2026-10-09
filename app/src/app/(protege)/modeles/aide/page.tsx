import Link from "next/link";
import { redirect } from "next/navigation";

import { CHAMPS, FILTRES, FILTRES_JINJA, type Section } from "@/domaine/documents/dictionnaire";
import { BALISES_FIXES } from "@/domaine/documents/modeles";
import { peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";

const code = "rounded bg-surface px-1 font-mono text-[0.85em]";

/** Aide intégrée (CDC §6.2, §6.3) : générée à partir du dictionnaire du code, sa source unique. */
export default async function PageAide() {
  const utilisateur = await exigerUtilisateur();
  const [depot, publication] = await Promise.all([niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"), niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE")]);
  if (!peutLire(depot) && !peutLire(publication)) redirect("/acces-refuse");

  const sections = [...new Set(CHAMPS.map((c) => c.section))] as Section[];

  return (
    <main className="max-w-5xl">
      <p className="mb-2 text-sm">
        <Link href="/modeles" className="text-sim-bleu underline">
          ← Modèles Word
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold text-sim-bleu">Aide à la rédaction des modèles Word</h1>

      <section className="mb-8 space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Règles</h2>
        <ul className="list-disc space-y-1 pl-5">
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
          <li>Polices : utilisez celles installées sur le générateur (Calibri, Tahoma, Arial, Times New Roman, MS Gothic…). Une autre police fait l'objet d'un avertissement au dépôt : la mise en page pourrait différer de Word.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Filtres</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">Filtre</th>
              <th className="p-2">Dans le Word</th>
              <th className="p-2">Rendu</th>
              <th className="p-2">À savoir</th>
            </tr>
          </thead>
          <tbody>
            {FILTRES.map((f) => (
              <tr key={f.nom} className="border-b border-bordure align-top">
                <td className="p-2 font-mono">{f.nom}</td>
                <td className="p-2 font-mono text-xs">{f.syntaxe}</td>
                <td className="p-2">{f.rendu}</td>
                <td className="p-2">{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-zinc-700">
          Filtres de Jinja également permis : <code className={code}>{FILTRES_JINJA.join(", ")}</code> (par exemple{" "}
          <code className={code}>{"{{ assures | length }}"}</code>).
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Dictionnaire des champs (CDC §6.3)</h2>
        <p className="mb-3 text-sm text-zinc-700">
          « assures[].nom_prenoms » : champ de chaque assuré, à écrire dans une boucle (<code className={code}>{"{{ a.nom_prenoms }}"}</code>).
          Les champs <code className={code}>risque.*</code> sont propres à chaque produit (minuscules, chiffres et _).
        </p>
        {sections.map((section) => (
          <div key={section} className="mb-6">
            <h3 className="mb-1 font-semibold">{section}</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface text-left">
                  <th className="p-1">Champ</th>
                  <th className="p-1">Type</th>
                  <th className="p-1">Description</th>
                  <th className="p-1">Exemple (aperçu)</th>
                </tr>
              </thead>
              <tbody>
                {CHAMPS.filter((c) => c.section === section).map((c) => (
                  <tr key={c.chemin} className="border-b border-bordure align-top">
                    <td className="p-1 font-mono text-xs">{c.chemin}</td>
                    <td className="p-1">{c.type}</td>
                    <td className="p-1">{c.description}</td>
                    <td className="p-1 text-zinc-700">{c.exemple === undefined || c.exemple === "" ? "" : String(c.exemple)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </main>
  );
}
