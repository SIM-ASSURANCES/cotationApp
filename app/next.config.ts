import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Déploiement sans Docker : `next build` produit .next/standalone/server.js, qui se
  // lance avec un simple `node server.js` (service Windows ou systemd).
  // Voir docs/deploiement.md.
  output: "standalone",
};

export default nextConfig;
