"""Gemini video provider for production Detailed AI Analysis.

Expo never talks to Gemini. Flow: Expo → FastAPI → this module → Gemini.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from app.ai.errors import (
    GeminiAuthenticationError,
    GeminiNotConfiguredError,
    GeminiQuotaError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUnavailableError,
    MalformedAssessmentError,
)
from app.ai.models import HOLISTIC_OVERALL_SIMILARITY_ID, ModelVideoAssessment
from app.ai.progress import AnalysisStage
from app.ai.providers import ProgressCallback, ProviderCallResult
from app.ai.reliability import RetryEvent, execute_with_retry, load_retry_settings
from app.ai.video_prompt import VIDEO_INSTRUCTIONS, video_user_prompt
from app.config import (
    GEMINI_INLINE_MAX_BYTES,
    GEMINI_TIMEOUT_SECONDS,
    gemini_api_key,
    gemini_video_fps,
)

logger = logging.getLogger(__name__)

PROVIDER_NAME = "gemini-video"


class GeminiVideoProvider:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_s: float | None = None,
        inline_max_bytes: int = GEMINI_INLINE_MAX_BYTES,
    ) -> None:
        self._api_key = api_key if api_key is not None else gemini_api_key()
        self._timeout_s = GEMINI_TIMEOUT_SECONDS if timeout_s is None else timeout_s
        self._inline_max_bytes = inline_max_bytes

    @property
    def name(self) -> str:
        return PROVIDER_NAME

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
    ) -> ProviderCallResult:
        if not self._api_key:
            raise GeminiNotConfiguredError()
        if not video_path.is_file():
            raise GeminiUnavailableError("The comparison video could not be prepared for analysis.")

        try:
            from google import genai
            from google.genai import types
        except ImportError as error:
            raise GeminiUnavailableError(
                "Detailed AI Analysis is not available on this server."
            ) from error

        settings = load_retry_settings()
        if model:
            settings = type(settings)(
                primary_model=model,
                fallback_model=None if model == settings.fallback_model else settings.fallback_model,
                max_attempts=settings.max_attempts,
                base_seconds=settings.base_seconds,
            )
        sampling_fps = gemini_video_fps()
        prompt = video_user_prompt(
            technique_name=technique_name,
            description=description,
            reference_duration_ms=reference_duration_ms,
            user_duration_ms=user_duration_ms,
        )
        video_bytes = video_path.read_bytes()
        use_inline = len(video_bytes) <= self._inline_max_bytes
        upload_method = "inline" if use_inline else "files_api"
        client = genai.Client(
            api_key=self._api_key,
            http_options={"timeout": int(self._timeout_s * 1000)},
        )

        def on_attempt(event: RetryEvent) -> None:
            if on_progress is None:
                return
            if event.is_fallback:
                on_progress(
                    AnalysisStage.CONTACTING_FALLBACK_MODEL,
                    model=event.model,
                    attempt=event.attempt,
                    max_attempts=event.max_attempts,
                    fallback_used=True,
                )
                return
            stage = (
                AnalysisStage.RETRYING_PRIMARY_MODEL
                if event.is_retry
                else AnalysisStage.CONTACTING_PRIMARY_MODEL
            )
            on_progress(
                stage,
                model=event.model,
                attempt=event.attempt,
                max_attempts=event.max_attempts,
                fallback_used=False,
            )

        def operation(chosen_model: str) -> ProviderCallResult:
            return _generate_once(
                client=client,
                types=types,
                video_path=video_path,
                video_bytes=video_bytes,
                prompt=prompt,
                chosen_model=chosen_model,
                sampling_fps=sampling_fps,
                use_inline=use_inline,
                upload_method=upload_method,
                timeout_s=self._timeout_s,
            )

        result, meta = execute_with_retry(operation, settings=settings, on_attempt=on_attempt)
        return ProviderCallResult(
            assessment=result.assessment,
            provider=result.provider,
            model=meta.actual_model,
            upload_method=result.upload_method,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            requested_model=meta.requested_model,
            primary_attempts=meta.primary_attempts,
            fallback_used=meta.fallback_used,
            fallback_attempts=meta.fallback_attempts,
            provider_latency_ms=meta.latency_ms,
        )


def _generate_once(
    *,
    client: Any,
    types: Any,
    video_path: Path,
    video_bytes: bytes,
    prompt: str,
    chosen_model: str,
    sampling_fps: float,
    use_inline: bool,
    upload_method: str,
    timeout_s: float,
) -> ProviderCallResult:
    uploaded_name: str | None = None
    logger.info(
        "Gemini video request model=%s method=%s bytes=%s fps=%s",
        chosen_model,
        upload_method,
        len(video_bytes),
        sampling_fps,
    )
    stage = "inline_generate" if use_inline else "files_upload"
    try:
        if use_inline:
            video_part = _inline_video_part(types, video_bytes, fps=sampling_fps)
        else:
            stage = "files_upload"
            uploaded = client.files.upload(file=video_path)
            uploaded_name = getattr(uploaded, "name", None)
            stage = "files_processing"
            uploaded = _wait_until_active(client, uploaded, timeout_s=timeout_s)
            video_part = _files_api_video_part(types, uploaded, fps=sampling_fps)
        stage = "inline_generate" if use_inline else "generate"
        response = client.models.generate_content(
            model=chosen_model,
            contents=[video_part, prompt],
            config=types.GenerateContentConfig(
                system_instruction=VIDEO_INSTRUCTIONS,
                response_mime_type="application/json",
                response_schema=ModelVideoAssessment,
            ),
        )
    except Exception as error:
        raise _map_gemini_error(error, stage=stage) from error
    finally:
        if uploaded_name:
            _delete_uploaded_file(client, uploaded_name)

    parsed = _parse_response(response)
    usage = getattr(response, "usage_metadata", None)
    input_tokens = _optional_int(getattr(usage, "prompt_token_count", None) if usage else None)
    output_tokens = _optional_int(
        getattr(usage, "candidates_token_count", None) if usage else None
    )
    reported_model = getattr(response, "model_version", None) or chosen_model
    return ProviderCallResult(
        assessment=parsed,
        provider=PROVIDER_NAME,
        model=str(reported_model),
        upload_method=upload_method,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _wait_until_active(client: object, uploaded: object, *, timeout_s: float) -> object:
    deadline = time.monotonic() + timeout_s
    current = uploaded
    while time.monotonic() < deadline:
        state = _file_state(current)
        if state == "ACTIVE":
            return current
        if state == "FAILED":
            raise GeminiUnavailableError("The comparison video could not be processed by the analysis service.")
        time.sleep(1.0)
        name = getattr(current, "name", None)
        getter = getattr(client, "files", None)
        if getter is None or name is None:
            break
        current = getter.get(name=name)
    raise GeminiTimeoutError()


def _file_state(uploaded: object) -> str:
    state = getattr(uploaded, "state", None)
    if state is None:
        return ""
    name = getattr(state, "name", None)
    if isinstance(name, str):
        return name.upper()
    return str(state).upper()


def _delete_uploaded_file(client: object, name: str) -> None:
    try:
        files = getattr(client, "files", None)
        if files is not None:
            files.delete(name=name)
    except Exception:
        logger.warning("Could not delete uploaded Gemini file")


def _inline_video_part(types: Any, video_bytes: bytes, *, fps: float) -> Any:
    blob = types.Blob(data=video_bytes, mime_type="video/mp4")
    return types.Part(
        inline_data=blob,
        video_metadata=types.VideoMetadata(fps=fps),
    )


def _files_api_video_part(types: Any, uploaded: object, *, fps: float) -> Any:
    uri = getattr(uploaded, "uri", None)
    mime_type = getattr(uploaded, "mime_type", None) or "video/mp4"
    if not uri:
        raise GeminiUnavailableError("The comparison video could not be prepared for analysis.")
    return types.Part(
        file_data=types.FileData(file_uri=uri, mime_type=mime_type),
        video_metadata=types.VideoMetadata(fps=fps),
    )


def _parse_response(response: object) -> ModelVideoAssessment:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, ModelVideoAssessment):
        return parsed
    if parsed is not None:
        try:
            return ModelVideoAssessment.model_validate(_strip_holistic_criteria(parsed))
        except Exception as error:
            raise MalformedAssessmentError() from error
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        try:
            payload = json.loads(text)
            return ModelVideoAssessment.model_validate(_strip_holistic_criteria(payload))
        except Exception as error:
            raise MalformedAssessmentError() from error
    raise MalformedAssessmentError()


def _strip_holistic_criteria(payload: object) -> object:
    if not isinstance(payload, dict):
        return payload
    criteria = payload.get("criteria")
    if not isinstance(criteria, list):
        return payload
    stripped = [
        item
        for item in criteria
        if not (isinstance(item, dict) and item.get("criterion") == HOLISTIC_OVERALL_SIMILARITY_ID)
    ]
    return {**payload, "criteria": stripped}


def _map_gemini_error(error: Exception, *, stage: str | None = None) -> Exception:
    name = type(error).__name__
    http_status = getattr(error, "status_code", None)
    google_code = getattr(error, "code", None)
    google_status = getattr(error, "status", None)
    if http_status is None and isinstance(google_code, int):
        http_status = google_code
    sanitized = _sanitize_gemini_message(str(error))
    logger.warning(
        "Gemini request failed stage=%s http_status=%s google_status=%s google_code=%s message=%s",
        stage or "unknown",
        http_status,
        google_status,
        google_code,
        sanitized,
    )

    if name in {
        "GeminiNotConfiguredError",
        "GeminiAuthenticationError",
        "GeminiQuotaError",
        "GeminiRateLimitError",
        "GeminiTimeoutError",
        "GeminiUnavailableError",
        "MalformedAssessmentError",
    }:
        return error
    message = str(error).lower()
    status = http_status if http_status is not None else google_code
    if "api key" in message or "unauthenticated" in message or status in {401, 403}:
        return GeminiAuthenticationError()
    if "quota" in message or "resource exhausted" in message or "billing" in message:
        return GeminiQuotaError()
    if "rate" in message and "limit" in message or status == 429:
        return GeminiRateLimitError()
    if "timeout" in name.lower() or "deadline" in message or "timed out" in message:
        return GeminiTimeoutError()
    if "json" in message or "schema" in message or "parse" in message:
        return MalformedAssessmentError()
    return GeminiUnavailableError()


def _sanitize_gemini_message(message: str) -> str:
    text = re.sub(r"(?i)(api[_-]?key|authorization|bearer)\s*[=:]\s*\S+", r"\1=***", message)
    text = re.sub(r"AIza[0-9A-Za-z_\-]{10,}", "***", text)
    text = re.sub(r"[A-Za-z]:\\[^\s\"']+", "<path>", text)
    text = re.sub(r"(?:/home|/Users)/[^\s\"']+", "<path>", text)
    return text[:400]


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value
