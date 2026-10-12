import NextAuth from "next-auth";

import { authConfig } from "@/serveur/auth.config";

// Premier filtre : sans session, toute page est redirigée vers /connexion et toute route /api
// répond 401, sauf les routes publiques (domaine/acces.ts). Il ne lit que le cookie de session.
export default NextAuth(authConfig).auth;

export const config = {
  // Tout sauf les fichiers statiques de Next.js, les images publiques et les icônes générées par app/icon.tsx et
  // app/apple-icon.tsx : Next les sert à /icon?<empreinte> et /apple-icon?<empreinte>, sans extension, donc hors de la
  // règle des images. « $ » limite l'exclusion à ces deux chemins exacts (ni /icons, ni /icon/x). Le matcher doit rester
  // une constante littérale ici : Next l'analyse à la construction et ignore une valeur importée.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
