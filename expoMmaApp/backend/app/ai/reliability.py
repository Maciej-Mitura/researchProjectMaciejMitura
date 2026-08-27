"""Central Gemini retry and fallback policy.

Retries are only for transient provider capacity failures (503 / UNAVAILABLE,
transient 500 / INTERNAL, timeouts). Auth, permission, quota, bad request,
and malformed local input are never retried and never trigger fallback.

This is not scattered across HTTP routes.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from app.ai.errors import (
    AiAnalysisError,
    AiPreprocessingError,
    ComparisonVideoInvalidError,
    GeminiAuthenticationError,
    GeminiNotConfiguredError,
    GeminiQuotaError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUnavailableError,
    MalformedAssessmentError,
)
from app.config import (
    gemini_fallback_model,
    gemini_max_retries,
    gemini_model,
    gemini_retry_base_seconds,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

RETRYABLE_HTTP = frozenset({408, 500, 502, 503, 504})
NON_RETRYABLE_HTTP = frozenset({400, 401, 403, 404, 409, 413, 422, 429})
RETRYABLE_GOOGLE = frozenset(
    {"UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "ABORTED", "UNKNOWN"}
)
NON_RETRYABLE_GOOGLE = frozenset(
    {
        "UNAUTHENTICATED",
        "PERMISSION_DENIED",
        "INVALID_ARGUMENT",
        "FAILED_PRECONDITION",
        "RESOURCE_EXHAUSTED",
        "NOT_FOUND",
    }
)
NON_RETRYABLE_TYPES = (
    GeminiNotConfiguredError,
    GeminiAuthenticationError,
    GeminiQuotaError,
    GeminiRateLimitError,
    MalformedAssessmentError,
    AiPreprocessingError,
    ComparisonVideoInvalidError,
)

_MODEL_LABELS = {
    "gemini-3.7-flash": "Gemini 3.7 Flash",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
}


@dataclass(frozen=True)
class RetrySettings:
    primary_model: str
    fallback_model: str | None
    max_attempts: int
    base_seconds: float


@dataclass(frozen=True)
class ProviderAttemptMeta:
    requested_model: str
    actual_model: str
    primary_attempts: int
    fallback_used: bool
    fallback_attempts: int
    latency_ms: int


class RetryEvent:
    def __init__(
        self,
        *,
        model: str,
        attempt: int,
        max_attempts: int,
        is_fallback: bool,
        is_retry: bool,
    ) -> None:
        self.model = model
        self.attempt = attempt
        self.max_attempts = max_attempts
        self.is_fallback = is_fallback
        self.is_retry = is_retry


def load_retry_settings() -> RetrySettings:
    return RetrySettings(
        primary_model=gemini_model(),
        fallback_model=gemini_fallback_model(),
        max_attempts=gemini_max_retries(),
        base_seconds=gemini_retry_base_seconds(),
    )


def display_model_name(model: str | None) -> str:
    if not model:
        return "Gemini"
    return _MODEL_LABELS.get(model, model)


def inspect_http_status(error: Exception) -> int | None:
    http_status = getattr(error, "status_code", None)
    google_code = getattr(error, "code", None)
    if http_status is None and isinstance(google_code, int):
        http_status = google_code
    if isinstance(http_status, int):
        return http_status
    return None


def inspect_google_status(error: Exception) -> str | None:
    status = getattr(error, "status", None)
    if isinstance(status, str) and status.strip():
        return status.strip().upper()
    return None


def is_retryable_gemini_error(error: Exception) -> bool:
    if isinstance(error, NON_RETRYABLE_TYPES):
        return False
    status = inspect_http_status(error)
    google_status = inspect_google_status(error)
    if status in NON_RETRYABLE_HTTP or google_status in NON_RETRYABLE_GOOGLE:
        return False
    if isinstance(error, GeminiTimeoutError):
        return True
    if isinstance(error, GeminiUnavailableError):
        if status in RETRYABLE_HTTP or google_status in RETRYABLE_GOOGLE:
            return True
        message = str(error).lower()
        if "high demand" in message or "try again later" in message or "unavailable" in message:
            return True
        return status is None and google_status is None
    if status in RETRYABLE_HTTP or google_status in RETRYABLE_GOOGLE:
        return True
    message = str(error).lower()
    return "high demand" in message or "try again later" in message or "unavailable" in message


def retry_delay_seconds(attempt: int, base_seconds: float) -> float:
    """Wait after a failed attempt before the next try. attempt is 1-based for the failure that just happened."""
    delay = base_seconds * (2 ** max(0, attempt - 1))
    jitter = random.uniform(0.0, min(0.35, delay * 0.2))
    return delay + jitter


def backoff_sleep(seconds: float) -> None:
    if seconds > 0:
        time.sleep(seconds)


def execute_with_retry(
    operation: Callable[[str], T],
    *,
    settings: RetrySettings | None = None,
    on_attempt: Callable[[RetryEvent], None] | None = None,
    sleep_fn: Callable[[float], None] = backoff_sleep,
) -> tuple[T, ProviderAttemptMeta]:
    policy = settings or load_retry_settings()
    started = time.perf_counter()
    primary_attempts = 0
    fallback_attempts = 0

    def run_series(model: str, *, is_fallback: bool) -> T:
        nonlocal primary_attempts, fallback_attempts
        last_error: Exception | None = None
        for attempt in range(1, policy.max_attempts + 1):
            if is_fallback:
                fallback_attempts = attempt
            else:
                primary_attempts = attempt
            if on_attempt is not None:
                on_attempt(
                    RetryEvent(
                        model=model,
                        attempt=attempt,
                        max_attempts=policy.max_attempts,
                        is_fallback=is_fallback,
                        is_retry=attempt > 1,
                    )
                )
            try:
                return operation(model)
            except Exception as error:
                mapped = error if isinstance(error, AiAnalysisError) else error
                if not is_retryable_gemini_error(mapped):
                    raise mapped
                last_error = mapped
                logger.warning(
                    "Transient Gemini failure model=%s attempt=%s/%s fallback=%s",
                    model,
                    attempt,
                    policy.max_attempts,
                    is_fallback,
                )
                if attempt < policy.max_attempts:
                    sleep_fn(retry_delay_seconds(attempt, policy.base_seconds))
        assert last_error is not None
        raise last_error

    try:
        result = run_series(policy.primary_model, is_fallback=False)
        actual = getattr(result, "model", None) or policy.primary_model
        return result, ProviderAttemptMeta(
            requested_model=policy.primary_model,
            actual_model=str(actual),
            primary_attempts=primary_attempts,
            fallback_used=False,
            fallback_attempts=0,
            latency_ms=_elapsed_ms(started),
        )
    except Exception as primary_error:
        if not is_retryable_gemini_error(primary_error) or not policy.fallback_model:
            raise
        logger.warning(
            "Primary Gemini model exhausted retries; trying fallback=%s",
            policy.fallback_model,
        )
        try:
            result = run_series(policy.fallback_model, is_fallback=True)
        except Exception as fallback_error:
            if isinstance(fallback_error, GeminiUnavailableError):
                raise GeminiUnavailableError(
                    "Google Gemini could not complete analysis after retries and the backup model. Quick Comparison still works."
                ) from fallback_error
            raise
        actual = getattr(result, "model", None) or policy.fallback_model
        return result, ProviderAttemptMeta(
            requested_model=policy.primary_model,
            actual_model=str(actual),
            primary_attempts=primary_attempts,
            fallback_used=True,
            fallback_attempts=fallback_attempts,
            latency_ms=_elapsed_ms(started),
        )


def _elapsed_ms(started: float) -> int:
    return int(round((time.perf_counter() - started) * 1000))
