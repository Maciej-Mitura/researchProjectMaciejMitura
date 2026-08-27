"""HTTP routes for Detailed AI Analysis. Gemini calls stay behind the provider."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.ai.errors import AiAnalysisError
from app.ai.jobs import create_analysis_job, get_analysis_job, start_analysis_job
from app.ai.models import AnalysisJobCreated, AnalysisJobResponse, DetailedAssessmentResponse
from app.ai.pipeline import run_detailed_analysis
from app.ai.store import (
    discard_attempt,
    new_analysis_id,
    resolve_attempt_dir,
)
from app.api.uploads import save_upload, validate_upload_metadata
from app.config import AI_ATTEMPT_VIDEO_FILENAME, gemini_api_key
from app.models.reference import ReferenceTechniqueMetadata
from app.reference.errors import (
    DraftNotFoundError,
    IncompleteReferenceError,
    TechniqueNotFoundError,
)
from app.reference.slug import is_safe_slug
from app.reference.store import load_complete_reference, technique_video_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reference-techniques", tags=["ai-analysis"])
jobs_router = APIRouter(prefix="/ai-analysis", tags=["ai-jobs"])


def _load_recorded_reference(slug: str) -> ReferenceTechniqueMetadata:
    if not is_safe_slug(slug):
        raise HTTPException(status_code=404, detail="Recorded reference technique not found.")
    try:
        metadata = load_complete_reference(slug)
        technique_video_path(slug)
        return metadata
    except TechniqueNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    except DraftNotFoundError as error:
        raise HTTPException(status_code=422, detail="Recorded reference video is missing.") from error
    except IncompleteReferenceError as error:
        raise HTTPException(status_code=422, detail=error.message) from error


def _require_gemini_configured() -> None:
    if not gemini_api_key():
        raise HTTPException(
            status_code=503,
            detail="Detailed AI Analysis is not configured on the server. Quick Comparison still works.",
        )


@router.post("/{slug}/ai-analysis", response_model=DetailedAssessmentResponse)
async def analyze_attempt_with_ai(
    slug: str,
    video: UploadFile = File(...),
) -> DetailedAssessmentResponse:
    metadata = _load_recorded_reference(slug)
    _require_gemini_configured()
    validate_upload_metadata(video)

    analysis_id = new_analysis_id()
    work_dir = resolve_attempt_dir(analysis_id)
    work_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(video.filename or AI_ATTEMPT_VIDEO_FILENAME).suffix.lower() or ".mp4"
    attempt_path = work_dir / AI_ATTEMPT_VIDEO_FILENAME
    upload_path = work_dir / f"upload{suffix}"

    try:
        size = await save_upload(video, upload_path)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")
        if upload_path != attempt_path:
            upload_path.replace(attempt_path)
        return run_detailed_analysis(
            attempt_path,
            analysis_id=analysis_id,
            output_dir=work_dir,
            metadata=metadata,
        )
    except HTTPException:
        raise
    except AiAnalysisError as error:
        logger.warning(
            "Detailed AI analysis failed analysisId=%s code=%s",
            analysis_id,
            error.code,
        )
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    except Exception:
        logger.exception("Detailed AI analysis crashed analysisId=%s", analysis_id)
        raise HTTPException(
            status_code=500,
            detail="Detailed AI Analysis failed. Quick Comparison still works.",
        ) from None
    finally:
        discard_attempt(analysis_id)


@router.post("/{slug}/ai-analysis/jobs", response_model=AnalysisJobCreated)
async def create_detailed_analysis_job(
    slug: str,
    video: UploadFile = File(...),
) -> AnalysisJobCreated:
    metadata = _load_recorded_reference(slug)
    _require_gemini_configured()
    validate_upload_metadata(video)

    analysis_id = new_analysis_id()
    work_dir = resolve_attempt_dir(analysis_id)
    work_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(video.filename or AI_ATTEMPT_VIDEO_FILENAME).suffix.lower() or ".mp4"
    attempt_path = work_dir / AI_ATTEMPT_VIDEO_FILENAME
    upload_path = work_dir / f"upload{suffix}"

    try:
        size = await save_upload(video, upload_path)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")
        if upload_path != attempt_path:
            upload_path.replace(attempt_path)
    except HTTPException:
        discard_attempt(analysis_id)
        raise
    except Exception:
        discard_attempt(analysis_id)
        raise

    job = create_analysis_job(
        analysis_id=analysis_id,
        slug=slug,
        attempt_path=attempt_path,
        output_dir=work_dir,
        metadata=metadata,
    )
    start_analysis_job(job.job_id)
    return AnalysisJobCreated(
        jobId=job.job_id,
        status="queued",
        pollPath=f"/api/ai-analysis/jobs/{job.job_id}",
    )


@jobs_router.get("/jobs/{job_id}", response_model=AnalysisJobResponse)
def get_detailed_analysis_job(job_id: str) -> AnalysisJobResponse:
    from app.ai.jobs import registry

    job = get_analysis_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found.")
    return registry.snapshot(job)
