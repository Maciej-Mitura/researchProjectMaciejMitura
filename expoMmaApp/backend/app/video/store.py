"""Temporary synchronized comparison videos.

Generated MP4s are not saved in the reference library and are not committed.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from app import config
from app.reference.errors import DraftNotFoundError
from app.reference.store import remove_tree

SAFE_VIDEO_NAMES = frozenset(
    {
        config.COMPARISON_VIDEO_FILENAME,
        config.COMPARISON_POSE_VIDEO_FILENAME,
        config.AI_COMPARISON_VIDEO_FILENAME,
    }
)


def comparisons_root() -> Path:
    return config.COMPARISONS_DIR


def resolve_comparison_dir(analysis_id: str) -> Path:
    _require_uuid(analysis_id)
    root = comparisons_root().resolve()
    directory = (root / analysis_id).resolve()
    if directory.parent != root:
        raise DraftNotFoundError()
    return directory


def load_comparison_dir(analysis_id: str) -> Path:
    directory = resolve_comparison_dir(analysis_id)
    if not directory.is_dir():
        raise DraftNotFoundError()
    return directory


def comparison_video_path(analysis_id: str, filename: str) -> Path:
    if filename not in SAFE_VIDEO_NAMES:
        raise DraftNotFoundError()
    path = load_comparison_dir(analysis_id) / filename
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def comparison_video_url(analysis_id: str, filename: str = config.COMPARISON_VIDEO_FILENAME) -> str:
    return f"/api/comparisons/{analysis_id}/{filename}"


def discard_comparison(analysis_id: str) -> None:
    directory = resolve_comparison_dir(analysis_id)
    remove_tree(directory)


def sweep_stale_comparisons(max_age_seconds: float | None = None) -> int:
    age = config.COMPARISON_MAX_AGE_SECONDS if max_age_seconds is None else max_age_seconds
    root = comparisons_root()
    if not root.is_dir():
        return 0
    now = time.time()
    removed = 0
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            uuid.UUID(child.name)
        except ValueError:
            continue
        try:
            mtime = child.stat().st_mtime
        except OSError:
            continue
        if now - mtime >= age:
            remove_tree(child)
            removed += 1
    return removed


def _require_uuid(value: str) -> None:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError) as error:
        raise DraftNotFoundError() from error
