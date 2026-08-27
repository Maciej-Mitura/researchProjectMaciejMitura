"""Deterministic 1-D smoothing for the jab extension signal."""

from __future__ import annotations

from collections.abc import Sequence


def moving_average(
    values: Sequence[float | None],
    window: int,
) -> list[float | None]:
    """Centered moving average that ignores missing samples.

    `window` should be a small odd integer (Phase 3 default: 5). Edge frames
    use a truncated window rather than padding, so the filter stays causal
    in the sense that it never invents values outside the series.
    """
    if window < 1:
        raise ValueError("Smoothing window must be >= 1.")

    half = window // 2
    n = len(values)
    smoothed: list[float | None] = []
    for index in range(n):
        start = max(0, index - half)
        end = min(n, index + half + 1)
        chunk = [values[i] for i in range(start, end) if values[i] is not None]
        if not chunk:
            smoothed.append(None)
            continue
        smoothed.append(sum(chunk) / len(chunk))
    return smoothed
