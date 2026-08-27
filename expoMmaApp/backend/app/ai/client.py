"""Experimental/legacy OpenAI still-image client.

Current GPT vision models do not accept raw MP4 video. Production Detailed
Analysis uses Gemini via `app.ai.providers.gemini_video`. Quick Comparison
never imports or calls this module.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from app.ai.errors import (
    MalformedAssessmentError,
    OpenAiAuthenticationError,
    OpenAiNotConfiguredError,
    OpenAiQuotaError,
    OpenAiRateLimitError,
    OpenAiTimeoutError,
    OpenAiUnavailableError,
)
from app.ai.models import ModelVisualAssessment
from app.config import OPENAI_TIMEOUT_SECONDS, openai_api_key, openai_model

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AssessmentCallResult:
    assessment: ModelVisualAssessment
    model: str
    input_tokens: int | None
    output_tokens: int | None


class AssessmentClient(Protocol):
    def assess(
        self,
        *,
        instructions: str,
        content: list[dict[str, object]],
        model: str | None = None,
    ) -> AssessmentCallResult: ...


class OpenAIAssessmentClient:
    """Thin wrapper around the official OpenAI Responses API."""

    def __init__(self, *, api_key: str | None = None, timeout_s: float | None = None) -> None:
        self._api_key = api_key if api_key is not None else openai_api_key()
        self._timeout_s = OPENAI_TIMEOUT_SECONDS if timeout_s is None else timeout_s

    def assess(
        self,
        *,
        instructions: str,
        content: list[dict[str, object]],
        model: str | None = None,
    ) -> AssessmentCallResult:
        if not self._api_key:
            raise OpenAiNotConfiguredError()

        try:
            from openai import OpenAI
        except ImportError as error:
            raise OpenAiUnavailableError(
                "Detailed AI Analysis is not available on this server."
            ) from error

        chosen_model = model or openai_model()
        client = OpenAI(api_key=self._api_key, timeout=self._timeout_s)
        logger.info("OpenAI Responses request model=%s images=%s", chosen_model, _image_count(content))

        try:
            response = client.responses.parse(
                model=chosen_model,
                instructions=instructions,
                input=[{"role": "user", "content": content}],
                text_format=ModelVisualAssessment,
                store=False,
                timeout=self._timeout_s,
            )
        except Exception as error:
            raise _map_openai_error(error) from error

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise MalformedAssessmentError()
        if not isinstance(parsed, ModelVisualAssessment):
            try:
                parsed = ModelVisualAssessment.model_validate(parsed)
            except Exception as error:
                raise MalformedAssessmentError() from error

        usage = getattr(response, "usage", None)
        input_tokens = _optional_int(getattr(usage, "input_tokens", None) if usage else None)
        output_tokens = _optional_int(getattr(usage, "output_tokens", None) if usage else None)
        reported_model = getattr(response, "model", None) or chosen_model
        return AssessmentCallResult(
            assessment=parsed,
            model=str(reported_model),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )


def _map_openai_error(error: Exception) -> Exception:
    name = type(error).__name__
    message = str(error).lower()
    status = getattr(error, "status_code", None)
    code = str(getattr(error, "code", "") or "").lower()

    logger.warning("OpenAI request failed type=%s status=%s code=%s", name, status, code or None)

    if name in {"AuthenticationError"} or status in {401, 403}:
        return OpenAiAuthenticationError()
    if "insufficient_quota" in code or "insufficient_quota" in message or "billing" in message:
        return OpenAiQuotaError()
    if name in {"RateLimitError"} or status == 429:
        return OpenAiRateLimitError()
    if name in {"APITimeoutError", "TimeoutException"} or "timeout" in name.lower():
        return OpenAiTimeoutError()
    if name in {"APIConnectionError"}:
        return OpenAiUnavailableError()
    if name in {"BadRequestError", "APIStatusError"} and status == 400:
        return MalformedAssessmentError()
    return OpenAiUnavailableError()


def _image_count(content: list[dict[str, object]]) -> int:
    return sum(1 for part in content if part.get("type") == "input_image")


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value
