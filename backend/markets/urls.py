"""URLs de l'API marchés."""
from django.urls import path

from . import views

app_name = "markets"

urlpatterns = [
    # Catalogue public
    path("", views.MarketListView.as_view(), name="market-list"),
    path("<int:pk>/", views.MarketDetailView.as_view(), name="market-detail"),
    path("<int:pk>/estimate/", views.EstimateView.as_view(), name="market-estimate"),
    path("<int:pk>/place-bet/", views.PlaceBetView.as_view(), name="market-place-bet"),
    # Paris de l'utilisateur connecté
    path("my-bets/", views.MyBetsView.as_view(), name="my-bets"),
    path("my-bets/active/", views.MyActiveBetsView.as_view(), name="my-bets-active"),
]
