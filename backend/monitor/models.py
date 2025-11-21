from django.db import models
import json


class Event(models.Model):
    """
    Stores user interaction events from the frontend (gesture detections, session events, etc.)
    """
    EVENT_TYPE_CHOICES = [
        ('GESTURE', 'Gesture Detection'),
        ('SESSION', 'Session Event'),
        ('FACE', 'Face Detection'),
        ('ERROR', 'Error'),
        ('OTHER', 'Other'),
    ]

    event_type = models.CharField(max_length=50, choices=EVENT_TYPE_CHOICES, default='OTHER')
    event_name = models.CharField(max_length=100, help_text="e.g., STUDENT_CLAPPED, STUDENT_LEFT_SCREEN")
    data = models.JSONField(default=dict, null=True, blank=True, help_text="Additional event metadata")
    
    timestamp = models.DateTimeField(auto_now_add=True)
    
    # Optional user/session tracking
    username = models.CharField(max_length=255, null=True, blank=True)
    session_id = models.CharField(max_length=255, null=True, blank=True)
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name_plural = "Events"
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['event_type', '-timestamp']),
            models.Index(fields=['username', '-timestamp']),
        ]

    def __str__(self):
        return f"{self.event_type} - {self.event_name} ({self.timestamp.strftime('%Y-%m-%d %H:%M:%S')})"
