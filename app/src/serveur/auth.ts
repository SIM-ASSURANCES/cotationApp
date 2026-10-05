import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "./auth.config";
import { verifierIdentifiants } from "./utilisateurs";

/** Adresse du client, transmise par le proxy HTTPS (à ne croire que derrière lui). */
function adresseIp(requete: Request | undefined): string | null {
  const transmise = requete?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (transmise || requete?.headers.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { identifiant: {}, motDePasse: {} },
      async authorize(identifiants, requete) {
        const utilisateur = await verifierIdentifiants(
          { identifiant: identifiants?.identifiant, motDePasse: identifiants?.motDePasse },
          adresseIp(requete),
        );
        return utilisateur ? { id: String(utilisateur.id), name: utilisateur.nom } : null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Le jeton ne contient que l'identifiant : profil et droits sont relus en base à chaque requête.
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") {
        session.user.id = token.uid;
      }
      return session;
    },
  },
});
