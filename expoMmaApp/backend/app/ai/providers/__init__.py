"""Provider interface for Detailed AI Analysis.

Product routes depend on this protocol, not on a specific SDK.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.ai.models import ModelVideoAssessment


@dataclass(frozen=True)
class ProviderCallResult:
    assessment: ModelVideoAssessment
    provider: str
    model: str
    upload_method: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    requested_model: str | None = None
    primary_attempts: int = 1
    fallback_used: bool = False
    fallback_attempts: int = 0
    provider_latency_ms: int | None = None


ProgressCallback = Callable[..., None]


class VideoAssessmentProvider(Protocol):
    @property
    def name(self) -> str: ...

    def assess_video(
        self,
        *,
        video_path: Path,
        technique_name: str,
        description: str | None,
        model: str | None = None,
        reference_duration_ms: int | None = None,
        user_duration_ms: int | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> ProviderCallResult: ...
