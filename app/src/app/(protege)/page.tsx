import { Bandeau, Bouton, Carte, CarteIndicateur, Champ, EnTetePage, tonDuStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS } from "@/domaine/cotation/statuts";
import { DOCUMENTS, estTypeDocument } from "@/domaine/documents/emission";
import { LIBELLE_TRANCHE, TRANCHES_ANCIENNETE, type LigneTransformation } from "@/domaine/tableaux/indicateurs";
import { exigerUtilisateur } from "@/serveur/session";
import { tableauCommercialMemorise, tableauDeBordMemorise } from "@/serveur/tableaux-memorises";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

import { TableauDeBordCommercial } from "./tableau-commercial";

const f = (m: string) => `${formaterMontant(montant(m))} F`;

const TITRE_SOUS_SECTION = "mb-2 text-base font-semibold text-foreground";

/** Taux de transformation d'un regroupement (produit, commercial, intermédiaire) : une ligne par clé. */
function Transformation({ titre, entete, lignes }: { titre: string; entete: string; lignes: LigneTransformation[] }) {
  const colonnes: ColonneTableau<LigneTransformation>[] = [
    { cle: "cle", entete, rendu: (l) => l.cle },
    { cle: "emises", entete: "Émises", alignement: "droite", rendu: (l) => l.emises },
    { cle: "acceptees", entete: "Acceptées", alignement: "droite", rendu: (l) => l.acceptees },
    { cle: "taux", entete: "Taux", alignement: "droite", rendu: (l) => (l.taux === null ? "—" : `${l.taux.replace(".", ",")} %`) },
  ];
  return (
    <div>
      <h3 className={TITRE_SOUS_SECTION}>{titre}</h3>
      <Tableau legende={titre} lignes={lignes} cleLigne={(l) => l.cle} messageVide="Aucune cotation émise sur la période." colonnes={colonnes} />
    </div>
  );
}

function Bienvenue({ nom, profil }: { nom: string; profil: string }) {
  return (
    <main className="space-y-6">
      <EnTetePage titre={`Bonjour ${nom}`} />
      <Carte className="max-w-3xl">
        <p className="text-sm text-muted-foreground">
          Connecté en tant que <strong className="text-foreground">{profil}</strong>. Le menu donne accès aux écrans de votre profil.
        </p>
      </Carte>
    </main>
  );
}

/** Accueil = tableaux de bord (session 5b) : cotations (§9.4), facturation et relances (§11, §12), production. Recalculés depuis la base à chaque affichage. */
export default async function PageTableauDeBord(props: PageProps<"/">) {
  const recherche = await props.searchParams;
  const texte = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const utilisateur = await exigerUtilisateur();
  const periode = { debut: texte(recherche.debut), fin: texte(recherche.fin) };
  // Profil Commercial (H102) : son tableau personnel, jamais le tableau général (qui montre le travail de tous), quels que soient ses droits.
  if (utilisateur.profil === "COMMERCIAL") {
    let perso;
    let erreurPerso: string | null = null;
    try {
      perso = await tableauCommercialMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreurPerso = e.message;
      perso = await tableauCommercialMemorise(utilisateur);
    }
    return <TableauDeBordCommercial t={perso} erreur={erreurPerso} />;
  }
  let t;
  let erreur: string | null = null;
  try {
    t = await tableauDeBordMemorise(utilisateur, periode);
  } catch (e) {
    // Profil sans le droit « Consulter les tableaux de bord » (droits personnalisés) : simple page de bienvenue.
    if (e instanceof ErreurAcces) return <Bienvenue nom={utilisateur.nom} profil={utilisateur.libelleProfil} />;
    if (!(e instanceof ErreurMetier)) throw e;
    erreur = e.message;
    t = await tableauDeBordMemorise(utilisateur);
  }
  const { cotations: c, facturation: fa, production: p } = t;

  return (
    <main className="space-y-6">
      <EnTetePage titre="Tableaux de bord" />

      <Carte>
        <form className="flex flex-wrap items-end gap-4" method="get">
          <div className="w-full sm:w-56">
            <Champ label="Du (AAAA-MM-JJ)" name="debut" defaultValue={t.periode.debut} />
          </div>
          <div className="w-full sm:w-56">
            <Champ label="Au" name="fin" defaultValue={t.periode.fin} />
          </div>
          <Bouton type="submit">Afficher</Bouton>
        </form>
        {erreur ? (
          <Bandeau ton="danger" role="alert" className="mt-4">
            {erreur} Période par défaut affichée.
          </Bandeau>
        ) : null}
      </Carte>

      <Carte
        titre="Cotations"
        description={`Créées du ${t.periode.debut} au ${t.periode.fin}, à leur statut d'aujourd'hui. Taux de transformation : cotations émises sur la période, acceptées à ce jour.`}
      >
        {/* Le ton de chaque indicateur vient de la table unique des statuts (ui/statuts.tsx), pas d'une table locale. */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STATUTS.map((s) => (
            <CarteIndicateur key={s} icone="document" etiquette={LIBELLE_STATUT[s]} valeur={c.parStatut[s]} ton={tonDuStatut(LIBELLE_STATUT[s])} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Transformation titre="Par produit" entete="Produit" lignes={c.transformation.parProduit} />
          <Transformation titre="Par commercial (auteur de la cotation)" entete="Commercial" lignes={c.transformation.parCommercial} />
          <Transformation titre="Par intermédiaire (une cotation compte pour chacun de ses intermédiaires)" entete="Intermédiaire" lignes={c.transformation.parIntermediaire} />
        </div>
      </Carte>

      <Carte titre="Facturation">
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CarteIndicateur icone="document" etiquette="Émis sur la période (factures)" valeur={f(fa.emis)} ton="info" />
          <CarteIndicateur icone="recu" etiquette="Avoirs sur la période" valeur={f(fa.avoirs)} ton="neutre" />
          <CarteIndicateur icone="portefeuille" etiquette="Encaissé sur la période" valeur={f(fa.encaisse)} ton="succes" />
          <CarteIndicateur icone="horloge" etiquette="Restant dû à ce jour" valeur={f(fa.restantDu)} ton="avertissement" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className={TITRE_SOUS_SECTION}>Impayés par ancienneté (échéances échues)</h3>
            <Tableau
              legende="Impayés par ancienneté"
              lignes={TRANCHES_ANCIENNETE}
              cleLigne={(tr) => tr}
              colonnes={[
                { cle: "tranche", entete: "Ancienneté", rendu: (tr) => LIBELLE_TRANCHE[tr] },
                { cle: "nombre", entete: "Échéances", alignement: "droite", rendu: (tr) => `${fa.impayes[tr].nombre} échéance(s)` },
                { cle: "montant", entete: "Montant", alignement: "droite", rendu: (tr) => f(fa.impayes[tr].montant) },
              ]}
            />
          </div>
          <div>
            <h3 className={TITRE_SOUS_SECTION}>Avis et relances produits sur la période</h3>
            <p className="text-sm">Avis d&apos;échéance : {fa.avis}</p>
            {fa.relancesParNiveau.length === 0 ? (
              <p className="text-sm">Aucune relance.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {fa.relancesParNiveau.map((r) => (
                  <li key={r.niveau}>
                    Niveau {r.niveau} : {r.nombre}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Carte>

      <Carte titre="Production">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className={TITRE_SOUS_SECTION}>Documents émis par type et par mois</h3>
            <Tableau
              legende="Documents émis par type et par mois"
              lignes={p.documents}
              cleLigne={(d) => `${d.mois}-${d.type}`}
              messageVide="Aucun document émis sur la période."
              colonnes={[
                { cle: "mois", entete: "Mois", rendu: (d) => d.mois },
                { cle: "type", entete: "Type", rendu: (d) => (estTypeDocument(d.type) ? DOCUMENTS[d.type].libelle : d.type) },
                { cle: "nombre", entete: "Nombre", alignement: "droite", rendu: (d) => d.nombre },
              ]}
            />
          </div>
          <div>
            <h3 className={TITRE_SOUS_SECTION}>Imports en masse confirmés sur la période</h3>
            <p className="text-sm">
              {p.imports.lots} import(s) : {p.imports.traites} certificat(s) produit(s), {p.imports.enErreur} ligne(s) en erreur, {p.imports.enEchec} en échec.
            </p>
          </div>
        </div>
      </Carte>
    </main>
  );
}
