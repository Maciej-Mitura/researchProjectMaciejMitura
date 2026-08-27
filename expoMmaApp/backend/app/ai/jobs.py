"""In-memory Detailed AI Analysis jobs. Prototype — no database."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.ai.errors import AiAnalysisError
from app.ai.models import AnalysisJobError, AnalysisJobResponse, DetailedAssessmentResponse
from app.ai.pipeline import run_detailed_analysis
from app.ai.progress import (
    PROGRESS_CAPTION,
    AnalysisStage,
    checklist_for,
    stage_message,
    stage_progress,
)
from app.ai.reliability import display_model_name, load_retry_settings
from app.ai.store import discard_attempt
from app.config import AI_JOB_MAX_AGE_SECONDS, gemini_fallback_model, gemini_model
from app.models.reference import ReferenceTechniqueMetadata

logger = logging.getLogger(__name__)


@dataclass
class AnalysisJob:
    job_id: str
    analysis_id: str
    slug: str
    attempt_path: Path
    output_dir: Path
    metadata: ReferenceTechniqueMetadata
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    status: str = "queued"
    stage: AnalysisStage = AnalysisStage.UPLOADING
    progress: int = 10
    message: str = ""
    model: str | None = None
    requested_model: str | None = None
    attempt: int | None = None
    max_attempts: int | None = None
    fallback_used: bool = False
    result: DetailedAssessmentResponse | None = None
    error: AnalysisJobError | None = None

    def elapsed_ms(self) -> int:
        return int(round((time.monotonic() - self.created_at) * 1000))


class JobRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, AnalysisJob] = {}

    def create(
        self,
        *,
        analysis_id: str,
        slug: str,
        attempt_path: Path,
        output_dir: Path,
        metadata: ReferenceTechniqueMetadata,
    ) -> AnalysisJob:
        settings = load_retry_settings()
        job = AnalysisJob(
            job_id=str(uuid.uuid4()),
            analysis_id=analysis_id,
            slug=slug,
            attempt_path=attempt_path,
            output_dir=output_dir,
            metadata=metadata,
            requested_model=settings.primary_model,
            model=settings.primary_model,
            max_attempts=settings.max_attempts,
            message=stage_message(
                AnalysisStage.UPLOADING,
                model=settings.primary_model,
            ),
        )
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> AnalysisJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(
        self,
        job_id: str,
        *,
        stage: AnalysisStage | None = None,
        status: str | None = None,
        model: str | None = None,
        requested_model: str | None = None,
        attempt: int | None = None,
        max_attempts: int | None = None,
        fallback_used: bool | None = None,
        message: str | None = None,
        result: DetailedAssessmentResponse | None = None,
        error: AnalysisJobError | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if stage is not None:
                job.stage = stage
                if stage is not AnalysisStage.FAILED:
                    job.progress = stage_progress(
                        stage,
                        attempt=attempt if attempt is not None else job.attempt,
                        max_attempts=max_attempts if max_attempts is not None else job.max_attempts,
                    )
            if status is not None:
                job.status = status
            if model is not None:
                job.model = model
            if requested_model is not None:
                job.requested_model = requested_model
            if attempt is not None:
                job.attempt = attempt
            if max_attempts is not None:
                job.max_attempts = max_attempts
            if fallback_used is not None:
                job.fallback_used = fallback_used
            if message is not None:
                job.message = message
            elif stage is not None:
                job.message = stage_message(
                    stage,
                    model=job.model,
                    fallback_model=gemini_fallback_model(),
                    attempt=job.attempt,
                    max_attempts=job.max_attempts,
                )
            if result is not None:
                job.result = result
            if error is not None:
                job.error = error
            job.updated_at = time.monotonic()

    def snapshot(self, job: AnalysisJob) -> AnalysisJobResponse:
        status = job.status
        stage = job.stage
        progress = job.progress
        if status == "complete":
            stage = AnalysisStage.COMPLETE
            progress = 100
        return AnalysisJobResponse(
            jobId=job.job_id,
            status=status,
            stage=stage,
            progress=progress,
            message=job.message,
            progressCaption=PROGRESS_CAPTION,
            model=job.model,
            requestedModel=job.requested_model,
            modelLabel=display_model_name(job.model),
            attempt=job.attempt,
            maxAttempts=job.max_attempts,
            fallbackUsed=job.fallback_used,
            elapsedMs=job.elapsed_ms(),
            checklist=checklist_for(stage),
            result=job.result,
            error=job.error,
        )

    def sweep(self, *, max_age_seconds: float = AI_JOB_MAX_AGE_SECONDS) -> int:
        cutoff = time.monotonic() - max_age_seconds
        removed = 0
        with self._lock:
            stale = [
                job_id
                for job_id, job in self._jobs.items()
                if job.updated_at < cutoff and job.status in {"complete", "failed"}
            ]
            for job_id in stale:
                del self._jobs[job_id]
                removed += 1
        return removed


registry = JobRegistry()


def create_analysis_job(
    *,
    analysis_id: str,
    slug: str,
    attempt_path: Path,
    output_dir: Path,
    metadata: ReferenceTechniqueMetadata,
) -> AnalysisJob:
    registry.sweep()
    return registry.create(
        analysis_id=analysis_id,
        slug=slug,
        attempt_path=attempt_path,
        output_dir=output_dir,
        metadata=metadata,
    )


def start_analysis_job(job_id: str) -> None:
    thread = threading.Thread(target=_run_job, args=(job_id,), name=f"ai-job-{job_id[:8]}", daemon=True)
    thread.start()


def get_analysis_job(job_id: str) -> AnalysisJob | None:
    try:
        uuid.UUID(job_id)
    except (ValueError, TypeError):
        return None
    return registry.get(job_id)


def sweep_stale_jobs() -> int:
    return registry.sweep()


def _run_job(job_id: str) -> None:
    job = registry.get(job_id)
    if job is None:
        return
    registry.update(job_id, status="processing", stage=AnalysisStage.UPLOADING)

    def on_progress(
        stage: AnalysisStage,
        *,
        model: str | None = None,
        attempt: int | None = None,
        max_attempts: int | None = None,
        fallback_used: bool | None = None,
    ) -> None:
        registry.update(
            job_id,
            stage=stage,
            model=model,
            attempt=attempt,
            max_attempts=max_attempts,
            fallback_used=fallback_used,
        )

    try:
        result = run_detailed_analysis(
            job.attempt_path,
            analysis_id=job.analysis_id,
            output_dir=job.output_dir,
            metadata=job.metadata,
            on_progress=on_progress,
        )
        registry.update(
            job_id,
            status="complete",
            stage=AnalysisStage.COMPLETE,
            result=result,
            fallback_used=bool(result.debug.fallbackUsed) if result.debug else None,
            model=(result.debug.model if result.debug else gemini_model()),
        )
    except AiAnalysisError as error:
        logger.warning("AI job failed jobId=%s code=%s", job_id, error.code)
        registry.update(
            job_id,
            status="failed",
            stage=AnalysisStage.FAILED,
            error=AnalysisJobError(code=error.code, message=error.message),
            message=error.message,
        )
    except Exception:
        logger.exception("AI job crashed jobId=%s", job_id)
        registry.update(
            job_id,
            status="failed",
            stage=AnalysisStage.FAILED,
            error=AnalysisJobError(
                code="gemini_unavailable",
                message="Google Gemini could not complete this analysis. Quick Comparison still works.",
            ),
            message="Google Gemini could not complete this analysis. Quick Comparison still works.",
        )
    finally:
        discard_attempt(job.analysis_id)
