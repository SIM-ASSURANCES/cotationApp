import type { NextConfig } from "next";

/**
 * Content-Security-Policy de l'application. `'unsafe-inline'` pour les scripts et les styles : Next.js insère des scripts en ligne
 * (données d'hydratation) et la CSP à jeton n'est pas encore en place. `'unsafe-eval'` seulement en développement (React).
 * Exportée pour le test `src/securite-en-tetes.test.ts`.
 */
export function politiqueDeSecurite(developpement: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${developpement ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Déploiement : `next build` produit .next/standalone/server.js, qui se lance avec un
  // simple `node server.js` (image Docker, service Windows ou systemd). Voir docs/deploiement.md.
  output: "standalone",
  poweredByHeader: false, // ne pas annoncer « Next.js » à chaque réponse
  // File de tâches et classeurs Excel (phase 5) : chargés tels quels par Node.js, jamais regroupés par Next.js
  // (BullMQ lit ses scripts Lua dans son propre dossier).
  serverExternalPackages: ["bullmq", "ioredis", "exceljs"],

  experimental: {
    // Dépôt d'un modèle Word (15 Mo au plus, voir domaine/documents/modeles.ts) par une Server
    // Action : 1 Mo par défaut. Le proxy (src/proxy.ts) met lui aussi le corps en mémoire (10 Mo
    // par défaut) : même limite, avec la marge de l'encodage multipart.
    serverActions: { bodySizeLimit: "16mb" },
    proxyClientMaxBodySize: "16mb",
  },

  // En-têtes de sécurité (application exposée sur Internet). Content-Security-Policy SANS jeton (audit M3) : elle interdit
  // l'encadrement, les formulaires et les connexions vers un autre site, les objets et les changements de base d'URL, mais
  // autorise les scripts et styles en ligne que Next.js génère. La version stricte (jeton par requête dans proxy.ts) viendra après.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS obligatoire pendant 1 an (ignoré par les navigateurs sur une adresse http://).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: politiqueDeSecurite(process.env.NODE_ENV !== "production") },
        ],
      },
    ];
  },
};

export default nextConfig;
