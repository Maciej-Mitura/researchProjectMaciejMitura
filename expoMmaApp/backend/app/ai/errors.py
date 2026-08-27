"""Typed failures for Detailed AI Analysis. Messages are safe to show to athletes."""

from __future__ import annotations


class AiAnalysisError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class OpenAiNotConfiguredError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "openai_not_configured",
            "Detailed AI Analysis is not configured on the server. Quick Comparison still works.",
            status_code=503,
        )


class OpenAiAuthenticationError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "openai_auth",
            "Detailed AI Analysis could not authenticate. Check the server configuration.",
            status_code=503,
        )


class OpenAiQuotaError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "openai_quota",
            "Detailed AI Analysis is temporarily unavailable due to usage limits.",
            status_code=503,
        )


class OpenAiRateLimitError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "openai_rate_limit",
            "Too many analysis requests. Please try again in a moment.",
            status_code=429,
        )


class OpenAiTimeoutError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "openai_timeout",
            "Detailed AI Analysis took too long. Please try again.",
            status_code=504,
        )


class OpenAiUnavailableError(AiAnalysisError):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            "openai_unavailable",
            message
            or "Detailed AI Analysis is temporarily unavailable. Quick Comparison still works.",
            status_code=503,
        )


class GeminiNotConfiguredError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "gemini_not_configured",
            "Google Gemini is not configured on the server. Quick Comparison still works.",
            status_code=503,
        )


class GeminiAuthenticationError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "gemini_auth",
            "Google Gemini could not authenticate. Check the backend configuration. Quick Comparison still works.",
            status_code=503,
        )


class GeminiQuotaError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "gemini_quota",
            "Google Gemini usage or billing limits stopped this analysis. Quick Comparison still works.",
            status_code=503,
        )


class GeminiRateLimitError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "gemini_rate_limit",
            "Google Gemini is busy. Please try again in a moment. Quick Comparison still works.",
            status_code=429,
        )


class GeminiTimeoutError(AiAnalysisError):
    def __init__(self) -> None:
        super().__init__(
            "gemini_timeout",
            "Google Gemini took too long. Please try again. Quick Comparison still works.",
            status_code=504,
        )


class GeminiUnavailableError(AiAnalysisError):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            "gemini_unavailable",
            message
            or "Google Gemini is temporarily unavailable due to high demand. Quick Comparison still works.",
            status_code=503,
        )


class MalformedAssessmentError(AiAnalysisError):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            "ai_malformed",
            message
            or "Google Gemini returned a result that could not be used. Please try again. Quick Comparison still works.",
            status_code=502,
        )


class AiPreprocessingError(AiAnalysisError):
    def __init__(self, message: str) -> None:
        super().__init__("ai_preprocessing", message, status_code=422)


COMPARISON_VIDEO_INVALID_CODE = "comparison_video_invalid"
COMPARISON_VIDEO_INVALID_MESSAGE = (
    "The complete movement could not be prepared for AI analysis. Please retry the recording."
)


class ComparisonVideoInvalidError(AiAnalysisError):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            COMPARISON_VIDEO_INVALID_CODE,
            message or COMPARISON_VIDEO_INVALID_MESSAGE,
            status_code=422,
        )


class DenseSampleError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
