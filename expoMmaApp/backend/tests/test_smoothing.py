from app.phases.smoothing import moving_average


def test_moving_average_flattens_single_spike() -> None:
    values = [0.0, 0.0, 1.0, 0.0, 0.0]
    smoothed = moving_average(values, window=5)
    assert smoothed[2] is not None
    assert 0.15 < smoothed[2] < 0.35


def test_moving_average_preserves_constant_signal() -> None:
    values = [0.4] * 10
    smoothed = moving_average(values, window=5)
    assert all(item is not None and abs(item - 0.4) < 1e-12 for item in smoothed)


def test_moving_average_skips_none() -> None:
    values = [1.0, None, 1.0]
    smoothed = moving_average(values, window=3)
    assert smoothed[1] == 1.0


def test_moving_average_all_none() -> None:
    assert moving_average([None, None], window=3) == [None, None]
