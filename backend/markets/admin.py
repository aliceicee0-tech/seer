from django.contrib import admin
from django.utils.html import format_html

from .models import (
    Market, MarketOutcome, MarketPool, MarketStatus, Order, Position, Trade,
)


class MarketPoolInline(admin.StackedInline):
    """Pool de séquestre d'un marché (lecture seule — géré par le moteur)."""
    model = MarketPool
    extra = 0
    can_delete = False
    max_num = 1
    readonly_fields = (
        "escrow_balance", "pairs_created", "pairs_destroyed",
        "created_at", "updated_at",
    )

    def has_add_permission(self, request, obj=None):
        return False


class PositionInline(admin.TabularInline):
    model = Position
    extra = 0
    can_delete = False
    fields = ("user", "outcome", "quantity", "locked_quantity",
              "avg_buy_price", "updated_at")
    readonly_fields = ("user", "outcome", "quantity", "locked_quantity",
                       "avg_buy_price", "updated_at")
    ordering = ("-updated_at",)

    def has_add_permission(self, request, obj=None):
        return False


class OrderInline(admin.TabularInline):
    model = Order
    extra = 0
    can_delete = False
    fields = ("user", "side", "outcome", "order_type", "price",
              "quantity", "filled_quantity", "status", "created_at")
    readonly_fields = ("user", "side", "outcome", "order_type", "price",
                       "quantity", "filled_quantity", "status", "created_at")
    ordering = ("-created_at",)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Market)
class MarketAdmin(admin.ModelAdmin):
    list_display = ("id", "short_question", "category", "status", "outcome",
                    "escrow_display", "bet_close_at", "is_featured")
    list_filter = ("status", "category", "is_featured")
    search_fields = ("question", "description", "source_url")
    list_editable = ("status", "is_featured")
    date_hierarchy = "bet_close_at"
    fieldsets = (
        ("Énoncé", {"fields": ("question", "description", "category", "image_url")}),
        ("Source & règles", {"fields": ("source_url", "source_rules")}),
        ("Dates", {"fields": ("bet_close_at", "resolve_at")}),
        ("État", {"fields": ("status", "outcome", "resolved_by", "resolved_at")}),
        ("Mise en avant", {"fields": ("is_featured",)}),
    )
    readonly_fields = ("resolved_by", "resolved_at")
    inlines = [MarketPoolInline, OrderInline, PositionInline]
    actions = ["resolve_yes", "resolve_no", "cancel"]

    def short_question(self, obj):
        return obj.question[:70]
    short_question.short_description = "Question"

    def escrow_display(self, obj):
        try:
            pool = obj.pool
        except MarketPool.DoesNotExist:
            return "—"
        return f"{pool.escrow_balance} MGA"
    escrow_display.short_description = "Séquestre"

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

    @admin.action(description="Résoudre en OUI et payer (1,00/part)")
    def resolve_yes(self, request, qs):
        self._resolve(request, qs, "YES")

    @admin.action(description="Résoudre en NON et payer (1,00/part)")
    def resolve_no(self, request, qs):
        self._resolve(request, qs, "NO")

    @admin.action(description="Annuler et rembourser (1,00/part)")
    def cancel(self, request, qs):
        from .services import cancel_market
        n = 0
        for m in qs:
            cancel_market(market=m, admin_user=request.user)
            n += 1
        self.message_user(request, f"{n} marché(s) annulé(s) et remboursé(s).")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "market", "side", "outcome", "order_type",
                    "price", "quantity", "filled_quantity", "status", "created_at")
    list_filter = ("status", "side", "outcome", "order_type")
    search_fields = ("user__phone", "market__question")
    readonly_fields = ("filled_quantity", "created_at", "updated_at")


@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display = ("id", "market", "outcome", "price", "quantity",
                    "buyer", "seller", "created_at")
    list_filter = ("outcome",)
    search_fields = ("market__question", "buyer__phone", "seller__phone")
    readonly_fields = ("created_at",)


@admin.register(Position)
class PositionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "market", "outcome", "quantity",
                    "locked_quantity", "avg_buy_price", "updated_at")
    list_filter = ("outcome",)
    search_fields = ("user__phone", "market__question")
    readonly_fields = ("created_at", "updated_at")


@admin.register(MarketPool)
class MarketPoolAdmin(admin.ModelAdmin):
    list_display = ("market", "escrow_balance", "pairs_created",
                    "pairs_destroyed", "pairs_in_circulation", "invariant_state")
    search_fields = ("market__question",)
    readonly_fields = ("escrow_balance", "pairs_created", "pairs_destroyed",
                       "created_at", "updated_at")

    @admin.display(description="Paires en circulation")
    def pairs_in_circulation(self, obj):
        return obj.pairs_in_circulation

    @admin.display(description="Invariant")
    def invariant_state(self, obj):
        if obj.invariant_ok():
            return format_html('<span style="color:green;">✓ OK</span>')
        return format_html('<span style="color:red;">✗ ANOMALIE</span>')
