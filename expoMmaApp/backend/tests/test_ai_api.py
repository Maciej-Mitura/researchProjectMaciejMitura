"""HTTP tests for Detailed AI Analysis. No real OpenAI calls."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.errors import GeminiQuotaError
from app.ai.models import (
    AssessmentCriterionId,
    CriterionAssessment,
    DetailedAssessmentResponse,
    MainCorrection,
)
from app.main import app
from app.models.comparison import ComparisonTechnique
from app.reference.store import confirm_draft
from tests.reference_helpers import plant_draft

client = TestClient(app)


@pytest.fixture
def isolated_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path, Path]:
    refs = tmp_path / "reference-techniques"
    drafts = tmp_path / "drafts"
    attempts = tmp_path / "ai-attempts"
    comparison = tmp_path / "comparison-attempts"
    comparisons = tmp_path / "comparisons"
    refs.mkdir()
    drafts.mkdir()
    attempts.mkdir()
    comparison.mkdir()
    comparisons.mkdir()
    monkeypatch.setattr("app.config.REFERENCE_TECHNIQUES_DIR", refs)
    monkeypatch.setattr("app.config.REFERENCE_DRAFTS_DIR", drafts)
    monkeypatch.setattr("app.config.AI_ATTEMPTS_DIR", attempts)
    monkeypatch.setattr("app.config.COMPARISON_ATTEMPTS_DIR", comparison)
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)
    return refs, drafts, attempts


def _valid_response(analysis_id: str) -> DetailedAssessmentResponse:
    return DetailedAssessmentResponse(
        analysisId=analysis_id,
        technique=ComparisonTechnique(
            id="cross",
            slug="cross",
            name="Cross",
            description="A clean reference.",
        ),
        analysisValid=True,
        comparisonValid=True,
        confidence=0.9,
        overallScore=92,
        criteria=[
            CriterionAssessment(criterion=item, score=score, observation="ok")
            for item, score in zip(
                (
                    AssessmentCriterionId.MOVEMENT_PATH,
                    AssessmentCriterionId.RANGE_OF_MOTION,
                    AssessmentCriterionId.BODY_POSITIONING,
                    AssessmentCriterionId.SEQUENCING_AND_TIMING,
                    AssessmentCriterionId.BALANCE_AND_CONTROL,
                    AssessmentCriterionId.RECOVERY_OR_COMPLETION,
                ),
                (4, 4, 3, 4, 3, 4),
                strict=True,
            )
        ],
        strengths=["Guard stays high."],
        mainCorrections=[
            MainCorrection(
                title="Rotate the hip",
                explanation="USER rotation is smaller than REFERENCE.",
                relevantCriterion=AssessmentCriterionId.BODY_POSITIONING,
            )
        ],
        summary="Close, with a noticeable body-positioning gap.",
        comparisonVideoUrl=f"/api/comparisons/{analysis_id}/comparison.mp4",
    )


def test_missing_api_key_returns_clean_error(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _refs, drafts, _attempts = isolated_dirs
    plant_draft(drafts, "11111111-1111-1111-1111-111111111111", "cross", "Cross")
    confirm_draft("11111111-1111-1111-1111-111111111111")
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: None)

    response = client.post(
        "/api/reference-techniques/cross/ai-analysis",
        files={"video": ("attempt.mp4", b"not-a-real-video", "video/mp4")},
    )
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert "Quick Comparison still works" in detail
    assert "sk-" not in detail.lower()
    assert "traceback" not in detail.lower()


def test_ai_analysis_success_and_temp_cleanup(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refs, drafts, attempts = isolated_dirs
    plant_draft(drafts, "22222222-2222-2222-2222-222222222222", "cross", "Cross")
    confirm_draft("22222222-2222-2222-2222-222222222222")
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: "test-key-not-real")

    def fake_run(user_video: Path, *, analysis_id: str, output_dir: Path, metadata, provider=None, model_path=None):
        assert user_video.is_file()
        assert user_video.name == "attempt.mp4"
        assert metadata.slug == "cross"
        assert (refs / "cross" / "reference.mp4").is_file()
        return _valid_response(analysis_id)

    monkeypatch.setattr("app.api.ai.run_detailed_analysis", fake_run)

    response = client.post(
        "/api/reference-techniques/cross/ai-analysis",
        files={"video": ("attempt.mp4", b"fake-mp4-bytes", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysisValid"] is True
    assert body["comparisonValid"] is True
    assert body["overallScore"] == 92
    assert body["overallMax"] == 100
    assert [item["criterion"] for item in body["criteria"]] == [
        "movementPath",
        "rangeOfMotion",
        "bodyPositioning",
        "sequencingAndTiming",
        "balanceAndControl",
        "recoveryOrCompletion",
    ]
    assert list(attempts.iterdir()) == []
    assert "cross" in {path.name for path in refs.iterdir()}


def test_gemini_failure_cleans_temp_and_hides_internals(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _refs, drafts, attempts = isolated_dirs
    plant_draft(drafts, "33333333-3333-3333-3333-333333333333", "hook", "Hook")
    confirm_draft("33333333-3333-3333-3333-333333333333")
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: "test-key-not-real")

    def boom(*_args, **_kwargs):
        raise GeminiQuotaError()

    monkeypatch.setattr("app.api.ai.run_detailed_analysis", boom)

    response = client.post(
        "/api/reference-techniques/hook/ai-analysis",
        files={"video": ("attempt.mp4", b"fake-mp4-bytes", "video/mp4")},
    )
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert "billing limits" in detail.lower() or "usage" in detail.lower()
    assert "GeminiQuotaError" not in detail
    assert list(attempts.iterdir()) == []


def test_missing_reference_is_404(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: "test-key-not-real")
    response = client.post(
        "/api/reference-techniques/missing-kick/ai-analysis",
        files={"video": ("attempt.mp4", b"abc", "video/mp4")},
    )
    assert response.status_code == 404


def test_quick_comparison_does_not_invoke_ai(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.comparison.pipeline import analyze_generic_attempt as real_analyze
    from app.models.pose import VideoInfo
    from app.reference.analyzer import GenericMotionAnalysis
    from app.reference.keyframes import GENERIC_PHASES
    from app.reference.models import ActiveWindowResult, ReferenceKeyframePick
    from app.config import REFERENCE_KEYFRAME_FILENAMES

    _refs, drafts, _attempts = isolated_dirs
    plant_draft(drafts, "44444444-4444-4444-4444-444444444444", "teep", "Teep", start_ms=400, end_ms=2000)
    confirm_draft("44444444-4444-4444-4444-444444444444")

    called = {"ai": False}

    def forbidden(*_args, **_kwargs):
        called["ai"] = True
        raise AssertionError("Quick Comparison must not call Detailed AI Analysis.")

    monkeypatch.setattr("app.api.ai.run_detailed_analysis", forbidden)

    picks = []
    for index, phase in enumerate(GENERIC_PHASES):
        picks.append(
            ReferenceKeyframePick(
                phase=phase,
                frame_index=10 + index * 4,
                timestamp_ms=500 + index * 280,
                filename=REFERENCE_KEYFRAME_FILENAMES[phase.value],
            )
        )
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
        start_ms=500,
        end_ms=1900,
        start_frame_index=10,
        end_frame_index=40,
        raw_values=(),
        smoothed_values=(),
    )
    motion = GenericMotionAnalysis(
        valid=True,
        failure_reason=None,
        failure_message=None,
        video=video,
        pose_coverage=0.96,
        major_coverage=0.92,
        window=window,
        picks=tuple(picks),
        fps_fallback_used=False,
    )

    def fake_extract(_video_path, _fps, frames_to_save, output_dir):
        output_dir.mkdir(parents=True, exist_ok=True)
        saved = {}
        for _index, filename in frames_to_save:
            (output_dir / filename).write_bytes(b"jpeg")
            saved[filename] = filename
        return saved

    monkeypatch.setattr("app.comparison.pipeline.analyze_generic_motion", lambda *_a, **_k: motion)
    monkeypatch.setattr("app.comparison.pipeline.extract_named_frames", fake_extract)
    monkeypatch.setattr(
        "app.ai.providers.gemini_video.GeminiVideoProvider.assess_video",
        forbidden,
    )
    _ = real_analyze

    response = client.post(
        "/api/reference-techniques/teep/analyze-attempt",
        files={"video": ("attempt.mp4", b"fake-mp4-bytes", "video/mp4")},
    )
    assert response.status_code == 200
    assert response.json()["analysisValid"] is True
    assert "overallScore" not in response.json()
    assert called["ai"] is False
