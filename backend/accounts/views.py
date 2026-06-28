"""Vues d'authentification et de compte utilisateur."""
from rest_framework import generics, status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from ledger.models import LedgerEntry

from .serializers import (
    LedgerEntrySerializer, LoginSerializer, RegisterSerializer, UserSerializer,
)
from .throttles import LoginRateThrottle, PhoneLoginThrottle


def _jwt_for(user):
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": UserSerializer(user).data,
    }


class RegisterView(generics.CreateAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]  # anti création massive de comptes
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = ser.save()
        return Response(_jwt_for(user), status=status.HTTP_201_CREATED)


class LoginView(generics.GenericAPIView):
    permission_classes = [AllowAny]
    # Double verrou : par IP ET par numéro de téléphone visé.
    throttle_classes = [LoginRateThrottle, PhoneLoginThrottle]
    serializer_class = LoginSerializer

    def post(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = ser.validated_data["user"]
        return Response(_jwt_for(user))


class MeView(generics.RetrieveUpdateAPIView):
    """Profil + solde du joueur connecté."""
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        user = self.request.user
        if "display_name" in request.data:
            user.display_name = request.data["display_name"]
            user.save(update_fields=["display_name"])
        return Response(UserSerializer(user).data)


class MyLedgerView(ListAPIView):
    """Historique comptable (dépôts, retraits, mises, gains) du joueur."""
    serializer_class = LedgerEntrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return LedgerEntry.objects.filter(wallet__user=self.request.user)


class RefreshTokenView(generics.GenericAPIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from rest_framework_simplejwt.tokens import RefreshToken, TokenError
        token = request.data.get("refresh")
        if not token:
            return Response({"detail": "refresh manquant."}, status=400)
        try:
            refresh = RefreshToken(token)
            return Response({
                "access": str(refresh.access_token),
                "refresh": str(refresh),
            })
        except TokenError:
            return Response({"detail": "Token invalide ou expiré."}, status=401)
