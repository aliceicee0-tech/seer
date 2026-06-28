"""
Admin des paiements — c'est ici que l'administrateur valide/exécute
manuellement les flux Mobile Money (voir §3.2 du cahier des charges).
"""
from django.contrib import admin
from django.utils import timezone

from .models import DepositRequest, WithdrawRequest
from .services import (
    PaymentError, approve_deposit, mark_withdraw_paid,
    reject_deposit, reject_withdraw,
)


@admin.register(DepositRequest)
class DepositRequestAdmin(admin.ModelAdmin):
    list_display = ("code", "user", "amount", "operator", "sender_phone",
                    "operator_ref", "status", "created_at", "processed_by")
    list_filter = ("status", "operator")
    search_fields = ("code", "user__phone", "user__display_name",
                     "sender_phone", "operator_ref")
    list_editable = ("status",)  # lecture seule en pratique (actions dédiées)
    readonly_fields = ("code", "user", "amount", "operator", "sender_phone",
                       "operator_ref", "ledger_entry", "processed_by",
                       "processed_at", "created_at", "updated_at")
    fields = ("code", "user", "amount", "operator", "sender_phone",
              "operator_ref", "status", "admin_note", "ledger_entry",
              "processed_by", "processed_at", "created_at", "updated_at")
    actions = ["bulk_approve", "bulk_reject"]

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        # Ne montrer QUE les PENDING en haut par défaut
        qs = super().get_queryset(request)
        return qs.order_by("status", "-created_at")

    @admin.action(description="✅ Approuver (créditer le joueur)")
    def bulk_approve(self, request, qs):
        ok, fail = 0, 0
        for d in qs.filter(status=DepositRequest.Status.PENDING):
            try:
                approve_deposit(deposit=d, admin_user=request.user)
                ok += 1
            except PaymentError:
                fail += 1
        self.message_user(request, f"{ok} dépôt(s) approuvé(s), {fail} échec(s).")

    @admin.action(description="❌ Rejeter")
    def bulk_reject(self, request, qs):
        n = 0
        for d in qs.filter(status=DepositRequest.Status.PENDING):
            reject_deposit(deposit=d, admin_user=request.user)
            n += 1
        self.message_user(request, f"{n} dépôt(s) rejeté(s).")


@admin.register(WithdrawRequest)
class WithdrawRequestAdmin(admin.ModelAdmin):
    list_display = ("code", "user", "amount", "operator", "recipient_phone",
                    "status", "created_at", "processed_by")
    list_filter = ("status", "operator")
    search_fields = ("code", "user__phone", "recipient_phone", "operator_ref")
    readonly_fields = ("code", "user", "amount", "operator", "recipient_phone",
                       "ledger_entry", "processed_by", "processed_at",
                       "created_at", "updated_at")
    fields = ("code", "user", "amount", "operator", "recipient_phone",
              "status", "operator_ref", "admin_note", "ledger_entry",
              "processed_by", "processed_at", "created_at", "updated_at")
    actions = ["bulk_pay", "bulk_reject"]

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).order_by("status", "created_at")

    @admin.action(description="💸 Marquer comme Payé (transfert effectué)")
    def bulk_pay(self, request, qs):
        ok, fail = 0, 0
        for w in qs.filter(status=WithdrawRequest.Status.PENDING):
            try:
                mark_withdraw_paid(withdraw=w, admin_user=request.user)
                ok += 1
            except PaymentError:
                fail += 1
        self.message_user(request, f"{ok} retrait(s) payé(s), {fail} échec(s).")

    @admin.action(description="❌ Rejeter (débloquer le montant)")
    def bulk_reject(self, request, qs):
        n = 0
        for w in qs.filter(status=WithdrawRequest.Status.PENDING):
            reject_withdraw(withdraw=w, admin_user=request.user)
            n += 1
        self.message_user(request, f"{n} retrait(s) rejeté(s) et débloqué(s).")
