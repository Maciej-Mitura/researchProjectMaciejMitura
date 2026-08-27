"""Shared multipart video upload helpers."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import ALLOWED_VIDEO_CONTENT_TYPES, ALLOWED_VIDEO_EXTENSIONS, MAX_UPLOAD_BYTES


def validate_upload_metadata(video: UploadFile) -> None:
    filename = video.filename or ""
    suffix = Path(filename).suffix.lower()
    content_type = (video.content_type or "").split(";")[0].strip().lower()

    if suffix and suffix not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video extension '{suffix}'. Use mp4, mov, m4v, or webm.",
        )
    if content_type and content_type not in ALLOWED_VIDEO_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video content type '{content_type}'.",
        )
    if not suffix and not content_type:
        raise HTTPException(status_code=400, detail="Video file is missing a name and content type.")


async def save_upload(video: UploadFile, destination: Path) -> int:
    size = 0
    try:
        with destination.open("wb") as handle:
            while True:
                chunk = await video.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Video exceeds the {MAX_UPLOAD_BYTES} byte upload limit.",
                    )
                handle.write(chunk)
    except HTTPException:
        if destination.exists():
            destination.unlink()
        raise
    finally:
        await video.close()
    return size
