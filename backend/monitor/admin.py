from django.contrib import admin
from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ('event_name', 'event_type', 'username', 'timestamp')
    list_filter = ('event_type', 'timestamp', 'username')
    search_fields = ('event_name', 'username', 'session_id')
    readonly_fields = ('timestamp', 'id')
    ordering = ('-timestamp',)
