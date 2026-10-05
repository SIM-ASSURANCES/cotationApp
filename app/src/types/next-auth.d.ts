import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    /** Identifiant de l'utilisateur en base : la seule donnée que le jeton porte. */
    uid?: string;
  }
}
