"""Helpers for building synthetic jab-like extension sequences."""

from __future__ import annotations

from app.models.phases import ExtensionSample


def samples_from_values(
    values: list[float | None],
    *,
    fps: float = 30.0,
) -> list[ExtensionSample]:
    out: list[ExtensionSample] = []
    for index, value in enumerate(values):
        out.append(
            ExtensionSample(
                frame_index=index,
                timestamp_ms=int(round(index * 1000.0 / fps)),
                raw=value,
            )
        )
    return out


def jab_like_signal(
    *,
    n: int = 90,
    fps: float = 30.0,
    baseline: float = 0.45,
    peak: float = 1.20,
    noise: list[float] | None = None,
) -> list[ExtensionSample]:
    """baseline → rise → peak → fall → baseline over ~3 seconds at 30 FPS."""
    values: list[float | None] = []
    rise_start, peak_index, fall_end = 24, 36, 52
    for index in range(n):
        if index < rise_start:
            value = baseline
        elif index <= peak_index:
            t = (index - rise_start) / (peak_index - rise_start)
            value = baseline + t * (peak - baseline)
        elif index <= fall_end:
            t = (index - peak_index) / (fall_end - peak_index)
            value = peak + t * (baseline - peak)
        else:
            value = baseline
        if noise is not None:
            value = value + noise[index]
        values.append(value)
    return samples_from_values(values, fps=fps)
