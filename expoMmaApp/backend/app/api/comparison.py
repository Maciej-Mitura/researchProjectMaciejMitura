"""HTTP routes for temporary USER comparison keyframes and synchronized videos."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.comparison.store import SAFE_KEYFRAME_NAMES, attempt_keyframe_path
from app.reference.errors import DraftNotFoundError
from app.video.store import SAFE_VIDEO_NAMES, comparison_video_path

router = APIRouter(tags=["comparison-attempts"])


@router.get("/comparison-attempts/{analysis_id}/keyframes/{filename}")
def get_comparison_keyframe(analysis_id: str, filename: str) -> FileResponse:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise HTTPException(status_code=404, detail="Unknown keyframe.")
    try:
        path = attempt_keyframe_path(analysis_id, filename)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail="Keyframe not found.") from error
    return FileResponse(path, media_type="image/jpeg", filename=filename)


@router.get("/comparisons/{analysis_id}/{filename}")
def get_comparison_video(analysis_id: str, filename: str) -> FileResponse:
    if filename not in SAFE_VIDEO_NAMES:
        raise HTTPException(status_code=404, detail="Unknown comparison video.")
    try:
        path = comparison_video_path(analysis_id, filename)
    except DraftNotFoundError as error:
        raise HTTPException(status_code=404, detail="Comparison video not found.") from error
    return FileResponse(path, media_type="video/mp4", filename=filename)
