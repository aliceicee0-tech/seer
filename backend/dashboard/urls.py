"""URLs de l'API dashboard admin (préfixe /api/admin/)."""
from django.urls import path

from . import views

app_name = "dashboard"

urlpatterns = [
    # Vue d'ensemble
    path("stats/", views.StatsView.as_view(), name="stats"),

    # Rapprochement bancaire — dépôts
    path("deposits/", views.DepositListView.as_view(), name="deposit-list"),
    path("deposits/<int:pk>/<str:action>/",
         views.DepositActionView.as_view(), name="deposit-action"),
    # action ∈ {approve, reject}

    # Rapprochement bancaire — retraits
    path("withdrawals/", views.WithdrawListView.as_view(), name="withdraw-list"),
    path("withdrawals/<int:pk>/<str:action>/",
         views.WithdrawActionView.as_view(), name="withdraw-action"),
    # action ∈ {pay, reject}

    # Marchés (CRUD + résolution/annulation)
    path("markets/", views.MarketAdminListView.as_view(), name="market-list"),
    path("markets/<int:pk>/", views.MarketAdminDetailView.as_view(), name="market-detail"),
    path("markets/<int:pk>/resolve/",
         views.MarketResolveView.as_view(), name="market-resolve"),
    path("markets/<int:pk>/cancel/",
         views.MarketCancelView.as_view(), name="market-cancel"),

    # Joueurs & comptabilité
    path("users/", views.UserListView.as_view(), name="user-list"),
    path("ledger/", views.LedgerListView.as_view(), name="ledger-list"),
]
