from app.reference.keyframes import KeyframeSelectionError, pick_generic_keyframes, spaced_indices
from app.reference.motion import compute_body_motion
from app.reference.window import detect_active_window
from tests.reference_helpers import burst_offsets, samples_from_values, standing_frames

import pytest


def test_spaced_indices_are_ordered_distinct_and_span_the_window() -> None:
    assert spaced_indices(5) == [0, 1, 2, 3, 4]
    assert spaced_indices(9) == [0, 2, 4, 6, 8]
    for count in range(5, 40):
        indices = spaced_indices(count)
        assert indices[0] == 0
        assert indices[-1] == count - 1
        assert indices == sorted(set(indices))
        assert len(indices) == 5


def test_spaced_indices_reject_too_few_frames() -> None:
    with pytest.raises(KeyframeSelectionError):
        spaced_indices(4)


def test_still_pose_is_not_meaningful_movement() -> None:
    samples = compute_body_motion(standing_frames(90))
    result = detect_active_window(samples)
    assert result.valid is False
    assert result.failure_reason == "no_meaningful_movement"
    assert result.start_ms is None


def test_flat_signal_is_not_meaningful_movement() -> None:
    result = detect_active_window(samples_from_values([0.004] * 90))
    assert result.valid is False
    assert result.failure_reason == "no_meaningful_movement"


def test_burst_yields_window_and_five_ordered_keyframes() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    samples = compute_body_motion(frames)
    window = detect_active_window(samples)
    assert window.valid is True
    assert window.start_ms is not None
    assert window.end_ms is not None
    assert window.end_ms > window.start_ms

    picks = pick_generic_keyframes(frames, window.start_ms, window.end_ms)
    assert [pick.phase.value for pick in picks] == ["START", "EARLY", "MIDDLE", "LATE", "END"]
    timestamps = [pick.timestamp_ms for pick in picks]
    assert timestamps == sorted(timestamps)
    assert timestamps == list(dict.fromkeys(timestamps))
    assert [pick.frame_index for pick in picks] == sorted(pick.frame_index for pick in picks)


def test_tiny_pre_movement_does_not_win_over_dominant_burst() -> None:
    values: list[float | None] = [0.002] * 90
    values[5] = 0.08
    values[6] = 0.09
    values[7] = 0.08
    for index in range(30, 55):
        values[index] = 0.12
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index >= 25
    assert result.end_frame_index <= 60


def test_keyframes_fail_when_window_has_too_few_frames() -> None:
    frames = standing_frames(8)
    with pytest.raises(KeyframeSelectionError):
        pick_generic_keyframes(frames, start_ms=0, end_ms=50)


def test_end_is_the_held_pose_not_the_fastest_moment() -> None:
    values: list[float | None] = [0.002] * 120
    for index in range(30, 46):
        values[index] = 0.16
    for index in range(46, 55):
        values[index] = 0.05
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index <= 35
    assert result.end_frame_index >= 50
    assert result.end_ms is not None
    assert result.start_ms is not None
    assert result.end_ms - result.start_ms >= 700


def test_recording_end_without_a_hold_uses_last_movement() -> None:
    values: list[float | None] = [0.002] * 90
    for index in range(20, 81):
        values[index] = 0.14
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index >= 15
    assert result.end_frame_index >= 75
    assert result.end_frame_index <= 85


def _combo_values(
    *,
    n: int = 180,
    starts: tuple[int, ...] = (20, 34, 48, 62),
    width: int = 8,
    amplitudes: tuple[float, ...] = (0.10, 0.10, 0.10, 0.10),
    baseline: float = 0.002,
) -> list[float | None]:
    values: list[float | None] = [baseline] * n
    for start, amplitude in zip(starts, amplitudes, strict=True):
        for index in range(start, min(n, start + width)):
            values[index] = amplitude
    return values


def test_single_strike_is_the_complete_window() -> None:
    values = _combo_values(starts=(30,), amplitudes=(0.16,), width=16)
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index <= 32
    assert result.end_frame_index >= 44
    assert len(result.regions) == 1


def test_four_action_combo_is_one_complete_envelope() -> None:
    values = _combo_values()
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert len(result.regions) == 4
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index <= 22
    assert result.end_frame_index >= 68


def test_last_action_strongest_still_includes_earlier_actions() -> None:
    values = _combo_values(amplitudes=(0.09, 0.10, 0.11, 0.24))
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert len(result.regions) == 4
    assert result.start_frame_index is not None
    assert result.start_frame_index <= 22
    assert result.end_frame_index is not None
    assert result.end_frame_index >= 68


def test_first_action_strongest_still_includes_later_actions() -> None:
    values = _combo_values(amplitudes=(0.24, 0.11, 0.10, 0.09))
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert len(result.regions) == 4
    assert result.start_frame_index is not None
    assert result.start_frame_index <= 22
    assert result.end_frame_index is not None
    assert result.end_frame_index >= 68


def test_short_combo_pause_is_bridged() -> None:
    # 5 frames at 30 FPS ≈ 167 ms gap, under GENERIC_MOVEMENT_MAX_GAP_MS=500.
    values = _combo_values(starts=(20, 33, 46), width=8, amplitudes=(0.12, 0.12, 0.12))
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert len(result.regions) == 3
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index <= 22
    assert result.end_frame_index >= 52


def test_long_idle_is_not_blindly_bridged() -> None:
    # ~3 s idle at 30 FPS between two actions.
    values = _combo_values(n=200, starts=(20, 140), width=10, amplitudes=(0.16, 0.12))
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.end_frame_index is not None
    assert result.start_frame_index <= 24
    assert result.end_frame_index < 100
    assert all(region.start_frame_index < 50 for region in result.regions)


def test_noise_before_combo_does_not_become_start() -> None:
    values = _combo_values(starts=(40, 54, 68, 82))
    values[4] = 0.08
    values[5] = 0.09
    values[6] = 0.08
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.start_frame_index >= 35
    assert len(result.regions) == 4
