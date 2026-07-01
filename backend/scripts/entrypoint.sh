#!/usr/bin/env bash
# Entrypoint du backend Nexus.
# 1. attend que PostgreSQL soit prêt ;
# 2. applique les migrations (crée aussi les tables token_blacklist) ;
# 3. collecte les statiques (idempotent) ;
# 4. exec la commande passée (gunicorn par défaut).
set -euo pipefail

: "${DB_HOST:=db}"
: "${DB_PORT:=5432}"
: "${DJANGO_SETTINGS_MODULE:=config.settings}"

echo "▸ Attente de PostgreSQL sur ${DB_HOST}:${DB_PORT} ..."
# python: pas de dépendance externe, juste la stdlib (socket).
python - <<'PY'
import os, socket, sys, time
host = os.environ.get("DB_HOST", "db")
port = int(os.environ.get("DB_PORT", "5432"))
deadline = time.time() + 60
while time.time() < deadline:
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"✓ PostgreSQL répond sur {host}:{port}")
            sys.exit(0)
    except OSError:
        time.sleep(1)
print("✗ PostgreSQL indisponible après 60s, abandon.", file=sys.stderr)
sys.exit(1)
PY

echo "▸ Application des migrations ..."
python manage.py migrate --noinput

echo "▸ Collecte des fichiers statiques ..."
python manage.py collectstatic --noinput || true

echo "▸ Démarrage : $*"
exec "$@"
