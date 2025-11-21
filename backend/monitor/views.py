from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Event
from .serializers import MonitorEventCreateSerializer, EventSerializer


class MonitorEventAPIView(APIView):
    """
    POST /monitor/save-event/ - Save user interaction events from frontend
    """
    
    def post(self, request):
        """
        Save an event to the database.
        
        Expected JSON:
        {
            "type": "STUDENT_CLAPPED",
            "username": "Explorer",
            "session_id": "abc123",
            "data": {...}
        }
        """
        serializer = MonitorEventCreateSerializer(data=request.data)
        
        if serializer.is_valid():
            try:
                event = Event.objects.create(
                    event_type=serializer.validated_data['event_type'],
                    event_name=serializer.validated_data['event_name'],
                    username=serializer.validated_data.get('username', ''),
                    session_id=serializer.validated_data.get('session_id', ''),
                    data=serializer.validated_data.get('data', {}),
                )
                
                response_serializer = EventSerializer(event)
                return Response(
                    {
                        'success': True,
                        'message': f'Event {event.event_name} saved successfully',
                        'event': response_serializer.data
                    },
                    status=status.HTTP_201_CREATED
                )
            except Exception as e:
                return Response(
                    {'success': False, 'error': str(e)},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
        else:
            return Response(
                {'success': False, 'errors': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )


class EventListAPIView(APIView):
    """
    GET /monitor/events/ - Retrieve all events (optional, for debugging/analytics)
    """
    
    def get(self, request):
        """
        Retrieve events with optional filtering by username or event_type
        
        Query params:
        - username: filter by username
        - event_type: filter by event type
        - limit: number of results (default 100)
        """
        events = Event.objects.all()
        
        # Optional filtering
        username = request.query_params.get('username')
        event_type = request.query_params.get('event_type')
        limit = int(request.query_params.get('limit', 100))
        
        if username:
            events = events.filter(username=username)
        if event_type:
            events = events.filter(event_type=event_type)
        
        events = events[:limit]
        serializer = EventSerializer(events, many=True)
        
        return Response({'events': serializer.data}, status=status.HTTP_200_OK)
