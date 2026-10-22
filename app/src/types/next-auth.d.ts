import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** `motDePasseModifieLe` : date (ms) du mot de passe avec lequel la session a été ouverte ; absente d'un jeton ancien. */
    user: { id: string; motDePasseModifieLe?: number } & DefaultSession["user"];
  }
  interface User {
    /** Renseignée à la connexion (jeton de session, audit m1). */
    motDePasseModifieLe?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    /** Identifiant de l'utilisateur en base : la seule donnée que le jeton porte. */
    uid?: string;
    /** Date (ms) de la dernière modification du mot de passe au moment de la connexion (audit m1). */
    mdp?: number;
  }
}
