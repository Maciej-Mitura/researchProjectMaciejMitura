"""Sidecar metadata for a prepared AI comparison MP4.

Lets Gemini repeatability reuse the exact same validated file without
re-recording or re-rendering.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from pydantic import BaseModel

from app.config import AI_COMPARISON_VIDEO_FILENAME, AI_CONTEXT_FILENAME
from app.reference.errors import DraftNotFoundError
from app.video.store import load_comparison_dir, resolve_comparison_dir


class AiComparisonContext(BaseModel):
    analysisId: str
    slug: str
    techniqueName: str
    description: str | None = None
    referenceDurationMs: int
    userDurationMs: int
    videoFilename: str = AI_COMPARISON_VIDEO_FILENAME


def write_ai_context(context: AiComparisonContext) -> Path:
    directory = resolve_comparison_dir(context.analysisId)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / AI_CONTEXT_FILENAME
    path.write_text(context.model_dump_json(indent=2), encoding="utf-8")
    return path


def load_ai_context(analysis_id: str) -> AiComparisonContext:
    directory = load_comparison_dir(analysis_id)
    path = directory / AI_CONTEXT_FILENAME
    if not path.is_file():
        raise DraftNotFoundError()
    return AiComparisonContext.model_validate_json(path.read_text(encoding="utf-8"))


def ai_comparison_video_path(analysis_id: str) -> Path:
    directory = load_comparison_dir(analysis_id)
    path = directory / AI_COMPARISON_VIDEO_FILENAME
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()
