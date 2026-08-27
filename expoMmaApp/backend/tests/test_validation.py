"""Prototype validation records, self-comparison, export, and Gemini repeats.

Automated tests never call the real Gemini API.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.models import (
    ASSESSMENT_CRITERIA,
    CriterionAssessment,
    MainCorrection,
    ModelVideoAssessment,
)
from app.ai.providers import ProviderCallResult
from app.config import AI_COMPARISON_VIDEO_FILENAME
from app.models.comparison import ProcessingLatency
from app.pose.landmarks import PoseLandmarkIndex
from app.similarity.engine import compare_active_movements
from app.validation.context import AiComparisonContext, sha256_file, write_ai_context
from app.validation.gemini_repeat import run_gemini_repeatability
from app.validation.models import (
    SCENARIO_LABELS,
    ValidationRecord,
    ValidationRecordCreate,
    ValidationScenario,
    bound_repeat_count,
    record_to_export_dict,
)
from app.validation.repeat import compare_sequence_with_itself, deterministic_repeat_check
from app.validation.store import export_csv_text, export_json_payload, save_record, summarize_records
from app.video.highlight import highlight_is_active, resolve_highlight
from tests.reference_helpers import burst_offsets, standing_frames


@pytest.fixture
def isolated_validation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    runs = tmp_path / "validation-runs"
    runs.mkdir()
    monkeypatch.setattr("app.config.VALIDATION_RUNS_DIR", runs)
    monkeypatch.setattr("app.validation.store.config.VALIDATION_RUNS_DIR", runs)
    return runs


def test_validation_record_serialization_round_trip(isolated_validation: Path) -> None:
    created = save_record(
        ValidationRecordCreate(
            techniqueSlug="front-kick",
            techniqueName="Front Kick",
            scenarioType=ValidationScenario.CLEAN_REPRODUCTION,
            comparisonValid=True,
            poseCoverage=0.92,
            quickOverall=88,
            quickPose=90,
            quickPath=86,
            quickTiming=84,
            referenceMovementDurationMs=1240,
            userMovementDurationMs=1230,
            userMovementRegionCount=1,
            referenceMovementRegionCount=1,
            geminiOverall=83,
            geminiModel="gemini-3.7-flash",
            geminiFallbackUsed=False,
            geminiLatencyMs=4100,
            geminiAnalysisId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            totalAnalysisLatencyMs=9200,
            latency=ProcessingLatency(totalQuickMs=1800, totalDetailedMs=9200, geminiProviderMs=4100),
            notes="Attempt intended as clean reproduction.",
        )
    )
    assert created.id
    assert created.timestamp
    loaded = ValidationRecord.model_validate_json(
        (isolated_validation / f"{created.id}.json").read_text(encoding="utf-8")
    )
    assert loaded.quickOverall == 88
    assert loaded.geminiModel == "gemini-3.7-flash"
    assert loaded.notes == "Attempt intended as clean reproduction."
    assert loaded.latency is not None
    assert loaded.latency.geminiProviderMs == 4100


def test_self_comparison_creates_near_100_result() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    outcome = compare_sequence_with_itself(frames, start_ms=400, end_ms=2000)
    assert outcome.valid is True
    assert outcome.movement_similarity is not None
    assert outcome.pose_similarity is not None
    assert outcome.path_similarity is not None
    assert outcome.timing_similarity is not None
    assert outcome.movement_similarity >= 99
    assert outcome.pose_similarity >= 99
    assert outcome.path_similarity >= 99
    assert outcome.timing_similarity >= 99


def test_deterministic_repeat_check_is_identical() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    first, second, result = deterministic_repeat_check(
        reference_frames=frames,
        user_frames=frames,
        reference_start_ms=400,
        reference_end_ms=2000,
        user_start_ms=400,
        user_end_ms=2000,
    )
    assert first == second
    assert result.identical is True
    assert result.passed is True
    assert result.label == "Deterministic repeat check: PASS"


def test_invalid_analysis_can_be_saved_without_score(isolated_validation: Path) -> None:
    record = save_record(
        ValidationRecordCreate(
            techniqueSlug="jab",
            techniqueName="Jab",
            scenarioType=ValidationScenario.BAD_CAMERA,
            comparisonValid=False,
            invalidReason="Left foot partially outside frame.",
            poseCoverage=0.21,
            quickOverall=0,
            quickPose=0,
            geminiOverall=12,
            notes="Left foot partially outside frame.",
        )
    )
    assert record.comparisonValid is False
    assert record.quickOverall is None
    assert record.quickPose is None
    assert record.geminiOverall is None
    assert record.geminiCriteria is None
    assert record.poseCoverage == 0.21
    assert record.invalidReason == "Left foot partially outside frame."


def test_scenario_display_labels_remain_compatible_with_stored_enums() -> None:
    assert SCENARIO_LABELS[ValidationScenario.SELF_COMPARISON] == "Reference self-test"
    assert SCENARIO_LABELS[ValidationScenario.CLEAN_REPRODUCTION] == "Clean attempt"
    assert SCENARIO_LABELS[ValidationScenario.MINOR_DELIBERATE_ERROR] == "Deliberate difference — small"
    assert SCENARIO_LABELS[ValidationScenario.MAJOR_DELIBERATE_ERROR] == "Deliberate difference — major"
    assert SCENARIO_LABELS[ValidationScenario.BAD_CAMERA] == "Poor recording test"
    assert SCENARIO_LABELS[ValidationScenario.MULTI_ACTION] == "Multi-action validation (legacy)"
    assert SCENARIO_LABELS[ValidationScenario.CUSTOM] == "Custom (legacy)"
    loaded = ValidationRecord.model_validate(
        {
            "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
            "timestamp": "2026-08-27T12:00:00Z",
            "techniqueSlug": "combo",
            "techniqueName": "Combo",
            "scenarioType": "multi_action",
            "comparisonValid": True,
            "quickOverall": 70,
        }
    )
    assert loaded.scenarioType is ValidationScenario.MULTI_ACTION
    assert SCENARIO_LABELS[loaded.scenarioType] == "Multi-action validation (legacy)"


def test_repeat_count_is_bounded() -> None:
    assert bound_repeat_count(1) == 1
    assert bound_repeat_count(3) == 3
    with pytest.raises(ValueError, match="1 or 3"):
        bound_repeat_count(5)
    with pytest.raises(ValueError, match="1 or 3"):
        bound_repeat_count(0)


def test_gemini_repeatability_reuses_same_ai_video(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    analysis_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    folder = comparisons / analysis_id
    folder.mkdir(parents=True)
    video = folder / AI_COMPARISON_VIDEO_FILENAME
    video.write_bytes(b"frozen-ai-comparison-bytes")
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)
    write_ai_context(
        AiComparisonContext(
            analysisId=analysis_id,
            slug="front-kick",
            techniqueName="Front Kick",
            referenceDurationMs=1240,
            userDurationMs=1230,
        )
    )
    digest = sha256_file(video)
    provider = _RecordingProvider()
    result = run_gemini_repeatability(analysis_id=analysis_id, run_count=3, provider=provider)
    assert result.reusedExistingAiVideo is True
    assert result.identicalAssetEachRun is True
    assert result.assetFilename == AI_COMPARISON_VIDEO_FILENAME
    assert result.assetSha256 == digest
    assert len(provider.paths) == 3
    assert len(set(provider.paths)) == 1
    assert all(run.videoSha256 == digest for run in result.runs)
    assert result.overall is not None
    assert result.overall.runCount == 3
    assert result.overall.minimum is not None
    assert result.overall.maximum is not None
    assert result.overall.mean is not None
    assert result.overall.scoreRange is not None
    assert video.read_bytes() == b"frozen-ai-comparison-bytes"
    assert not (folder / "comparison.mp4").exists()


def test_validation_export_excludes_media_pose_and_keys(isolated_validation: Path) -> None:
    save_record(
        ValidationRecordCreate(
            techniqueSlug="combo",
            techniqueName="Combo",
            scenarioType=ValidationScenario.MULTI_ACTION,
            comparisonValid=True,
            quickOverall=77,
            geminiOverall=70,
            geminiModel="gemini-3.7-flash",
            geminiAnalysisId="dddddddd-dddd-dddd-dddd-dddddddddddd",
            notes="Third punch intentionally shortened.",
        )
    )
    payload = export_json_payload()
    blob = str(payload).lower()
    assert "api_key" not in blob
    assert "apikey" not in blob
    assert "prompt" not in blob
    assert "landmarks" not in blob
    assert ".mp4" not in blob
    assert "comparisonvideourl" not in blob.replace("_", "")
    csv_text = export_csv_text()
    assert "quickOverall" in csv_text
    assert "Third punch intentionally shortened." in csv_text
    assert "GEMINI_API_KEY" not in csv_text
    stripped = record_to_export_dict(
        ValidationRecord(
            id="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            timestamp="2026-08-27T12:00:00Z",
            techniqueSlug="jab",
            techniqueName="Jab",
            scenarioType=ValidationScenario.CUSTOM,
            comparisonValid=True,
            quickOverall=91,
        )
    )
    stuffed = _strip_with_secrets(stripped)
    assert "apiKey" not in stuffed
    assert "landmarks" not in stuffed
    assert "comparisonVideoUrl" not in stuffed


def test_latency_fields_are_optional_and_serializable() -> None:
    latency = ProcessingLatency(poseAnalysisMs=120, quickSimilarityMs=15, totalQuickMs=800)
    dumped = latency.model_dump()
    assert dumped["poseAnalysisMs"] == 120
    assert dumped["geminiProviderMs"] is None
    restored = ProcessingLatency.model_validate(dumped)
    assert restored.totalQuickMs == 800


def test_highlight_body_part_mapping() -> None:
    wrist = resolve_highlight("right wrist")
    assert wrist is not None
    assert wrist.joint_index == int(PoseLandmarkIndex.RIGHT_WRIST)
    assert (int(PoseLandmarkIndex.RIGHT_ELBOW), int(PoseLandmarkIndex.RIGHT_WRIST)) in wrist.connections
    ankle = resolve_highlight("left_ankle")
    assert ankle is not None
    assert ankle.joint_index == int(PoseLandmarkIndex.LEFT_ANKLE)
    assert resolve_highlight("not_a_joint") is None
    assert resolve_highlight(None) is None


def test_highlight_active_only_in_requested_progress_range() -> None:
    assert highlight_is_active(0.42, 0.30, 0.55) is True
    assert highlight_is_active(0.10, 0.30, 0.55) is False
    assert highlight_is_active(0.90, 0.30, 0.55) is False
    assert highlight_is_active(0.30, 0.30, 0.55) is True
    assert highlight_is_active(0.55, 0.30, 0.55) is True
    assert highlight_is_active(0.5, None, 0.9) is False


def test_validation_records_are_gitignored() -> None:
    gitignore = Path(__file__).resolve().parents[1] / ".gitignore"
    text = gitignore.read_text(encoding="utf-8")
    assert "data/validation-runs" in text


def test_summary_aggregates_are_descriptive_not_conclusive(isolated_validation: Path) -> None:
    save_record(
        ValidationRecordCreate(
            techniqueSlug="jab",
            techniqueName="Jab",
            scenarioType=ValidationScenario.SELF_COMPARISON,
            comparisonValid=True,
            quickOverall=100,
        )
    )
    save_record(
        ValidationRecordCreate(
            techniqueSlug="jab",
            techniqueName="Jab",
            scenarioType=ValidationScenario.BAD_CAMERA,
            comparisonValid=False,
            invalidReason="occlusion",
            poseCoverage=0.1,
        )
    )
    summary = summarize_records()
    assert summary.runCount == 2
    assert summary.invalidCount == 1
    labels = {item.scenarioType: item for item in summary.perScenario}
    assert labels[ValidationScenario.SELF_COMPARISON].quickMean == 100
    assert labels[ValidationScenario.BAD_CAMERA].invalidCount == 1


def test_compare_active_movements_unchanged_by_repeat_helper() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    direct = compare_active_movements(
        reference_frames=frames,
        user_frames=frames,
        reference_start_ms=400,
        reference_end_ms=2000,
        user_start_ms=400,
        user_end_ms=2000,
    )
    via_helper = compare_sequence_with_itself(frames, start_ms=400, end_ms=2000)
    assert direct == via_helper


def _strip_with_secrets(base: dict) -> dict:
    from app.validation.models import _strip_forbidden

    return _strip_forbidden(
        {
            **base,
            "apiKey": "should-not-survive",
            "landmarks": [{"x": 0.1}],
            "comparisonVideoUrl": "/api/comparisons/x/comparison.mp4",
            "prompt": "hidden",
        }
    )


def _assessment(*, score: int) -> ModelVideoAssessment:
    return ModelVideoAssessment(
        comparisonValid=True,
        invalidReason="",
        confidence=0.8,
        criteria=[
            CriterionAssessment(criterion=item, score=score, observation="visible match")
            for item in ASSESSMENT_CRITERIA
        ],
        strengths=["Path stayed close."],
        mainCorrections=[
            MainCorrection(title="Small timing difference", explanation="Recovery is slightly later.", relevantCriterion=None)
        ],
        summary="Close overall.",
    )


class _RecordingProvider:
    name = "fake-gemini"

    def __init__(self) -> None:
        self.paths: list[Path] = []

    def assess_video(self, *, video_path: Path, **_kwargs: object) -> ProviderCallResult:
        self.paths.append(video_path.resolve())
        score = 3 if len(self.paths) % 2 else 4
        return ProviderCallResult(
            assessment=_assessment(score=score),
            provider="fake-gemini",
            model="gemini-3.7-flash",
            upload_method="inline",
            requested_model="gemini-3.7-flash",
            fallback_used=False,
            provider_latency_ms=250,
        )
