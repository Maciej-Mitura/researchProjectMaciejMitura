"""Backend paths and non-technique runtime settings."""

from __future__ import annotations

import math
import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = BACKEND_ROOT / "assets"
MODEL_PATH = ASSETS_DIR / "models" / "pose_landmarker_lite.task"
TMP_DIR = BACKEND_ROOT / "tmp"
DATA_DIR = BACKEND_ROOT / "data"
REFERENCE_TECHNIQUES_DIR = DATA_DIR / "reference-techniques"
REFERENCE_DRAFTS_DIR = TMP_DIR / "reference-drafts"
VALIDATION_RUNS_DIR = DATA_DIR / "validation-runs"


def _load_backend_env() -> None:
    """Load backend-only secrets from backend/.env if python-dotenv is present.

    Existing process environment wins (override=False). Expo public env files
    are not read here — OpenAI and Gemini credentials must never be bundled into the app.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(BACKEND_ROOT / ".env", override=False)


_load_backend_env()

# OpenCV sometimes reports 0 / NaN FPS for phone recordings.
# 30 FPS matches typical Expo / mobile capture and is only used as a fallback.
FALLBACK_FPS = 30.0

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
JPEG_QUALITY = 95

# A usable attempt must be long enough to contain a jab cycle.
# Expo records ~3 seconds; these floors only reject broken/truncated files.
MIN_RECORDING_DURATION_MS = 500.0
MIN_FRAME_COUNT = 8

ALLOWED_VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".m4v", ".webm"})
ALLOWED_VIDEO_CONTENT_TYPES = frozenset(
    {
        "video/mp4",
        "video/quicktime",
        "video/x-m4v",
        "video/webm",
        "application/octet-stream",
    }
)

KEYFRAME_FILENAMES = {
    "START": "start.jpg",
    "EXTENSION": "extension.jpg",
    "PEAK": "peak.jpg",
    "RETRACTION": "retraction.jpg",
    "RECOVERY": "recovery.jpg",
}

# Generic reference keyframes (temporal labels, not technique phases).
REFERENCE_STRATEGY = "generic-motion-window-v1"
REFERENCE_VIDEO_FILENAME = "reference.mp4"
REFERENCE_METADATA_FILENAME = "metadata.json"
REFERENCE_KEYFRAMES_SUBDIR = "keyframes"
REFERENCE_KEYFRAME_FILENAMES = {
    "START": "01-start.jpg",
    "EARLY": "02-early.jpg",
    "MIDDLE": "03-middle.jpg",
    "LATE": "04-late.jpg",
    "END": "05-end.jpg",
}
REFERENCE_DRAFT_VIDEO_FILENAME = "source.mp4"
REFERENCE_DRAFT_METADATA_FILENAME = "draft.json"

# Recorded references are longer than a 3-second jab attempt (~6–8 s capture).
MAX_REFERENCE_DURATION_MS = 20_000.0
# Custom-technique USER attempts share the same backend duration ceiling.
# Expo records up to ~7 seconds; this only rejects unexpectedly long files.
MAX_GENERIC_ATTEMPT_DURATION_MS = MAX_REFERENCE_DURATION_MS

COMPARISON_ATTEMPTS_DIR = TMP_DIR / "comparison-attempts"
COMPARISONS_DIR = TMP_DIR / "comparisons"
COMPARISON_VIDEO_FILENAME = "comparison.mp4"
COMPARISON_POSE_VIDEO_FILENAME = "comparison-pose.mp4"
AI_COMPARISON_VIDEO_FILENAME = "ai-comparison.mp4"

AI_ATTEMPTS_DIR = TMP_DIR / "ai-attempts"
AI_ATTEMPT_VIDEO_FILENAME = "attempt.mp4"
AI_FRAMES_SUBDIR = "frames"
AI_CONTEXT_FILENAME = "ai-context.json"

# Prototype Gemini repeatability. Cost-bounded; not a statistical sample size.
MAX_GEMINI_REPEAT_COUNT = 3

# Dense ordered samples for experimental/legacy OpenAI image-sequence analysis.
# Production Detailed Analysis uses continuous video, not these stills.
DENSE_FRAME_COUNT = 12

# Longest side in pixels for experimental OpenAI image input. Aspect ratio is preserved.
AI_IMAGE_MAX_DIMENSION = 768
AI_JPEG_QUALITY = 80

# Small padding so the first/last active frame is not clipped. Used only via
# active_window_padding_ms() — do not scatter a second literal through call sites.
DEFAULT_ACTIVE_WINDOW_PADDING_MS = 100

# Merge short low-motion gaps inside one generic technique (combo pauses).
# 500 ms = 15 frames at 30 FPS. Bridges 150–200 ms combo gaps; does not join
# actions separated by several seconds of idle footage.
DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS = 500

# Canonical active clips shorter than this are treated as incomplete evidence.
MIN_CANONICAL_DURATION_MS = 200

# Encoded AI comparison may differ slightly from the target after muxing.
AI_DURATION_TOLERANCE_MS = 250

# Quick Comparison keeps a real-time-ish length (max of the two active windows).
MIN_COMPARISON_DURATION_MS = 200

# Gemini's default video sampling is ~1 FPS. Fast MMA clips are still slowed to
# this length so the model sees the full movement; explicit GEMINI_VIDEO_FPS
# then requests denser sampling of that normalized video.
DEFAULT_AI_COMPARISON_DURATION_MS = 8000
COMPARISON_OUTPUT_FPS = 30.0
COMPARISON_PANEL_HEIGHT = 640

DEFAULT_OPENAI_MODEL = "gpt-5.6-sol"
DEFAULT_GEMINI_MODEL = "gemini-3.7-flash"
DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.6-flash"
DEFAULT_GEMINI_MAX_RETRIES = 3
DEFAULT_GEMINI_RETRY_BASE_SECONDS = 2.0
AI_JOB_MAX_AGE_SECONDS = 3600.0
AI_JOB_POLL_HINT_MS = 800
# Inline video is acceptable well below Gemini's documented payload limit.
GEMINI_INLINE_MAX_BYTES = 20 * 1024 * 1024
# google-genai VideoMetadata.fps: default 1.0, valid range (0.0, 24.0].
DEFAULT_GEMINI_VIDEO_FPS = 8.0
GEMINI_VIDEO_FPS_MAX = 24.0


def _float_env(name: str, default: str) -> float:
    raw = os.environ.get(name, default) or default
    try:
        return float(raw)
    except ValueError:
        return float(default)


# Backend → OpenAI request timeout (experimental image-sequence path).
OPENAI_TIMEOUT_SECONDS = _float_env("OPENAI_TIMEOUT_SECONDS", "120")
# Backend → Gemini request timeout (production Detailed Analysis).
GEMINI_TIMEOUT_SECONDS = _float_env("GEMINI_TIMEOUT_SECONDS", "180")
# Stale USER temp media from crashed processes is removed after this age.
AI_ATTEMPT_MAX_AGE_SECONDS = 3600.0
COMPARISON_MAX_AGE_SECONDS = 3600.0

RESERVED_TECHNIQUE_IDS = frozenset({"simple_jab", "mmakick", "simple-jab", "mma-kick"})


def openai_api_key() -> str | None:
    value = os.environ.get("OPENAI_API_KEY", "").strip()
    return value or None


def openai_model() -> str:
    value = os.environ.get("OPENAI_MODEL", "").strip()
    return value or DEFAULT_OPENAI_MODEL


def gemini_api_key() -> str | None:
    value = os.environ.get("GEMINI_API_KEY", "").strip()
    return value or None


def gemini_model() -> str:
    value = os.environ.get("GEMINI_MODEL", "").strip()
    return value or DEFAULT_GEMINI_MODEL


def gemini_fallback_model() -> str | None:
    """Optional backup model after primary transient retries are exhausted.

    Empty string disables fallback. If it matches the primary, it is ignored.
    """
    raw = os.environ.get("GEMINI_FALLBACK_MODEL", DEFAULT_GEMINI_FALLBACK_MODEL)
    value = (raw or "").strip()
    if not value:
        return None
    primary = gemini_model()
    if value == primary:
        return None
    return value


def gemini_max_retries() -> int:
    """Maximum generate attempts per model, including the first try."""
    raw = os.environ.get("GEMINI_MAX_RETRIES", "").strip()
    if not raw:
        return DEFAULT_GEMINI_MAX_RETRIES
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_GEMINI_MAX_RETRIES
    return max(1, min(6, value))


def gemini_retry_base_seconds() -> float:
    raw = os.environ.get("GEMINI_RETRY_BASE_SECONDS", "").strip()
    if not raw:
        return DEFAULT_GEMINI_RETRY_BASE_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_GEMINI_RETRY_BASE_SECONDS
    if not math.isfinite(value) or value <= 0.0:
        return DEFAULT_GEMINI_RETRY_BASE_SECONDS
    return min(15.0, value)


def gemini_video_fps() -> float:
    """Gemini video sampling FPS. Invalid values fall back to 8; values above 24 are clamped."""
    raw = os.environ.get("GEMINI_VIDEO_FPS", "").strip()
    if not raw:
        return DEFAULT_GEMINI_VIDEO_FPS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_GEMINI_VIDEO_FPS
    if not math.isfinite(value) or value <= 0.0:
        return DEFAULT_GEMINI_VIDEO_FPS
    if value > GEMINI_VIDEO_FPS_MAX:
        return GEMINI_VIDEO_FPS_MAX
    return value


def generic_movement_max_gap_ms() -> int:
    raw = os.environ.get("GENERIC_MOVEMENT_MAX_GAP_MS", "").strip()
    if not raw:
        return DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS
    return max(0, value)


def active_window_padding_ms() -> int:
    raw = os.environ.get("ACTIVE_WINDOW_PADDING_MS", "").strip()
    if not raw:
        return DEFAULT_ACTIVE_WINDOW_PADDING_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_ACTIVE_WINDOW_PADDING_MS
    return max(0, value)


def ai_comparison_duration_ms() -> int:
    raw = os.environ.get("AI_COMPARISON_DURATION_MS", "").strip()
    if not raw:
        return DEFAULT_AI_COMPARISON_DURATION_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_AI_COMPARISON_DURATION_MS
    return max(MIN_COMPARISON_DURATION_MS, value)


def ensure_runtime_directories() -> None:
    """Create local persistence folders used by Uvicorn. Safe to call repeatedly."""
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    REFERENCE_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    REFERENCE_TECHNIQUES_DIR.mkdir(parents=True, exist_ok=True)
    COMPARISON_ATTEMPTS_DIR.mkdir(parents=True, exist_ok=True)
    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)
    AI_ATTEMPTS_DIR.mkdir(parents=True, exist_ok=True)
    VALIDATION_RUNS_DIR.mkdir(parents=True, exist_ok=True)
