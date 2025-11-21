from django.urls import path
from .views import MonitorEventAPIView, EventListAPIView

app_name = 'monitor'

urlpatterns = [
    path('save-event/', MonitorEventAPIView.as_view(), name='save-event'),
    path('events/', EventListAPIView.as_view(), name='event-list'),
]
