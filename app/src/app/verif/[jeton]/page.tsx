import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { CoquilleConnexion } from "@/composants/coquille/CoquilleConnexion";
import { Icone, Pastille, type TonPastille } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { verifierJeton } from "@/serveur/documents";

export const metadata: Metadata = { title: "Vérification d'un document – SIM Assurances", robots: { index: false, follow: false } };

// Codes de `vue.statut.code` (domaine/documents/emission.ts, statutPublic). Expiré est neutre (consigne de la refonte ; avant, tout ce
// qui n'était pas « valide » était rouge, le libellé reste écrit). Un code inconnu est présenté en danger, comme avant : la page ne
// présente jamais comme anodin un statut qu'elle ne connaît pas.
const TON_STATUT: Record<string, TonPastille> = { VALIDE: "succes", ANNULE: "danger", EXPIRE: "neutre" };

/** Une ligne de la liste de définition : libellé au-dessus de la valeur sur mobile, côte à côte dès `sm`. */
function Ligne({ terme, classeValeur, children }: { terme: string; classeValeur?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-x-4">
      <dt className="text-neutral">{terme}</dt>
      <dd className={`min-w-0 text-foreground ${classeValeur ?? ""}`}>{children}</dd>
    </div>
  );
}

/**
 * Page PUBLIQUE de vérification d'un QR code (CDC §14.1) : type, numéro, date, statut en temps réel,
 * produit, souscripteur masqué et empreinte. Aucune autre donnée personnelle. Un jeton inconnu donne
 * une page neutre, qui ne dit pas si le jeton a existé.
 */
export default async function PageVerification(props: PageProps<"/verif/[jeton]">) {
  await connection();
  const { jeton } = await props.params;
  const vue = await verifierJeton(jeton);
  return (
    <main className="flex flex-1 flex-col">
      {/* Largeur « lg » : l'empreinte SHA-256 (64 caractères) serait trop à l'étroit dans la carte « md ». */}
      <CoquilleConnexion largeur="lg">
        <h1 className="text-xl font-bold text-foreground">Vérification d'un document</h1>
        {vue ? (
          <>
            {/* Le statut est la première information lue : pastille agrandie (le « ! » l'emporte sur la taille par défaut). */}
            <Pastille ton={TON_STATUT[vue.statut.code] ?? "danger"} className="self-start px-4! py-1.5! text-base! font-semibold!">
              {vue.statut.libelle}
            </Pastille>
            <dl className="divide-y divide-border text-sm">
              <Ligne terme="Document">{vue.type}</Ligne>
              <Ligne terme="Numéro">
                {vue.numero} (version {vue.version})
              </Ligne>
              <Ligne terme="Émis le">{formaterDate(vue.dateEmission)}</Ligne>
              <Ligne terme="Produit">{vue.produit}</Ligne>
              <Ligne terme="Souscripteur">{vue.souscripteur}</Ligne>
              <Ligne terme="Empreinte SHA-256" classeValeur="break-all font-mono text-xs">
                {vue.empreinte}
              </Ligne>
            </dl>
            <p className="text-xs text-muted-foreground">
              L'empreinte permet de vérifier qu'un fichier PDF n'a pas été modifié : elle doit être identique à celle du fichier reçu.
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info">
            <Icone nom="information" className="mt-0.5 size-4 shrink-0" />
            Ce lien de vérification ne correspond à aucun document. Vérifiez qu'il a été recopié en entier, ou contactez SIM Assurances.
          </p>
        )}
      </CoquilleConnexion>
    </main>
  );
}
