"""Temporary USER media for Detailed AI Analysis.

USER attempts are not saved in the reference library and are not committed.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from app import config
from app.reference.errors import DraftNotFoundError
from app.reference.store import remove_tree


def attempts_root() -> Path:
    return config.AI_ATTEMPTS_DIR


def new_analysis_id() -> str:
    return str(uuid.uuid4())


def resolve_attempt_dir(analysis_id: str) -> Path:
    _require_uuid(analysis_id)
    root = attempts_root().resolve()
    directory = (root / analysis_id).resolve()
    if directory.parent != root:
        raise DraftNotFoundError()
    return directory


def attempt_video_path(analysis_id: str) -> Path:
    return resolve_attempt_dir(analysis_id) / config.AI_ATTEMPT_VIDEO_FILENAME


def frames_dir(analysis_id: str) -> Path:
    return resolve_attempt_dir(analysis_id) / config.AI_FRAMES_SUBDIR


def discard_attempt(analysis_id: str) -> None:
    directory = resolve_attempt_dir(analysis_id)
    remove_tree(directory)


def sweep_stale_attempts(max_age_seconds: float | None = None) -> int:
    """Remove leftover USER temp folders. Returns the number of directories removed."""
    age = config.AI_ATTEMPT_MAX_AGE_SECONDS if max_age_seconds is None else max_age_seconds
    root = attempts_root()
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
