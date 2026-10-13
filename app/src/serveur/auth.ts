import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { adresseDuClient, proxiesDeConfiance } from "@/domaine/adresse-client";

import { authConfig } from "./auth.config";
import { verifierIdentifiants } from "./utilisateurs";

/** Adresse du client, ajoutée par notre proxy HTTPS (audit M1 : voir domaine/adresse-client.ts). */
function adresseIp(requete: Request | undefined): string | null {
  return adresseDuClient(requete?.headers.get("x-forwarded-for"), proxiesDeConfiance(process.env.PROXIES_DE_CONFIANCE));
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
