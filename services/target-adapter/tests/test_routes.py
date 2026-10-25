import unittest
import os
from unittest.mock import patch
import uuid
from fastapi.testclient import TestClient
from src.main import app
from src import main


class RoutesTest(unittest.TestCase):
    def test_root_opens_api_docs(self):
        with TestClient(app) as client:
            response = client.get("/", follow_redirects=False)
            self.assertEqual(response.status_code, 307)
            self.assertEqual(response.headers["location"], "/docs")
            self.assertEqual(client.get("/").status_code, 200)
            self.assertEqual(client.get("/favicon.ico").status_code, 204)
            self.assertEqual(client.get("/health").json()["status"], "healthy")

    def test_production_requires_a_service_credential(self):
        with patch.object(main, 'PRODUCTION', True), patch.dict(os.environ, {'TARGET_TOKEN': 'red-secret', 'TARGET_REPLAY_TOKEN': 'replay-secret'}), TestClient(app) as client:
            self.assertEqual(client.post('/execute', json={}).status_code, 401)
            self.assertEqual(client.get('/health').status_code, 200)

    def test_fresh_requests_and_strict_envelope(self):
        with TestClient(app) as client:
            body = {'run_id': str(uuid.uuid4()), 'case_id': 'case-001', 'prompt': 'prompt_injection synthetic marker'}
            first = client.post('/execute', json=body)
            self.assertEqual(first.status_code, 200)
            body['run_id'] = str(uuid.uuid4())
            second = client.post('/execute', json=body)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.json()['response'], second.json()['response'])
            self.assertNotEqual(first.json()['run_id'], second.json()['run_id'])
            body['context'] = {'previous_run': 'hidden'}
            self.assertEqual(client.post('/execute', json=body).status_code, 422)
