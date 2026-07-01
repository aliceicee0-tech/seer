"""Configuration gunicorn pour Nexus en production.

1 worker + 4 threads : choix délibéré pour le lancement gratuit sur Oracle :
- 1 worker suffit au trafic initial et garde le cache LocMem du throttling
  partagé (pas besoin de Redis). Passe en 2-4 workers + Redis quand le trafic
  grimpe.
- 4 threads pour servir plusieurs requêtes concurrentes (I/O DB).
"""
import multiprocessing

bind = "0.0.0.0:8000"
workers = 1
threads = 4
timeout = 30        # un trade/résolution peut prendre quelques secondes
graceful_timeout = 40
keepalive = 5

# Logs vers stdout/stderr → capturés par Docker.
accesslog = "-"
errorlog = "-"
loglevel = "info"
capture_output = True

# Sécurité : limite la taille des requêtes (anti-abus upload).
limit_request_line = 8190
limit_request_fields = 100

# Rechargement gracieux quand le code change (utile lors des deploys).
max_requests = 1000
max_requests_jitter = 50

# Variables brutes (gunicorn accepte aussi un dict via raw_env).
raw_env = [
    "DJANGO_SETTINGS_MODULE=config.settings",
]


def _when_ready(_):
    print("✓ Gunicorn prêt", flush=True)


when_ready = _when_ready
