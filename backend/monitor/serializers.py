from rest_framework import serializers
from .models import Event


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'event_type', 'event_name', 'data', 'timestamp', 'username', 'session_id']
        read_only_fields = ['id', 'timestamp']


class MonitorEventCreateSerializer(serializers.Serializer):
    """
    Serializer for incoming event data from frontend.
    Maps frontend 'type' field to 'event_name' and classifies the event type.
    """
    type = serializers.CharField(max_length=100, required=True)
    username = serializers.CharField(max_length=255, required=False, allow_blank=True)
    session_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    data = serializers.JSONField(required=False, default=dict)

    def validate(self, data):
        """Classify event type based on the 'type' field"""
        event_type_map = {
            'STUDENT_CLAPPED': 'GESTURE',
            'STUDENT_WAVED': 'GESTURE',
            'STUDENT_TOUCHED_NOSE': 'GESTURE',
            'STUDENT_RAISED_HAND': 'GESTURE',
            'STUDENT_LEFT_SCREEN': 'FACE',
            'STUDENT_RETURNED': 'FACE',
            'SESSION_START': 'SESSION',
            'SESSION_END': 'SESSION',
            'SESSION_COMPLETE': 'SESSION',
        }
        
        # Determine event type
        data['event_type'] = event_type_map.get(data['type'], 'OTHER')
        data['event_name'] = data['type']
        
        return data
