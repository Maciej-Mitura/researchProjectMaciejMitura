/**
 * Camera Information Template
 * 
 * This template defines the required camera settings for the MMA training application.
 * Camera settings must match these requirements to be considered valid.
 */

export interface CameraInformation {
  width: number;
  height: number;
  aspectRatio: number;
  frameRate: number;
  facingMode?: string;
  deviceId?: string;
}

export interface CameraRequirements {
  minResolution: {
    width: number;
    height: number;
  };
  allowedFrameRates: number[];
  requiredAspectRatio?: number; // Optional: if undefined, any aspect ratio is acceptable
}

/**
 * Camera requirements template
 * - Resolution: Minimum 480p (640x480 or higher)
 * - Frame Rate: Must be 60fps, 30fps, or 24fps
 * - Aspect Ratio: Any (not restricted)
 */
export const CAMERA_REQUIREMENTS: CameraRequirements = {
  minResolution: {
    width: 640,
    height: 480,
  },
  allowedFrameRates: [60, 30, 24],
};

/**
 * Validates camera settings against the requirements template
 * @param settings - Camera settings to validate
 * @returns true if settings match requirements, false otherwise
 */
export function validateCameraSettings(
  settings: Partial<CameraInformation>
): boolean {
  // Check if required fields are present
  if (
    !settings.width ||
    !settings.height ||
    !settings.frameRate ||
    !settings.aspectRatio
  ) {
    return false;
  }

  // Check minimum resolution (480p = 640x480)
  const totalPixels = settings.width * settings.height;
  const minPixels =
    CAMERA_REQUIREMENTS.minResolution.width *
    CAMERA_REQUIREMENTS.minResolution.height;

  if (totalPixels < minPixels) {
    return false;
  }

  // Check frame rate is one of the allowed values
  if (!CAMERA_REQUIREMENTS.allowedFrameRates.includes(settings.frameRate)) {
    return false;
  }

  return true;
}

/**
 * Stores validated camera information in localStorage
 * @param cameraInfo - Validated camera information to store
 */
export function saveCameraInformation(cameraInfo: CameraInformation): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("cameraInformation", JSON.stringify(cameraInfo));
  }
}

/**
 * Retrieves stored camera information from localStorage
 * @returns Camera information if found, null otherwise
 */
export function getCameraInformation(): CameraInformation | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = localStorage.getItem("cameraInformation");
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as CameraInformation;
  } catch {
    return null;
  }
}

/**
 * Checks if camera information has been validated and saved
 * @returns true if valid camera information exists, false otherwise
 */
export function hasValidCameraInformation(): boolean {
  const cameraInfo = getCameraInformation();
  if (!cameraInfo) {
    return false;
  }
  return validateCameraSettings(cameraInfo);
}

