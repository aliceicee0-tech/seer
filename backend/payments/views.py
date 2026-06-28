"""Vues de l'API paiements (coté joueur)."""
from django.conf import settings
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DepositRequest, WithdrawRequest
from .serializers import (
    CreateDepositSerializer, CreateWithdrawSerializer, DeclareDepositSerializer,
    DepositSerializer, MobileMoneyInfoSerializer, WithdrawSerializer,
)
from .services import PaymentError, request_withdraw


class MobileMoneyInfoView(APIView):
    """Affiche les numéros de réception de la plateforme (public)."""
    permission_classes = [AllowAny]

    def get(self, request):
        data = {
            "holder": settings.MOBILE_MONEY_HOLDER,
            "numbers": {
                "MVOLA": settings.MVOLA_NUMBER,
                "ORANGE": settings.ORANGE_MONEY_NUMBER,
                "AIRTEL": settings.AIRTEL_MONEY_NUMBER,
            },
        }
        return Response(MobileMoneyInfoSerializer(data).data)


class DepositCreateView(APIView):
    """Étape 1 : le joueur crée une demande de dépôt → reçoit le code #DEP-XXXX."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = CreateDepositSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        deposit = DepositRequest.objects.create(
            user=request.user,
            amount=ser.validated_data["amount"],
            operator=ser.validated_data["operator"],
        )
        return Response(DepositSerializer(deposit).data, status=status.HTTP_201_CREATED)


class DepositDeclareView(APIView):
    """Étape 2 : après transfert réel, le joueur déclare son expéditeur + réf SMS."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            deposit = DepositRequest.objects.get(pk=pk, user=request.user)
        except DepositRequest.DoesNotExist:
            return Response({"detail": "Demande introuvable."}, status=404)
        ser = DeclareDepositSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if deposit.status != DepositRequest.Status.PENDING:
            return Response({"detail": "Demande déjà traitée."}, status=400)
        deposit.sender_phone = ser.validated_data["sender_phone"]
        deposit.operator_ref = ser.validated_data.get("operator_ref", "")
        deposit.save(update_fields=["sender_phone", "operator_ref", "updated_at"])
        return Response(DepositSerializer(deposit).data)


class DepositListView(ListAPIView):
    """Liste des demandes de dépôt de l'utilisateur connecté."""
    serializer_class = DepositSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return DepositRequest.objects.filter(user=self.request.user)


class WithdrawCreateView(APIView):
    """Le joueur demande un retrait → montant bloqué immédiatement."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = CreateWithdrawSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            w = request_withdraw(
                user=request.user,
                amount=ser.validated_data["amount"],
                operator=ser.validated_data["operator"],
                recipient_phone=ser.validated_data["recipient_phone"],
            )
        except PaymentError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(WithdrawSerializer(w).data, status=status.HTTP_201_CREATED)


class WithdrawListView(ListAPIView):
    serializer_class = WithdrawSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return WithdrawRequest.objects.filter(user=self.request.user)
