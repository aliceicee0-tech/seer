# syntax=docker/dockerfile:1
# Image Caddy : build le frontend React puis sert la SPA + proxifie /api.
# Caddy gère le TLS Let's Encrypt automatiquement (auto-HTTPS via le domaine).

# --- Étape 1 : build du frontend (Vite) ---
FROM node:20-alpine AS frontend-build
WORKDIR /build
# Copie d'abord les manifests pour exploiter le cache Docker.
COPY frontend/package.json frontend/package-lock.json* ./
# package.json attend npm install à la racine (le front vit dans /frontend).
RUN npm install --no-audit --no-fund
# Copie le reste des sources du frontend (relatif au contexte = racine du repo).
COPY frontend/ .
RUN npm run build   # produit ./dist

# --- Étape 2 : image finale Caddy ---
FROM caddy:2-alpine
# Récupère le build du frontend.
COPY --from=frontend-build /build/dist /srv
# La config Caddy (Caddyfile) lit DOMAIN et ACME_EMAIL depuis l'environnement.
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
