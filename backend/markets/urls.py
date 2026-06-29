"""URLs de l'API marchés (moteur Polymarket)."""
from django.urls import path

from . import views

app_name = "markets"

urlpatterns = [
    # Catalogue public
    path("", views.MarketListView.as_view(), name="market-list"),
    path("<int:pk>/", views.MarketDetailView.as_view(), name="market-detail"),
    path("<int:pk>/pool/", views.MarketPoolView.as_view(), name="market-pool"),
    path("<int:pk>/estimate/", views.EstimateView.as_view(), name="market-estimate"),
    # Carnet d'ordres
    path("<int:pk>/orderbook/", views.OrderBookView.as_view(), name="market-orderbook"),
    path("<int:pk>/trades/", views.TradeListView.as_view(), name="market-trades"),
    path("<int:pk>/price-history/", views.PriceHistoryView.as_view(), name="market-price-history"),
    # Émission / fusion de paires
    path("<int:pk>/mint/", views.MintView.as_view(), name="market-mint"),
    path("<int:pk>/merge/", views.MergeView.as_view(), name="market-merge"),
    # Ordres
    path("<int:pk>/orders/", views.OrderListView.as_view(), name="market-orders"),
    path("<int:pk>/orders/<int:order_pk>/", views.OrderDetailView.as_view(), name="market-order-detail"),
    # Compte utilisateur
    path("my-positions/", views.MyPositionsView.as_view(), name="my-positions"),
    path("my-orders/", views.MyOrdersView.as_view(), name="my-orders"),
]
