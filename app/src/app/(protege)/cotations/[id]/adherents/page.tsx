import Link from "next/link";
import { notFound } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { LignesAssures } from "@/composants/LignesDynamiques";
import { TachesPolice } from "@/composants/TachesPolice";
import { Carte, Champ as ChampSaisie, EnTetePage, ListeDeroulante, PastilleStatut, Tableau } from "@/composants/ui";
import { aujourdhui, formaterDate } from "@/domaine/calcul/dates";
import { LIBELLE_MOTIF_ADHERENTS } from "@/domaine/cotation/adherents";
import { numeroCertificatParDefaut, racineCertificat } from "@/domaine/cotation/police";
import { peutAgir, peutLire } from "@/domaine/droits";
import { lireAdherents, policeDeCotation } from "@/serveur/adherents";
import { listerLots } from "@/serveur/imports";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";
import { tachesDePolice } from "@/serveur/taches-police";

import { LIBELLE_STATUT_LOT } from "../../../imports/libelles";
import { controlerLeFichier, emettreLeCertificat, incorporerLesAdherents, mettreAJourLesCp, retirerLesAdherents } from "./actions";

export default async function PageAdherents(props: PageProps<"/cotations/[id]/adherents">) {
  const { id } = await props.params;
  const utilisateur = await exigerDroit("EMETTRE_CONTRAT", peutLire);
  const cotationId = Number(id);
  const policeId = Number.isInteger(cotationId) ? await policeDeCotation(utilisateur, cotationId) : null;
  const vue = policeId === null ? null : await lireAdherents(utilisateur, policeId);
  if (!vue || policeId === null) notFound();
  const agit = peutAgir(await niveauDuProfil(utilisateur.profil, "EMETTRE_CONTRAT"));
  const derniere = vue.versions[vue.versions.length - 1];
  const cpAJour = vue.cp !== null && vue.cp.versionAdherents === derniere?.numero;
  const [lots, taches] = await Promise.all([listerLots(utilisateur, { policeId }), tachesDePolice(utilisateur, policeId)]);
  const produitCode = vue.police.produitCode;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`Adhérents de la police mère ${vue.police.numero}`}
        sousTitre={`Période de la police : du ${formaterDate(vue.police.dateEffet)} au ${formaterDate(vue.police.dateEcheance)}. La liste évolue par versions : chaque incorporation ou retrait crée une nouvelle version, l'historique reste consultable. Les conditions particulières de la police mère reprennent la liste courante en annexe.`}
        filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Cotation", href: `/cotations/${cotationId}` }, { libelle: "Adhérents" }]}
      />
      <TachesPolice taches={taches} cotationId={cotationId} chemin={`/cotations/${cotationId}/adherents`} />

      <Carte titre={`Liste courante (${vue.courants.length} adhérents, version ${derniere?.numero ?? "—"})`}>
        <FormulaireAction action={retirerLesAdherents} libelleBouton="Retirer les adhérents cochés" discret>
          <input type="hidden" name="cotationId" value={cotationId} />
          <input type="hidden" name="policeId" value={policeId} />
          <div className="mb-4">
            <Tableau
              legende="Liste courante des adhérents"
              lignes={vue.courants}
              cleLigne={(a) => String(a.ordre)}
              messageVide="Aucun adhérent."
              colonnes={[
                ...(agit
                  ? [{ cle: "retrait", entete: "Retrait", rendu: (a: (typeof vue.courants)[number]) => <input type="checkbox" name="retrait" value={a.ordre} aria-label={`Retirer l'adhérent ${a.ordre}`} className="size-5 accent-primary" /> }]
                  : []),
                { cle: "ordre", entete: "N°", rendu: (a) => a.ordre },
                { cle: "nom", entete: "Nom et prénoms", rendu: (a) => a.nom_prenoms },
                { cle: "naissance", entete: "Naissance", rendu: (a) => formaterDate(a.date_naissance) },
                { cle: "sexe", entete: "Sexe", rendu: (a) => a.sexe || "—" },
                { cle: "lien", entete: "Lien", rendu: (a) => a.lien || "—" },
                { cle: "identification", entete: "Pièce d'identité", rendu: (a) => a.num_identification || "—" },
                { cle: "formule", entete: "Formule", rendu: (a) => a.formule || "—" },
                {
                  cle: "certificat",
                  entete: "Certificat",
                  rendu: (a) => {
                    const certificat = vue.certificats[a.ordre];
                    return certificat ? (
                      <a href={`/api/documents/${certificat.id}`} className="text-primary underline">
                        {certificat.numero} (v{certificat.version})
                      </a>
                    ) : (
                      "—"
                    );
                  },
                },
              ]}
            />
          </div>
          {agit ? (
            <div className="max-w-xs">
              <ChampDate nom="dateEffet" libelle="Date d'effet du retrait (JJ/MM/AAAA)" valeur={derniere?.dateEffet} min={vue.police.dateEffet} max={vue.police.dateEcheance} />
            </div>
          ) : null}
        </FormulaireAction>
      </Carte>

      {agit ? (
        <Carte titre="Incorporer des adhérents">
          <FormulaireAction action={incorporerLesAdherents} libelleBouton="Incorporer">
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <div className="mb-4">
              <LignesAssures initiales={[{ nom: "", naissance: "", sexe: "", lien: "", identification: "", formule: "" }]} formules={vue.formules.map((code) => ({ code, libelle: code }))} />
            </div>
            <div className="max-w-xs">
              <ChampDate nom="dateEffet" libelle="Date d'effet de l'incorporation (JJ/MM/AAAA)" valeur={derniere?.dateEffet} min={vue.police.dateEffet} max={vue.police.dateEcheance} />
            </div>
          </FormulaireAction>
        </Carte>
      ) : null}

      {agit ? (
        <Carte
          titre="Import en masse (fichier Excel ou CSV)"
          description={
            <>
              Une ligne par adhérent. La colonne du numéro de certificat peut rester vide : le numéro proposé est alors la racine de la police mère suivie du numéro d'ordre de l'adhérent sur 5 chiffres. Le fichier est d'abord <strong>contrôlé</strong> : rien n'est créé avant votre
              confirmation sur l'écran de contrôle. Les lignes valides deviennent alors <strong>une seule</strong> incorporation, et un certificat
              d'adhésion est produit pour chacune, en tâche de fond.{" "}
              <a href={`/api/imports/modele?produit=${encodeURIComponent(produitCode)}&police=${policeId}`} className="text-primary underline">
                Télécharger le fichier modèle ({produitCode})
              </a>
            </>
          }
        >
          <FormulaireAction action={controlerLeFichier} libelleBouton="Contrôler le fichier">
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <div className="mb-4">
              <ChampSaisie
                label="Fichier des adhérents (.xlsx ou .csv, 10 Mo au plus)"
                name="fichier"
                type="file"
                required
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-semibold file:text-secondary-foreground"
              />
            </div>
            <div className="max-w-xs">
              <ChampDate nom="dateEffet" libelle="Date d'effet de l'incorporation (JJ/MM/AAAA)" valeur={derniere?.dateEffet} min={vue.police.dateEffet} max={aujourdhui()} />
            </div>
          </FormulaireAction>
          {lots.length > 0 ? (
            <div className="mt-4">
              <Tableau
                legende="Imports de la police"
                lignes={lots}
                cleLigne={(l) => String(l.id)}
                colonnes={[
                  {
                    cle: "import",
                    entete: "Import",
                    rendu: (l) => (
                      <Link href={`/imports/${l.id}`} className="text-primary underline">
                        n° {l.id}
                      </Link>
                    ),
                  },
                  { cle: "fichier", entete: "Fichier", rendu: (l) => l.fichierNom },
                  { cle: "lignes", entete: "Lignes", alignement: "droite", rendu: (l) => l.total },
                  { cle: "erreurs", entete: "En erreur", alignement: "droite", rendu: (l) => l.erreurs },
                  { cle: "etat", entete: "État", rendu: (l) => <PastilleStatut libelle={LIBELLE_STATUT_LOT[l.statut]} /> },
                ]}
              />
            </div>
          ) : null}
        </Carte>
      ) : null}

      <Carte titre="Conditions particulières de la police mère">
        {vue.cp === null ? (
          <p className="text-sm text-neutral">Pas encore émises : depuis la fiche de la cotation, émettez-les ; la liste courante sera en annexe.</p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              Dernière édition : version {vue.cp.version}, avec la version {vue.cp.versionAdherents ?? "?"} de la liste. {cpAJour ? "Elle est à jour." : "La liste a changé depuis : une nouvelle version est nécessaire."}
            </p>
            {!cpAJour && agit ? (
              <FormulaireAction action={mettreAJourLesCp} libelleBouton="Émettre une nouvelle version des CP (annexe à jour)">
                <input type="hidden" name="cotationId" value={cotationId} />
                <input type="hidden" name="policeId" value={policeId} />
              </FormulaireAction>
            ) : null}
          </>
        )}
      </Carte>

      {agit ? (
        <Carte
          titre="Certificat d'adhésion (unitaire)"
          description={`Un certificat par adhérent, avec son propre numéro et son propre QR code. Le numéro reprend la racine de la police mère (${racineCertificat(vue.police.numero) ?? "aucune : le numéro de la police ne se termine pas par G ou I et 5 chiffres"}) suivie du numéro personnel de l'adhérent sur 5 chiffres. Laissé vide, c'est son numéro d'ordre (proposé dans la liste) ; vous pouvez en saisir un autre. Pour de nombreux adhérents : l'import en masse ci-dessus.`}
        >
          <FormulaireAction action={emettreLeCertificat} libelleBouton="Émettre le certificat" discret>
            <input type="hidden" name="cotationId" value={cotationId} />
            <input type="hidden" name="policeId" value={policeId} />
            <div className="mb-3 max-w-xl">
              <ListeDeroulante
                label="Adhérent"
                name="ordre"
                required
                defaultValue=""
                invite="— Choisir —"
                options={vue.courants
                  .filter((a) => !vue.certificats[a.ordre])
                  .map((a) => ({ valeur: String(a.ordre), libelle: `${a.ordre} — ${a.nom_prenoms} (proposé : ${numeroCertificatParDefaut(vue.police.numero, a.ordre) ?? "à saisir"})` }))}
              />
            </div>
            <Champ nom="numero" libelle="Numéro du certificat (vide : numéro proposé)" autoComplete="off" requis={false} />
          </FormulaireAction>
        </Carte>
      ) : null}

      <Carte titre="Historique des versions">
        <Tableau
          legende="Historique des versions de la liste"
          lignes={[...vue.versions].reverse()}
          cleLigne={(v) => String(v.numero)}
          colonnes={[
            { cle: "version", entete: "Version", rendu: (v) => v.numero },
            { cle: "changement", entete: "Changement", rendu: (v) => LIBELLE_MOTIF_ADHERENTS[v.motif] },
            { cle: "effet", entete: "Prend effet le", rendu: (v) => formaterDate(v.dateEffet) },
            { cle: "concernes", entete: "Adhérents concernés", rendu: (v) => (v.concernes.length > 0 ? v.concernes.join(", ") : "—") },
            { cle: "total", entete: "Total", alignement: "droite", rendu: (v) => v.adherents.length },
            { cle: "par", entete: "Par", rendu: (v) => v.creePar },
          ]}
        />
      </Carte>
    </main>
  );
}
