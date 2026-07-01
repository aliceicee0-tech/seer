# syntax=docker/dockerfile:1
# Image de production du backend Nexus (Django + gunicorn).
# Conçue pour PostgreSQL (imposé par settings.py en DEBUG=False — garde B4).

FROM python:3.13-slim AS base

# Variables d'environnement Python : sorties non bufferisées (logs Docker
# en temps réel) + pas de .pyc (gain de place, builds reproductibles).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Dépendances système : libpq (psycopg2), libpq-dev pour la compilation,
# postgresql-client pour pg_dump (backups du scheduler), curl pour les healthchecks.
# On nettoie apt dans la même couche.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 libpq-dev gcc curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installe d'abord les requirements (couche mise en cache si requirements inchangé).
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copie le code applicatif.
COPY . .

# Collecte les fichiers statiques au build (WhiteNoise les sert en prod).
# Dummy SECRET_KEY + DEBUG=False : collectstatic n'a pas besoin de vrai secret.
RUN DJANGO_SECRET_KEY=build-time-dummy python manage.py collectstatic --noinput

# Utilisateur non-root : le process Django ne tourne pas en root (sécurité).
RUN useradd -m -u 1000 nexus && chown -R nexus:nexus /app
USER nexus

# Entrypoint : attend la DB, lance migrate + collectstatic, puis exec gunicorn.
COPY --chmod=0755 scripts/entrypoint.sh /app/scripts/entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["gunicorn", "-c", "gunicorn.conf.py", "config.wsgi:application"]
