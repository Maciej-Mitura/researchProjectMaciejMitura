"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  validateCameraSettings,
  saveCameraInformation,
  type CameraInformation,
} from "@/app/lib/camera/cameraInformation";

interface CameraSettings {
  aspectRatio?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
  deviceId?: string;
}

interface CameraTestProps {
  autoStart?: boolean;
  onValidationComplete?: (isValid: boolean) => void;
}

export function CameraTest({
  autoStart = false,
  onValidationComplete,
}: CameraTestProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const checkMediaDevicesSupport = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return false;
    }
    return true;
  };

  const startCamera = async () => {
    setError(null);
    setIsLoading(true);

    if (!checkMediaDevicesSupport()) {
      setError(
        "Camera access is not supported in this browser. Please use a modern browser with camera support."
      );
      setIsLoading(false);
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Get camera settings from the video track
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        const settingsData: CameraSettings = {
          aspectRatio: settings.aspectRatio,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          facingMode: settings.facingMode,
          deviceId: settings.deviceId,
        };
        setCameraSettings(settingsData);

        // Validate settings against template
        const isValid = validateCameraSettings(settingsData);
        if (isValid) {
          // Save validated camera information
          const cameraInfo: CameraInformation = {
            width: settingsData.width!,
            height: settingsData.height!,
            aspectRatio: settingsData.aspectRatio!,
            frameRate: settingsData.frameRate!,
            facingMode: settingsData.facingMode,
            deviceId: settingsData.deviceId,
          };
          saveCameraInformation(cameraInfo);
          setIsValidated(true);
          setValidationError(null);
          if (onValidationComplete) {
            onValidationComplete(true);
          }
        } else {
          setIsValidated(false);
          const errors: string[] = [];
          if (!settingsData.width || !settingsData.height) {
            errors.push("Resolution information missing");
          } else {
            const totalPixels = settingsData.width * settingsData.height;
            const minPixels = 640 * 480;
            if (totalPixels < minPixels) {
              errors.push(
                `Resolution too low (${settingsData.width}×${settingsData.height}). Minimum required: 640×480 (480p)`
              );
            }
          }
          if (!settingsData.frameRate) {
            errors.push("Frame rate information missing");
          } else if (![60, 30, 24].includes(settingsData.frameRate)) {
            errors.push(
              `Frame rate ${settingsData.frameRate} fps not supported. Must be 60fps, 30fps, or 24fps`
            );
          }
          setValidationError(errors.join(". "));
          if (onValidationComplete) {
            onValidationComplete(false);
          }
        }
      }

      setIsStreaming(true);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setError(
            "Camera permission was denied. Please allow camera access and try again."
          );
        } else if (err.name === "NotFoundError") {
          setError("No camera found. Please connect a camera and try again.");
        } else if (err.name === "NotReadableError") {
          setError(
            "Camera is already in use by another application. Please close other applications using the camera."
          );
        } else {
          setError(`Failed to access camera: ${err.message}`);
        }
      } else {
        setError("An unknown error occurred while accessing the camera.");
      }
    }
  };

  const stopCamera = () => {
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
      videoRef.current.load();
    }

    // Reset all state
    setIsStreaming(false);
    setCameraSettings(null);
    setError(null);
    setIsValidated(false);
    setValidationError(null);
    setIsLoading(false);
    if (onValidationComplete) {
      onValidationComplete(false);
    }
  };

  // Auto-start if requested (only on initial mount or when autoStart changes to true)
  useEffect(() => {
    if (autoStart && !isStreaming && !isLoading && !error && !cameraSettings) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Camera Test</CardTitle>
          {isStreaming && (
            <Button variant="destructive" size="sm" onClick={stopCamera}>
              Stop Camera
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              Requesting camera access...
            </p>
          </div>
        )}

        {isValidated && (
          <div className="rounded-md bg-green-500/10 border border-green-500/20 p-4">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400 mb-1">
              ✓ Successfully detected a fitting camera
            </p>
            <p className="text-sm text-green-600/80 dark:text-green-400/80">
              Your camera meets all requirements. You can now proceed with
              training.
            </p>
          </div>
        )}

        {validationError && (
          <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-4">
            <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-1">
              Camera settings do not meet requirements
            </p>
            <p className="text-sm text-yellow-600/80 dark:text-yellow-400/80">
              {validationError}
            </p>
            <p className="text-sm text-yellow-600/80 dark:text-yellow-400/80 mt-2">
              Please adjust your camera settings or try a different camera.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
            <p className="text-sm text-destructive font-medium">Error</p>
            <p className="text-sm text-destructive/80 mt-1">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Click "Test Camera" to try again.
            </p>
          </div>
        )}

        {isStreaming && (
          <div className="space-y-4">
            <div className="relative w-full bg-black rounded-lg overflow-hidden aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
            </div>

            {cameraSettings && (
              <div className="rounded-md bg-muted p-4">
                <h3 className="text-sm font-semibold mb-3">
                  Camera Settings
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {cameraSettings.width && cameraSettings.height && (
                    <div>
                      <span className="text-muted-foreground">Resolution: </span>
                      <span className="font-medium">
                        {cameraSettings.width} × {cameraSettings.height}
                      </span>
                    </div>
                  )}
                  {cameraSettings.aspectRatio && (
                    <div>
                      <span className="text-muted-foreground">
                        Aspect Ratio:{" "}
                      </span>
                      <span className="font-medium">
                        {cameraSettings.aspectRatio.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {cameraSettings.frameRate && (
                    <div>
                      <span className="text-muted-foreground">Frame Rate: </span>
                      <span className="font-medium">
                        {cameraSettings.frameRate} fps
                      </span>
                    </div>
                  )}
                  {cameraSettings.facingMode && (
                    <div>
                      <span className="text-muted-foreground">
                        Facing Mode:{" "}
                      </span>
                      <span className="font-medium capitalize">
                        {cameraSettings.facingMode}
                      </span>
                    </div>
                  )}
                </div>
                {isValidated && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                      ✓ Settings validated and saved
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

