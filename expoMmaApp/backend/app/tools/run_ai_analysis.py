"""Manual one-call Detailed AI Analysis smoke test.

Does not run as part of pytest. Requires a real GEMINI_API_KEY and --confirm.

Usage (from expoMmaApp/backend):

    python -m app.tools.run_ai_analysis --slug front-kick --user path\\to\\attempt.mp4 --confirm
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from app.ai.errors import AiAnalysisError
from app.ai.pipeline import run_detailed_analysis
from app.ai.store import discard_attempt, new_analysis_id, resolve_attempt_dir
from app.config import ensure_runtime_directories, gemini_api_key, gemini_model
from app.reference.errors import IncompleteReferenceError, TechniqueNotFoundError
from app.reference.store import load_complete_reference, technique_video_path
from app.video.store import discard_comparison


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run ONE Detailed AI Analysis against a stored reference and a USER video. "
            "Gemini receives one slowed, synchronized side-by-side comparison MP4."
        )
    )
    parser.add_argument("--slug", required=True, help="Confirmed recorded-technique slug.")
    parser.add_argument("--user", required=True, type=Path, help="Path to a USER attempt MP4.")
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required. Prevents accidental billed requests.",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Leave tmp/ai-attempts/<id>/ and tmp/comparisons/<id>/ on disk after the run.",
    )
    args = parser.parse_args(argv)

    if not args.confirm:
        print("error: pass --confirm to run a real Gemini request.", file=sys.stderr)
        return 2

    if not gemini_api_key():
        print("error: GEMINI_API_KEY is not set in the backend environment.", file=sys.stderr)
        return 2

    user_video: Path = args.user
    if not user_video.is_file():
        print(f"error: USER video not found: {user_video}", file=sys.stderr)
        return 2

    ensure_runtime_directories()
    try:
        metadata = load_complete_reference(args.slug)
        technique_video_path(args.slug)
    except TechniqueNotFoundError:
        print(f"error: recorded technique not found: {args.slug}", file=sys.stderr)
        return 2
    except IncompleteReferenceError as error:
        print(f"error: {error.message}", file=sys.stderr)
        return 2

    analysis_id = new_analysis_id()
    work_dir = resolve_attempt_dir(analysis_id)
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"provider:  gemini-video")
    print(f"model:     {gemini_model()}")
    print(f"technique: {metadata.name} ({metadata.slug})")
    print(f"analysis:  {analysis_id}")
    started = time.perf_counter()
    try:
        result = run_detailed_analysis(
            user_video,
            analysis_id=analysis_id,
            output_dir=work_dir,
            metadata=metadata,
        )
    except AiAnalysisError as error:
        print(f"error: {error.message}", file=sys.stderr)
        return 1
    finally:
        if not args.keep_temp:
            discard_attempt(analysis_id)
            discard_comparison(analysis_id)

    elapsed_s = time.perf_counter() - started
    structured_ok = result.comparisonValid is not None or result.analysisValid is False
    print(f"requestLatency: {elapsed_s:.1f}s")
    print(f"measurementValid: {result.analysisValid}")
    print(f"comparisonValid:  {result.comparisonValid}")
    print(f"structuredOutput: {'ok' if structured_ok else 'no'}")
    if result.movementWindow:
        print(f"userMovementDuration:      {result.movementWindow.durationMs / 1000:.2f}s")
    if result.referenceMovementWindow:
        print(f"referenceMovementDuration: {result.referenceMovementWindow.durationMs / 1000:.2f}s")
    if result.debug and result.debug.aiVideoDurationMs is not None:
        print(f"aiVideoDuration:           {result.debug.aiVideoDurationMs / 1000:.2f}s")
    if result.overallScore is None:
        print("overallScore:     (not scored)")
    else:
        print(f"overallScore:     {result.overallScore}/{result.overallMax}")
    if result.criteria:
        for item in result.criteria:
            if item.notApplicable:
                print(f"  {item.criterion.value}: N/A")
            else:
                print(f"  {item.criterion.value}: {item.score}/4")
    if result.debug:
        print(f"reportedModel:    {result.debug.model}")
        print(f"uploadMethod:     {result.debug.uploadMethod}")
        print(f"latencyMs:        {result.debug.latencyMs}")
    if result.failureMessage:
        print(f"failure:          {result.failureMessage}")
    if result.invalidReason:
        print(f"invalidReason:    {result.invalidReason}")
    return 0 if result.analysisValid else 1


if __name__ == "__main__":
    raise SystemExit(main())
