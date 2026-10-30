import { notFound } from "next/navigation";

import { EditeurBareme } from "@/composants/bareme/EditeurBareme";
import { Bandeau, EnTetePage, EtatVide, LienBouton } from "@/composants/ui";
import { schemaBareme } from "@/domaine/bareme";
import { aujourdhui, formaterDate } from "@/domaine/calcul/dates";
import { peutAgir } from "@/domaine/droits";
import { lireBaremePourEdition } from "@/serveur/bareme-edition";
import { exigerDroit } from "@/serveur/session";

import { basculerLeBaremeEcran, controlerLaPublicationEcran, enregistrerLeBaremeEcran, publierLeBaremeEcran, rejouerLesEssaisEcran } from "../../actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Édition d'un barème à l'écran (B4, D58) : le brouillon d'une version se modifie ; un barème publié se consulte seulement. */
export default async function PageEditionBareme(props: PageProps<"/parametrage/produits/[code]/bareme/[versionId]">) {
  const { code, versionId } = await props.params;
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutAgir);
  const id = Number(versionId);
  if (!Number.isInteger(id)) notFound();
  const donnees = await lireBaremePourEdition(utilisateur, id);
  if (!donnees || donnees.produit.code !== code) notFound();

  const retour = `/parametrage/produits/${code}`;
  const ligne = donnees.brouillon ?? donnees.publie;
  const lu = ligne ? schemaBareme.safeParse(ligne.contenu) : null;
  const titre = `Barème de la version du ${formaterDate(donnees.version.dateEffet)}`;
  const etat = donnees.brouillon
    ? `Brouillon enregistré par ${donnees.brouillon.creePar} (modifié le ${formaterDate(iso(donnees.brouillon.modifieLe))}, empreinte ${donnees.brouillon.empreinte}). Il n'est pas encore publié.`
    : donnees.publie
      ? `Barème publié le ${formaterDate(iso(donnees.publie.publieLe))} par ${donnees.publie.publiePar} (empreinte ${donnees.publie.empreinte}). Il ne se modifie plus.`
      : "Cette version n'a pas encore de barème.";

  return (
    <main className="space-y-6">
      <EnTetePage
        filAriane={[{ libelle: "Produits", href: "/parametrage/produits" }, { libelle: donnees.produit.code, href: retour }, { libelle: titre }]}
        titre={`${donnees.produit.code} — ${titre}`}
        sousTitre={etat}
        actions={<LienBouton href={retour}>Retour à la fiche du produit</LienBouton>}
      />
      {!ligne || !lu ? (
        <EtatVide message="Cette version n'a pas encore de barème. Créez un barème vide ou importez un classeur depuis la fiche du produit." />
      ) : !lu.success ? (
        <Bandeau ton="danger" role="alert" titre="Barème illisible">
          Le document enregistré ne passe plus le schéma : il ne peut pas être édité à l&apos;écran. Réimportez un classeur depuis la fiche du produit.
        </Bandeau>
      ) : (
        <EditeurBareme
          versionId={id}
          initial={lu.data}
          lectureSeule={!donnees.brouillon || !donnees.preparable}
          codesFiges={donnees.codesFiges}
          categoriesTaxe={donnees.categoriesTaxe}
          publication={{
            brouillon: donnees.brouillon ? { empreinte: donnees.brouillon.empreinte } : null,
            publie: donnees.publie ? { empreinte: donnees.publie.empreinte, publieLe: formaterDate(iso(donnees.publie.publieLe)), publiePar: donnees.publie.publiePar, motif: donnees.publie.motif } : null,
            peutBasculer: donnees.publie !== null && donnees.version.modeTarification !== "BAREME" && donnees.version.dateEffet > aujourdhui(),
            auBareme: donnees.version.modeTarification === "BAREME",
            dateEffet: formaterDate(donnees.version.dateEffet),
          }}
          enregistrer={enregistrerLeBaremeEcran.bind(null, code)}
          rejouer={rejouerLesEssaisEcran.bind(null, code)}
          controler={controlerLaPublicationEcran.bind(null, code)}
          publier={publierLeBaremeEcran.bind(null, code)}
          basculer={basculerLeBaremeEcran.bind(null, code)}
        />
      )}
    </main>
  );
}
