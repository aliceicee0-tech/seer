"""
Paramètres Django du projet Nexus.

Lecture des variables via django-environ depuis un fichier .env placé à la
racine du monorepo (parent de `backend/`) ou via les variables d'environnement.
"""

import os
from datetime import timedelta
from pathlib import Path

import environ

# --- Chemins ---------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
# Le .env vit à la racine du monorepo (parent de backend/)
ENV_PATH = BASE_DIR.parent / ".env"

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
    DJANGO_CORS_ALLOWED_ORIGINS=(list, []),
)
environ.Env.read_env(str(ENV_PATH)) if ENV_PATH.exists() else None

# --- Sécurité --------------------------------------------------------------
SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Cache partagé (utile au throttling DRF en production).
# En dev on retombe sur LocMem ; en prod, positionner REDIS_URL.
REDIS_URL = env("REDIS_URL", default="")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache" if REDIS_URL
        else "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": REDIS_URL or "",
    }
}

# Durcissement activé uniquement en production (HTTPS délégué au CDN/host).
if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)  # 30 j
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"

# --- Applications ----------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # tiers
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",

        # locales
        "core.apps.CoreConfig",
        "ledger",
        "accounts",
        "markets",
        "payments",
        "dashboard",
    ]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Base de données -------------------------------------------------------
# DATABASE_URL prend la priorité ; sinon on assemble depuis les variables.
def _build_databases():
    db_url = env("DATABASE_URL", default="")
    if db_url:
        return {"default": env.db_url("DATABASE_URL")}
    return {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("DB_NAME", default="seer"),
            "USER": env("DB_USER", default="seer"),
            "PASSWORD": env("DB_PASSWORD", default="seer"),
            "HOST": env("DB_HOST", default="127.0.0.1"),
            "PORT": env("DB_PORT", default="5432"),
        }
    }


DATABASES = _build_databases()

# --- Auth ------------------------------------------------------------------
AUTH_USER_MODEL = "core.User"
AUTHENTICATION_BACKENDS = [
    "accounts.backends.PhoneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 6}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internationalisation --------------------------------------------------
LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Indian/Antananarivo"   # UTC+3
USE_I18N = True
USE_TZ = True

# --- Fichiers statiques ----------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = (
    "whitenoise.storage.CompressedManifestStaticFilesStorage" if not DEBUG
    else "django.contrib.staticfiles.storage.StaticFilesStorage"
)

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- CORS ------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env.list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    default=["http://localhost:5173", "http://127.0.0.1:5173"],
)
CORS_ALLOW_CREDENTIALS = True

# --- REST Framework + JWT --------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # Rate limiting global (protection DoS / scraping).
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", default="120/min"),
        "user": env("THROTTLE_USER", default="300/min"),
        "login": env("THROTTLE_LOGIN", default="5/min"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(days=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- Réglages métier Nexus --------------------------------------------------
PLATFORM_COMMISSION_RATE = env.float("PLATFORM_COMMISSION_RATE", default=10.0)  # %
MIN_BET_AMOUNT = env.int("MIN_BET_AMOUNT", default=500)

# Numéros Mobile Money affichés aux joueurs pour leurs dépôts
MVOLA_NUMBER = env("MVOLA_NUMBER", default="0340000000")
ORANGE_MONEY_NUMBER = env("ORANGE_MONEY_NUMBER", default="0320000000")
AIRTEL_MONEY_NUMBER = env("AIRTEL_MONEY_NUMBER", default="0330000000")
MOBILE_MONEY_HOLDER = env("MOBILE_MONEY_HOLDER", default="Nexus Madagascar")

# Choix d'opérateurs Mobile Money
MOBILE_MONEY_OPERATORS = (
    ("MVOLA", "MVola"),
    ("ORANGE", "Orange Money"),
    ("AIRTEL", "Airtel Money"),
)
