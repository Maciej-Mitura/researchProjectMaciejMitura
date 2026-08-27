"""Experimental/legacy still-image prompt for OpenAI GPT vision.

Production Detailed Analysis uses `app.ai.video_prompt` with one synchronized
comparison video. Keep this module for research comparison only.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence

from app.ai.frames import DenseFramePick

INSTRUCTIONS = """You compare a USER martial-arts attempt against a recorded human REFERENCE of the same technique.

The recorded REFERENCE is the comparison authority. Do not judge whether the reference is objectively "correct MMA." Answer this question: how does the USER execution differ visually from the provided REFERENCE execution?

You receive still images only. They are an ordered sequence extracted from both complete recordings. You are not watching raw video. Each REFERENCE/USER pair is sampled at approximately the same normalized progress through that recording's own active movement window. Execution speed may differ. Camera angle, distance, person, clothing, and body proportions may differ. Compare observable technique execution, not physical appearance.

Compare:
- body positions
- movement trajectory
- sequencing
- range of motion
- body rotation and alignment where visible
- recovery / end position

Identify meaningful deviations. Do not judge clothing, body shape, identity, attractiveness, room, or background. Do not invent biomechanical facts that are not visible. If something cannot be observed reliably, say so.

Scoring rubric for each of START, EARLY, MIDDLE, LATE, END:
4 = very close to reference / no meaningful visible issue
3 = minor visible deviation
2 = noticeable deviation
1 = major deviation
0 = substantially different / expected movement not evident

Although many frames are supplied, report phase scores only for those five labels. The extra frames exist to give you temporal context.

Set comparisonValid to false when images are too blurry, framing differs too radically, critical body parts are consistently hidden, or visual evidence is insufficient for a confident comparison. When comparisonValid is false, put a short athlete-safe reason in invalidReason and still fill the schema. Do not use a low technique score as a substitute for invalid evidence.

When comparisonValid is true, invalidReason must be an empty string. confidence is 0–1 for the visual comparison, not a technique score.
"""


def percent_label(position: float) -> str:
    return f"{int(round(position * 100))}%"


def build_input_content(
    *,
    technique_name: str,
    description: str | None,
    reference_picks: Sequence[DenseFramePick],
    user_picks: Sequence[DenseFramePick],
    reference_jpegs: dict[str, bytes],
    user_jpegs: dict[str, bytes],
) -> list[dict[str, object]]:
    if len(reference_picks) != len(user_picks):
        raise ValueError("REFERENCE and USER dense sequences must be the same length.")

    content: list[dict[str, object]] = [
        {
            "type": "input_text",
            "text": _header_text(technique_name, description),
        }
    ]
    for reference, user in zip(reference_picks, user_picks, strict=True):
        if reference.normalized_position != user.normalized_position:
            raise ValueError("Paired frames must share the same normalized position.")
        label = percent_label(reference.normalized_position)
        content.append(
            {
                "type": "input_text",
                "text": (
                    f"REFERENCE {reference.sequence_index:02d} — {label}\n"
                    "Same normalized progress through the REFERENCE active movement."
                ),
            }
        )
        content.append(_image_part(reference_jpegs[reference.filename]))
        content.append(
            {
                "type": "input_text",
                "text": (
                    f"USER {user.sequence_index:02d} — {label}\n"
                    "Same normalized progress through the USER active movement."
                ),
            }
        )
        content.append(_image_part(user_jpegs[user.filename]))
    return content


def _header_text(technique_name: str, description: str | None) -> str:
    lines = [
        f"Technique: {technique_name}",
    ]
    if description and description.strip():
        lines.append(f"Description: {description.strip()}")
    lines.append(
        "Pairs below are ordered from 0% to 100% of each recording's own active movement."
    )
    return "\n".join(lines)


def _image_part(jpeg: bytes) -> dict[str, object]:
    encoded = base64.standard_b64encode(jpeg).decode("ascii")
    return {
        "type": "input_image",
        "image_url": f"data:image/jpeg;base64,{encoded}",
        "detail": "auto",
    }
