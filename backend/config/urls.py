"""Racine des URLs du projet Nexus."""
from django.contrib import admin
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


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api_root, name="api-root"),
    path("api/auth/", include(("accounts.urls_auth", "accounts"), namespace="auth")),
    path("api/", include(("accounts.urls", "accounts"), namespace="accounts")),
    path("api/markets/", include(("markets.urls", "markets"), namespace="markets")),
    path("api/payments/", include(("payments.urls", "payments"), namespace="payments")),
    path("api/admin/", include(("dashboard.urls", "dashboard"), namespace="dashboard")),
]
