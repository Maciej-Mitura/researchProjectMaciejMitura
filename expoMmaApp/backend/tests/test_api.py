from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:8081"})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers.get("access-control-allow-origin") == "*"


def test_mmakick_is_not_implemented() -> None:
    response = client.post(
        "/api/analyze-attempt",
        data={"techniqueId": "mmakick"},
        files={"video": ("attempt.mp4", b"not-a-real-video", "video/mp4")},
    )
    assert response.status_code == 422
    assert "mmakick" in response.json()["detail"]
    assert "simple_jab" in response.json()["detail"]


def test_unknown_technique_rejected() -> None:
    response = client.post(
        "/api/analyze-attempt",
        data={"techniqueId": "spinning_backfist"},
        files={"video": ("attempt.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 422


def test_empty_video_rejected() -> None:
    response = client.post(
        "/api/analyze-attempt",
        data={"techniqueId": "simple_jab"},
        files={"video": ("attempt.mp4", b"", "video/mp4")},
    )
    assert response.status_code == 400


def test_wrong_extension_rejected() -> None:
    response = client.post(
        "/api/analyze-attempt",
        data={"techniqueId": "simple_jab"},
        files={"video": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_invalid_video_bytes_return_analysis_failure() -> None:
    response = client.post(
        "/api/analyze-attempt",
        data={"techniqueId": "simple_jab"},
        files={"video": ("attempt.mp4", b"this is not a video", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysisValid"] is False
    assert body["failureReason"] == "invalid_video"
    assert body["techniqueId"] == "simple_jab"
