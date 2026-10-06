import { adresseIpCourante } from "@/serveur/requete";
import { obtenirUtilisateurCourant } from "@/serveur/session";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "@/serveur/types";

/**
 * Téléchargement d'un fichier de la bibliothèque (route GET) : session, droits et erreurs lisibles.
 * Le proxy (src/proxy.ts) a déjà répondu 401 à une requête sans session ; on vérifie de nouveau ici.
 */
export async function telecharger(
  operation: (acteur: UtilisateurCourant, adresseIp: string | null) => Promise<{ nom: string; contenu: Uint8Array }>,
  disposition: "inline" | "attachment",
  typeContenu: string,
): Promise<Response> {
  const acteur = await obtenirUtilisateurCourant();
  if (!acteur || acteur.doitChangerMotDePasse) return new Response("Connexion requise.", { status: 401 });
  try {
    const { nom, contenu } = await operation(acteur, await adresseIpCourante());
    return new Response(Buffer.from(contenu), {
      headers: {
        "Content-Type": typeContenu,
        "Content-Disposition": `${disposition}; filename="${nom.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erreur) {
    const texte = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    if (erreur instanceof ErreurAcces) return texte("Vous n'avez pas le droit de consulter ce fichier.", 403);
    if (erreur instanceof ErreurMetier) return texte([erreur.message, ...erreur.details].join("\n"), 422);
    throw erreur;
  }
}

export const idDeVersion = async (params: Promise<{ id: string }>): Promise<number> => {
  const { id } = await params;
  return Number.isInteger(Number(id)) ? Number(id) : -1;
};
