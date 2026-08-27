from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import (
    REFERENCE_DRAFT_METADATA_FILENAME,
    REFERENCE_KEYFRAME_FILENAMES,
    REFERENCE_KEYFRAMES_SUBDIR,
    REFERENCE_METADATA_FILENAME,
    REFERENCE_STRATEGY,
    REFERENCE_VIDEO_FILENAME,
)
from app.main import app
from app.reference.errors import DuplicateTechniqueError
from app.reference.store import assert_slug_available, confirm_draft, list_recorded_techniques, write_json
from tests.reference_helpers import plant_draft


client = TestClient(app)


@pytest.fixture
def isolated_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    refs = tmp_path / "reference-techniques"
    drafts = tmp_path / "drafts"
    refs.mkdir()
    drafts.mkdir()
    monkeypatch.setattr("app.config.REFERENCE_TECHNIQUES_DIR", refs)
    monkeypatch.setattr("app.config.REFERENCE_DRAFTS_DIR", drafts)
    return refs, drafts


def test_list_recorded_techniques_empty(isolated_dirs: tuple[Path, Path]) -> None:
    refs, _drafts = isolated_dirs
    assert list_recorded_techniques() == []
    response = client.get("/api/reference-techniques")
    assert response.status_code == 200
    assert response.json() == []
    assert refs.exists()


def test_list_skips_staging_and_invalid_dirs(isolated_dirs: tuple[Path, Path]) -> None:
    refs, _drafts = isolated_dirs
    (refs / ".staging-abc").mkdir()
    broken = refs / "broken"
    broken.mkdir()
    (broken / "notes.txt").write_text("no metadata", encoding="utf-8")
    assert list_recorded_techniques() == []


def test_confirm_creates_permanent_folder(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    draft_id = "11111111-1111-1111-1111-111111111111"
    plant_draft(drafts, draft_id, "rear-roundhouse-kick", "Rear Roundhouse Kick")

    summary = confirm_draft(draft_id)
    dest = refs / "rear-roundhouse-kick"
    assert dest.is_dir()
    assert (dest / REFERENCE_VIDEO_FILENAME).is_file()
    assert (dest / REFERENCE_METADATA_FILENAME).is_file()
    for filename in REFERENCE_KEYFRAME_FILENAMES.values():
        assert (dest / REFERENCE_KEYFRAMES_SUBDIR / filename).is_file()
    assert not (drafts / draft_id).exists()
    assert not any(refs.glob(".staging-*"))

    metadata = json.loads((dest / REFERENCE_METADATA_FILENAME).read_text(encoding="utf-8"))
    assert metadata["id"] == "rear-roundhouse-kick"
    assert metadata["name"] == "Rear Roundhouse Kick"
    assert metadata["referenceVideo"] == "reference.mp4"
    assert metadata["referenceStrategy"] == REFERENCE_STRATEGY
    assert ":" not in metadata["referenceVideo"]
    assert not metadata["referenceVideo"].startswith("/")
    assert len(metadata["keyframes"]) == 5
    assert metadata["recordingDurationSeconds"] == 3
    assert summary.id == "rear-roundhouse-kick"
    assert summary.recordingDurationSeconds == 3

    listed = list_recorded_techniques()
    assert [item.id for item in listed] == ["rear-roundhouse-kick"]


def test_confirm_api_then_list(isolated_dirs: tuple[Path, Path]) -> None:
    _refs, drafts = isolated_dirs
    draft_id = "22222222-2222-2222-2222-222222222222"
    plant_draft(drafts, draft_id, "cross", "Cross")
    response = client.post(f"/api/reference-techniques/drafts/{draft_id}/confirm")
    assert response.status_code == 200
    body = response.json()
    assert body["technique"]["id"] == "cross"
    listed = client.get("/api/reference-techniques")
    assert listed.status_code == 200
    assert listed.json()[0]["name"] == "Cross"
    assert listed.json()[0]["recordingDurationSeconds"] == 3


def test_duplicate_slug_is_rejected_on_confirm(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    first = "33333333-3333-3333-3333-333333333333"
    second = "44444444-4444-4444-4444-444444444444"
    plant_draft(drafts, first, "cross", "Cross")
    confirm_draft(first)
    plant_draft(drafts, second, "cross", "Cross")
    with pytest.raises(DuplicateTechniqueError):
        confirm_draft(second)
    response = client.post(f"/api/reference-techniques/drafts/{second}/confirm")
    assert response.status_code == 409
    assert (refs / "cross").is_dir()


def test_duplicate_name_rejected_before_processing(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    draft_id = "55555555-5555-5555-5555-555555555555"
    plant_draft(drafts, draft_id, "cross", "Cross")
    confirm_draft(draft_id)
    response = client.post(
        "/api/reference-techniques/drafts",
        data={"name": "Cross", "description": "again"},
        files={"video": ("reference.mp4", b"not-a-video", "video/mp4")},
    )
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_builtin_ids_cannot_be_overwritten(isolated_dirs: tuple[Path, Path]) -> None:
    with pytest.raises(DuplicateTechniqueError):
        assert_slug_available("simple_jab")
    with pytest.raises(DuplicateTechniqueError):
        assert_slug_available("mmakick")
    response = client.post(
        "/api/reference-techniques/drafts",
        data={"name": "Simple Jab"},
        files={"video": ("reference.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 409
    assert "reserved" in response.json()["detail"].lower()


def test_invalid_name_rejected(isolated_dirs: tuple[Path, Path]) -> None:
    response = client.post(
        "/api/reference-techniques/drafts",
        data={"name": "   "},
        files={"video": ("reference.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 400


def test_invalid_draft_cannot_be_confirmed(isolated_dirs: tuple[Path, Path]) -> None:
    _refs, drafts = isolated_dirs
    draft_id = "66666666-6666-6666-6666-666666666666"
    folder = plant_draft(drafts, draft_id, "hook", "Hook")
    payload = json.loads((folder / REFERENCE_DRAFT_METADATA_FILENAME).read_text(encoding="utf-8"))
    payload["analysisValid"] = False
    write_json(folder / REFERENCE_DRAFT_METADATA_FILENAME, payload)
    response = client.post(f"/api/reference-techniques/drafts/{draft_id}/confirm")
    assert response.status_code == 400
    assert not (isolated_dirs[0] / "hook").exists()


def test_path_traversal_media_routes_are_404(isolated_dirs: tuple[Path, Path]) -> None:
    assert client.get("/api/reference-techniques/../config/video").status_code == 404
    assert client.get("/api/reference-techniques/%2e%2e/%2e%2e/etc/passwd/video").status_code == 404
    assert (
        client.get(
            "/api/reference-techniques/drafts/11111111-1111-1111-1111-111111111111/keyframes/../draft.json"
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/api/reference-techniques/not-a-uuid/keyframes/01-start.jpg"
        ).status_code
        == 404
    )


def test_garbage_reference_video_is_measurement_failure(isolated_dirs: tuple[Path, Path]) -> None:
    response = client.post(
        "/api/reference-techniques/drafts",
        data={"name": "Garbage Kick"},
        files={"video": ("reference.mp4", b"this is not a video", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysisValid"] is False
    assert body["failureReason"] == "invalid_video"
    assert body["slug"] == "garbage-kick"


def test_permanent_media_404_for_unknown_slug(isolated_dirs: tuple[Path, Path]) -> None:
    assert client.get("/api/reference-techniques/missing-kick/video").status_code == 404
    assert client.get("/api/reference-techniques/missing-kick/keyframes/01-start.jpg").status_code == 404


def test_confirm_uses_chosen_recording_duration(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    draft_id = "77777777-7777-7777-7777-777777777777"
    folder = plant_draft(drafts, draft_id, "teep", "Teep")
    payload = json.loads((folder / REFERENCE_DRAFT_METADATA_FILENAME).read_text(encoding="utf-8"))
    payload["recordingDurationSeconds"] = 8
    write_json(folder / REFERENCE_DRAFT_METADATA_FILENAME, payload)

    summary = confirm_draft(draft_id)
    metadata = json.loads((refs / "teep" / REFERENCE_METADATA_FILENAME).read_text(encoding="utf-8"))
    assert summary.recordingDurationSeconds == 8
    assert metadata["recordingDurationSeconds"] == 8


def test_confirm_prefers_reference_video_duration(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    draft_id = "88888888-8888-8888-8888-888888888888"
    folder = plant_draft(drafts, draft_id, "elbow", "Elbow")
    payload = json.loads((folder / REFERENCE_DRAFT_METADATA_FILENAME).read_text(encoding="utf-8"))
    payload["recordingDurationSeconds"] = 5
    payload["video"] = {"durationMs": 7200}
    write_json(folder / REFERENCE_DRAFT_METADATA_FILENAME, payload)

    summary = confirm_draft(draft_id)
    metadata = json.loads((refs / "elbow" / REFERENCE_METADATA_FILENAME).read_text(encoding="utf-8"))
    assert summary.recordingDurationSeconds == 7
    assert metadata["recordingDurationSeconds"] == 7


def test_invalid_recording_duration_is_rejected(isolated_dirs: tuple[Path, Path]) -> None:
    response = client.post(
        "/api/reference-techniques/drafts",
        data={"name": "Long Kick", "recordingDurationSeconds": 99},
        files={"video": ("reference.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 400
    assert "recordingDurationSeconds" in response.json()["detail"]


def test_confirm_falls_back_when_directory_rename_is_denied(
    isolated_dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    refs, drafts = isolated_dirs
    draft_id = "99999999-9999-9999-9999-999999999999"
    plant_draft(drafts, draft_id, "front-kick", "Front Kick")

    def deny_rename(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        raise PermissionError(13, "Access is denied", str(src))

    monkeypatch.setattr(os, "rename", deny_rename)

    summary = confirm_draft(draft_id)
    dest = refs / "front-kick"
    assert summary.id == "front-kick"
    assert dest.is_dir()
    assert (dest / REFERENCE_METADATA_FILENAME).is_file()
    assert (dest / REFERENCE_VIDEO_FILENAME).is_file()
    assert not (drafts / draft_id).exists()
    assert not any(refs.glob(".staging-*"))


def test_confirm_replaces_incomplete_destination(
    isolated_dirs: tuple[Path, Path],
) -> None:
    refs, drafts = isolated_dirs
    leftover = refs / "hook"
    leftover.mkdir()
    (leftover / "orphan.txt").write_text("incomplete", encoding="utf-8")
    draft_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    plant_draft(drafts, draft_id, "hook", "Hook")

    summary = confirm_draft(draft_id)
    assert summary.id == "hook"
    assert (refs / "hook" / REFERENCE_METADATA_FILENAME).is_file()
    assert not (refs / "hook" / "orphan.txt").exists()


def test_delete_recorded_technique_removes_directory(isolated_dirs: tuple[Path, Path]) -> None:
    from app.reference.store import delete_recorded_technique

    refs, drafts = isolated_dirs
    plant_draft(drafts, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "combo-wombo", "Combo Wombo")
    confirm_draft("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    dest = refs / "combo-wombo"
    assert dest.is_dir()
    delete_recorded_technique("combo-wombo")
    assert not dest.exists()
    assert client.get("/api/reference-techniques").json() == []


def test_delete_recorded_technique_http(isolated_dirs: tuple[Path, Path]) -> None:
    refs, drafts = isolated_dirs
    plant_draft(drafts, "cccccccc-cccc-cccc-cccc-cccccccccccc", "teep", "Teep")
    confirm_draft("cccccccc-cccc-cccc-cccc-cccccccccccc")
    response = client.delete("/api/reference-techniques/teep")
    assert response.status_code == 200
    assert response.json()["status"] == "deleted"
    assert not (refs / "teep").exists()


def test_builtin_deletion_is_rejected(isolated_dirs: tuple[Path, Path]) -> None:
    response = client.delete("/api/reference-techniques/simple_jab")
    assert response.status_code in {403, 404}
    if response.status_code == 403:
        assert "built-in" in response.json()["detail"].lower()


def test_missing_technique_delete_is_404(isolated_dirs: tuple[Path, Path]) -> None:
    assert client.delete("/api/reference-techniques/no-such-kick").status_code == 404


def test_path_traversal_delete_is_404(isolated_dirs: tuple[Path, Path]) -> None:
    refs, _drafts = isolated_dirs
    secret = refs.parent / "secret.txt"
    secret.write_text("no", encoding="utf-8")
    assert client.delete("/api/reference-techniques/../secret").status_code == 404
    assert client.delete("/api/reference-techniques/..%2Fsecret").status_code == 404
    assert secret.is_file()
    assert refs.is_dir()


def test_delete_failure_does_not_report_success(
    isolated_dirs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refs, drafts = isolated_dirs
    plant_draft(drafts, "dddddddd-dddd-dddd-dddd-dddddddddddd", "hook", "Hook")
    confirm_draft("dddddddd-dddd-dddd-dddd-dddddddddddd")

    def fake_remove(_path):
        return None

    monkeypatch.setattr("app.reference.store._remove_tree", fake_remove)
    response = client.delete("/api/reference-techniques/hook")
    assert response.status_code == 500
    assert (refs / "hook").is_dir()
    assert (refs / "hook" / REFERENCE_METADATA_FILENAME).is_file()
