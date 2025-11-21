from django.test import TestCase
from rest_framework.test import APIClient
from .models import Event


class MonitorEventAPITestCase(TestCase):
    """Basic tests for the monitor event API"""
    
    def setUp(self):
        self.client = APIClient()
        self.save_event_url = '/monitor/save-event/'
    
    def test_save_event_success(self):
        """Test saving a gesture event"""
        data = {
            'type': 'STUDENT_CLAPPED',
            'username': 'TestUser',
            'session_id': 'test-session-123',
            'data': {'clap_count': 2}
        }
        response = self.client.post(self.save_event_url, data, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['success'])
        self.assertEqual(Event.objects.count(), 1)
    
    def test_save_event_missing_type(self):
        """Test that missing type field is rejected"""
        data = {
            'username': 'TestUser'
        }
        response = self.client.post(self.save_event_url, data, format='json')
        self.assertEqual(response.status_code, 400)
