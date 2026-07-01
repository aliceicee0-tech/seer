"""Racine des URLs du projet Nexus."""
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path


def api_root(request):
    return JsonResponse({
        "name": "Nexus API",
        "version": "1.0",
        "endpoints": [
            "/api/auth/",
            "/api/me/",
            "/api/markets/",
            "/api/payments/",
            "/api/admin/  (staff only)",
        ],
    })


def healthz(request):
    """Sonde de santé : vérifie que la base de données répond.

    Endpoint D3 — utilisé par le load-balancer / la VM pour savoir si le
    conteneur est vivant. Sans authentification, réponse JSON courte.
    200 = OK, 503 = la base de données ne répond pas.
    """
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return JsonResponse({"status": "ok", "database": "up"})
    except Exception as e:
        return JsonResponse(
            {"status": "error", "database": "down", "detail": str(e)},
            status=503,
        )


urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/", api_root, name="api-root"),
    path("api/auth/", include(("accounts.urls_auth", "accounts"), namespace="auth")),
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),
    path("api/markets/", include(("markets.urls", "markets"), namespace="markets")),
    path("api/payments/", include(("payments.urls", "payments"), namespace="payments")),
    path("api/admin/", include(("dashboard.urls", "dashboard"), namespace="dashboard")),
]
