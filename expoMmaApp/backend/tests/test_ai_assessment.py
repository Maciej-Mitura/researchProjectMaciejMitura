"""Unit tests for dense sampling, scoring, prompts, and AI helpers.

These tests never call the real OpenAI API.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest

from app.ai.assessment import finalize_assessment, finalize_video_assessment
from app.ai.client import _map_openai_error
from app.ai.errors import (
    GeminiAuthenticationError,
    GeminiNotConfiguredError,
    GeminiQuotaError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUnavailableError,
    MalformedAssessmentError,
    OpenAiAuthenticationError,
    OpenAiNotConfiguredError,
    OpenAiQuotaError,
    OpenAiRateLimitError,
    OpenAiTimeoutError,
    OpenAiUnavailableError,
)
from app.ai.frames import (
    TimestampedFrame,
    dense_frame_filename,
    dense_normalized_positions,
    pick_dense_frames,
)
from app.ai.images import prepare_analysis_bgr
from app.ai.models import (
    ASSESSMENT_CRITERIA,
    HOLISTIC_OVERALL_SIMILARITY_ID,
    AssessmentCriterionId,
    AssessmentPhase,
    CriterionAssessment,
    MainCorrection,
    ModelVideoAssessment,
    ModelVisualAssessment,
    PhaseAssessment,
)
from app.ai.prompt import INSTRUCTIONS, build_input_content, percent_label
from app.ai.providers.gemini_video import (
    _map_gemini_error,
    _sanitize_gemini_message,
    _strip_holistic_criteria,
)
from app.ai.scoring import overall_score_from_criteria, overall_score_from_phases, score_valid_assessment
from app.ai.store import discard_attempt, resolve_attempt_dir, sweep_stale_attempts
from app.ai.video_prompt import VIDEO_INSTRUCTIONS, video_user_prompt
from app.config import AI_IMAGE_MAX_DIMENSION, DENSE_FRAME_COUNT


def _phase(phase: AssessmentPhase, score: int) -> PhaseAssessment:
    return PhaseAssessment(phase=phase, score=score, observation=f"{phase.value} note")


def _assessment(
    *,
    valid: bool = True,
    scores: tuple[int, int, int, int, int] = (4, 3, 2, 3, 4),
) -> ModelVisualAssessment:
    phases = (
        AssessmentPhase.START,
        AssessmentPhase.EARLY,
        AssessmentPhase.MIDDLE,
        AssessmentPhase.LATE,
        AssessmentPhase.END,
    )
    return ModelVisualAssessment(
        comparisonValid=valid,
        invalidReason="" if valid else "Views are too different to compare.",
        confidence=0.86,
        phaseAssessments=[_phase(phase, score) for phase, score in zip(phases, scores, strict=True)],
        strengths=["Hands stay near the face."],
        mainCorrections=[
            MainCorrection(
                title="Raise the knee earlier",
                explanation="The USER knee lift starts later than the REFERENCE.",
                relevantPhase=AssessmentPhase.MIDDLE,
            )
        ],
        summary="Close overall, with a noticeable middle-phase difference.",
    )


def test_dense_positions_are_evenly_spaced() -> None:
    positions = dense_normalized_positions()
    assert len(positions) == DENSE_FRAME_COUNT
    assert positions[0] == 0.0
    assert positions[-1] == 1.0
    assert positions == (0.0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.64, 0.73, 0.82, 0.91, 1.0)


def test_dense_positions_are_programmatic() -> None:
    generated = tuple(round(i / 11, 2) for i in range(12))
    assert dense_normalized_positions(12) == generated


def test_pick_dense_frames_labels_source_and_order() -> None:
    frames = [
        TimestampedFrame(frame_index=10 + i, timestamp_ms=500 + i * 40) for i in range(24)
    ]
    picks = pick_dense_frames(frames, 500, 500 + 23 * 40, source="user")
    assert len(picks) == 12
    assert [pick.sequence_index for pick in picks] == list(range(1, 13))
    assert [pick.normalized_position for pick in picks] == list(dense_normalized_positions())
    assert [pick.source for pick in picks] == ["user"] * 12
    assert picks[0].timestamp_ms == 500
    assert picks[-1].timestamp_ms == 500 + 23 * 40
    assert [pick.frame_index for pick in picks] == sorted(pick.frame_index for pick in picks)
    assert picks[0].filename == "user-01.jpg"
    assert picks[-1].filename == "user-12.jpg"
    assert dense_frame_filename("reference", 3) == "reference-03.jpg"

    reference = pick_dense_frames(frames, 500, 500 + 23 * 40, source="reference")
    assert [pick.source for pick in reference] == ["reference"] * 12
    assert [pick.normalized_position for pick in reference] == [pick.normalized_position for pick in picks]


def test_pick_dense_frames_rejects_short_windows() -> None:
    frames = [TimestampedFrame(frame_index=i, timestamp_ms=i * 33) for i in range(8)]
    with pytest.raises(Exception, match="too short"):
        pick_dense_frames(frames, 0, 7 * 33, source="user")


def test_overall_score_is_deterministic() -> None:
    assert overall_score_from_phases((4, 3, 2, 3, 4)) == 80
    assert overall_score_from_phases((4, 4, 4, 4, 4)) == 100
    assert overall_score_from_phases((0, 0, 0, 0, 0)) == 0
    assert overall_score_from_phases((2, 2, 2, 2, 2)) == 50


def test_invalid_assessment_has_no_overall_score() -> None:
    assessment, overall = finalize_assessment(_assessment(valid=False, scores=(0, 0, 0, 0, 0)))
    assert assessment.comparisonValid is False
    assert overall is None


def test_valid_assessment_uses_backend_score() -> None:
    assessment, overall = finalize_assessment(_assessment(scores=(4, 3, 2, 3, 4)))
    assert overall == 80
    assert [item.phase.value for item in assessment.phaseAssessments] == [
        "START",
        "EARLY",
        "MIDDLE",
        "LATE",
        "END",
    ]
    assert score_valid_assessment(assessment) == 80


def test_malformed_phases_are_rejected() -> None:
    broken = _assessment()
    broken.phaseAssessments.pop()
    with pytest.raises(MalformedAssessmentError):
        finalize_assessment(broken)


def test_openai_error_mapping() -> None:
    class AuthenticationError(Exception):
        status_code = 401

    class RateLimitError(Exception):
        status_code = 429
        code = "rate_limit_exceeded"

    class QuotaError(Exception):
        status_code = 429
        code = "insufficient_quota"

    class APITimeoutError(Exception):
        pass

    class APIConnectionError(Exception):
        pass

    assert isinstance(_map_openai_error(AuthenticationError()), OpenAiAuthenticationError)
    assert isinstance(_map_openai_error(RateLimitError()), OpenAiRateLimitError)
    assert isinstance(_map_openai_error(QuotaError()), OpenAiQuotaError)
    assert isinstance(_map_openai_error(APITimeoutError()), OpenAiTimeoutError)
    assert isinstance(_map_openai_error(APIConnectionError()), OpenAiUnavailableError)


def test_missing_api_key_client_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("app.ai.client.openai_api_key", lambda: None)
    from app.ai.client import OpenAIAssessmentClient

    with pytest.raises(OpenAiNotConfiguredError):
        OpenAIAssessmentClient(api_key=None).assess(instructions="x", content=[])


def test_prepare_analysis_image_keeps_aspect_ratio() -> None:
    frame = np.zeros((1920, 1080, 3), dtype=np.uint8)
    prepared = prepare_analysis_bgr(frame)
    height, width = prepared.shape[:2]
    assert max(height, width) == AI_IMAGE_MAX_DIMENSION
    assert abs((height / width) - (1920 / 1080)) < 0.02


def test_small_images_are_not_upscaled() -> None:
    frame = np.zeros((400, 300, 3), dtype=np.uint8)
    prepared = prepare_analysis_bgr(frame)
    assert prepared.shape[:2] == (400, 300)


def test_prompt_orders_reference_then_user_pairs() -> None:
    from app.ai.frames import DenseFramePick

    positions = dense_normalized_positions()
    reference = [
        DenseFramePick(
            sequence_index=i + 1,
            normalized_position=positions[i],
            timestamp_ms=100 + i * 10,
            frame_index=i,
            source="reference",
            filename=f"reference-{i + 1:02d}.jpg",
        )
        for i in range(12)
    ]
    user = [
        DenseFramePick(
            sequence_index=i + 1,
            normalized_position=positions[i],
            timestamp_ms=200 + i * 8,
            frame_index=i,
            source="user",
            filename=f"user-{i + 1:02d}.jpg",
        )
        for i in range(12)
    ]
    jpeg = b"\xff\xd8fake"
    content = build_input_content(
        technique_name="Front Kick",
        description="Chamber then extend.",
        reference_picks=reference,
        user_picks=user,
        reference_jpegs={item.filename: jpeg for item in reference},
        user_jpegs={item.filename: jpeg for item in user},
    )
    texts = [part["text"] for part in content if part["type"] == "input_text"]
    images = [part for part in content if part["type"] == "input_image"]
    assert texts[0].startswith("Technique: Front Kick")
    assert "Chamber then extend." in texts[0]
    assert "REFERENCE 01 — 0%" in texts[1]
    assert "USER 01 — 0%" in texts[2]
    assert f"REFERENCE 12 — {percent_label(1.0)}" in texts[-2]
    assert f"USER 12 — {percent_label(1.0)}" in texts[-1]
    assert len(images) == 24
    assert "token" not in INSTRUCTIONS.lower()
    assert " objectively the correct" not in INSTRUCTIONS.lower() or "Do not judge whether the reference is objectively" in INSTRUCTIONS


def test_user_temp_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "ai-attempts"
    root.mkdir()
    monkeypatch.setattr("app.config.AI_ATTEMPTS_DIR", root)
    analysis_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    folder = resolve_attempt_dir(analysis_id)
    folder.mkdir()
    (folder / "attempt.mp4").write_bytes(b"video")
    (folder / "frames").mkdir()
    (folder / "frames" / "user-01.jpg").write_bytes(b"jpeg")
    discard_attempt(analysis_id)
    assert not folder.exists()


def test_stale_temp_sweep(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "ai-attempts"
    root.mkdir()
    monkeypatch.setattr("app.config.AI_ATTEMPTS_DIR", root)
    old_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    new_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    old_dir = root / old_id
    new_dir = root / new_id
    old_dir.mkdir()
    new_dir.mkdir()
    past = time.time() - 10_000
    (old_dir / "attempt.mp4").write_bytes(b"old")
    (new_dir / "attempt.mp4").write_bytes(b"new")
    os.utime(old_dir, (past, past))
    removed = sweep_stale_attempts(max_age_seconds=60)
    assert removed == 1
    assert not old_dir.exists()
    assert new_dir.exists()


def test_invalid_measurement_does_not_call_ai(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.ai.pipeline import run_detailed_analysis
    from app.ai.providers import ProviderCallResult
    from app.models.pose import VideoInfo
    from app.models.reference import MovementWindow, ReferenceKeyframeMeta, ReferenceTechniqueMetadata
    from app.reference.analyzer import GenericMotionAnalysis

    class BoomProvider:
        name = "boom"

        def assess_video(self, **_kwargs: object) -> ProviderCallResult:
            raise AssertionError("Gemini must not be called when measurement is invalid.")

    metadata = ReferenceTechniqueMetadata(
        id="cross",
        name="Cross",
        slug="cross",
        description=None,
        createdAt="2026-08-26T12:00:00Z",
        referenceVideo="reference.mp4",
        referenceStrategy="generic-motion-window-v1",
        movementWindow=MovementWindow(startMs=400, endMs=1600, durationMs=1200),
        poseCoverage=0.9,
        majorLandmarkCoverage=0.9,
        keyframes=[
            ReferenceKeyframeMeta(
                phase=phase,
                filename=f"keyframes/0{index}-x.jpg",
                timestampMs=400 + index * 100,
                frameIndex=index,
            )
            for index, phase in enumerate(("START", "EARLY", "MIDDLE", "LATE", "END"), start=1)
        ],
    )
    invalid = GenericMotionAnalysis(
        valid=False,
        failure_reason="invalid_video",
        failure_message="The recording could not be measured.",
        video=VideoInfo(
            fps=30.0,
            fps_fallback_used=False,
            frame_count=10,
            width=720,
            height=1280,
            duration_ms=300.0,
        ),
        pose_coverage=0.0,
        major_coverage=0.0,
        window=None,
        picks=None,
        fps_fallback_used=False,
    )
    monkeypatch.setattr("app.ai.pipeline.analyze_generic_motion", lambda *_a, **_k: invalid)
    result = run_detailed_analysis(
        tmp_path / "attempt.mp4",
        analysis_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        output_dir=tmp_path,
        metadata=metadata,
        provider=BoomProvider(),
    )
    assert result.analysisValid is False
    assert result.overallScore is None
    assert result.comparisonValid is None


def test_openai_model_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.6-terra")
    from app.config import openai_model

    assert openai_model() == "gpt-5.6-terra"


def test_comparison_pipeline_source_does_not_call_ai() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    pipeline = (backend_root / "app/comparison/pipeline.py").read_text(encoding="utf-8")
    reference_routes = (backend_root / "app/api/reference.py").read_text(encoding="utf-8")
    package = (backend_root / "app/video/package.py").read_text(encoding="utf-8")
    assert "app.ai" not in pipeline
    assert "from openai" not in pipeline
    assert "import openai" not in pipeline
    assert "google.genai" not in pipeline
    assert "app.ai" not in reference_routes
    assert "from openai" not in reference_routes
    assert "import openai" not in reference_routes
    assert "google.genai" not in reference_routes
    assert "google.genai" not in package
    assert "from openai" not in package
    assert "import openai" not in package
    similarity_root = backend_root / "app/similarity"
    for path in similarity_root.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "google.genai" not in text
        assert "from openai" not in text
        assert "import openai" not in text
        assert "app.ai" not in text


def _criterion(criterion: AssessmentCriterionId, score: int | None, *, not_applicable: bool = False) -> CriterionAssessment:
    return CriterionAssessment(
        criterion=criterion,
        score=score,
        notApplicable=not_applicable,
        observation="ok" if not not_applicable else "not visible",
    )


def _video_assessment(
    *,
    valid: bool = True,
    scores: dict[AssessmentCriterionId, int | None] | None = None,
    not_applicable: set[AssessmentCriterionId] | None = None,
) -> ModelVideoAssessment:
    skipped = not_applicable or set()
    values = scores or {item: 4 for item in ASSESSMENT_CRITERIA}
    return ModelVideoAssessment(
        comparisonValid=valid,
        invalidReason="" if valid else "Views are too different to compare.",
        confidence=0.9,
        criteria=[
            _criterion(item, None if item in skipped else values.get(item, 4), not_applicable=item in skipped)
            for item in ASSESSMENT_CRITERIA
        ],
        strengths=["Path matches the reference."],
        mainCorrections=[],
        summary="Close overall.",
    )


def test_na_criteria_do_not_reduce_overall() -> None:
    all_fours = _video_assessment()
    _, full = finalize_video_assessment(all_fours)
    skipped = _video_assessment(not_applicable={AssessmentCriterionId.RECOVERY_OR_COMPLETION})
    _, reduced = finalize_video_assessment(skipped)
    assert full == 100
    assert reduced == 100
    assert overall_score_from_criteria(skipped.criteria) == 100


def test_six_applicable_fours_score_100() -> None:
    assessment, overall = finalize_video_assessment(_video_assessment())
    assert overall == 100
    assert [item.criterion for item in assessment.criteria] == list(ASSESSMENT_CRITERIA)


def test_six_applicable_threes_score_75() -> None:
    assessment = _video_assessment(scores={item: 3 for item in ASSESSMENT_CRITERIA})
    _, overall = finalize_video_assessment(assessment)
    assert overall == 75


def test_high_criterion_grades_calculate_high_overall() -> None:
    assessment = _video_assessment(
        scores={
            AssessmentCriterionId.MOVEMENT_PATH: 4,
            AssessmentCriterionId.RANGE_OF_MOTION: 4,
            AssessmentCriterionId.BODY_POSITIONING: 3,
            AssessmentCriterionId.SEQUENCING_AND_TIMING: 4,
            AssessmentCriterionId.BALANCE_AND_CONTROL: 3,
            AssessmentCriterionId.RECOVERY_OR_COMPLETION: 4,
        }
    )
    normalized, overall = finalize_video_assessment(assessment)
    assert overall == 92
    assert normalized.comparisonValid is True


def test_model_overall_similarity_is_not_aggregated() -> None:
    payload = {
        "comparisonValid": True,
        "invalidReason": "",
        "confidence": 0.9,
        "criteria": [
            {
                "criterion": item.value,
                "score": 4,
                "notApplicable": False,
                "observation": "ok",
            }
            for item in ASSESSMENT_CRITERIA
        ]
        + [
            {
                "criterion": HOLISTIC_OVERALL_SIMILARITY_ID,
                "score": 0,
                "notApplicable": False,
                "observation": "holistic",
            }
        ],
        "strengths": [],
        "mainCorrections": [],
        "summary": "Close overall.",
    }
    stripped = _strip_holistic_criteria(payload)
    assessment = ModelVideoAssessment.model_validate(stripped)
    _, overall = finalize_video_assessment(assessment)
    assert overall == 100
    assert HOLISTIC_OVERALL_SIMILARITY_ID not in {item.criterion.value for item in assessment.criteria}
    assert HOLISTIC_OVERALL_SIMILARITY_ID not in {item.value for item in ASSESSMENT_CRITERIA}
    required = VIDEO_INSTRUCTIONS.rsplit("You must return every criterion:", 1)[1]
    assert HOLISTIC_OVERALL_SIMILARITY_ID not in required


def test_invalid_video_comparison_produces_no_score() -> None:
    assessment, overall = finalize_video_assessment(_video_assessment(valid=False))
    assert assessment.comparisonValid is False
    assert overall is None


def test_gemini_error_mapping() -> None:
    class AuthError(Exception):
        status_code = 401

    class TimeoutError(Exception):
        pass

    class QuotaError(Exception):
        def __str__(self) -> str:
            return "resource exhausted: quota"

    class RateError(Exception):
        status_code = 429

        def __str__(self) -> str:
            return "rate limit exceeded"

    assert isinstance(_map_gemini_error(AuthError()), GeminiAuthenticationError)
    assert isinstance(_map_gemini_error(TimeoutError()), GeminiTimeoutError)
    assert isinstance(_map_gemini_error(QuotaError()), GeminiQuotaError)
    assert isinstance(_map_gemini_error(RateError()), GeminiRateLimitError)
    assert isinstance(_map_gemini_error(RuntimeError("offline")), GeminiUnavailableError)


def test_gemini_error_diagnostics_are_sanitized(caplog: pytest.LogCaptureFixture) -> None:
    class ClientError(Exception):
        status_code = 403
        code = 403
        status = "PERMISSION_DENIED"

        def __str__(self) -> str:
            return (
                "403 PERMISSION_DENIED. API_KEY=secret-value "
                "AIzaSyDummyTestKeyValue123 C:\\Users\\mimac\\hidden\\clip.mp4"
            )

    with caplog.at_level("WARNING"):
        mapped = _map_gemini_error(ClientError(), stage="inline_generate")
    assert isinstance(mapped, GeminiAuthenticationError)
    joined = " ".join(caplog.messages)
    assert "stage=inline_generate" in joined
    assert "http_status=403" in joined
    assert "PERMISSION_DENIED" in joined
    assert "secret-value" not in joined
    assert "AIzaSyDummyTestKeyValue123" not in joined
    assert "hidden\\clip.mp4" not in joined
    cleaned = _sanitize_gemini_message(str(ClientError()))
    assert "***" in cleaned or "API_KEY=***" in cleaned
    assert "AIzaSyDummyTestKeyValue123" not in cleaned
    assert "<path>" in cleaned


def test_missing_gemini_key_provider_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("app.ai.providers.gemini_video.gemini_api_key", lambda: None)
    from app.ai.providers.gemini_video import GeminiVideoProvider

    with pytest.raises(GeminiNotConfiguredError):
        GeminiVideoProvider(api_key=None).assess_video(
            video_path=Path("missing.mp4"),
            technique_name="Teep",
            description=None,
        )


def test_gemini_model_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.7-flash")
    from app.config import gemini_model

    assert gemini_model() == "gemini-3.7-flash"


def test_gemini_video_fps_default_is_eight(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_VIDEO_FPS", raising=False)
    from app.config import DEFAULT_GEMINI_VIDEO_FPS, gemini_video_fps

    assert DEFAULT_GEMINI_VIDEO_FPS == 8.0
    assert gemini_video_fps() == 8.0


def test_invalid_gemini_video_fps_is_handled_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import GEMINI_VIDEO_FPS_MAX, gemini_video_fps

    monkeypatch.setenv("GEMINI_VIDEO_FPS", "not-a-number")
    assert gemini_video_fps() == 8.0
    monkeypatch.setenv("GEMINI_VIDEO_FPS", "0")
    assert gemini_video_fps() == 8.0
    monkeypatch.setenv("GEMINI_VIDEO_FPS", "-1")
    assert gemini_video_fps() == 8.0
    monkeypatch.setenv("GEMINI_VIDEO_FPS", "nan")
    assert gemini_video_fps() == 8.0
    monkeypatch.setenv("GEMINI_VIDEO_FPS", "30")
    assert gemini_video_fps() == GEMINI_VIDEO_FPS_MAX
    monkeypatch.setenv("GEMINI_VIDEO_FPS", "12.5")
    assert gemini_video_fps() == 12.5


def test_original_durations_enter_prompt_context() -> None:
    prompt = video_user_prompt(
        technique_name="Front Kick",
        description="Chamber then extend.",
        reference_duration_ms=1240,
        user_duration_ms=1230,
    )
    assert "Technique: Front Kick" in prompt
    assert "Reference active movement: 1.24 seconds" in prompt
    assert "User active movement: 1.23 seconds" in prompt
    assert "Duration difference (user - reference): -0.01 seconds" in prompt
    assert "Duration ratio (user / reference): 0.99" in prompt
    assert "temporally normalized" in prompt
    assert "Do NOT infer original total execution speed" in prompt
    assert "relative sequencing" in VIDEO_INSTRUCTIONS
    assert "never be frame-perfect" in VIDEO_INSTRUCTIONS


def test_configured_fps_reaches_inline_and_files_api_requests(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.ai.providers.gemini_video import GeminiVideoProvider
    import google.genai as genai_mod

    monkeypatch.setenv("GEMINI_VIDEO_FPS", "8")
    assessment = _video_assessment()
    captured: dict[str, object] = {}

    class FakeModels:
        def generate_content(self, **kwargs: object) -> object:
            captured["kwargs"] = kwargs
            return SimpleNamespace(
                parsed=assessment,
                text=None,
                usage_metadata=None,
                model_version="test-model",
            )

    class FakeFiles:
        def upload(self, file: object) -> object:
            captured["uploaded"] = file
            return SimpleNamespace(
                name="files/test",
                uri="https://generativelanguage.googleapis.com/v1beta/files/test",
                mime_type="video/mp4",
                state=SimpleNamespace(name="ACTIVE"),
            )

        def get(self, name: str) -> object:
            return self.upload(None)

        def delete(self, name: str) -> None:
            captured["deleted"] = name

    class FakeClient:
        def __init__(self, **_kwargs: object) -> None:
            self.models = FakeModels()
            self.files = FakeFiles()

    monkeypatch.setattr(genai_mod, "Client", FakeClient)

    video = tmp_path / "ai-comparison.mp4"
    video.write_bytes(b"fake-mp4-bytes")

    inline_provider = GeminiVideoProvider(api_key="test-key-not-real", inline_max_bytes=1024)
    inline_result = inline_provider.assess_video(
        video_path=video,
        technique_name="Teep",
        description=None,
        reference_duration_ms=1240,
        user_duration_ms=1230,
    )
    inline_contents = captured["kwargs"]["contents"]  # type: ignore[index]
    inline_part = inline_contents[0]
    assert inline_part.video_metadata is not None
    assert inline_part.video_metadata.fps == 8.0
    assert inline_part.inline_data is not None
    assert inline_part.file_data is None
    assert "Reference active movement: 1.24 seconds" in inline_contents[1]
    assert "User active movement: 1.23 seconds" in inline_contents[1]
    assert inline_result.upload_method == "inline"

    files_provider = GeminiVideoProvider(api_key="test-key-not-real", inline_max_bytes=1)
    files_result = files_provider.assess_video(
        video_path=video,
        technique_name="Teep",
        description=None,
        reference_duration_ms=1240,
        user_duration_ms=1230,
    )
    files_contents = captured["kwargs"]["contents"]  # type: ignore[index]
    files_part = files_contents[0]
    assert files_part.video_metadata is not None
    assert files_part.video_metadata.fps == 8.0
    assert files_part.file_data is not None
    assert files_part.file_data.file_uri.endswith("files/test")
    assert files_part.inline_data is None
    assert files_result.upload_method == "files_api"
    assert captured.get("deleted") == "files/test"


def test_provider_abstraction_is_used_by_pipeline() -> None:
    source = Path(__file__).resolve().parents[1] / "app/ai/pipeline.py"
    text = source.read_text(encoding="utf-8")
    assert "VideoAssessmentProvider" in text
    assert "GeminiVideoProvider" in text
    assert "OpenAIAssessmentClient" not in text
    assert "responses.parse" not in text
