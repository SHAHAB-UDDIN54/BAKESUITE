"""
Unit tests for BakeSuite ML Microservice initialization and health check
"""
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "bakesuite-ml-service"
    assert data["status"] == "online"

def test_health_check_endpoint():
    response = client.get("/ml/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("healthy", "degraded")
    assert data["service"] == "bakesuite-ml-service"
    assert data["timezone"] == "Asia/Karachi"
    assert "timestamp_karachi" in data
    assert data["database"]["connected"] is True
    assert data["database"]["target_schema"] == "ml"
