"""Vues de l'API marchés (moteur Polymarket)."""
from collections import OrderedDict
from decimal import Decimal

from django.db.models import F, Q, Sum
from rest_framework import generics, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Market, MarketOutcome, MarketStatus, Order, Position, Trade,
)
from .serializers import (
    EstimateSerializer, MarketDetailSerializer, MarketListSerializer,
    MarketPoolSerializer, MergeSerializer, MintSerializer, OrderBookSerializer,
    OrderCreateSerializer, OrderSerializer, PositionSerializer, TradeSerializer,
)
from .services import (
    MarketError, cancel_order, estimate_payout, merge_pair, mint_pair,
    place_order,
)


# --------------------------------------------------------------------------
# Catalogue public
# --------------------------------------------------------------------------

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


class MarketPoolView(RetrieveAPIView):
    """État du séquestre (escrow) d'un marché — transparence financière."""
    serializer_class = MarketPoolSerializer
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            market = Market.objects.exclude(status=MarketStatus.DRAFT).get(pk=pk)
        except Market.DoesNotExist:
            return Response({"detail": "Marché introuvable."}, status=404)
        pool = market.pool  # créé automatiquement par signal
        return Response(MarketPoolSerializer(pool).data)


# --------------------------------------------------------------------------
# Émission / fusion de paires
# --------------------------------------------------------------------------

class MintView(APIView):
    """Émet `count` paires YES+NO (prélève count × 1,00 MGA → séquestre)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        market = self._get_market(pk)
        ser = MintSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            mint_pair(user=request.user, market=market,
                      count=ser.validated_data["count"])
        except MarketError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            MarketPoolSerializer(market.pool).data,
            status=status.HTTP_201_CREATED,
        )

    def _get_market(self, pk):
        try:
            return Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            raise NotFound("Marché introuvable.")


class MergeView(APIView):
    """Fusionne `count` paires (rend count × 1,00 MGA au wallet)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        market = self._get_market(pk)
        ser = MergeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            merge_pair(user=request.user, market=market,
                       count=ser.validated_data["count"])
        except MarketError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MarketPoolSerializer(market.pool).data)


# --------------------------------------------------------------------------
# Carnet d'ordres
# --------------------------------------------------------------------------

class OrderListView(generics.ListCreateAPIView):
    """Liste les ordres de l'utilisateur OU en crée un nouveau (et l'exécute)."""
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Order.objects.filter(user=self.request.user)
            .select_related("market")
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        return OrderCreateSerializer if self.request.method == "POST" else OrderSerializer

    def create(self, request, *args, **kwargs):
        market = self._get_market(kwargs["pk"])
        ser = OrderCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            order = place_order(
                user=request.user, market=market,
                side=ser.validated_data["side"],
                outcome=ser.validated_data["outcome"],
                order_type=ser.validated_data["order_type"],
                quantity=ser.validated_data["quantity"],
                price=ser.validated_data.get("price"),
                expires_at=ser.validated_data.get("expires_at"),
            )
        except MarketError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

    def _get_market(self, pk):
        try:
            return Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            raise NotFound("Marché introuvable.")


class OrderDetailView(APIView):
    """Annule un de ses ordres (DELETE)."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, order_pk):
        try:
            order = Order.objects.get(pk=order_pk, market_id=pk)
        except Order.DoesNotExist:
            raise NotFound("Ordre introuvable.")
        if order.user_id != request.user.id:
            raise PermissionDenied("Cet ordre ne vous appartient pas.")
        try:
            cancel_order(order=order, user=request.user)
        except MarketError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrderSerializer(order).data)


class OrderBookView(APIView):
    """Carnet d'ordres agrégé par niveau de prix (YES et NO)."""
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            market = Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            raise NotFound("Marché introuvable.")

        books = []
        for outcome in (MarketOutcome.YES, MarketOutcome.NO):
            bids = self._aggregate(market, outcome, Order.Side.BUY)
            asks = self._aggregate(market, outcome, Order.Side.SELL)
            best_bid = bids[0]["price"] if bids else None
            best_ask = asks[0]["price"] if asks else None
            spread = (best_ask - best_bid) if (best_bid and best_ask) else None
            books.append(OrderDict({
                "outcome": outcome,
                "bids": bids,
                "asks": asks,
                "spread": spread,
                "last_price": market.last_trade_price(),
            }))
        return Response(OrderBookSerializer(books, many=True).data)

    @staticmethod
    def _aggregate(market, outcome, side):
        qs = (
            Order.objects
            .filter(
                market=market, outcome=outcome, side=side,
                status__in=[Order.Status.OPEN, Order.Status.PARTIAL],
            )
            .values("price")
            .annotate(qty=Sum(F("quantity") - F("filled_quantity")))
            .filter(qty__gt=0)
        )
        if side == Order.Side.BUY:
            qs = qs.order_by("-price")  # meilleurs achats en premier
        else:
            qs = qs.order_by("price")   # meilleures ventes en premier
        return [{"price": r["price"], "quantity": r["qty"]} for r in qs]


class OrderDict(OrderedDict):
    """OrderedDict acceptant l'accès par attribut (pour les serializers DRF)."""
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError:
            raise AttributeError(item)


class TradeListView(ListAPIView):
    """Historique public des transactions d'un marché."""
    serializer_class = TradeSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return (
            Trade.objects.filter(market_id=self.kwargs["pk"])
            .select_related("buyer", "seller")
            .order_by("-created_at", "-id")
        )


class PriceHistoryView(APIView):
    """Série temporelle des prix de trade (base des graphes Phase 8)."""
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            market = Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            raise NotFound("Marché introuvable.")
        window = request.query_params.get("window", "7d")
        outcome = request.query_params.get("outcome", "YES").upper()
        if outcome not in MarketOutcome.values:
            raise ValidationError({"outcome": "YES ou NO attendu."})

        trades = (
            Trade.objects.filter(market=market, outcome=outcome)
            .order_by("created_at", "id")
            .values("created_at", "price", "quantity")
        )
        # Découpe optionnelle par fenêtre temporelle (24h / 7d / 30d)
        from django.utils import timezone
        from datetime import timedelta
        deltas = {"24h": timedelta(hours=24), "7d": timedelta(days=7),
                  "30d": timedelta(days=30)}
        delta = deltas.get(window)
        now = timezone.now()
        if delta:
            trades = [t for t in trades if t["created_at"] >= now - delta]
        return Response([
            {"at": t["created_at"].isoformat(), "price": str(t["price"]),
             "quantity": t["quantity"]}
            for t in trades
        ])


# --------------------------------------------------------------------------
# Positions de l'utilisateur connecté
# --------------------------------------------------------------------------

class MyPositionsView(ListAPIView):
    """Mes positions ouvertes (avec P&L et valeur actuelle)."""
    serializer_class = PositionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Position.objects.filter(user=self.request.user, quantity__gt=0)
            .select_related("market")
            .order_by("-updated_at")
        )


class MyOrdersView(ListAPIView):
    """Mes ordres (filtrables par statut)."""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = (
            Order.objects.filter(user=self.request.user)
            .select_related("market")
            .order_by("-created_at")
        )
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs


# --------------------------------------------------------------------------
# Estimation
# --------------------------------------------------------------------------

class EstimateView(APIView):
    """Estimation du gain potentiel pour `quantity` parts (lecture seule)."""
    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            market = Market.objects.get(pk=pk)
        except Market.DoesNotExist:
            return Response({"detail": "Marché introuvable."}, status=404)
        outcome = request.query_params.get("outcome", "YES").upper()
        if outcome not in MarketOutcome.values:
            return Response({"detail": "outcome doit être YES ou NO."}, status=400)
        try:
            qty = int(request.query_params.get("quantity", "10"))
        except Exception:
            return Response({"detail": "quantity invalide."}, status=400)
        try:
            data = estimate_payout(market, outcome, qty)
        except MarketError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(EstimateSerializer(data).data)
