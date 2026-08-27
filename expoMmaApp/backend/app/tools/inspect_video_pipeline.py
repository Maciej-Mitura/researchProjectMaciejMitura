"""Inspect REFERENCE + USER video preprocessing without calling Gemini.

Usage (from expoMmaApp/backend):

    python -m app.tools.inspect_video_pipeline --slug <slug> --user path/to/attempt.mp4

Optional:

    python -m app.tools.inspect_video_pipeline --slug <slug> --user attempt.mp4 --save-comparison
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.ai.store import new_analysis_id
from app.config import (
    AI_COMPARISON_VIDEO_FILENAME,
    MODEL_PATH,
    REFERENCE_VIDEO_FILENAME,
    ai_comparison_duration_ms,
    ensure_runtime_directories,
)
from app.pose.video import probe_video
from app.reference.analyzer import analyze_generic_motion
from app.reference.errors import IncompleteReferenceError, TechniqueNotFoundError
from app.reference.store import load_complete_reference, technique_video_path
from app.reference.window import video_crop_ms
from app.video.package import build_comparison_package
from app.video.state import VideoStage
from app.video.store import discard_comparison, resolve_comparison_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Print canonical movement windows and comparison metadata. "
            "Does not call Gemini or OpenAI."
        )
    )
    parser.add_argument("--slug", required=True, help="Confirmed recorded-technique slug.")
    parser.add_argument("--user", required=True, type=Path, help="Path to a USER attempt MP4.")
    parser.add_argument(
        "--save-comparison",
        action="store_true",
        help="Write the AI-duration diagnostic comparison under tmp/comparisons/<id>/.",
    )
    args = parser.parse_args(argv)

    user_video: Path = args.user
    if not user_video.is_file():
        print(f"error: USER video not found: {user_video}", file=sys.stderr)
        return 2

    ensure_runtime_directories()
    try:
        metadata = load_complete_reference(args.slug)
        reference_path = technique_video_path(args.slug)
    except TechniqueNotFoundError:
        print(f"error: recorded technique not found: {args.slug}", file=sys.stderr)
        return 2
    except IncompleteReferenceError as error:
        print(f"error: {error.message}", file=sys.stderr)
        return 2

    print(f"technique: {metadata.name} ({metadata.slug})")
    print(f"referenceSource: {REFERENCE_VIDEO_FILENAME} ({reference_path.name})")
    print()

    reference_motion = analyze_generic_motion(
        reference_path,
        model_path=MODEL_PATH,
        raw_stage=VideoStage.RAW_REFERENCE,
    )
    user_motion = analyze_generic_motion(
        user_video,
        model_path=MODEL_PATH,
        raw_stage=VideoStage.RAW_USER,
    )
    _print_side("REFERENCE", reference_path, reference_motion)
    print()
    _print_side("USER", user_video, user_motion)
    print()

    if not reference_motion.valid or reference_motion.window is None:
        print("error: REFERENCE canonical window is invalid; not building comparison.")
        return 1
    if not user_motion.valid or user_motion.window is None:
        print("error: USER canonical window is invalid; not building comparison.")
        return 1

    analysis_id = new_analysis_id()
    ref_crop = video_crop_ms(reference_motion.window)
    user_crop = video_crop_ms(user_motion.window)
    package = build_comparison_package(
        analysis_id=analysis_id,
        reference_path=reference_path,
        user_path=user_video,
        reference_start_ms=ref_crop[0],
        reference_end_ms=ref_crop[1],
        user_start_ms=user_crop[0],
        user_end_ms=user_crop[1],
        include_pose=False,
        include_ai=True,
        windows_already_canonical=True,
    )
    print("AI")
    print(f"  target:              {ai_comparison_duration_ms() / 1000:.2f}s")
    if package.ai:
        print(f"  actual:              {package.ai.duration_ms / 1000:.2f}s")
        print(f"  fps:                 {package.ai.fps:.2f}")
        print(f"  frames:              {package.ai.frame_count}")
        print(f"  retimeOperations:    {package.ai_retime_operations}")
    print(f"  previewMatchesGemini: {package.preview_matches_gemini}")
    print(f"  previewFile:         {package.preview_path.name if package.preview_path else None}")
    print(f"  geminiFile:          {package.gemini_path.name if package.gemini_path else None}")
    print(f"  analysisId:          {analysis_id}")

    if package.ai_video_path and package.ai_video_path.is_file():
        try:
            encoded = probe_video(package.ai_video_path)
            print(
                "  reopened:            "
                f"{encoded.duration_ms / 1000:.2f}s @ {encoded.fps:.2f}fps / {encoded.frame_count} frames"
            )
        except ValueError as error:
            print(f"  reopened:            failed ({error})")

    if not args.save_comparison:
        discard_comparison(analysis_id)
        print("  saved:               no (pass --save-comparison to keep the file)")
    else:
        print(f"  saved:               {resolve_comparison_dir(analysis_id) / AI_COMPARISON_VIDEO_FILENAME}")
    return 0 if reference_motion.valid and user_motion.valid else 1


def _print_side(label: str, path: Path, motion) -> None:
    print(label)
    print(f"  file:                {path.name}")
    print(f"  rawKind:             {motion.raw_stage.value if motion.raw_stage else 'unknown'}")
    print(f"  valid:               {motion.valid}")
    if motion.failure_reason:
        print(f"  failure:             {motion.failure_reason}: {motion.failure_message}")
    video = motion.video
    if video is not None:
        print(
            f"  raw:                 {video.duration_ms / 1000:.2f}s @ {video.fps:.2f}fps / "
            f"{video.frame_count} frames"
        )
        print(f"  fpsFallback:         {video.fps_fallback_used}")
    window = motion.window
    if window is None:
        print("  regions:             n/a")
        return
    print(f"  regions:             {len(window.regions)}")
    for index, region in enumerate(window.regions, start=1):
        print(
            f"    region {index}:        {region.start_ms / 1000:.2f}–{region.end_ms / 1000:.2f}s "
            f"({region.duration_ms} ms)"
        )
    if window.start_ms is not None and window.end_ms is not None:
        print(
            f"  envelope:            {window.start_ms / 1000:.2f}–{window.end_ms / 1000:.2f}s "
            f"({window.end_ms - window.start_ms} ms)"
        )
    if window.canonical_start_ms is not None and window.canonical_end_ms is not None:
        print(
            f"  canonical:           {window.canonical_start_ms / 1000:.2f}–"
            f"{window.canonical_end_ms / 1000:.2f}s "
            f"({window.canonical_end_ms - window.canonical_start_ms} ms)"
        )
        print(f"  paddingApplied:      {window.padding_applied}")


if __name__ == "__main__":
    raise SystemExit(main())
