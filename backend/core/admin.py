from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("phone",)
    list_display = ("phone", "display_name", "is_platform_admin", "is_active", "date_joined")
    list_filter = ("is_superuser", "is_staff", "is_active")
    search_fields = ("phone", "display_name")
    fieldsets = (
        (None, {"fields": ("phone", "password")}),
        ("Identité", {"fields": ("display_name", "username", "first_name", "last_name")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "is_staff_member",
                                    "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "display_name",
                                                  "password1", "password2")}),
    )
