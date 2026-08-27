"""Temporary USER comparison-attempt storage.

USER training attempts are not saved in the reference library.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from app import config
from app.reference.errors import DraftNotFoundError

SAFE_KEYFRAME_NAMES = frozenset(config.REFERENCE_KEYFRAME_FILENAMES.values())


def attempts_root() -> Path:
    return config.COMPARISON_ATTEMPTS_DIR


def new_analysis_id() -> str:
    return str(uuid.uuid4())


def resolve_attempt_dir(analysis_id: str) -> Path:
    _require_uuid(analysis_id)
    root = attempts_root().resolve()
    directory = (root / analysis_id).resolve()
    if directory.parent != root:
        raise DraftNotFoundError()
    return directory


def load_attempt_dir(analysis_id: str) -> Path:
    directory = resolve_attempt_dir(analysis_id)
    if not directory.is_dir():
        raise DraftNotFoundError()
    return directory


def attempt_keyframe_path(analysis_id: str, filename: str) -> Path:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise DraftNotFoundError()
    path = load_attempt_dir(analysis_id) / filename
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def _require_uuid(value: str) -> None:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError) as error:
        raise DraftNotFoundError() from error
