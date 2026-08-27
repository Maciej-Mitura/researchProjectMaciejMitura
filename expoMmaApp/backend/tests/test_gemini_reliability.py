"""Gemini retry/fallback policy. No real Gemini calls."""

from __future__ import annotations

import pytest

from app.ai.errors import (
    GeminiAuthenticationError,
    GeminiQuotaError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUnavailableError,
    MalformedAssessmentError,
)
from app.ai.reliability import (
    RetrySettings,
    execute_with_retry,
    is_retryable_gemini_error,
    retry_delay_seconds,
)


def _settings(*, fallback: str | None = "gemini-3.6-flash") -> RetrySettings:
    return RetrySettings(
        primary_model="gemini-3.7-flash",
        fallback_model=fallback,
        max_attempts=3,
        base_seconds=2.0,
    )


def test_retryable_classification() -> None:
    class Busy(Exception):
        status_code = 503
        status = "UNAVAILABLE"

        def __str__(self) -> str:
            return "This model is currently experiencing high demand. Please try again later."

    assert is_retryable_gemini_error(Busy()) is True
    assert is_retryable_gemini_error(GeminiUnavailableError()) is True
    assert is_retryable_gemini_error(GeminiTimeoutError()) is True
    assert is_retryable_gemini_error(GeminiAuthenticationError()) is False
    assert is_retryable_gemini_error(GeminiQuotaError()) is False
    assert is_retryable_gemini_error(GeminiRateLimitError()) is False
    assert is_retryable_gemini_error(MalformedAssessmentError()) is False

    class Forbidden(Exception):
        status_code = 403
        status = "PERMISSION_DENIED"

    assert is_retryable_gemini_error(Forbidden()) is False

    class BadRequest(Exception):
        status_code = 400
        status = "INVALID_ARGUMENT"

    assert is_retryable_gemini_error(BadRequest()) is False


def test_retry_delay_is_exponential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.ai.reliability.random.uniform", lambda *_args, **_kwargs: 0.0)
    assert retry_delay_seconds(1, 2.0) == 2.0
    assert retry_delay_seconds(2, 2.0) == 4.0
    assert retry_delay_seconds(3, 2.0) == 8.0


def test_transient_503_retries_then_succeeds() -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def operation(model: str) -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise GeminiUnavailableError("This model is currently experiencing high demand.")
        return f"ok:{model}"

    result, meta = execute_with_retry(
        operation,
        settings=_settings(),
        sleep_fn=sleeps.append,
    )
    assert result == "ok:gemini-3.7-flash"
    assert calls["n"] == 3
    assert meta.primary_attempts == 3
    assert meta.fallback_used is False
    assert len(sleeps) == 2
    assert sleeps[0] >= 2.0
    assert sleeps[1] >= 4.0


def test_retry_count_is_bounded() -> None:
    calls = {"n": 0}

    def operation(_model: str) -> str:
        calls["n"] += 1
        raise GeminiUnavailableError("high demand")

    with pytest.raises(GeminiUnavailableError):
        execute_with_retry(operation, settings=_settings(fallback=None), sleep_fn=lambda _s: None)
    assert calls["n"] == 3


def test_fallback_used_after_primary_exhaustion() -> None:
    models: list[str] = []

    def operation(model: str) -> str:
        models.append(model)
        if model == "gemini-3.7-flash":
            raise GeminiUnavailableError("high demand")
        return "ok-fallback"

    result, meta = execute_with_retry(
        operation,
        settings=_settings(),
        sleep_fn=lambda _s: None,
    )
    assert result == "ok-fallback"
    assert meta.fallback_used is True
    assert meta.actual_model == "ok-fallback" or meta.fallback_attempts >= 1
    assert models.count("gemini-3.7-flash") == 3
    assert "gemini-3.6-flash" in models
    assert meta.requested_model == "gemini-3.7-flash"


def test_fallback_success_records_actual_model() -> None:
    def operation(model: str) -> object:
        if model.endswith("3.7-flash"):
            raise GeminiUnavailableError("UNAVAILABLE")

        class Result:
            model = "gemini-3.6-flash"

        return Result()

    _result, meta = execute_with_retry(operation, settings=_settings(), sleep_fn=lambda _s: None)
    assert meta.fallback_used is True
    assert meta.actual_model == "gemini-3.6-flash"
    assert meta.primary_attempts == 3
    assert meta.fallback_attempts == 1


def test_fallback_not_used_for_auth_quota_or_bad_request() -> None:
    for error in (
        GeminiAuthenticationError(),
        GeminiQuotaError(),
        GeminiRateLimitError(),
        MalformedAssessmentError(),
    ):
        calls = {"n": 0}

        def operation(_model: str, current=error) -> str:
            calls["n"] += 1
            raise current

        with pytest.raises(type(error)):
            execute_with_retry(operation, settings=_settings(), sleep_fn=lambda _s: None)
        assert calls["n"] == 1


def test_no_fallback_when_unconfigured() -> None:
    def operation(_model: str) -> str:
        raise GeminiUnavailableError("high demand")

    with pytest.raises(GeminiUnavailableError):
        execute_with_retry(operation, settings=_settings(fallback=None), sleep_fn=lambda _s: None)
