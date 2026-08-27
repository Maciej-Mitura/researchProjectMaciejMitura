"""JSON files under a gitignored local folder. Not a database."""

from __future__ import annotations

import csv
import io
import json
import uuid
from pathlib import Path

from app import config
from app.reference.store import utc_now_iso
from app.validation.models import (
    SCENARIO_LABELS,
    ScenarioAggregate,
    ValidationRecord,
    ValidationRecordCreate,
    ValidationScenario,
    ValidationSummary,
    record_to_export_dict,
)

CSV_COLUMNS = (
    "id",
    "timestamp",
    "techniqueSlug",
    "techniqueName",
    "scenarioType",
    "comparisonValid",
    "invalidReason",
    "quickOverall",
    "quickPose",
    "quickPath",
    "quickTiming",
    "referenceMovementDurationMs",
    "userMovementDurationMs",
    "userMovementRegionCount",
    "referenceMovementRegionCount",
    "poseCoverage",
    "geminiOverall",
    "geminiMovementPath",
    "geminiRangeOfMotion",
    "geminiBodyPositioning",
    "geminiSequencingAndTiming",
    "geminiBalanceAndControl",
    "geminiRecoveryOrCompletion",
    "geminiModel",
    "geminiFallbackUsed",
    "geminiLatencyMs",
    "geminiAnalysisId",
    "totalAnalysisLatencyMs",
    "poseAnalysisMs",
    "comparisonVideoMs",
    "quickSimilarityMs",
    "aiVideoPreparationMs",
    "geminiProviderMs",
    "totalQuickMs",
    "totalDetailedMs",
    "selfComparison",
    "notes",
    "repeatMin",
    "repeatMax",
    "repeatMean",
    "repeatRange",
    "repeatCount",
)


def validation_root() -> Path:
    return config.VALIDATION_RUNS_DIR


def new_record_id() -> str:
    return str(uuid.uuid4())


def save_record(payload: ValidationRecordCreate | ValidationRecord) -> ValidationRecord:
    validation_root().mkdir(parents=True, exist_ok=True)
    if isinstance(payload, ValidationRecord):
        record = payload
    else:
        record = ValidationRecord(
            id=new_record_id(),
            timestamp=utc_now_iso(),
            **payload.model_dump(),
        )
    path = _record_path(record.id)
    path.write_text(json.dumps(record.model_dump(mode="json"), indent=2), encoding="utf-8")
    return record


def list_records() -> list[ValidationRecord]:
    root = validation_root()
    if not root.is_dir():
        return []
    records: list[ValidationRecord] = []
    for path in sorted(root.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            records.append(ValidationRecord.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    records.sort(key=lambda item: item.timestamp, reverse=True)
    return records


def summarize_records(records: list[ValidationRecord] | None = None) -> ValidationSummary:
    items = list_records() if records is None else records
    invalid = sum(1 for item in items if not item.comparisonValid)
    per_scenario: list[ScenarioAggregate] = []
    for scenario in ValidationScenario:
        subset = [item for item in items if item.scenarioType == scenario]
        if not subset:
            continue
        per_scenario.append(
            ScenarioAggregate(
                scenarioType=scenario,
                label=SCENARIO_LABELS[scenario],
                count=len(subset),
                invalidCount=sum(1 for item in subset if not item.comparisonValid),
                quickMean=_mean([item.quickOverall for item in subset if item.quickOverall is not None]),
                geminiMean=_mean([item.geminiOverall for item in subset if item.geminiOverall is not None]),
            )
        )
    return ValidationSummary(
        runCount=len(items),
        invalidCount=invalid,
        records=items,
        perScenario=per_scenario,
    )


def export_json_payload(records: list[ValidationRecord] | None = None) -> dict[str, object]:
    items = list_records() if records is None else records
    return {
        "exportedAt": utc_now_iso(),
        "recordCount": len(items),
        "disclaimer": (
            "Prototype validation metrics for a research prototype. "
            "Not statistically significant conclusions."
        ),
        "records": [record_to_export_dict(item) for item in items],
    }


def export_csv_text(records: list[ValidationRecord] | None = None) -> str:
    items = list_records() if records is None else records
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for item in items:
        writer.writerow(_csv_row(item))
    return buffer.getvalue()


def _csv_row(record: ValidationRecord) -> dict[str, object]:
    criteria = record.geminiCriteria
    latency = record.latency
    repeat = record.repeatability.overall if record.repeatability else None
    return {
        "id": record.id,
        "timestamp": record.timestamp,
        "techniqueSlug": record.techniqueSlug,
        "techniqueName": record.techniqueName,
        "scenarioType": record.scenarioType.value,
        "comparisonValid": record.comparisonValid,
        "invalidReason": record.invalidReason or "",
        "quickOverall": _empty(record.quickOverall),
        "quickPose": _empty(record.quickPose),
        "quickPath": _empty(record.quickPath),
        "quickTiming": _empty(record.quickTiming),
        "referenceMovementDurationMs": _empty(record.referenceMovementDurationMs),
        "userMovementDurationMs": _empty(record.userMovementDurationMs),
        "userMovementRegionCount": _empty(record.userMovementRegionCount),
        "referenceMovementRegionCount": _empty(record.referenceMovementRegionCount),
        "poseCoverage": _empty(record.poseCoverage),
        "geminiOverall": _empty(record.geminiOverall),
        "geminiMovementPath": _empty(criteria.movementPath if criteria else None),
        "geminiRangeOfMotion": _empty(criteria.rangeOfMotion if criteria else None),
        "geminiBodyPositioning": _empty(criteria.bodyPositioning if criteria else None),
        "geminiSequencingAndTiming": _empty(criteria.sequencingAndTiming if criteria else None),
        "geminiBalanceAndControl": _empty(criteria.balanceAndControl if criteria else None),
        "geminiRecoveryOrCompletion": _empty(criteria.recoveryOrCompletion if criteria else None),
        "geminiModel": record.geminiModel or "",
        "geminiFallbackUsed": "" if record.geminiFallbackUsed is None else record.geminiFallbackUsed,
        "geminiLatencyMs": _empty(record.geminiLatencyMs),
        "geminiAnalysisId": record.geminiAnalysisId or "",
        "totalAnalysisLatencyMs": _empty(record.totalAnalysisLatencyMs),
        "poseAnalysisMs": _empty(latency.poseAnalysisMs if latency else None),
        "comparisonVideoMs": _empty(latency.comparisonVideoMs if latency else None),
        "quickSimilarityMs": _empty(latency.quickSimilarityMs if latency else None),
        "aiVideoPreparationMs": _empty(latency.aiVideoPreparationMs if latency else None),
        "geminiProviderMs": _empty(latency.geminiProviderMs if latency else None),
        "totalQuickMs": _empty(latency.totalQuickMs if latency else None),
        "totalDetailedMs": _empty(latency.totalDetailedMs if latency else None),
        "selfComparison": record.selfComparison,
        "notes": record.notes or "",
        "repeatMin": _empty(repeat.minimum if repeat else None),
        "repeatMax": _empty(repeat.maximum if repeat else None),
        "repeatMean": _empty(repeat.mean if repeat else None),
        "repeatRange": _empty(repeat.scoreRange if repeat else None),
        "repeatCount": _empty(repeat.runCount if repeat else None),
    }


def _empty(value: object) -> object:
    return "" if value is None else value


def _mean(values: list[int]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _record_path(record_id: str) -> Path:
    uuid.UUID(record_id)
    return validation_root() / f"{record_id}.json"
