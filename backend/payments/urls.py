"""URLs de l'API paiements."""
from django.urls import path

from . import views

app_name = "payments"

urlpatterns = [
    path("mobile-money/", views.MobileMoneyInfoView.as_view(), name="mm-info"),
    path("deposits/", views.DepositListView.as_view(), name="deposit-list"),
    path("deposits/create/", views.DepositCreateView.as_view(), name="deposit-create"),
    path("deposits/<int:pk>/declare/", views.DepositDeclareView.as_view(), name="deposit-declare"),
    path("withdrawals/", views.WithdrawListView.as_view(), name="withdraw-list"),
    path("withdrawals/create/", views.WithdrawCreateView.as_view(), name="withdraw-create"),
]
