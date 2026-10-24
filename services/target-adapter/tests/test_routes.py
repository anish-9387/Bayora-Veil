import unittest
from fastapi.testclient import TestClient
from src.main import app


class RoutesTest(unittest.TestCase):
    def test_root_opens_api_docs(self):
        with TestClient(app) as client:
            response = client.get("/", follow_redirects=False)
            self.assertEqual(response.status_code, 307)
            self.assertEqual(response.headers["location"], "/docs")
            self.assertEqual(client.get("/").status_code, 200)
            self.assertEqual(client.get("/favicon.ico").status_code, 204)
            self.assertEqual(client.get("/health").json()["status"], "healthy")
