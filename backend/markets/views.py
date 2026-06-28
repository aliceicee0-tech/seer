"""Vues de l'API marchés."""
from decimal import Decimal

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Bet, Market, MarketStatus
from .serializers import (
    BetSerializer, EstimateSerializer, MarketDetailSerializer,
    MarketListSerializer, PlaceBetSerializer,
)
from .services import MarketError, estimate_payout, place_bet


class MarketListView(ListAPIView):
    """Liste paginée des marchés ouverts/filtrables par catégorie."""
    serializer_class = MarketListSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        qs = Market.objects.exclude(status=MarketStatus.DRAFT).select_related()
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs


class MarketDetailView(RetrieveAPIView):
    """Détail public d'un marché (sauf brouillons)."""
    serializer_class = MarketDetailSerializer
    permission_classes = [AllowAny]
    queryset = Market.objects.exclude(status=MarketStatus.DRAFT)


class EstimateView(APIView):
    """Estimation INDICATIVE du gain potentiel pour une mise hypothétique."""
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            market = Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            return Response({"detail": "Marché introuvable."}, status=404)
        outcome = request.query_params.get("outcome", "YES").upper()
        if outcome not in ("YES", "NO"):
            return Response({"detail": "outcome doit être YES ou NO."}, status=400)
        try:
            amount = Decimal(request.query_params.get("amount", "1000"))
        except Exception:
            return Response({"detail": "amount invalide."}, status=400)
        data = estimate_payout(market, outcome, amount)
        return Response(EstimateSerializer(data).data)


class PlaceBetView(APIView):
    """Place un pari : débite le wallet et incrémente le pool."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        market = Market.objects.get(pk=pk)
        ser = PlaceBetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            bet = place_bet(
                user=request.user,
                market=market,
                outcome=ser.validated_data["outcome"],
                amount=ser.validated_data["amount"],
            )
        except MarketError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BetSerializer(bet).data, status=status.HTTP_201_CREATED)


class MyBetsView(ListAPIView):
    """Historique complet des paris de l'utilisateur connecté."""
    serializer_class = BetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Bet.objects.filter(user=self.request.user)
            .select_related("market")
            .order_by("-created_at")
        )


class MyActiveBetsView(MyBetsView):
    """Paris encore en cours (non résolus/non remboursés)."""
    def get_queryset(self):
        return super().get_queryset().filter(status=Bet.Status.PLACED)
