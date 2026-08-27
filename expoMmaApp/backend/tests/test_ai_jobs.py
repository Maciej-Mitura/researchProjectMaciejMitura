"""Async Detailed AI jobs. No real Gemini calls."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.errors import GeminiUnavailableError
from app.ai.models import (
    AssessmentCriterionId,
    CriterionAssessment,
    DetailedAssessmentResponse,
)
from app.ai.progress import AnalysisStage, STAGE_PROGRESS, stage_progress
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
        technique=ComparisonTechnique(id="cross", slug="cross", name="Cross"),
        analysisValid=True,
        comparisonValid=True,
        confidence=0.9,
        overallScore=88,
        criteria=[
            CriterionAssessment(criterion=item, score=3, observation="ok")
            for item in AssessmentCriterionId
        ],
        strengths=["Guard stays high."],
        mainCorrections=[],
        summary="Close.",
        comparisonVideoUrl=f"/api/comparisons/{analysis_id}/comparison.mp4",
        comparisonPoseVideoUrl=None,
        poseOverlayAvailable=False,
    )


def _wait_job(job_id: str, *, timeout_s: float = 3.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = client.get(f"/api/ai-analysis/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in {"complete", "failed"}:
            return body
        time.sleep(0.05)
    pytest.fail("AI job did not finish in time.")


def test_progress_messages_match_presentation_copy() -> None:
    from app.ai.progress import stage_message

    assert stage_message(AnalysisStage.DETECTING_MOVEMENT) == "Detecting movement…"
    assert stage_message(AnalysisStage.PREPARING_COMPARISON) == "Preparing synchronized comparison…"
    assert (
        stage_message(AnalysisStage.CONTACTING_PRIMARY_MODEL, model="gemini-3.7-flash")
        == "Analyzing with Gemini 3.7 Flash…"
    )
    assert (
        stage_message(
            AnalysisStage.RETRYING_PRIMARY_MODEL,
            model="gemini-3.7-flash",
            attempt=2,
            max_attempts=3,
        )
        == "Gemini 3.7 Flash is busy — retrying (2/3)…"
    )
    assert (
        stage_message(AnalysisStage.CONTACTING_FALLBACK_MODEL, fallback_model="gemini-3.6-flash")
        == "Trying backup model: Gemini 3.6 Flash…"
    )
    assert stage_message(AnalysisStage.VALIDATING_AI_RESPONSE) == "Validating feedback…"
    assert stage_message(AnalysisStage.PREPARING_RESULTS) == "Preparing results…"
    assert STAGE_PROGRESS[AnalysisStage.COMPLETE] == 100


def test_progress_milestones_are_not_100_until_complete() -> None:
    assert STAGE_PROGRESS[AnalysisStage.CONTACTING_PRIMARY_MODEL] == 65
    assert STAGE_PROGRESS[AnalysisStage.CONTACTING_FALLBACK_MODEL] == 75
    assert STAGE_PROGRESS[AnalysisStage.COMPLETE] == 100
    assert stage_progress(AnalysisStage.CONTACTING_PRIMARY_MODEL) == 65
    assert stage_progress(AnalysisStage.COMPLETE) == 100


def test_job_completes_with_result(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _refs, drafts, _attempts = isolated_dirs
    plant_draft(drafts, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "cross", "Cross")
    confirm_draft("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: "test-key-not-real")
    seen: list[str] = []

    def fake_run(*_args, analysis_id: str, on_progress=None, **_kwargs):
        if on_progress:
            on_progress(AnalysisStage.DETECTING_MOVEMENT)
            on_progress(AnalysisStage.PREPARING_COMPARISON)
            on_progress(AnalysisStage.CONTACTING_PRIMARY_MODEL, model="gemini-3.7-flash", attempt=1)
        seen.append(analysis_id)
        return _valid_response(analysis_id)

    monkeypatch.setattr("app.ai.jobs.run_detailed_analysis", fake_run)

    created = client.post(
        "/api/reference-techniques/cross/ai-analysis/jobs",
        files={"video": ("attempt.mp4", b"fake-mp4-bytes", "video/mp4")},
    )
    assert created.status_code == 200
    job_id = created.json()["jobId"]
    assert created.json()["pollPath"] == f"/api/ai-analysis/jobs/{job_id}"

    body = _wait_job(job_id)
    assert body["status"] == "complete"
    assert body["stage"] == "COMPLETE"
    assert body["progress"] == 100
    assert body["result"]["overallScore"] == 88
    assert body["error"] is None
    assert seen
    assert body["progressCaption"]


def test_failed_job_status(
    isolated_dirs: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _refs, drafts, _attempts = isolated_dirs
    plant_draft(drafts, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "hook", "Hook")
    confirm_draft("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    monkeypatch.setattr("app.api.ai.gemini_api_key", lambda: "test-key-not-real")

    def boom(*_args, **_kwargs):
        raise GeminiUnavailableError("This model is currently experiencing high demand.")

    monkeypatch.setattr("app.ai.jobs.run_detailed_analysis", boom)

    created = client.post(
        "/api/reference-techniques/hook/ai-analysis/jobs",
        files={"video": ("attempt.mp4", b"fake-mp4-bytes", "video/mp4")},
    )
    job_id = created.json()["jobId"]
    body = _wait_job(job_id)
    assert body["status"] == "failed"
    assert body["stage"] == "FAILED"
    assert body["result"] is None
    assert body["error"]["code"] == "gemini_unavailable"
    assert body["progress"] != 100 or body["status"] == "failed"


def test_missing_job_is_404() -> None:
    response = client.get("/api/ai-analysis/jobs/not-a-uuid")
    assert response.status_code == 404
