from django.db import models

class Activity(models.Model):
    ACTION_CHOICES = [
        ('NOSE_TOUCH', 'Touch Your Nose'),
        ('CLAP', 'Clap Hands'),
        ('WAVE', 'Wave Hello'),
    ]

    title = models.CharField(max_length=100, help_text="The name of the activity (e.g., 'Touch Nose')")
    description = models.TextField(help_text="Instructions for the kid to read/hear")
    
    # This field matches the logic we will write in React
    action_type = models.CharField(max_length=50, choices=ACTION_CHOICES)
    
    # We store AI configuration here so we can tweak difficulty without redeploying the frontend
    # Example: {"threshold": 0.05, "hold_duration": 1.0}
    ai_config = models.JSONField(default=dict, help_text="JSON config for detection thresholds")
    
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Activities"
        ordering = ['order']

    def __str__(self):
        return f"{self.order}. {self.title}"