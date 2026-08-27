from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.comparison.pairing import NORMALIZED_POSITIONS, build_comparison_pairs
from app.config import REFERENCE_KEYFRAME_FILENAMES
from app.main import app
from app.models.pose import VideoInfo
from app.models.reference import ReferenceKeyframeMeta
from app.reference.analyzer import GenericMotionAnalysis, analyze_generic_motion
from app.reference.errors import IncompleteReferenceError
from app.reference.keyframes import GENERIC_PHASES
from app.reference.models import ActiveWindowResult, ReferenceKeyframePick
from app.reference.store import confirm_draft
from tests.reference_helpers import plant_draft

client = TestClient(app)

PHASE_ORDER = ("START", "EARLY", "MIDDLE", "LATE", "END")


@pytest.fixture
def isolated_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path, Path]:
    refs = tmp_path / "reference-techniques"
    drafts = tmp_path / "drafts"
    attempts = tmp_path / "comparison-attempts"
    comparisons = tmp_path / "comparisons"
    refs.mkdir()
    drafts.mkdir()
    attempts.mkdir()
    comparisons.mkdir()
    monkeypatch.setattr("app.config.REFERENCE_TECHNIQUES_DIR", refs)
    monkeypatch.setattr("app.config.REFERENCE_DRAFTS_DIR", drafts)
    monkeypatch.setattr("app.config.COMPARISON_ATTEMPTS_DIR", attempts)
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)
    return refs, drafts, attempts


def _user_picks(*, start_ms: int, step_ms: int) -> tuple[ReferenceKeyframePick, ...]:
    picks: list[ReferenceKeyframePick] = []
    for index, phase in enumerate(GENERIC_PHASES):
        picks.append(
            ReferenceKeyframePick(
                phase=phase,
                frame_index=10 + index * 4,
                timestamp_ms=start_ms + index * step_ms,
                filename=REFERENCE_KEYFRAME_FILENAMES[phase.value],
            )
        )
    return tuple(picks)


def _reference_keyframes(*, start_ms: int, step_ms: int) -> list[ReferenceKeyframeMeta]:
    items: list[ReferenceKeyframeMeta] = []
    for index, phase in enumerate(GENERIC_PHASES):
        filename = REFERENCE_KEYFRAME_FILENAMES[phase.value]
        items.append(
            ReferenceKeyframeMeta(
                phase=phase.value,
                filename=f"keyframes/{filename}",
                timestampMs=start_ms + index * step_ms,
                frameIndex=20 + index * 6,
            )
        )
    return items


def _valid_motion_result(
    picks: tuple[ReferenceKeyframePick, ...],
    *,
    start_ms: int,
    end_ms: int,
) -> GenericMotionAnalysis:
    video = VideoInfo(
        fps=30.0,
        fps_fallback_used=False,
        frame_count=90,
        width=720,
        height=1280,
        duration_ms=3000.0,
    )
    window = ActiveWindowResult(
        valid=True,
        failure_reason=None,
        failure_message=None,
        baseline=0.01,
        peak=0.2,
        motion_delta=0.19,
        start_ms=start_ms,
        end_ms=end_ms,
        start_frame_index=10,
        end_frame_index=40,
        raw_values=(),
        smoothed_values=(),
    )
    return GenericMotionAnalysis(
        valid=True,
        failure_reason=None,
        failure_message=None,
        video=video,
        pose_coverage=0.96,
        major_coverage=0.92,
        window=window,
        picks=picks,
        fps_fallback_used=False,
    )


def _fake_extract(
    _video_path: Path,
    _fps: float,
    frames_to_save: list[tuple[int, str]],
    output_dir: Path,
) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    saved: dict[str, str] = {}
    for _index, filename in frames_to_save:
        (output_dir / filename).write_bytes(b"jpeg")
        saved[filename] = filename
    return saved


def test_reference_and_user_analysis_share_the_same_generic_analyzer() -> None:
    from app.comparison import pipeline as comparison_pipeline
    from app.reference import pipeline as reference_pipeline

    assert reference_pipeline.analyze_generic_motion is analyze_generic_motion
    assert comparison_pipeline.analyze_generic_motion is analyze_generic_motion
    assert not hasattr(comparison_pipeline, "compute_body_motion")
    assert not hasattr(comparison_pipeline, "detect_active_window")
    assert not hasattr(comparison_pipeline, "pick_generic_keyframes")


def test_pairing_is_explicit_start_to_end() -> None:
    user = _user_picks(start_ms=500, step_ms=300)
    reference = _reference_keyframes(start_ms=800, step_ms=400)
    pairs = build_comparison_pairs(
        user,
        reference,
        analysis_id="11111111-1111-1111-1111-111111111111",
        slug="cross",
    )
    assert [pair.phase for pair in pairs] == list(PHASE_ORDER)
    for pair, phase in zip(pairs, GENERIC_PHASES, strict=True):
        assert pair.phase == phase.value
        assert pair.normalizedPosition == NORMALIZED_POSITIONS[phase]
        assert pair.user.keyframeUrl.endswith(REFERENCE_KEYFRAME_FILENAMES[phase.value])
        assert pair.reference.keyframeUrl.endswith(REFERENCE_KEYFRAME_FILENAMES[phase.value])
        assert f"/api/comparison-attempts/" in pair.user.keyframeUrl
        assert f"/api/reference-techniques/cross/keyframes/" in pair.reference.keyframeUrl


def test_pairing_allows_different_movement_durations() -> None:
    user = _user_picks(start_ms=500, step_ms=300)
    reference = _reference_keyframes(start_ms=800, step_ms=400)
    pairs = build_comparison_pairs(
        user,
        reference,
        analysis_id="11111111-1111-1111-1111-111111111111",
        slug="hook",
    )
    user_span = pairs[-1].user.timestampMs - pairs[0].user.timestampMs
    reference_span = pairs[-1].reference.timestampMs - pairs[0].reference.timestampMs
    assert user_span == 1200
    assert reference_span == 1600
    assert user_span != reference_span
    assert [pair.phase for pair in pairs] == list(PHASE_ORDER)


def test_pairing_rejects_missing_reference_phase() -> None:
    user = _user_picks(start_ms=100, step_ms=100)
    reference = _reference_keyframes(start_ms=200, step_ms=100)[:-1]
    with pytest.raises(IncompleteReferenceError):
        build_comparison_pairs(
            user,
            reference,
            analysis_id="11111111-1111-1111-1111-111111111111",
            slug="hook",
        )


def test_analyze_attempt_pairs_phases(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refs, drafts, attempts = isolated_dirs
    draft_id = "11111111-1111-1111-1111-111111111111"
    plant_draft(drafts, draft_id, "cross", "Cross", start_ms=400, end_ms=2000)
    confirm_draft(draft_id)

    user = _user_picks(start_ms=500, step_ms=280)

    def fake_motion(video_path, **_kwargs):
        if Path(video_path).name == "reference.mp4":
            return _valid_motion_result(user, start_ms=400, end_ms=2000)
        return _valid_motion_result(user, start_ms=500, end_ms=1900)

    monkeypatch.setattr("app.comparison.pipeline.analyze_generic_motion", fake_motion)
    monkeypatch.setattr("app.comparison.pipeline.extract_named_frames", _fake_extract)

    response = client.post(
        "/api/reference-techniques/cross/analyze-attempt",
        files={"video": ("attempt.mp4", b"not-a-real-video", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysisValid"] is True
    assert body["technique"]["slug"] == "cross"
    assert body["technique"]["name"] == "Cross"
    assert "score" not in body
    assert "overallScore" not in body
    assert body["movementSimilarity"]["similarityValid"] is False
    assert body["movementSimilarity"]["movementSimilarity"] is None
    assert body["poseOverlayAvailable"] is False
    assert body["poseCoverage"] == 0.96
    assert body["majorLandmarkCoverage"] == 0.92
    assert body["movementWindow"]["durationMs"] == 1400
    assert body["referenceMovementWindow"]["durationMs"] == 1600
    assert [pair["phase"] for pair in body["pairs"]] == list(PHASE_ORDER)
    for pair, expected in zip(body["pairs"], PHASE_ORDER, strict=True):
        assert pair["phase"] == expected
        assert pair["user"]["keyframeUrl"].endswith(REFERENCE_KEYFRAME_FILENAMES[expected])
        assert pair["reference"]["keyframeUrl"].endswith(REFERENCE_KEYFRAME_FILENAMES[expected])
        assert pair["user"]["timestampMs"] != pair["reference"]["timestampMs"]

    analysis_id = body["analysisId"]
    assert (attempts / analysis_id / "01-start.jpg").is_file()
    assert analysis_id not in {path.name for path in refs.iterdir()}
    assert not (refs / analysis_id).exists()


def test_invalid_attempt_is_not_a_score(
    isolated_dirs: tuple[Path, Path, Path],
) -> None:
    _refs, drafts, _attempts = isolated_dirs
    draft_id = "22222222-2222-2222-2222-222222222222"
    plant_draft(drafts, draft_id, "hook", "Hook")
    confirm_draft(draft_id)

    response = client.post(
        "/api/reference-techniques/hook/analyze-attempt",
        files={"video": ("attempt.mp4", b"this is not a video", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysisValid"] is False
    assert body["failureReason"] == "invalid_video"
    assert body["pairs"] is None
    assert "score" not in body
    assert "overallScore" not in body
    assert body["movementSimilarity"] is None
    assert body["poseOverlayAvailable"] is False


def test_missing_reference_is_404(isolated_dirs: tuple[Path, Path, Path]) -> None:
    response = client.post(
        "/api/reference-techniques/missing-kick/analyze-attempt",
        files={"video": ("attempt.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_unsafe_slug_is_404(isolated_dirs: tuple[Path, Path, Path]) -> None:
    response = client.post(
        "/api/reference-techniques/../config/analyze-attempt",
        files={"video": ("attempt.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 404


def test_incomplete_reference_is_controlled_failure(
    isolated_dirs: tuple[Path, Path, Path],
) -> None:
    refs, drafts, _attempts = isolated_dirs
    draft_id = "33333333-3333-3333-3333-333333333333"
    plant_draft(drafts, draft_id, "uppercut", "Uppercut")
    confirm_draft(draft_id)
    (refs / "uppercut" / "keyframes" / "03-middle.jpg").unlink()

    response = client.post(
        "/api/reference-techniques/uppercut/analyze-attempt",
        files={"video": ("attempt.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 422
    assert "incomplete" in response.json()["detail"].lower()


def test_comparison_keyframe_path_traversal_is_404(
    isolated_dirs: tuple[Path, Path, Path],
) -> None:
    assert client.get("/api/comparison-attempts/../config/keyframes/01-start.jpg").status_code == 404
    assert (
        client.get("/api/comparison-attempts/not-a-uuid/keyframes/01-start.jpg").status_code == 404
    )
    assert (
        client.get(
            "/api/comparison-attempts/11111111-1111-1111-1111-111111111111/keyframes/../secret.jpg"
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/api/comparison-attempts/11111111-1111-1111-1111-111111111111/keyframes/start.jpg"
        ).status_code
        == 404
    )


def test_comparison_attempts_do_not_write_the_reference_library(
    isolated_dirs: tuple[Path, Path, Path],
) -> None:
    refs, drafts, attempts = isolated_dirs
    draft_id = "44444444-4444-4444-4444-444444444444"
    plant_draft(drafts, draft_id, "teep", "Teep")
    confirm_draft(draft_id)
    before = {path.name for path in refs.iterdir()}

    client.post(
        "/api/reference-techniques/teep/analyze-attempt",
        files={"video": ("attempt.mp4", b"this is not a video", "video/mp4")},
    )
    after = {path.name for path in refs.iterdir()}
    assert before == after
    assert "teep" in after
    for child in attempts.iterdir():
        assert child.name not in before
