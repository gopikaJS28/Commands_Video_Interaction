# views.py
from rest_framework.views import APIView
from rest_framework.response import Response

class ActivityList(APIView):
    def get(self, request, format=None):
        activities = [
            {
                "id": 1,
                "title": "Clap Your Hands",
                "action_type": "CLAP",
                "target_count": 2,
                "intro_text": "Clap your hands twice!",
                "success_text": "Perfect clapping!",
                # NEW FIELDS
                "retry_text": "I didn't quite catch that. Try clapping louder!",
                "skip_text": "That was tricky! Let's shake it off and try the next one.",
                "time_limit": 5000 # 5 seconds per attempt
            },
            {
                "id": 2,
                "title": "Touch Your Nose",
                "action_type": "NOSE_TOUCH",
                "target_count": 1,
                "intro_text": "Touch your nose!",
                "success_text": "Nice! You found it!",
                "retry_text": "Try again! Point to your nose.",
                "skip_text": "Don't worry, we'll get it next time. Moving on!",
                "time_limit": 5000
            },
            {
                "id": 3,
                "title": "Raise One Hand",
                "action_type": "RAISE_HAND",
                "target_count": 1,
                "intro_text": "All right… last one! Raise one hand up high!",
                "success_text": "Woo-hoo! You nailed all the commands!",
                
                # --- NEW FIELDS FOR ATTEMPTS ---
                "retry_text": "I can't see your hand. Try raising it higher!",
                "skip_text": "That was a tough one. You did your best!",
                "time_limit": 6000 # Maybe give 6 seconds for this one
}
          
        ]
        return Response(activities)