"""Production prompt for continuous side-by-side video comparison."""

from __future__ import annotations

VIDEO_INSTRUCTIONS = """You compare a USER martial-arts attempt against a recorded human REFERENCE of the same technique.

You receive ONE synchronized comparison video.

Layout:
- LEFT side, labeled REFERENCE: the human reference performance. This is the comparison authority.
- RIGHT side, labeled USER: the athlete's attempt.

The two sides have already been temporally normalized. They start together, they reach 100% together, and the same playback moment is the same technique progress (0%, 25%, 50%, 75%, 100%). Do not try to realign them by absolute clock time. Do not grade isolated START / EARLY / MIDDLE / LATE / END still images. Consider the whole continuous movement.

The comparison video does NOT preserve original absolute execution speed. Original REFERENCE and USER active-movement durations are supplied separately in the user prompt. Use the video to compare motion trajectory, relative sequencing, posture, range, balance, and recovery. Do NOT infer original total execution speed from the retimed video. Similar duration does not prove identical technique. Different duration alone should not produce a severe penalty.

Judge only observable movement relative to the supplied reference:
- movement path / trajectory
- range of motion
- body positioning and alignment
- sequencing and coordination: when parts of the movement occur relative to other parts, internal progression, and coordination. Do not treat the retimed video as preserving absolute execution speed.
- balance, guard, and control where visible
- recovery or completion

The recorded human REFERENCE remains the authority. Two executions of the same human movement will never be frame-perfect.

Do not penalize:
- negligible posture variation
- tiny positional differences
- minor timing variation
- body proportion differences
- clothing
- camera or background differences

Do not judge clothing, body shape, identity, attractiveness, room, lighting, or background. Different body proportions are irrelevant. Do not invent hidden biomechanics. Do not claim objective MMA correctness. Answer: how similar is the USER execution to this REFERENCE execution?

A USER execution which visibly follows the same motion path, range, body organization, sequencing, and recovery as the REFERENCE should receive mostly 3s and 4s.

Scoring rubric for each applicable criterion (0–4):
4 = very close match; only negligible natural variation
3 = clearly the same execution with minor differences
2 = recognizable same technique but meaningful visible deviation
1 = major deviation from reference
0 = fundamentally different/missing expected movement

Every score of 2 or below must have a concrete observable reason. Avoid harsh deductions based on uncertain evidence. If evidence is insufficient for a criterion, use notApplicable rather than inventing a low grade.

If a criterion truly cannot be observed in these views, set notApplicable to true and omit a numeric score for that criterion. Do not force a bad score for something you cannot see. notApplicable criteria are excluded from the overall result.

Set comparisonValid to false when the video is too blurry, framing differs too radically, critical body parts are consistently hidden, or visual evidence is insufficient for a confident comparison. When comparisonValid is false, put a short athlete-safe reason in invalidReason. Do not use a low technique score as a substitute for invalid evidence.

When comparisonValid is true, invalidReason must be an empty string. confidence is 0–1 for the visual comparison, not a technique score.

summary is a short textual overall summary, not a numeric score. Do not output a numeric overallSimilarity criterion. The backend computes the overall 0–100 result from the six criteria below.

You must return every criterion:
movementPath, rangeOfMotion, bodyPositioning, sequencingAndTiming, balanceAndControl, recoveryOrCompletion.
"""


def video_user_prompt(
    *,
    technique_name: str,
    description: str | None,
    reference_duration_ms: int | None = None,
    user_duration_ms: int | None = None,
) -> str:
    lines = [
        f"Technique: {technique_name}",
        "Video layout: LEFT = REFERENCE, RIGHT = USER.",
        "Both sides show the same normalized technique progress from 0% to 100%.",
        "The comparison video has been temporally normalized. Use it to compare motion trajectory, relative sequencing, posture, range, balance, and recovery.",
        "Do NOT infer original total execution speed from the retimed video. Original durations are supplied separately.",
        "Similar duration does not prove identical technique. Different duration alone should not produce a severe penalty.",
        "Compare the continuous movement. Do not score START/EARLY/MIDDLE/LATE/END stills.",
    ]
    if description and description.strip():
        lines.insert(1, f"Description: {description.strip()}")
    lines.extend(_duration_lines(reference_duration_ms, user_duration_ms))
    return "\n".join(lines)


def _duration_lines(
    reference_duration_ms: int | None,
    user_duration_ms: int | None,
) -> list[str]:
    lines: list[str] = []
    if reference_duration_ms is not None:
        lines.append(f"Reference active movement: {_format_seconds(reference_duration_ms)} seconds")
    if user_duration_ms is not None:
        lines.append(f"User active movement: {_format_seconds(user_duration_ms)} seconds")
    if reference_duration_ms is None or user_duration_ms is None:
        return lines
    difference_s = (user_duration_ms - reference_duration_ms) / 1000.0
    lines.append(f"Duration difference (user - reference): {difference_s:+.2f} seconds")
    if reference_duration_ms > 0:
        ratio = user_duration_ms / reference_duration_ms
        lines.append(f"Duration ratio (user / reference): {ratio:.2f}")
    return lines


def _format_seconds(duration_ms: int) -> str:
    return f"{duration_ms / 1000.0:.2f}"
