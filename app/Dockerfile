# syntax=docker/dockerfile:1
# Image de l'application (Next.js). Construction en plusieurs étapes : l'image finale ne contient
# que la sortie autonome de `next build` (pas de node_modules complet, pas de code source).
# Contexte de construction : le dossier app/ (voir docker-compose.yml).
# La police Montserrat est hébergée dans le dépôt (src/app/polices, licence OFL) : rien à télécharger pour elle.

# Base commune de TOUTES les images Node (application, outils, travailleur). OpenSSL : l'image « slim » ne l'a pas, et Prisma
# ne peut alors pas détecter la version de libssl (avertissement « failed to detect the libssl/openssl version »).
FROM node:24-bookworm-slim AS base
RUN apt-get update  && apt-get install -y --no-install-recommends openssl  && rm -rf /var/lib/apt/lists/*

FROM base AS dependances
WORKDIR /app
# On copie d'abord ce dont `npm ci` a besoin (dont le schéma Prisma : le script postinstall
# lance « prisma generate ») : tant que ces fichiers ne changent pas, cette couche reste en cache.
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM dependances AS construction
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Image d'outils : migrations (`npm run migrate:deploy`) et scripts d'installation
# (`npm run initialiser`, `npm run creer-admin`). Contient tout node_modules, y compris la CLI Prisma.
FROM construction AS outils
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "migrate:deploy"]

# Image finale de l'application.
FROM base AS execution
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=construction --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
# /connexion répond 200 sans dépendre du générateur : un générateur arrêté ne doit pas
# faire redémarrer l'application en boucle (l'état détaillé est dans /api/sante).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/connexion').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
