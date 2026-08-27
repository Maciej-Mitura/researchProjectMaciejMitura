"""Analyze a local attempt video with the same pipeline as the HTTP API.

Usage (from expoMmaApp/backend):

    python -m app.tools.analyze_video path/to/attempt.mp4 --technique simple_jab
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.analysis.pipeline import analyze_attempt
from app.config import TMP_DIR
from app.techniques.catalog import UnsupportedTechniqueError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Phase 3 jab pose analysis on a local video file.",
    )
    parser.add_argument("video", type=Path, help="Path to an MP4 (or similar) attempt recording.")
    parser.add_argument(
        "--technique",
        default="simple_jab",
        help="Technique id. Phase 3 supports simple_jab only.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for keyframes. Defaults to backend/tmp/<analysis-id>/",
    )
    args = parser.parse_args(argv)

    video_path: Path = args.video
    if not video_path.is_file():
        print(f"error: video not found: {video_path}", file=sys.stderr)
        return 2

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        result = analyze_attempt(
            video_path,
            args.technique,
            output_dir=args.output_dir,
        )
    except UnsupportedTechniqueError as error:
        print(f"error: {error.reason}", file=sys.stderr)
        return 2

    print(f"analysisId:     {result.analysisId}")
    print(f"techniqueId:    {result.techniqueId}")
    print(f"analysisValid:  {result.analysisValid}")
    if result.failureReason:
        print(f"failureReason:  {result.failureReason}")
        print(f"failureMessage: {result.failureMessage}")
    if result.video:
        print(
            "video:          "
            f"{result.video.width}x{result.video.height} "
            f"{result.video.fps:.2f} fps "
            f"{result.video.durationMs:.0f} ms "
            f"({result.video.frameCount} frames)"
        )
    if result.poseCoverage is not None:
        print(f"poseCoverage:   {result.poseCoverage:.1%}")
    if result.phases:
        print("phases:")
        for phase in result.phases:
            filename = phase.keyframeFilename or "-"
            location = ""
            if args.output_dir:
                location = str(args.output_dir / filename)
            elif result.debug and result.debug.keyframeDir:
                location = str(TMP_DIR / result.debug.keyframeDir / filename)
            print(
                f"  {phase.phase:<12} frame={phase.frameIndex:<5} "
                f"t={phase.timestampMs}ms  {location}"
            )
    if result.debug:
        print("debug:")
        print(f"  leadSide={result.debug.leadSide}")
        print(f"  baseline={result.debug.baseline}")
        print(f"  peakExtension={result.debug.peakExtension}")
        print(f"  extensionDelta={result.debug.extensionDelta}")
        print(
            f"  smoothing={result.debug.smoothingMethod} "
            f"window={result.debug.smoothingWindow}"
        )
        print(f"  fpsFallbackUsed={result.debug.fpsFallbackUsed}")
        if result.debug.keyframeDir:
            print(f"  keyframeDir={TMP_DIR / result.debug.keyframeDir}")

    print()
    print(json.dumps(result.model_dump(), indent=2))
    return 0 if result.analysisValid else 1


if __name__ == "__main__":
    raise SystemExit(main())
