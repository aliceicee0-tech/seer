#!/usr/bin/env bash
# =====================================================================
#  Nexus — installation en UNE commande sur la VM Oracle Cloud.
#
#  À lancer sur la VM Oracle (une fois connecté en SSH) :
#
#      bash install.sh
#
#  Ce script :
#    1. installe Docker + Docker Compose ;
#    2. clone votre dépôt (ou réutilise un clone existant) ;
#    3. génère une SECRET_KEY aléatoire forte ;
#    4. crée .env.prod en vous demandant domaine / numéros Mobile Money ;
#    5. lance la stack complète (db + web + caddy + scheduler).
#
#  Idempotent : peut être relancé sans risque.
# =====================================================================
set -euo pipefail

# Couleurs pour la lisibilité.
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $1${NC}"; }
fatal() { echo -e "${RED}✗ $1${NC}" >&2; exit 1; }

# Doit tourner sur Linux (VM Oracle). Pas sur Windows/Mac.
[[ "$(uname -s)" == "Linux" ]] || fatal "Ce script est conçu pour la VM Linux Oracle."

PROJECT_DIR="$HOME/nexus"
cd "$HOME"

# =====================================================================
# 1. Docker + Docker Compose
# =====================================================================
info "Vérification de Docker..."
if ! command -v docker >/dev/null 2>&1; then
    info "Installation de Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    sudo systemctl enable --now docker
    ok "Docker installé."
    warn "Le groupe docker vient d'être ajouté. Reconnectez-vous (exit + SSH) puis RELANCEZ ce script."
    exit 0
fi
ok "Docker présent ($(docker --version))."

if ! docker compose version >/dev/null 2>&1; then
    fatal "Docker Compose v2 absent. Installez-le : sudo apt-get install docker-compose-plugin"
fi
ok "Docker Compose v2 présent."

# =====================================================================
# 2. Code source
# =====================================================================
info "Code source de Nexus..."
if [[ -d "$PROJECT_DIR/.git" ]]; then
    ok "Dépôt déjà présent à $PROJECT_DIR."
    cd "$PROJECT_DIR"
    info "Mise à jour (git pull)..."
    git pull --ff-only || warn "git pull a échoué (modifications locales ?). Continue avec l'état actuel."
else
    read -rp "$(echo -e ${CYAN}URL Git de votre dépôt Nexus (https://github.com/...git) :${NC} ")" REPO_URL
    [[ -n "$REPO_URL" ]] || fatal "URL du dépôt requise."
    read -rp "$(echo -e ${CYAN}Branche [feat/polymarket-engine] :${NC} ")" REPO_BRANCH
    REPO_BRANCH="${REPO_BRANCH:-feat/polymarket-engine}"
    info "Clonage de $REPO_URL (branche $REPO_BRANCH)..."
    git clone -b "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR" || fatal "Échec du clone. Vérifiez l'URL/branche."
    cd "$PROJECT_DIR"
    ok "Dépôt cloné."
fi

# =====================================================================
# 3. Fichier .env.prod
# =====================================================================
info "Configuration de .env.prod..."
ENV_FILE="$PROJECT_DIR/.env.prod"

if [[ -f "$ENV_FILE" ]]; then
    ok ".env.prod existe déjà — on le conserve."
    warn "Pour le régénérer : supprimez-le puis relancez ce script."
else
    info "Génération d'une SECRET_KEY aléatoire (50 caractères)..."
    SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))' 2>/dev/null \
                  || openssl rand -base64 50 | tr -d '\n=+/')"
    [[ -n "$SECRET_KEY" ]] || fatal "Impossible de générer la SECRET_KEY."

    info "Génération d'un mot de passe PostgreSQL aléatoire..."
    DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n=+/' || echo "change-me-${RANDOM}")"

    echo ""
    echo -e "${CYAN}── Réglages de production ──${NC}"
    read -rp "$(echo -e ${CYAN}Nom de domaine (ex: nexus.mg) :${NC} ")" DOMAIN
    [[ -n "$DOMAIN" ]] || fatal "Le domaine est requis (sans https://)."
    read -rp "$(echo -e ${CYAN}Email pour Let's Encrypt :${NC} ")" ACME_EMAIL
    [[ -n "$ACME_EMAIL" ]] || fatal "L'email Let's Encrypt est requis."
    read -rp "$(echo -e ${CYAN}N° MVola (dépôts) [0384362216] :${NC} ")" MVOLA
    MVOLA="${MVOLA:-0384362216}"
    read -rp "$(echo -e ${CYAN}N° Orange Money [0320000000] :${NC} ")" ORANGE
    ORANGE="${ORANGE:-0320000000}"
    read -rp "$(echo -e ${CYAN}N° Airtel Money [0330000000] :${NC} ")" AIRTEL
    AIRTEL="${AIRTEL:-0330000000}"
    echo ""

    # Écriture du .env.prod (valeurs sensibles générées, métier saisies).
    cat > "$ENV_FILE" <<EOF
# Généré par install.sh le $(date -u '+%Y-%m-%dT%H:%M:%SZ') — NE PAS COMMITTER.

DJANGO_SECRET_KEY=${SECRET_KEY}
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN}
DJANGO_CORS_ALLOWED_ORIGINS=https://${DOMAIN}

DATABASE_URL=postgres://nexus:${DB_PASSWORD}@db:5432/nexus
DB_NAME=nexus
DB_USER=nexus
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=db
DB_PORT=5432

REDIS_URL=
THROTTLE_ANON=120/min
THROTTLE_USER=300/min
THROTTLE_LOGIN=5/min

SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=2592000

SHARE_VALUE=5000
MIN_ORDER_PRICE=1
MAX_ORDER_PRICE=4999
PLATFORM_COMMISSION_RATE=10.0
MIN_BET_AMOUNT=500

MVOLA_NUMBER=${MVOLA}
ORANGE_MONEY_NUMBER=${ORANGE}
AIRTEL_MONEY_NUMBER=${AIRTEL}
MOBILE_MONEY_HOLDER=Nexus Madagascar

DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
EOF
    chmod 600 "$ENV_FILE"
    ok ".env.prod créé (droits 600)."
    warn "Mot de passe DB généré automatiquement — conservé dans .env.prod."
fi

# =====================================================================
# 4. Pare-feu de la VM (ufw)
# =====================================================================
info "Pare-feu de la VM..."
if command -v ufw >/dev/null 2>&1; then
    sudo ufw --force reset >/dev/null 2>&1 || true
    sudo ufw default deny incoming >/dev/null 2>&1 || true
    sudo ufw default allow outgoing >/dev/null 2>&1 || true
    sudo ufw allow 22/tcp  >/dev/null 2>&1 || true   # SSH
    sudo ufw allow 80/tcp  >/dev/null 2>&1 || true   # HTTP (redirect Caddy)
    sudo ufw allow 443/tcp >/dev/null 2>&1 || true   # HTTPS
    sudo ufw --force enable >/dev/null 2>&1 || true
    ok "Pare-feu actif (ports 22/80/443 ouverts)."
else
    info "Installation d'ufw..."
    sudo apt-get update -qq && sudo apt-get install -y -qq ufw >/dev/null 2>&1 || true
    warn "ufw installé — relancez ce script pour activer le pare-feu."
fi

# =====================================================================
# 5. Lancement de la stack
# =====================================================================
info "Construction + démarrage de la stack (5-10 min au 1er build)..."
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build

ok "Stack démarrée."
echo ""
info "Suivi des logs (Ctrl+C pour quitter sans arrêter) :"
echo "    docker compose -f deploy/docker-compose.prod.yml logs -f"
echo ""
info "Vérifiez que Caddy obtient son certificat (cherchez 'certificate obtained')."
info "Puis testez :"
echo "    curl -I https://${DOMAIN:-VOTRE-DOMAINE}/healthz"
echo ""
ok "Installation terminée. 🎉"
