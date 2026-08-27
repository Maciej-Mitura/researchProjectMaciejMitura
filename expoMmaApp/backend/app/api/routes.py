"""HTTP API for attempt analysis and debug keyframe access."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.analysis.pipeline import analyze_attempt
from app.api.uploads import save_upload, validate_upload_metadata
from app.config import KEYFRAME_FILENAMES, TMP_DIR
from app.models.api import AnalyzeAttemptResponse
from app.techniques.catalog import UnsupportedTechniqueError, require_supported_technique

router = APIRouter()
SAFE_KEYFRAME_NAMES = frozenset(KEYFRAME_FILENAMES.values())


@router.post("/analyze-attempt", response_model=AnalyzeAttemptResponse)
async def analyze_attempt_endpoint(
    techniqueId: str = Form(...),
    video: UploadFile = File(...),
) -> AnalyzeAttemptResponse:
    try:
        require_supported_technique(techniqueId)
    except UnsupportedTechniqueError as error:
        raise HTTPException(status_code=422, detail=error.reason) from error

    validate_upload_metadata(video)

    analysis_id = str(uuid.uuid4())
    upload_dir = TMP_DIR / analysis_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(video.filename or "attempt.mp4").suffix.lower() or ".mp4"
    upload_path = upload_dir / f"upload{suffix}"

    try:
        size = await save_upload(video, upload_path)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")
        return analyze_attempt(
            upload_path,
            techniqueId,
            analysis_id=analysis_id,
            output_dir=upload_dir,
        )
    finally:
        if upload_path.exists():
            upload_path.unlink()


@router.get("/debug/analyses/{analysis_id}")
def list_debug_keyframes(analysis_id: str) -> dict[str, object]:
    directory = _analysis_dir(analysis_id)
    files = sorted(path.name for path in directory.glob("*.jpg") if path.name in SAFE_KEYFRAME_NAMES)
    return {
        "analysisId": analysis_id,
        "keyframes": [
            {
                "filename": name,
                "url": f"/api/debug/analyses/{analysis_id}/keyframes/{name}",
            }
            for name in files
        ],
    }


@router.get("/debug/analyses/{analysis_id}/keyframes/{filename}")
def get_debug_keyframe(analysis_id: str, filename: str) -> FileResponse:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise HTTPException(status_code=404, detail="Unknown keyframe.")
    path = _analysis_dir(analysis_id) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Keyframe not found.")
    return FileResponse(path, media_type="image/jpeg", filename=filename)


def _analysis_dir(analysis_id: str) -> Path:
    try:
        uuid.UUID(analysis_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Analysis not found.") from error
    directory = (TMP_DIR / analysis_id).resolve()
    if not directory.is_dir() or directory.parent != TMP_DIR.resolve():
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return directory
