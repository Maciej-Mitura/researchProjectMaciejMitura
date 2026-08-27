"""Filesystem persistence for reference drafts and confirmed techniques.

Destination paths are owned by this module. Callers pass ids/slugs only.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app import config
from app.models.reference import (
    MovementWindow,
    RecordedTechniqueSummary,
    ReferenceKeyframeMeta,
    ReferenceTechniqueMetadata,
)
from app.reference.errors import (
    BuiltinTechniqueProtectedError,
    DraftNotConfirmableError,
    DraftNotFoundError,
    DuplicateTechniqueError,
    IncompleteReferenceError,
    TechniqueDeleteError,
    TechniqueNotFoundError,
)
from app.reference.keyframes import GENERIC_PHASES
from app.reference.slug import is_safe_slug

SAFE_KEYFRAME_NAMES = frozenset(config.REFERENCE_KEYFRAME_FILENAMES.values())
logger = logging.getLogger(__name__)


def drafts_root() -> Path:
    return config.REFERENCE_DRAFTS_DIR


def techniques_root() -> Path:
    return config.REFERENCE_TECHNIQUES_DIR


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug_is_taken(slug: str) -> bool:
    if slug in config.RESERVED_TECHNIQUE_IDS:
        return True
    destination = _technique_dir(slug)
    return destination.is_dir() and (destination / config.REFERENCE_METADATA_FILENAME).is_file()


def assert_slug_available(slug: str) -> None:
    if slug in config.RESERVED_TECHNIQUE_IDS:
        raise DuplicateTechniqueError(slug, reserved=True)
    if slug_is_taken(slug):
        raise DuplicateTechniqueError(slug)


def new_draft_id() -> str:
    return str(uuid.uuid4())


def resolve_draft_dir(draft_id: str) -> Path:
    _require_uuid(draft_id)
    directory = (drafts_root() / draft_id).resolve()
    if directory.parent != drafts_root().resolve():
        raise DraftNotFoundError()
    return directory


def load_draft_dir(draft_id: str) -> Path:
    directory = resolve_draft_dir(draft_id)
    if not directory.is_dir():
        raise DraftNotFoundError()
    return directory


def draft_video_path(draft_id: str) -> Path:
    path = load_draft_dir(draft_id) / config.REFERENCE_DRAFT_VIDEO_FILENAME
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def draft_keyframe_path(draft_id: str, filename: str) -> Path:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise DraftNotFoundError()
    path = load_draft_dir(draft_id) / config.REFERENCE_KEYFRAMES_SUBDIR / filename
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def discard_draft(draft_id: str) -> None:
    directory = resolve_draft_dir(draft_id)
    _remove_tree(directory)


def list_recorded_techniques() -> list[RecordedTechniqueSummary]:
    root = techniques_root()
    if not root.is_dir():
        return []
    summaries: list[RecordedTechniqueSummary] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        metadata_path = child / config.REFERENCE_METADATA_FILENAME
        if not metadata_path.is_file():
            continue
        try:
            metadata = ReferenceTechniqueMetadata.model_validate(read_json(metadata_path))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if metadata.id != child.name or not is_safe_slug(metadata.id):
            continue
        summaries.append(
            RecordedTechniqueSummary(
                id=metadata.id,
                slug=metadata.slug,
                name=metadata.name,
                description=metadata.description,
                createdAt=metadata.createdAt,
                referenceStrategy=metadata.referenceStrategy,
                keyframeCount=len(metadata.keyframes),
                recordingDurationSeconds=metadata.recordingDurationSeconds,
            )
        )
    summaries.sort(key=lambda item: item.createdAt, reverse=True)
    return summaries


def load_technique_metadata(slug: str) -> ReferenceTechniqueMetadata:
    directory = _existing_technique_dir(slug)
    metadata_path = directory / config.REFERENCE_METADATA_FILENAME
    return ReferenceTechniqueMetadata.model_validate(read_json(metadata_path))


def load_complete_reference(slug: str) -> ReferenceTechniqueMetadata:
    """Load a recorded technique only when video + five phase keyframes exist.

    Missing technique → TechniqueNotFoundError (404).
    Present but incomplete → IncompleteReferenceError (422).
    Never returns a partial comparison package.
    """
    if not is_safe_slug(slug):
        raise TechniqueNotFoundError()
    try:
        directory = _existing_technique_dir(slug)
    except DraftNotFoundError as error:
        raise TechniqueNotFoundError() from error

    try:
        metadata = ReferenceTechniqueMetadata.model_validate(
            read_json(directory / config.REFERENCE_METADATA_FILENAME)
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise IncompleteReferenceError("Recorded reference metadata is unreadable.") from error

    video_path = directory / config.REFERENCE_VIDEO_FILENAME
    if not video_path.is_file():
        raise IncompleteReferenceError("Recorded reference video is missing.")

    phases = [item.phase for item in metadata.keyframes]
    required = [phase.value for phase in GENERIC_PHASES]
    if len(phases) != 5 or set(phases) != set(required):
        raise IncompleteReferenceError(
            "Recorded reference does not contain all five movement phases."
        )

    for item in metadata.keyframes:
        basename = Path(item.filename).name
        if basename not in SAFE_KEYFRAME_NAMES:
            raise IncompleteReferenceError("Recorded reference keyframe filename is invalid.")
        keyframe_path = directory / config.REFERENCE_KEYFRAMES_SUBDIR / basename
        if not keyframe_path.is_file():
            raise IncompleteReferenceError("Recorded reference keyframes are incomplete.")

    return metadata


def technique_video_path(slug: str) -> Path:
    directory = _existing_technique_dir(slug)
    path = directory / config.REFERENCE_VIDEO_FILENAME
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def technique_keyframe_path(slug: str, filename: str) -> Path:
    if filename not in SAFE_KEYFRAME_NAMES:
        raise DraftNotFoundError()
    directory = _existing_technique_dir(slug)
    path = directory / config.REFERENCE_KEYFRAMES_SUBDIR / filename
    if not path.is_file():
        raise DraftNotFoundError()
    return path


def delete_recorded_technique(slug: str) -> None:
    """Permanently remove a recorded technique directory.

    Built-in catalog ids cannot be deleted. The path is always resolved under
    the configured reference-techniques root after safe-slug validation.
    """
    if not is_safe_slug(slug):
        raise TechniqueNotFoundError()
    if slug in config.RESERVED_TECHNIQUE_IDS:
        raise BuiltinTechniqueProtectedError()

    root = techniques_root().resolve()
    try:
        directory = _existing_technique_dir(slug).resolve()
    except DraftNotFoundError as error:
        raise TechniqueNotFoundError() from error
    if directory.parent != root or directory == root:
        raise TechniqueNotFoundError()
    if not directory.is_dir():
        raise TechniqueNotFoundError()

    logger.info("Deleting recorded technique slug=%s", slug)
    _remove_tree(directory)
    if directory.exists():
        raise TechniqueDeleteError("The technique folder could not be fully removed.")
    if (root / slug).exists():
        raise TechniqueDeleteError("The technique folder could not be fully removed.")
    logger.info("Deleted recorded technique slug=%s", slug)


def confirm_draft(draft_id: str) -> RecordedTechniqueSummary:
    draft_dir = load_draft_dir(draft_id)
    draft_meta_path = draft_dir / config.REFERENCE_DRAFT_METADATA_FILENAME
    if not draft_meta_path.is_file():
        raise DraftNotFoundError()

    try:
        draft = read_json(draft_meta_path)
    except (OSError, json.JSONDecodeError) as error:
        raise DraftNotConfirmableError("Draft metadata is unreadable.") from error

    if draft.get("analysisValid") is not True:
        raise DraftNotConfirmableError(
            "This reference could not be measured. Retake the recording."
        )

    slug = draft.get("slug")
    name = draft.get("name")
    if not isinstance(slug, str) or not is_safe_slug(slug):
        raise DraftNotConfirmableError("Draft slug is invalid.")
    if not isinstance(name, str) or not name.strip():
        raise DraftNotConfirmableError("Draft is missing a technique name.")
    assert_slug_available(slug)

    video_src = draft_dir / config.REFERENCE_DRAFT_VIDEO_FILENAME
    keyframes_src = draft_dir / config.REFERENCE_KEYFRAMES_SUBDIR
    if not video_src.is_file():
        raise DraftNotConfirmableError("Draft video is missing.")
    missing = [
        filename
        for filename in SAFE_KEYFRAME_NAMES
        if not (keyframes_src / filename).is_file()
    ]
    if missing:
        raise DraftNotConfirmableError("Draft keyframes are incomplete.")

    metadata = _metadata_from_draft(draft)
    dest = _technique_dir(slug)
    staging = techniques_root() / f".staging-{draft_id}"

    try:
        _remove_tree(staging)
        staging.mkdir(parents=True)
        shutil.copy2(video_src, staging / config.REFERENCE_VIDEO_FILENAME)
        keyframes_dest = staging / config.REFERENCE_KEYFRAMES_SUBDIR
        keyframes_dest.mkdir()
        for filename in sorted(SAFE_KEYFRAME_NAMES):
            shutil.copy2(keyframes_src / filename, keyframes_dest / filename)
        write_json(staging / config.REFERENCE_METADATA_FILENAME, metadata.model_dump())
        _publish_directory(staging, dest, slug)
    except Exception:
        _remove_tree(staging)
        if dest.exists() and not (dest / config.REFERENCE_METADATA_FILENAME).is_file():
            _remove_tree(dest)
        raise

    discard_draft(draft_id)
    return RecordedTechniqueSummary(
        id=metadata.id,
        slug=metadata.slug,
        name=metadata.name,
        description=metadata.description,
        createdAt=metadata.createdAt,
        referenceStrategy=metadata.referenceStrategy,
        keyframeCount=len(metadata.keyframes),
        recordingDurationSeconds=metadata.recordingDurationSeconds,
    )


def _metadata_from_draft(draft: dict[str, object]) -> ReferenceTechniqueMetadata:
    keyframes_raw = draft.get("keyframes")
    if not isinstance(keyframes_raw, list) or len(keyframes_raw) != 5:
        raise DraftNotConfirmableError("Draft is missing five keyframes.")

    keyframes: list[ReferenceKeyframeMeta] = []
    for item in keyframes_raw:
        if not isinstance(item, dict):
            raise DraftNotConfirmableError("Draft keyframe metadata is invalid.")
        phase = item.get("phase")
        filename = item.get("filename")
        timestamp_ms = item.get("timestampMs")
        frame_index = item.get("frameIndex")
        if not isinstance(phase, str) or phase not in config.REFERENCE_KEYFRAME_FILENAMES:
            raise DraftNotConfirmableError("Draft keyframe phase is invalid.")
        expected = f"{config.REFERENCE_KEYFRAMES_SUBDIR}/{config.REFERENCE_KEYFRAME_FILENAMES[phase]}"
        if filename != expected:
            raise DraftNotConfirmableError("Draft keyframe filename is invalid.")
        if not isinstance(timestamp_ms, int) or not isinstance(frame_index, int):
            raise DraftNotConfirmableError("Draft keyframe timing is invalid.")
        keyframes.append(
            ReferenceKeyframeMeta(
                phase=phase,
                filename=expected,
                timestampMs=timestamp_ms,
                frameIndex=frame_index,
            )
        )

    window_raw = draft.get("movementWindow")
    if not isinstance(window_raw, dict):
        raise DraftNotConfirmableError("Draft movement window is missing.")
    start_ms = window_raw.get("startMs")
    end_ms = window_raw.get("endMs")
    duration_ms = window_raw.get("durationMs")
    if not isinstance(start_ms, int) or not isinstance(end_ms, int) or not isinstance(duration_ms, int):
        raise DraftNotConfirmableError("Draft movement window is invalid.")

    slug = draft["slug"]
    name = draft["name"]
    description = draft.get("description")
    pose_coverage = draft.get("poseCoverage")
    major_coverage = draft.get("majorLandmarkCoverage")
    if not isinstance(slug, str) or not isinstance(name, str):
        raise DraftNotConfirmableError("Draft identity is invalid.")
    if not isinstance(pose_coverage, (int, float)) or not isinstance(major_coverage, (int, float)):
        raise DraftNotConfirmableError("Draft quality fields are invalid.")
    if description is not None and not isinstance(description, str):
        raise DraftNotConfirmableError("Draft description is invalid.")

    created = draft.get("createdAt")
    created_at = created if isinstance(created, str) and created else utc_now_iso()

    return ReferenceTechniqueMetadata(
        id=slug,
        name=name,
        slug=slug,
        description=description,
        createdAt=created_at,
        referenceVideo=config.REFERENCE_VIDEO_FILENAME,
        referenceStrategy=config.REFERENCE_STRATEGY,
        movementWindow=MovementWindow(startMs=start_ms, endMs=end_ms, durationMs=duration_ms),
        poseCoverage=float(pose_coverage),
        majorLandmarkCoverage=float(major_coverage),
        keyframes=keyframes,
        recordingDurationSeconds=_recording_duration_seconds(draft),
    )


def _recording_duration_seconds(draft: dict[str, object]) -> int:
    video = draft.get("video")
    if isinstance(video, dict):
        duration_ms = video.get("durationMs")
        if isinstance(duration_ms, (int, float)) and duration_ms > 0:
            seconds = int(round(float(duration_ms) / 1000.0))
            return max(1, min(15, seconds))
    chosen = draft.get("recordingDurationSeconds")
    if isinstance(chosen, bool):
        return 3
    if isinstance(chosen, (int, float)) and 1 <= int(round(float(chosen))) <= 15:
        return int(round(float(chosen)))
    return 3


def _technique_dir(slug: str) -> Path:
    if not is_safe_slug(slug):
        raise DraftNotFoundError()
    root = techniques_root().resolve()
    directory = (root / slug).resolve()
    if directory.parent != root:
        raise DraftNotFoundError()
    return directory


def _existing_technique_dir(slug: str) -> Path:
    directory = _technique_dir(slug)
    if not directory.is_dir() or not (directory / config.REFERENCE_METADATA_FILENAME).is_file():
        raise DraftNotFoundError()
    return directory


def _require_uuid(value: str) -> None:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError) as error:
        raise DraftNotFoundError() from error


def _publish_directory(staging: Path, dest: Path, slug: str) -> None:
    """Move a completed staging folder into the permanent technique path.

    Windows often denies `os.replace` / `os.rename` on a directory that was
    just written (indexer, antivirus, leftover file handles). Retry, then copy.
    """
    if dest.exists():
        if (dest / config.REFERENCE_METADATA_FILENAME).is_file():
            raise DuplicateTechniqueError(slug)
        _remove_tree(dest)

    last_error: OSError | None = None
    for attempt in range(3):
        try:
            os.rename(staging, dest)
            return
        except OSError as error:
            last_error = error
            if dest.exists():
                break
            if attempt < 2:
                time.sleep(0.05)

    if dest.exists() and (dest / config.REFERENCE_METADATA_FILENAME).is_file():
        _remove_tree(staging)
        return
    if dest.exists():
        _remove_tree(dest)

    if not staging.exists():
        if last_error is not None:
            raise last_error
        raise OSError("Staging directory disappeared before it could be published.")

    shutil.copytree(staging, dest)
    _remove_tree(staging)


def remove_tree(path: Path) -> None:
    """Best-effort recursive delete with Windows retries."""
    _remove_tree(path)


def _remove_tree(path: Path) -> None:
    if not path.exists():
        return
    for attempt in range(6):
        try:
            shutil.rmtree(path)
            return
        except OSError:
            time.sleep(0.05 * (attempt + 1))
    shutil.rmtree(path, ignore_errors=True)
