"""Vues de l'API dashboard admin (§3 du cahier des charges).

Toutes les routes sont préfixées `/api/admin/` et protégées par
`IsAdminUser` (= is_staff ou is_superuser). Aucune action métier n'est
réimplémentée ici : chaque mutation délègue aux services atomiques
(`payments.services`, `markets.services`), garantissant le ledger
double-écriture et les verrous pessimistes.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger.models import LedgerEntry
from markets.models import Market, MarketStatus
from markets.services import MarketError, cancel_market, resolve_market
from payments.models import DepositRequest, WithdrawRequest
from payments.services import (
    PaymentError, approve_deposit, mark_withdraw_paid,
    reject_deposit, reject_withdraw,
)

from .serializers import (
    AdminDepositSerializer, AdminLedgerEntrySerializer, AdminUserSerializer,
    AdminWithdrawSerializer, MarketAdminSerializer, MarketCreateSerializer,
    ProcessNoteSerializer, ResolveSerializer,
)

User = get_user_model()


# --------------------------------------------------------------------------
# 3.0 Vue d'ensemble (statistiques temps réel)
# --------------------------------------------------------------------------

class StatsView(APIView):
    """Compteurs de pilotage affichés en haut du dashboard."""
    permission_classes = [IsAdminUser]

    def get(self, request):
        deposits_pending = DepositRequest.objects.filter(
            status=DepositRequest.Status.PENDING
        )
        withdrawals_pending = WithdrawRequest.objects.filter(
            status=WithdrawRequest.Status.PENDING
        )
        # Liquidité en attente : somme des retraits à exécuter
        pending_payout = withdrawals_pending.aggregate(
            t=Sum("amount")
        )["t"] or Decimal("0")
        # Trésorerie collectée (dépôts approuvés) moins reversée (retraits payés)
        deposits_in = DepositRequest.objects.filter(
            status=DepositRequest.Status.APPROVED
        ).aggregate(t=Sum("amount"))["t"] or Decimal("0")
        withdrawals_out = WithdrawRequest.objects.filter(
            status=WithdrawRequest.Status.PAID
        ).aggregate(t=Sum("amount"))["t"] or Decimal("0")

        return Response({
            "users_total": User.objects.count(),
            "markets_open": Market.objects.filter(status=MarketStatus.OPEN).count(),
            "markets_locked": Market.objects.filter(
                status__in=[MarketStatus.LOCKED, MarketStatus.RESOLVING]
            ).count(),
            "markets_resolved": Market.objects.filter(status=MarketStatus.RESOLVED).count(),
            "deposits_pending": deposits_pending.count(),
            "deposits_pending_amount": str(deposits_pending.aggregate(
                t=Sum("amount"))["t"] or Decimal("0")),
            "withdrawals_pending": withdrawals_pending.count(),
            "withdrawals_pending_amount": str(pending_payout),
            "cash_collected_net": str(Decimal(deposits_in) - Decimal(withdrawals_out)),
        })


# --------------------------------------------------------------------------
# 3.2 Rapprochement bancaire : DÉPÔTS
# --------------------------------------------------------------------------

class DepositListView(generics.ListAPIView):
    """File des demandes de dépôt (filtrable par statut)."""
    serializer_class = AdminDepositSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = DepositRequest.objects.select_related("user").order_by("status", "-created_at")
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs


class DepositActionView(APIView):
    """Approuve ou rejette une demande de dépôt (validation manuelle admin)."""
    permission_classes = [IsAdminUser]

    def _get(self, pk):
        return DepositRequest.objects.select_related("user").get(pk=pk)

    def post(self, request, pk, action):
        try:
            deposit = self._get(pk)
        except DepositRequest.DoesNotExist:
            return Response({"detail": "Demande introuvable."}, status=404)

        ser = ProcessNoteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        note = ser.validated_data.get("note", "")

        try:
            if action == "approve":
                approve_deposit(deposit=deposit, admin_user=request.user, note=note)
            elif action == "reject":
                reject_deposit(deposit=deposit, admin_user=request.user, note=note)
            else:
                return Response({"detail": "Action inconnue."}, status=400)
        except PaymentError as e:
            return Response({"detail": str(e)}, status=400)

        return Response(AdminDepositSerializer(deposit).data)


# --------------------------------------------------------------------------
# 3.2 Rapprochement bancaire : RETRAITS
# --------------------------------------------------------------------------

class WithdrawListView(generics.ListAPIView):
    """File des demandes de retrait (filtrable par statut)."""
    serializer_class = AdminWithdrawSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = WithdrawRequest.objects.select_related("user").order_by("status", "created_at")
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        return qs


class WithdrawActionView(APIView):
    """Marque un retrait comme payé (après transfert réel) ou le rejette (débloque)."""
    permission_classes = [IsAdminUser]

    def _get(self, pk):
        return WithdrawRequest.objects.select_related("user").get(pk=pk)

    def post(self, request, pk, action):
        try:
            withdraw = self._get(pk)
        except WithdrawRequest.DoesNotExist:
            return Response({"detail": "Demande introuvable."}, status=404)

        ser = ProcessNoteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        note = ser.validated_data.get("note", "")
        operator_ref = ser.validated_data.get("operator_ref", "")

        try:
            if action == "pay":
                mark_withdraw_paid(
                    withdraw=withdraw, admin_user=request.user,
                    operator_ref=operator_ref, note=note,
                )
            elif action == "reject":
                reject_withdraw(withdraw=withdraw, admin_user=request.user, note=note)
            else:
                return Response({"detail": "Action inconnue."}, status=400)
        except PaymentError as e:
            return Response({"detail": str(e)}, status=400)

        return Response(AdminWithdrawSerializer(withdraw).data)


# --------------------------------------------------------------------------
# 3.1 & 3.3 Gestion des marchés (CRUD + résolution/annulation)
# --------------------------------------------------------------------------

class MarketAdminListView(generics.ListCreateAPIView):
    """Liste tous les marchés (y compris brouillons) + création rapide."""
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = Market.objects.all().order_by("-is_featured", "-bet_close_at")
        st = self.request.query_params.get("status")
        if st:
            qs = qs.filter(status=st)
        cat = self.request.query_params.get("category")
        if cat:
            qs = qs.filter(category=cat)
        return qs

    def get_serializer_class(self):
        return MarketCreateSerializer if self.request.method == "POST" else MarketAdminSerializer

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        market = ser.save()
        return Response(
            MarketAdminSerializer(market).data, status=status.HTTP_201_CREATED
        )


class MarketAdminDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Détail / édition / suppression d'un marché."""
    serializer_class = MarketAdminSerializer
    permission_classes = [IsAdminUser]
    queryset = Market.objects.all()


class MarketResolveView(APIView):
    """§3.3 : résout un marché (OUI/NON) et redistribue les gains."""
    permission_classes = [IsAdminUser]

    def post(self, request, pk):
        market = Market.objects.get(pk=pk)
        ser = ResolveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            resolve_market(
                market=market, outcome=ser.validated_data["outcome"],
                admin_user=request.user,
            )
        except MarketError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(MarketAdminSerializer(market).data)


class MarketCancelView(APIView):
    """§3.3 : annule un marché et rembourse toutes les mises."""
    permission_classes = [IsAdminUser]

    def post(self, request, pk):
        market = Market.objects.get(pk=pk)
        try:
            cancel_market(market=market, admin_user=request.user)
        except MarketError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(MarketAdminSerializer(market).data)


# --------------------------------------------------------------------------
# Joueurs & historique comptable global
# --------------------------------------------------------------------------

class UserListView(generics.ListAPIView):
    """Liste paginée des joueurs (recherche par téléphone / nom)."""
    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = User.objects.filter(is_staff=False, is_superuser=False).order_by("-date_joined")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(phone__icontains=q) | Q(display_name__icontains=q))
        return qs


class LedgerListView(generics.ListAPIView):
    """Journal comptable global (toutes écritures, filtrable par type)."""
    serializer_class = AdminLedgerEntrySerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = (
            LedgerEntry.objects
            .select_related("wallet__user", "created_by")
            .order_by("-created_at", "-id")
        )
        t = self.request.query_params.get("type")
        if t:
            qs = qs.filter(type=t)
        q = self.request.query_params.get("q")  # référence / note / téléphone
        if q:
            qs = qs.filter(
                Q(reference__icontains=q)
                | Q(note__icontains=q)
                | Q(wallet__user__phone__icontains=q)
            )
        return qs
