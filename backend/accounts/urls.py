"""URLs du compte (préfixe /api/)."""
from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="me"),
    path("me/ledger/", views.MyLedgerView.as_view(), name="my-ledger"),
]
