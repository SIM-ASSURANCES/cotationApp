"use client";

import { useMemo, useState } from "react";

import { Bandeau, Bouton, Champ, ListeDeroulante, Pastille, ZoneTexte } from "@/composants/ui";
import {
  CHAMPS_MONTANT,
  LIBELLE_MONTANT,
  ajouterEssai,
  ajouterLigneAttendue,
  attenduVide,
  changerSaisie,
  descripteurSaisie,
  dupliquerEssai,
  genreAttendu,
  poserMontantAttendu,
  poserRefusAttendu,
  poserTtcAttendu,
  renommerEssai,
  retirerLigneAttendue,
  saisieDepuisFormulaire,
  supprimerEssai,
  viderAttendu,
  type Ecart,
  type GenreAttendu,
  type JeuEssai,
} from "@/domaine/bareme";

import { ChampCode, Depliable, SOUS_TITRE, useOuverts, type ContexteEdition } from "./commun";
import { FormulaireCotation, type ChangementSaisie } from "./FormulaireCotation";

/**
 * Onglet « Jeux d'essai » (B5, D59). Un essai = la SAISIE (le même formulaire généré que le Commercial voit, plus les garanties souscrites) et
 * le résultat ATTENDU, que la Technique TAPE : montants ligne par ligne et TTC, ou message de refus. Aucun bouton ne remplit l'attendu avec
 * le calcul du moteur : l'essai ne prouverait plus rien. « Rejouer » compare, ligne à ligne, ce qui a été tapé à ce que le barème calcule.
 */
export function OngletEssais({
  ctx,
  disabled,
  ecarts,
  peutRejouer,
  enCours,
  onRejouer,
}: {
  ctx: ContexteEdition;
  disabled: boolean;
  /** Écarts du dernier rejeu valable pour le brouillon enregistré tel qu'il est ; `null` : pas de rejeu à jour. */
  ecarts: Ecart[] | null;
  peutRejouer: boolean;
  enCours: boolean;
  onRejouer: () => void;
}) {
  const { doc, appliquer } = ctx;
  const ouverts = useOuverts();
  const [nom, setNom] = useState("");
  const descripteur = useMemo(() => descripteurSaisie(doc), [doc]);

  const ajouter = () => {
    const r = ajouterEssai(doc, nom);
    appliquer(r);
    if (r.ok) {
      ouverts.ouvrir(nom.trim());
      setNom("");
    }
  };

  return (
    <section aria-labelledby="essais" className="space-y-3">
      <h3 id="essais" className={SOUS_TITRE}>
        Jeux d&apos;essai ({doc.jeuxEssai.length})
      </h3>
      <p className="text-sm text-muted-foreground">
        Un jeu d&apos;essai est un cas concret : vous saisissez les champs comme le Commercial, puis vous tapez les montants que vous attendez (ou le message de refus attendu). Le barème ne se publie que si tous les essais retombent sur vos chiffres. L&apos;application ne remplit jamais l&apos;attendu à votre place : il vient de votre simulateur ou de votre calcul.
      </p>
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton variante="secondaire" onClick={onRejouer} disabled={!peutRejouer || doc.jeuxEssai.length === 0} attente={enCours} title={!peutRejouer ? "Enregistrez d'abord : les essais se rejouent sur le brouillon enregistré" : undefined}>
            {enCours ? "Calcul des essais…" : "Rejouer les essais"}
          </Bouton>
          {ecarts !== null ? (
            <Pastille ton={ecarts.length === 0 ? "succes" : "danger"}>{ecarts.length === 0 ? "Tous les essais sont verts" : `${ecarts.length} écart(s)`}</Pastille>
          ) : (
            <span className="text-sm text-muted-foreground">Non rejoués depuis la dernière modification.</span>
          )}
        </div>
      ) : null}
      {!disabled ? (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Champ label="Nouveau jeu d'essai (nom du cas)" value={nom} autoComplete="off" onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ajouter())} />
          <Bouton onClick={ajouter}>Ajouter le jeu d&apos;essai</Bouton>
        </div>
      ) : null}
      {doc.jeuxEssai.length === 0 ? <p className="text-sm text-muted-foreground">Aucun jeu d&apos;essai : la publication sera refusée.</p> : null}
      {doc.jeuxEssai.map((e) => {
        const siens = ecarts === null ? null : ecarts.filter((x) => x.essai === e.nom);
        return (
          <Depliable
            key={e.nom}
            ouvert={ouverts.estOuvert(e.nom)}
            onBascule={(o) => ouverts.bascule(e.nom, o)}
            titre={e.nom}
            sousTitre={e.attendu.refus !== undefined ? "refus attendu" : e.attendu.ttc ? `TTC attendu ${e.attendu.ttc}` : attenduVide(e.attendu) ? "résultat attendu à taper" : "montants attendus"}
            pastilles={siens === null ? undefined : <Pastille ton={siens.length === 0 ? "succes" : "danger"}>{siens.length === 0 ? "Vert" : `${siens.length} écart(s)`}</Pastille>}
          >
            <FicheEssai
              e={e}
              ctx={ctx}
              disabled={disabled}
              descripteur={descripteur}
              ecarts={siens}
              onRenomme={(nouveau) => ouverts.renommer(e.nom, nouveau)}
              onDuplique={() => {
                const r = dupliquerEssai(doc, e.nom);
                appliquer(r);
              }}
            />
          </Depliable>
        );
      })}
    </section>
  );
}

function FicheEssai({
  e,
  ctx,
  disabled,
  descripteur,
  ecarts,
  onRenomme,
  onDuplique,
}: {
  e: JeuEssai;
  ctx: ContexteEdition;
  disabled: boolean;
  descripteur: ReturnType<typeof descripteurSaisie>;
  ecarts: Ecart[] | null;
  onRenomme: (nouveau: string) => void;
  onDuplique: () => void;
}) {
  const { doc, appliquer } = ctx;
  // Forme choisie (montants ou refus) : tant que rien n'est tapé, elle ne se déduit pas du document.
  const [forme, setForme] = useState<GenreAttendu>(genreAttendu(e.attendu));
  const [nouvelleLigne, setNouvelleLigne] = useState("");

  const surChangement = ({ etat, effectif }: ChangementSaisie) => {
    // Comme dans la cotation : un champ masqué par une condition garde sa valeur (elle revient si on change d'avis) et le moteur l'ignore.
    appliquer(changerSaisie(doc, e.nom, saisieDepuisFormulaire(doc, { champs: etat.champs, souscrit: etat.souscrit, effectif })));
  };

  const lignes = e.attendu.lignes ?? [];
  const garantiesLibres = doc.garanties.filter((g) => !lignes.some((l) => l.g === g.code));
  const choisirForme = (nouvelle: GenreAttendu) => {
    if (nouvelle === forme) return;
    if (!attenduVide(e.attendu) && !window.confirm("Changer de forme efface le résultat attendu déjà tapé. Continuer ?")) return;
    const r = viderAttendu(doc, e.nom);
    appliquer(r);
    if (r.ok) setForme(nouvelle);
  };

  return (
    <>
      <ChampCode
        key={e.nom}
        label="Nom du jeu d'essai"
        valeur={e.nom}
        disabled={disabled}
        valider={(nouveau) => {
          const r = renommerEssai(doc, e.nom, nouveau);
          appliquer(r);
          if (r.ok) onRenomme(nouveau.trim());
          return r.ok;
        }}
      />

      <div className="space-y-2">
        <h4 className="text-sm font-bold text-foreground">1. Saisie (comme le Commercial)</h4>
        <fieldset disabled={disabled} className="min-w-0">
          <FormulaireCotation key={e.nom} descripteur={descripteur} initiale={{ champs: e.entrees.champs, souscrit: e.entrees.souscrit, effectif: e.entrees.effectif }} onChangeSaisie={surChangement} />
        </fieldset>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-foreground">2. Résultat attendu (à taper, jamais calculé par l&apos;application)</h4>
        <ListeDeroulante
          label="Le Commercial doit obtenir"
          value={forme}
          disabled={disabled}
          options={[
            { valeur: "MONTANTS", libelle: "Des montants (ligne par ligne et TTC)" },
            { valeur: "REFUS", libelle: "Un refus, avec son message" },
          ]}
          onChange={(ev) => choisirForme(ev.target.value as GenreAttendu)}
        />
        {forme === "REFUS" ? (
          <ZoneTexte label="Le message de refus doit contenir ce texte" rows={2} disabled={disabled} value={e.attendu.refus ?? ""} onChange={(ev) => appliquer(poserRefusAttendu(doc, e.nom, ev.target.value))} aide="Un extrait suffit : l'essai est vert si le message du barème le contient." />
        ) : (
          <>
            <div className="max-w-xs">
              <ChampCode
                key={`ttc-${e.attendu.ttc ?? ""}`}
                label="TTC total attendu"
                montant
                valeur={e.attendu.ttc ?? ""}
                disabled={disabled}
                valider={(texte) => {
                  const r = poserTtcAttendu(doc, e.nom, texte);
                  appliquer(r);
                  return r.ok;
                }}
              />
            </div>
            <div className="space-y-3">
              {lignes.map((l) => {
                const garantie = doc.garanties.find((g) => g.code === l.g);
                return (
                  <fieldset key={l.g} className="rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium text-foreground">Ligne « {garantie?.nom ?? l.g} »</legend>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {CHAMPS_MONTANT.map((m) => (
                        <ChampCode
                          key={`${l.g}-${m}-${l[m] ?? ""}`}
                          label={`${LIBELLE_MONTANT[m]} attendu`}
                          montant
                          valeur={l[m] ?? ""}
                          disabled={disabled}
                          valider={(texte) => {
                            const r = poserMontantAttendu(doc, e.nom, l.g, m, texte);
                            appliquer(r);
                            return r.ok;
                          }}
                        />
                      ))}
                    </div>
                    {!disabled ? (
                      <div className="mt-2">
                        <Bouton variante="secondaire" onClick={() => appliquer(retirerLigneAttendue(doc, e.nom, l.g))} aria-label={`Retirer la ligne ${garantie?.nom ?? l.g}`}>
                          Retirer la ligne
                        </Bouton>
                      </div>
                    ) : null}
                  </fieldset>
                );
              })}
              {!disabled && garantiesLibres.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <ListeDeroulante label="Ajouter une ligne attendue pour la garantie" value={nouvelleLigne} options={[{ valeur: "", libelle: "Choisir…" }, ...garantiesLibres.map((g) => ({ valeur: g.code, libelle: g.nom }))]} onChange={(ev) => setNouvelleLigne(ev.target.value)} />
                  <Bouton
                    variante="secondaire"
                    disabled={nouvelleLigne === ""}
                    onClick={() => {
                      const r = ajouterLigneAttendue(doc, e.nom, nouvelleLigne);
                      appliquer(r);
                      if (r.ok) setNouvelleLigne("");
                    }}
                  >
                    Ajouter la ligne
                  </Bouton>
                </div>
              ) : null}
            </div>
          </>
        )}
        {attenduVide(e.attendu) ? <Bandeau ton="avertissement">Aucun résultat attendu tapé : cet essai ne vérifie rien, la publication est bloquée.</Bandeau> : null}
      </div>

      {ecarts !== null ? (
        ecarts.length === 0 ? (
          <Bandeau ton="succes" role="status">
            Essai rejoué : il retombe sur vos chiffres.
          </Bandeau>
        ) : (
          <Bandeau ton="danger" role="alert" titre={`${ecarts.length} écart(s) entre votre attendu et le calcul du barème`}>
            <ul className="list-disc space-y-1 pl-5">
              {ecarts.map((x, i) => (
                <li key={i}>
                  {x.ligne ? `Ligne « ${x.ligne} », ` : ""}
                  {x.champ} : attendu {x.attendu}, obtenu {x.obtenu}
                </li>
              ))}
            </ul>
          </Bandeau>
        )
      ) : null}

      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Bouton variante="secondaire" onClick={onDuplique}>
            Dupliquer cet essai
          </Bouton>
          <Bouton variante="danger" onClick={() => appliquer(supprimerEssai(doc, e.nom))} aria-label={`Supprimer le jeu d'essai ${e.nom}`}>
            Supprimer l&apos;essai
          </Bouton>
        </div>
      ) : null}
    </>
  );
}
