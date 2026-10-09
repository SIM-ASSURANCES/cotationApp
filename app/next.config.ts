import type { NextConfig } from "next";

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

  // En-têtes de sécurité (application exposée sur Internet). Pas de Content-Security-Policy
  // pour l'instant : elle demande un jeton (nonce) par requête, à ajouter avant la mise en production.
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
        ],
      },
    ];
  },
};

export default nextConfig;
