import unittest
import numpy as np
from unittest.mock import MagicMock, patch
import sys
import os
import io

# Set up environment for importing the API
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 1. Deep Mocking to avoid all heavy dependencies
mock_face_rec = MagicMock()
sys.modules['face_recognition'] = mock_face_rec

mock_pil = MagicMock()
mock_image = MagicMock()
mock_pil.open.return_value = mock_image
mock_image.convert.return_value = mock_image
sys.modules['PIL'] = mock_pil
sys.modules['PIL.Image'] = mock_image

class TestBiometricExpertLogic(unittest.TestCase):

    def setUp(self):
        # Mock employees data (Explicit dictionaries)
        self.mock_employees = [
            {"employee_id": "EMP-001", "name": "Shiv Kumar", "face_embedding": [0.1] * 128},
            {"employee_id": "EMP-002", "name": "Ratnesh", "face_embedding": [0.2] * 128}
        ]

    def setup_supabase_mock(self, mock_supabase):
        # Exact chain: supabase.table().select().not_.is_().execute().data
        mock_supabase.table.return_value.select.return_value.not_.is_.return_value.execute.return_value.data = self.mock_employees

    @patch('face_recognition.face_distance')
    @patch('face_recognition.face_locations')
    @patch('face_recognition.face_encodings')
    @patch('biometric_api.load_face_cache')
    @patch('biometric_api.save_face_cache')
    def test_clean_match(self, mock_save, mock_load, mock_encodings, mock_locations, mock_distance):
        """Test a clear match where distance is well within threshold and gap is large."""
        from biometric_api import verify_face
        
        with patch('biometric_api.supabase') as mock_supabase:
            self.setup_supabase_mock(mock_supabase)
            mock_locations.return_value = [(0, 0, 10, 10)]
            mock_encodings.return_value = [np.array([0.1] * 128)]
            mock_distance.return_value = np.array([0.1, 0.4], dtype=float)
            
            import asyncio
            class MockFile:
                async def read(self): return b"dummy_image_data"
            
            result = asyncio.run(verify_face(MockFile()))
            
            self.assertTrue(result['success'])
            self.assertEqual(result['employee_id'], "EMP-001")
            print("LOG: [Clean Match] Success verified.")

    @patch('face_recognition.face_distance')
    @patch('face_recognition.face_locations')
    @patch('face_recognition.face_encodings')
    @patch('biometric_api.load_face_cache')
    @patch('biometric_api.save_face_cache')
    def test_ambiguous_match(self, mock_save, mock_load, mock_encodings, mock_locations, mock_distance):
        """Test rejection when two faces are too similar (Gap < 0.05)."""
        from biometric_api import verify_face
        
        with patch('biometric_api.supabase') as mock_supabase:
            self.setup_supabase_mock(mock_supabase)
            mock_locations.return_value = [(0, 0, 10, 10)]
            mock_encodings.return_value = [np.array([0.1] * 128)]
            mock_distance.return_value = np.array([0.38001, 0.40], dtype=float) # Gap slightly > 0.02
            
            import asyncio
            class MockFile:
                async def read(self): return b"dummy_image_data"
            
            result = asyncio.run(verify_face(MockFile()))
            
            self.assertFalse(result['success'])
            self.assertEqual(result['error_code'], "AMBIGUOUS_MATCH")
            self.assertEqual(result['id_hint'], "EMP-001")
            print("LOG: [Ambiguity Match] Correctly rejected with MFA request.")

    @patch('face_recognition.face_distance')
    @patch('face_recognition.face_locations')
    @patch('face_recognition.face_encodings')
    @patch('biometric_api.load_face_cache')
    @patch('biometric_api.save_face_cache')
    def test_threshold_rejection(self, mock_save, mock_load, mock_encodings, mock_locations, mock_distance):
        """Test rejection when best distance exceeds 0.40."""
        from biometric_api import verify_face
        
        with patch('biometric_api.supabase') as mock_supabase:
            self.setup_supabase_mock(mock_supabase)
            mock_locations.return_value = [(0, 0, 10, 10)]
            mock_encodings.return_value = [np.array([0.1] * 128)]
            mock_distance.return_value = np.array([0.42, 0.60], dtype=float)

            import asyncio
            class MockFile:
                async def read(self): return b"dummy_image_data"
            
            result = asyncio.run(verify_face(MockFile()))
            
            self.assertFalse(result['success'])
            self.assertEqual(result['error_code'], "NOT_RECOGNIZED")
            print("LOG: [Threshold Check] Correctly blocked unrecognized face.")

if __name__ == '__main__':
    unittest.main()
