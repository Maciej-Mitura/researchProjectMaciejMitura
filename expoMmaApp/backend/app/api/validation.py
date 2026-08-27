"""HTTP routes for prototype validation, export, and developer checks."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse

from app.reference.errors import DraftNotFoundError, IncompleteReferenceError, TechniqueNotFoundError
from app.reference.slug import is_safe_slug
from app.validation.gemini_repeat import run_gemini_repeatability
from app.validation.models import (
    GeminiRepeatabilityRequest,
    RepeatabilityResult,
    SelfCompareResponse,
    ValidationRecord,
    ValidationRecordCreate,
    ValidationSummary,
)
from app.validation.self_compare import run_self_comparison
from app.validation.store import export_csv_text, export_json_payload, list_records, save_record, summarize_records

router = APIRouter(prefix="/validation", tags=["validation"])


def _self_compare_or_http(slug: str, *, render_video: bool) -> SelfCompareResponse:
    if not is_safe_slug(slug):
        raise HTTPException(status_code=404, detail="Recorded reference technique not found.")
    try:
        return run_self_comparison(slug, render_video=render_video)
    except TechniqueNotFoundError as error:
        raise HTTPException(status_code=404, detail=error.message) from error
    except DraftNotFoundError as error:
        raise HTTPException(status_code=422, detail="Recorded reference video is missing.") from error
    except IncompleteReferenceError as error:
        raise HTTPException(status_code=422, detail=error.message) from error


@router.post("/self-compare/{slug}", response_model=SelfCompareResponse)
def self_compare(slug: str) -> SelfCompareResponse:
    return _self_compare_or_http(slug, render_video=True)


@router.post("/deterministic-repeat/{slug}", response_model=SelfCompareResponse)
def deterministic_repeat(slug: str) -> SelfCompareResponse:
    return _self_compare_or_http(slug, render_video=False)


@router.post("/records", response_model=ValidationRecord)
def create_validation_record(payload: ValidationRecordCreate) -> ValidationRecord:
    return save_record(payload)


@router.get("/records", response_model=list[ValidationRecord])
def get_validation_records() -> list[ValidationRecord]:
    return list_records()


@router.get("/summary", response_model=ValidationSummary)
def get_validation_summary() -> ValidationSummary:
    return summarize_records()


@router.get("/export.json")
def export_validation_json() -> JSONResponse:
    payload = export_json_payload()
    return JSONResponse(
        payload,
        headers={"Content-Disposition": "attachment; filename=validation-export.json"},
    )


@router.get("/export.csv")
def export_validation_csv() -> PlainTextResponse:
    return PlainTextResponse(
        export_csv_text(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=validation-export.csv"},
    )


@router.post("/gemini-repeatability", response_model=RepeatabilityResult)
def gemini_repeatability(payload: GeminiRepeatabilityRequest) -> RepeatabilityResult:
    try:
        return run_gemini_repeatability(analysis_id=payload.analysisId, run_count=payload.runCount)
    except DraftNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="No prepared AI comparison video was found for this analysis.",
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
