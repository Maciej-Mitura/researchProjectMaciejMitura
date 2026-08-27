from app.models.phases import MovementPhase
from app.phases.jab import detect_jab_phases
from tests.helpers import jab_like_signal, samples_from_values


def _phase_order(result) -> list[str]:
    return [pick.phase.value for pick in result.phases]


def test_valid_jab_like_signal_yields_ordered_phases() -> None:
    result = detect_jab_phases(jab_like_signal())
    assert result.valid is True
    assert _phase_order(result) == [
        MovementPhase.START,
        MovementPhase.EXTENSION,
        MovementPhase.PEAK,
        MovementPhase.RETRACTION,
        MovementPhase.RECOVERY,
    ]
    timestamps = [pick.timestamp_ms for pick in result.phases]
    assert timestamps == sorted(timestamps)
    assert timestamps == list(dict.fromkeys(timestamps))
    frames = [pick.frame_index for pick in result.phases]
    assert frames == sorted(frames)
    assert result.extension_delta is not None
    assert result.extension_delta >= 0.20


def test_flat_signal_is_invalid() -> None:
    result = detect_jab_phases(samples_from_values([0.45] * 90))
    assert result.valid is False
    assert result.failure_reason == "no_meaningful_extension_peak"
    assert result.phases == ()


def test_no_recovery_is_invalid() -> None:
    values = [0.45] * 24 + [0.45 + (i / 12) * 0.75 for i in range(13)] + [1.20] * 53
    result = detect_jab_phases(samples_from_values(values))
    assert result.valid is False
    assert result.failure_reason == "arm_does_not_return"


def test_noisy_jab_still_orders_phases() -> None:
    # Deterministic jitter around a clear jab; smoothing should keep order.
    noise = [((i * 17) % 7 - 3) * 0.01 for i in range(90)]
    result = detect_jab_phases(jab_like_signal(noise=noise))
    assert result.valid is True
    timestamps = [pick.timestamp_ms for pick in result.phases]
    assert timestamps == sorted(set(timestamps))


def test_short_sequence_is_invalid() -> None:
    result = detect_jab_phases(samples_from_values([0.4, 0.8, 1.1, 0.8, 0.4]))
    assert result.valid is False
    assert result.failure_reason == "insufficient_pose_coverage"


def test_missing_start_does_not_fabricate_frame_zero() -> None:
    # Series already high, so there is no pre-peak guard/baseline region.
    values = [1.1] * 20 + [1.25] + [1.1] * 20 + [0.45] * 49
    result = detect_jab_phases(samples_from_values(values))
    assert result.valid is False
    assert result.phases == ()
