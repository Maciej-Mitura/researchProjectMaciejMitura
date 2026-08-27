"""HTTP API for recorded reference techniques (draft → confirm → library)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api.uploads import save_upload, validate_upload_metadata
from app.comparison.pipeline import analyze_generic_attempt
from app.comparison.store import new_analysis_id, resolve_attempt_dir
from app.config import (
    REFERENCE_DRAFT_METADATA_FILENAME,
    REFERENCE_DRAFT_VIDEO_FILENAME,
    REFERENCE_VIDEO_FILENAME,
)
from app.models.comparison import AnalyzeGenericAttemptResponse
from app.models.reference import (
    ConfirmReferenceResponse,
    RecordedTechniqueSummary,
    ReferenceDraftResponse,
)
from app.reference.errors import (
    BuiltinTechniqueProtectedError,
    DraftNotFoundError,
    DuplicateTechniqueError,
    IncompleteReferenceError,
    ReferenceError,
    TechniqueDeleteError,
    TechniqueNotFoundError,
)
from app.reference.pipeline import analyze_reference_draft
from app.reference.slug import (
    InvalidTechniqueNameError,
    is_safe_slug,
    normalize_description,
    normalize_display_name,
    slugify_technique_name,
)
from app.reference.store import (
    SAFE_KEYFRAME_NAMES,
    assert_slug_available,
    confirm_draft,
    delete_recorded_technique,
    discard_draft,
    draft_keyframe_path,
    draft_video_path,
    list_recorded_techniques,
    load_complete_reference,
    new_draft_id,
    read_json,
    resolve_draft_dir,
    technique_keyframe_path,
    technique_video_path,
    write_json,
)

router = APIRouter(prefix="/reference-techniques", tags=["reference-techniques"])


@router.get("", response_model=list[RecordedTechniqueSummary])
def list_reference_techniques() -> list[RecordedTechniqueSummary]:
    return list_recorded_techniques()


@router.post("/drafts", response_model=ReferenceDraftResponse)
async def create_reference_draft(
    name: str = Form(...),
    video: UploadFile = File(...),
    description: str | None = Form(None),
    recordingDurationSeconds: int | None = Form(None),
) -> ReferenceDraftResponse:
    try:
        slug = slugify_technique_name(name)
        normalized_name = normalize_display_name(name)
        normalized_description = normalize_description(description)
        chosen_duration = _normalize_recording_duration(recordingDurationSeconds)
        assert_slug_available(slug)
    except InvalidTechniqueNameError as error:
        raise HTTPException(status_code=400, detail=error.message) from error
    except DuplicateTechniqueError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error

    validate_upload_metadata(video)

    draft_id = new_draft_id()
    draft_dir = resolve_draft_dir(draft_id)
    draft_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(video.filename or "reference.mp4").suffix.lower() or ".mp4"
    upload_path = draft_dir / f"upload{suffix}"
    stored_video = draft_dir / REFERENCE_DRAFT_VIDEO_FILENAME

    try:
        size = await save_upload(video, upload_path)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")
        upload_path.replace(stored_video)
        response = analyze_reference_draft(
            stored_video,
            draft_id=draft_id,
            output_dir=draft_dir,
            name=normalized_name,
            slug=slug,
            description=normalized_description,
        )
        if chosen_duration is not None:
            draft_meta = draft_dir / REFERENCE_DRAFT_METADATA_FILENAME
            if draft_meta.is_file():
                payload = read_json(draft_meta)
                payload["recordingDurationSeconds"] = chosen_duration
                write_json(draft_meta, payload)
        return response
    except HTTPException:
        discard_draft(draft_id)
        raise
    except Exception:
        discard_draft(draft_id)
        raise


@router.post("/drafts/{draft_id}/confirm", response_model=ConfirmReferenceResponse)
def confirm_reference_draft(draft_id: str) -> ConfirmReferenceResponse:
    try:
        technique = confirm_draft(draft_id)
    except ReferenceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    return ConfirmReferenceResponse(technique=technique)


@router.delete("/drafts/{draft_id}")
def delete_reference_draft(draft_id: str) -> dict[str, str]:
    try:
        discard_draft(draft_id)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    return {"status": "discarded", "draftId": draft_id}


@router.get("/drafts/{draft_id}/video")
def get_draft_video(draft_id: str) -> FileResponse:
    try:
        path = draft_video_path(draft_id)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    return FileResponse(path, media_type="video/mp4", filename=REFERENCE_DRAFT_VIDEO_FILENAME)


@router.get("/drafts/{draft_id}/keyframes/{filename}")
def get_draft_keyframe(draft_id: str, filename: str) -> FileResponse:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise HTTPException(status_code=404, detail="Unknown keyframe.")
    try:
        path = draft_keyframe_path(draft_id, filename)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    return FileResponse(path, media_type="image/jpeg", filename=filename)


@router.post("/{slug}/analyze-attempt", response_model=AnalyzeGenericAttemptResponse)
async def analyze_recorded_technique_attempt(
    slug: str,
    video: UploadFile = File(...),
) -> AnalyzeGenericAttemptResponse:
    if not is_safe_slug(slug):
        raise HTTPException(status_code=404, detail="Recorded reference technique not found.")
    try:
        metadata = load_complete_reference(slug)
    except TechniqueNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    except IncompleteReferenceError as error:
        raise HTTPException(status_code=422, detail=error.message) from error

    validate_upload_metadata(video)

    analysis_id = new_analysis_id()
    output_dir = resolve_attempt_dir(analysis_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(video.filename or "attempt.mp4").suffix.lower() or ".mp4"
    upload_path = output_dir / f"upload{suffix}"

    try:
        size = await save_upload(video, upload_path)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")
        return analyze_generic_attempt(
            upload_path,
            analysis_id=analysis_id,
            output_dir=output_dir,
            metadata=metadata,
        )
    except IncompleteReferenceError as error:
        raise HTTPException(status_code=422, detail=error.message) from error
    finally:
        if upload_path.exists():
            upload_path.unlink()


@router.delete("/{slug}")
def delete_recorded_reference_technique(slug: str) -> dict[str, str]:
    if not is_safe_slug(slug):
        raise HTTPException(status_code=404, detail="Recorded reference technique not found.")
    try:
        delete_recorded_technique(slug)
    except BuiltinTechniqueProtectedError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    except TechniqueNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    except TechniqueDeleteError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    except ReferenceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    return {"status": "deleted", "slug": slug}


@router.get("/{slug}/video")
def get_reference_video(slug: str) -> FileResponse:
    try:
        path = technique_video_path(slug)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    return FileResponse(path, media_type="video/mp4", filename=REFERENCE_VIDEO_FILENAME)


@router.get("/{slug}/keyframes/{filename}")
def get_reference_keyframe(slug: str, filename: str) -> FileResponse:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise HTTPException(status_code=404, detail="Unknown keyframe.")
    try:
        path = technique_keyframe_path(slug, filename)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    return FileResponse(path, media_type="image/jpeg", filename=filename)


def _normalize_recording_duration(value: int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 15:
        raise HTTPException(
            status_code=400,
            detail="recordingDurationSeconds must be an integer between 1 and 15.",
        )
    return value
