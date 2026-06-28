from django.contrib import admin

from .models import LedgerEntry, Wallet


class LedgerEntryInline(admin.TabularInline):
    model = LedgerEntry
    extra = 0
    can_delete = False
    fields = ("type", "amount", "balance_after", "reference", "note", "created_at")
    readonly_fields = ("type", "amount", "balance_after", "reference", "note",
                       "created_at", "created_by")
    ordering = ("-created_at",)
    max_num = 0  # aucune création d'écriture depuis l'admin (utiliser les actions dédiées)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ("user", "balance", "available_balance", "locked_balance", "updated_at")
    list_select_related = ("user",)
    search_fields = ("user__phone", "user__display_name")
    readonly_fields = ("balance", "locked_balance", "available_balance",
                       "created_at", "updated_at")
    inlines = [LedgerEntryInline]

    def has_add_permission(self, request):
        return False  # créés automatiquement avec les users


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("wallet_user", "type", "amount", "balance_after",
                    "reference", "created_at", "created_by")
    list_filter = ("type",)
    search_fields = ("wallet__user__phone", "reference", "note")
    readonly_fields = [f.name for f in LedgerEntry._meta.get_fields()
                       if f.name != "id"] + ["id"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def wallet_user(self, obj):
        return obj.wallet.user.phone
    wallet_user.short_description = "Utilisateur"
