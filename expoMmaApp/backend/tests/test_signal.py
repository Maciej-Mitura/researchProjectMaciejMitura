from app.models.pose import Landmark, PoseFrame
from app.phases.signal import compute_lead_arm_extension
from app.pose.landmarks import PoseLandmarkIndex
from app.pose.video import resolve_fps
from app.techniques.catalog import LeadSide


def _landmark(x: float, y: float, z: float = 0.0, visibility: float = 1.0) -> Landmark:
    return Landmark(x=x, y=y, z=z, visibility=visibility, presence=1.0)


def _blank_landmarks() -> list[Landmark]:
    return [_landmark(0.5, 0.5) for _ in range(33)]


def test_resolve_fps_fallback_for_zero_and_nan() -> None:
    fps, used = resolve_fps(0.0)
    assert fps == 30.0
    assert used is True
    fps, used = resolve_fps(float("nan"))
    assert fps == 30.0
    assert used is True
    fps, used = resolve_fps(29.97)
    assert abs(fps - 29.97) < 1e-9
    assert used is False


def test_extension_is_wrist_shoulder_over_torso() -> None:
    landmarks = _blank_landmarks()
    landmarks[PoseLandmarkIndex.LEFT_SHOULDER] = _landmark(0.4, 0.3)
    landmarks[PoseLandmarkIndex.RIGHT_SHOULDER] = _landmark(0.6, 0.3)
    landmarks[PoseLandmarkIndex.LEFT_HIP] = _landmark(0.4, 0.6)
    landmarks[PoseLandmarkIndex.RIGHT_HIP] = _landmark(0.6, 0.6)
    landmarks[PoseLandmarkIndex.LEFT_WRIST] = _landmark(0.4, 0.0)

    frame = PoseFrame(
        frame_index=0,
        timestamp_ms=0,
        landmarks=tuple(landmarks),
        pose_detected=True,
    )
    samples = compute_lead_arm_extension([frame], LeadSide.LEFT)
    assert samples[0].raw is not None
    # torso length = 0.3 (shoulder/hip centers), wrist-shoulder = 0.3 → ext = 1.0
    assert abs(samples[0].raw - 1.0) < 1e-6


def test_low_visibility_yields_no_extension() -> None:
    landmarks = _blank_landmarks()
    landmarks[PoseLandmarkIndex.LEFT_SHOULDER] = _landmark(0.4, 0.3)
    landmarks[PoseLandmarkIndex.RIGHT_SHOULDER] = _landmark(0.6, 0.3)
    landmarks[PoseLandmarkIndex.LEFT_HIP] = _landmark(0.4, 0.6)
    landmarks[PoseLandmarkIndex.RIGHT_HIP] = _landmark(0.6, 0.6)
    landmarks[PoseLandmarkIndex.LEFT_WRIST] = _landmark(0.4, 0.0, visibility=0.1)

    frame = PoseFrame(
        frame_index=0,
        timestamp_ms=0,
        landmarks=tuple(landmarks),
        pose_detected=True,
    )
    samples = compute_lead_arm_extension([frame], LeadSide.LEFT)
    assert samples[0].raw is None
