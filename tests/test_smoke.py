import unittest

from fastapi.testclient import TestClient

from main import app


class SmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_root_page_serves(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
