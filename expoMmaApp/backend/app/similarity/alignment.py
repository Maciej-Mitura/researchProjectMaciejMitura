"""Constrained local alignment. Not an MMA quality score.

Sakoe–Chiba DTW is used only to pair nearby pose states before pose/path
distances are measured. The warp window is a small fraction of normalized
progress so fundamentally different sequences cannot be warped into a match.
This is not the V1 DTW scorer.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

_INF = 1e18


def constrained_dtw(
    n: int,
    m: int,
    cost_fn: Callable[[int, int], float],
    *,
    band: int,
) -> list[tuple[int, int]]:
    """Return a warping path of (i, j) index pairs, or a diagonal fallback."""
    if n <= 0 or m <= 0:
        return []
    width = max(0, band)
    dp = [[_INF] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(1, n + 1):
        j_lo = max(1, i - width)
        j_hi = min(m, i + width)
        for j in range(j_lo, j_hi + 1):
            step = cost_fn(i - 1, j - 1)
            dp[i][j] = step + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    if not math.isfinite(dp[n][m]) or dp[n][m] >= _INF / 2:
        limit = min(n, m)
        return [(index, index) for index in range(limit)]

    path: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        candidates = (
            (dp[i - 1][j - 1], i - 1, j - 1),
            (dp[i - 1][j], i - 1, j),
            (dp[i][j - 1], i, j - 1),
        )
        _best, i, j = min(candidates, key=lambda item: item[0])
    path.reverse()
    return path


def reference_alignment(path: Sequence[tuple[int, int]], sample_count: int) -> list[int]:
    """Map each reference sample to one aligned user sample."""
    assigned = [-1] * sample_count
    for ref_index, user_index in path:
        if 0 <= ref_index < sample_count:
            assigned[ref_index] = user_index
    previous = 0
    for index, value in enumerate(assigned):
        if value < 0:
            assigned[index] = previous
        else:
            previous = value
    return assigned


def mean_warp_fraction(aligned: Sequence[int], sample_count: int) -> float:
    if sample_count <= 1 or not aligned:
        return 0.0
    total = 0.0
    for index, mapped in enumerate(aligned):
        total += abs(index - mapped)
    return total / (len(aligned) * (sample_count - 1))
