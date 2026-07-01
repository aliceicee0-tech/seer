#!/bin/sh
# =====================================================================
#  Backup PostgreSQL de Nexus.
#  Dump compressé (gzip) → /backups/nexus-YYYY-MM-DD-HHMM.sql.gz
#  Conservation : 7 jours (les plus anciens sont supprimés).
#
#  Indispensable pour une app qui gère de l'argent réel : en cas de crash
#  ou de corruption, c'est la seule façon de restaurer les soldes.
#  ATTENTION : ces dumps vivent DANS le conteneur (volume `backups`).
#  Pour une sécurité maximale, configurez un transfert vers un stockage
#  externe (ex: rclone vers un bucket Oracle Object Storage gratuit).
# =====================================================================
set -eu

: "${DB_HOST:=db}"
: "${DB_PORT:=5432}"
: "${DB_USER:=nexus}"
: "${DB_NAME:=nexus}"
# PGPASSWORD est lu depuis l'environnement (DB_PASSWORD du .env.prod).
: "${DB_PASSWORD:?DB_PASSWORD requis pour le backup}"

BACKUP_DIR="/backups"
mkdir -p "$BACKUP_DIR"

STAMP=$(date '+%Y-%m-%d-%H%M')
FILE="$BACKUP_DIR/nexus-${STAMP}.sql.gz"

echo "▸ Backup de la base '${DB_NAME}' → ${FILE}"

PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --clean --if-exists \
    | gzip > "$FILE"

echo "✓ Backup terminé : $(ls -lh "$FILE" | awk '{print $5}')"

# Rotation : on ne garde que les 7 dumps les plus récents.
echo "▸ Rotation (conservation des 7 derniers)…"
ls -1t "$BACKUP_DIR"/nexus-*.sql.gz 2>/dev/null | tail -n +8 | while read -r old; do
    rm -f "$old"
    echo "  supprimé : $(basename "$old")"
done

echo "✓ Backups actuels :"
ls -1t "$BACKUP_DIR"/nexus-*.sql.gz 2>/dev/null | head -n 7 || echo "  (aucun)"
