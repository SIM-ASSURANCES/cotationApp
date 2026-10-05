import type { NextAuthConfig } from "next-auth";

import { estRoutePublique } from "@/domaine/acces";
import { SESSION_DUREE_MAX_HEURES } from "@/domaine/securite";

/**
 * Partie de la configuration d'Auth.js sans accès à la base : utilisée par le proxy
 * (src/proxy.ts), qui ne lit que le cookie de session. Pas de « server-only » ici :
 * le proxy a son propre environnement d'exécution.
 *
 * Le proxy n'est qu'un premier filtre. La vraie vérification (compte actif, droits)
 * se fait au plus près des données, dans src/serveur/session.ts.
 */
export const authConfig = {
  pages: { signIn: "/connexion" },
  session: { strategy: "jwt", maxAge: SESSION_DUREE_MAX_HEURES * 60 * 60 },
  providers: [], // le fournisseur « identifiant + mot de passe » est ajouté dans auth.ts
  callbacks: {
    authorized({ auth, request }) {
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
