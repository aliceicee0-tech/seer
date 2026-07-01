#!/bin/sh
# =====================================================================
#  Boucle cron du scheduler Nexus (tourne dans son propre conteneur).
#
#  - Toutes les 60 s :
#        verify_invariants   (détecteur de fraude — gèle un marché bancal)
#        expire_orders       (rembourse les ordres périmés)
#        lock_expired_markets (clôture les marchés dont bet_close_at est passé)
#  - 1x par jour (à 03:00 heure locale du conteneur) :
#        flushexpiredtokens  (purge des refresh tokens JWT révoqués expirés)
#        backup_db.sh        (pg_dump → /backups, 7 jours conservés)
#
#  Robuste : chaque commande est isolée (set +e autour), une erreur sur l'une
#  n'arrête pas la boucle. Le conteneur restart automatiquement (compose).
# =====================================================================
set -u

cd /app

# Heure de la dernière sauvegarde quotidienne (HH:MM), init à vide.
LAST_DAILY=""

echo "▸ Scheduler Nexus démarré ($(date -u '+%Y-%m-%dT%H:%M:%SZ'))"

while true; do
    NOW=$(date '+%H:%M')

    # --- Tâches chaque minute (sécurité financière) ---------------------
    python manage.py verify_invariants    --verbosity=0 2>&1 && \
        echo "✓ verify_invariants OK" || echo "⚠ verify_invariants a signalé une anomalie (voir logs)"
    python manage.py expire_orders        --verbosity=0 2>&1 || true
    python manage.py lock_expired_markets --verbosity=0 2>&1 || true

    # --- Tâche quotidienne vers 03:00 (maintenance) ---------------------
    if [ "$NOW" = "03:00" ] && [ "$LAST_DAILY" != "$(date '+%Y-%m-%d')" ]; then
        LAST_DAILY=$(date '+%Y-%m-%d')
        echo "▸ Maintenance quotidienne ($(date '+%Y-%m-%d %H:%M'))"
        python manage.py flushexpiredtokens --verbosity=0 2>&1 || true
        /bin/sh /scheduler-scripts/backup_db.sh 2>&1 || \
            echo "⚠ Échec du backup DB (voir logs)"
    fi

    # Attend 60 s avant le prochain cycle.
    sleep 60
done
