import type { ReactNode } from "react";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, EnTetePage, EtatVide, ListeDeroulante, Tableau, type ColonneTableau } from "@/composants/ui";
import { ASSIETTES_TAXE } from "@/domaine/calcul/calcul";
import { montant } from "@/domaine/calcul/montant";
import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT, REGIMES_TAXE, enVigueurLe, estRegimeTaxe, type TypeContrat } from "@/domaine/calcul/taxes";
import { peutAgir, peutLire } from "@/domaine/droits";
import { aujourdhui, listerBranches, listerTaxes, type LigneTaxe } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUneTaxe } from "./actions";

const LIBELLE_ASSIETTE = { NETTE_ACCESSOIRES: "Nette + accessoires", NETTE: "Nette seule" } as const;
/** Régime de la ligne ; une ligne FAMILLE ou GROUPE_OUVERT d'avant la session 6.0 n'est plus retenue par le calcul. */
const libelleType = (t: TypeContrat | null) => (t === null ? "Tous régimes" : estRegimeTaxe(t) ? `Régime ${LIBELLE_REGIME_TAXE[t].toLowerCase()}` : `${LIBELLE_TYPE_CONTRAT[t]} (ancienne clé, non utilisée)`);
const taux = (t: LigneTaxe) => (t.tauxMixte || t.tauxPourcent === null ? "Taux mixte" : `${montant(t.tauxPourcent).toString().replace(".", ",")} %`);

export default async function PageTaxes() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [taxes, branches, niveau] = await Promise.all([listerTaxes(utilisateur), listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const jour = aujourdhui();

  // Historique par clé (branche, type de contrat) : toutes les versions, la plus récente en premier.
  const groupes = new Map<string, LigneTaxe[]>();
  for (const t of taxes) {
    const cle = `${t.branche}|${t.typeContrat ?? ""}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), t]);
  }

  // La version en vigueur est en gras (période, taux, assiette) ; les mentions de saisie restent en texte normal.
  const gras = (t: LigneTaxe, contenu: ReactNode) => <span className={enVigueurLe(t, jour) ? "font-semibold" : undefined}>{contenu}</span>;
  const colonnes: ColonneTableau<LigneTaxe>[] = [
    {
      cle: "periode",
      entete: "Période",
      rendu: (t) => gras(t, `du ${t.dateEffet} ${t.dateFin ? `au ${t.dateFin}` : "(sans date de fin)"}${enVigueurLe(t, jour) ? " · en vigueur" : ""}`),
    },
    { cle: "taux", entete: "Taux", rendu: (t) => gras(t, taux(t)) },
    { cle: "assiette", entete: "Assiette", rendu: (t) => gras(t, LIBELLE_ASSIETTE[t.assiette]) },
    { cle: "commentaire", entete: "Commentaire", rendu: (t) => t.commentaire ?? "—" },
    { cle: "creePar", entete: "Saisi par", rendu: (t) => t.creePar },
    { cle: "creeLe", entete: "Saisi le", rendu: (t) => t.creeLe.toISOString().slice(0, 16).replace("T", " ") },
  ];

  return (
    <main className="space-y-6">
      <EnTetePage titre="Table des taxes" />
      <div className="max-w-3xl space-y-2 text-sm text-muted-foreground">
        <p>
          Taux de taxe par <strong>branche et régime de taxe</strong> (CDC §8.3, réponses de la Technique des 08 et 09/10/2026), historisés : on ajoute une
          version avec une date d'effet, on ne modifie jamais une version en vigueur. Pour un même taux, deux périodes ne peuvent pas se chevaucher ;
          la version précédente sans date de fin est clôturée la veille de la nouvelle.
        </p>
        <p>
          Le taux appliqué est celui en vigueur à la <strong>date d'effet</strong> de la police, pour le <strong>régime de taxe</strong> choisi sur la
          cotation (Individuel ou Groupe, H29 fermée le 09/10/2026), puis celui de « tous régimes ». Le type de contrat ne choisit plus le taux.
          Une branche à taux mixte refuse le calcul tant que la ventilation n'est pas paramétrée.
        </p>
      </div>

      {peutAgir(niveau) ? (
        <Carte titre="Ajouter une version de taux" className="max-w-md">
          <FormulaireAction action={creerUneTaxe} libelleBouton="Ajouter">
            <div className="mb-4">
              <ListeDeroulante
                label="Branche"
                name="branche"
                required
                invite="Choisir une branche"
                options={branches.filter((b) => b.actif).map((b) => ({ valeur: b.code, libelle: `${b.code} · ${b.libelle}` }))}
              />
            </div>
            <div className="mb-4">
              <ListeDeroulante
                label="Régime de taxe"
                name="typeContrat"
                defaultValue=""
                options={[{ valeur: "", libelle: "Tous régimes" }, ...REGIMES_TAXE.map((t) => ({ valeur: t, libelle: LIBELLE_REGIME_TAXE[t] }))]}
              />
            </div>
            <Champ nom="tauxPourcent" libelle="Taux en % (ex. 1,5) ; vide pour un taux mixte" requis={false} autoComplete="off" />
            <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
              <input type="checkbox" name="tauxMixte" className="size-4 accent-primary" /> Taux mixte (plusieurs taux dans un même contrat : calcul refusé)
            </label>
            <Champ nom="commentaire" libelle="Commentaire (facultatif)" requis={false} autoComplete="off" />
            <div className="mb-4">
              <ListeDeroulante
                label="Assiette"
                name="assiette"
                defaultValue="NETTE_ACCESSOIRES"
                options={ASSIETTES_TAXE.map((a) => ({ valeur: a, libelle: LIBELLE_ASSIETTE[a] }))}
              />
            </div>
            <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" autoComplete="off" />
            <Champ nom="dateFin" libelle="Date de fin (facultative)" requis={false} autoComplete="off" />
          </FormulaireAction>
        </Carte>
      ) : (
        <Bandeau ton="neutre">Consultation seule : votre profil peut proposer mais pas enregistrer de taux.</Bandeau>
      )}

      {[...groupes.values()].map((versions) => (
        <section key={`${versions[0].branche}|${versions[0].typeContrat ?? ""}`} className="space-y-2">
          <h2 className="text-lg font-bold text-foreground">
            {versions[0].branche} · {libelleType(versions[0].typeContrat)}
          </h2>
          <Tableau colonnes={colonnes} lignes={versions} cleLigne={(t) => String(t.id)} legende={`Taux ${versions[0].branche}, ${libelleType(versions[0].typeContrat)}`} />
        </section>
      ))}
      {taxes.length === 0 ? <EtatVide message="Aucune taxe enregistrée." /> : null}
    </main>
  );
}
