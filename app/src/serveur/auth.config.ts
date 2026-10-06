import type { NextAuthConfig } from "next-auth";

import { estRoutePublique } from "@/domaine/acces";
import { LimiteRequetes } from "@/domaine/limite";
import { SESSION_DUREE_MAX_HEURES } from "@/domaine/securite";

/**
 * Partie de la configuration d'Auth.js sans accès à la base : utilisée par le proxy
 * (src/proxy.ts), qui ne lit que le cookie de session. Pas de « server-only » ici :
 * le proxy a son propre environnement d'exécution.
 *
 * Le proxy n'est qu'un premier filtre. La vraie vérification (compte actif, droits)
 * se fait au plus près des données, dans src/serveur/session.ts.
 */
/** Page publique de vérification (CDC §14.1) : 30 consultations par minute et par adresse IP. */
const limiteVerification = new LimiteRequetes(30, 60_000);

export const authConfig = {
  pages: { signIn: "/connexion" },
  session: { strategy: "jwt", maxAge: SESSION_DUREE_MAX_HEURES * 60 * 60 },
  providers: [], // le fournisseur « identifiant + mot de passe » est ajouté dans auth.ts
  callbacks: {
    authorized({ auth, request }) {
      if (request.nextUrl.pathname.startsWith("/verif/")) {
        // Derrière le proxy HTTPS, l'adresse du client est la première de x-forwarded-for.
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "inconnue";
        if (!limiteVerification.accepter(ip, Date.now())) {
          return new Response("Trop de vérifications depuis cette adresse : réessayez dans une minute.", {
            status: 429,
            headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return true;
      }
      if (estRoutePublique(request.nextUrl.pathname) || auth?.user) {
        return true;
      }
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return Response.json({ erreur: "Non authentifié" }, { status: 401 });
      }
      return false; // Auth.js redirige vers /connexion en gardant la page demandée
    },
  },
} satisfies NextAuthConfig;
