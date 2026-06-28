from django.contrib import admin
from django.utils.html import format_html

from .models import Bet, Market


class BetInline(admin.TabularInline):
    model = Bet
    extra = 0
    can_delete = False
    fields = ("user", "outcome", "amount", "proba_at_place", "payout", "status", "created_at")
    readonly_fields = ("user", "outcome", "amount", "proba_at_place",
                       "payout", "status", "created_at", "ledger_entry")
    ordering = ("-created_at",)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Market)
class MarketAdmin(admin.ModelAdmin):
    list_display = ("id", "short_question", "category", "status", "outcome",
                    "pool_total_display", "bet_close_at", "is_featured")
    list_filter = ("status", "category", "is_featured")
    search_fields = ("question", "description", "source_url")
    list_editable = ("status", "is_featured")
    date_hierarchy = "bet_close_at"
    fieldsets = (
        ("Énoncé", {"fields": ("question", "description", "category", "image_url")}),
        ("Source & règles", {"fields": ("source_url", "source_rules")}),
        ("Dates", {"fields": ("bet_close_at", "resolve_at")}),
        ("État", {"fields": ("status", "outcome", "resolved_by", "resolved_at")}),
        ("Pool", {"fields": ("pool_yes", "pool_no")}),
        ("Mise en avant", {"fields": ("is_featured",)}),
    )
    readonly_fields = ("pool_yes", "pool_no", "resolved_by", "resolved_at")
    inlines = [BetInline]
    actions = ["resolve_yes", "resolve_no", "cancel"]

    def short_question(self, obj):
        return obj.question[:70]
    short_question.short_description = "Question"

    def pool_total_display(self, obj):
        return f"{obj.pool_total} pts"
    pool_total_display.short_description = "Pool"

    # --- Actions de résolution --------------------------------------------

    def _resolve(self, request, qs, outcome):
        from .services import resolve_market, MarketError
        ok, fail = 0, 0
        for m in qs:
            try:
                resolve_market(market=m, outcome=outcome, admin_user=request.user)
                ok += 1
            except MarketError:
                fail += 1
        self.message_user(request, f"{ok} marché(s) résolu(s) « {outcome} », {fail} échec(s).")

    @admin.action(description="Résoudre en OUI et payer")
    def resolve_yes(self, request, qs):
        self._resolve(request, qs, "YES")

    @admin.action(description="Résoudre en NON et payer")
    def resolve_no(self, request, qs):
        self._resolve(request, qs, "NO")

    @admin.action(description="Annuler et rembourser")
    def cancel(self, request, qs):
        from .services import cancel_market
        n = 0
        for m in qs:
            cancel_market(market=m, admin_user=request.user)
            n += 1
        self.message_user(request, f"{n} marché(s) annulé(s) et remboursé(s).")


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "market", "outcome", "amount",
                    "payout", "status", "created_at")
    list_filter = ("status", "outcome")
    search_fields = ("user__phone", "market__question")
    readonly_fields = ("ledger_entry", "proba_at_place", "created_at")
