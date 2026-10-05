import NextAuth from "next-auth";

import { authConfig } from "@/serveur/auth.config";

// Premier filtre : sans session, toute page est redirigée vers /connexion et toute route /api
// répond 401, sauf les routes publiques (domaine/acces.ts). Il ne lit que le cookie de session.
export default NextAuth(authConfig).auth;

export const config = {
  // Tout sauf les fichiers statiques de Next.js et les images publiques.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
