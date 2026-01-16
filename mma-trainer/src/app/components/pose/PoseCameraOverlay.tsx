"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

interface PoseCameraOverlayProps {
  showVideo?: boolean;
  mirrored?: boolean;
  inferenceFps?: number;
  onPoseDetected?: (landmarks: any) => void;
  onStop?: () => void;
}

export interface PoseCameraOverlayHandle {
  stop: () => void;
}

export const PoseCameraOverlay = forwardRef<PoseCameraOverlayHandle, PoseCameraOverlayProps>(({
  showVideo = true,
  mirrored = true,
  inferenceFps = 15,
  onPoseDetected,
  onStop,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const inferenceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPoseResultsRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Loading model...");
  const [cameraFps, setCameraFps] = useState<number>(0);
  const [poseFps, setPoseFps] = useState<number>(0);
  
  // Frame rate tracking refs
  const cameraFrameCountRef = useRef<number>(0);
  const cameraLastFpsUpdateRef = useRef<number>(0);
  const poseInferenceCountRef = useRef<number>(0);
  const poseLastFpsUpdateRef = useRef<number>(0);

  // Expose stop method via ref
  useImperativeHandle(ref, () => ({
    stop: () => {
      // Stop camera stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
      }
      
      // Stop inference interval
      if (inferenceIntervalRef.current !== null) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
      
      // Stop animation frame
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.pause();
      }
      
      // Reset states
      setIsCameraReady(false);
      setIsRunning(false);
      setCameraFps(0);
      setPoseFps(0);
      setStatus("");
      setError(null);
      cameraFrameCountRef.current = 0;
      poseInferenceCountRef.current = 0;
      lastPoseResultsRef.current = null;
      
      // Call onStop callback if provided
      if (onStop) {
        onStop();
      }
    },
  }));

  // Initialize MediaPipe PoseLandmarker
  useEffect(() => {
    let isMounted = true;

    const initializePoseLandmarker = async () => {
      try {
        setStatus("Loading model...");
        setError(null);
        
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (isMounted) {
          landmarkerRef.current = poseLandmarker;
          setIsInitialized(true);
          setStatus("Requesting camera...");
          setError(null);
        } else {
          poseLandmarker.close();
        }
      } catch (err) {
        console.error("Error initializing PoseLandmarker:", err);
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to initialize pose detection"
          );
          setStatus("");
        }
      }
    };

    initializePoseLandmarker();

    return () => {
      isMounted = false;
      // Cleanup landmarker
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
      setIsInitialized(false);
    };
  }, []);

  // Start camera stream
  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      try {
        setStatus("Requesting camera...");
        setError(null);

        // Check if getUserMedia is available (SSR-safe)
        if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera access is not supported in this browser");
        }

        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          
          // Wait for video to be ready
          await new Promise((resolve) => {
            if (videoRef.current) {
              const onLoadedMetadata = () => {
                if (videoRef.current) {
                  videoRef.current.removeEventListener("loadedmetadata", onLoadedMetadata);
                }
                resolve(void 0);
              };
              videoRef.current.addEventListener("loadedmetadata", onLoadedMetadata);
              // Fallback timeout
              setTimeout(resolve, 1000);
            } else {
              resolve(void 0);
            }
          });

          // Track camera frame rate
          if (videoRef.current) {
            // Get initial frame rate from video track settings
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack && videoTrack.getSettings) {
              const settings = videoTrack.getSettings();
              if (settings.frameRate) {
                setCameraFps(Math.round(settings.frameRate));
              }
            }

            // Track actual camera frame rate by monitoring video updates
            let lastVideoTime = videoRef.current.currentTime;
            const trackCameraFps = () => {
              if (!videoRef.current || !isMounted) return;
              
              const currentTime = videoRef.current.currentTime;
              // If video time has advanced, count it as a frame
              if (currentTime !== lastVideoTime) {
                cameraFrameCountRef.current += 1;
                lastVideoTime = currentTime;
              }
              
              const now = performance.now();
              const timeSinceLastUpdate = now - cameraLastFpsUpdateRef.current;
              
              // Update FPS every second
              if (timeSinceLastUpdate >= 1000) {
                const fps = Math.round((cameraFrameCountRef.current * 1000) / timeSinceLastUpdate);
                setCameraFps(fps);
                cameraFrameCountRef.current = 0;
                cameraLastFpsUpdateRef.current = now;
              }
              
              if (isMounted) {
                requestAnimationFrame(trackCameraFps);
              }
            };
            
            cameraLastFpsUpdateRef.current = performance.now();
            trackCameraFps();
          }

          if (isMounted) {
            setIsCameraReady(true);
            setStatus(""); // Clear status when running - don't show overlay
          }
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        if (isMounted) {
          if (err instanceof Error) {
            if (err.name === "NotAllowedError") {
              setError("Camera permission denied. Please allow camera access in your browser settings.");
              setStatus("");
            } else if (err.name === "NotFoundError") {
              setError("No camera found. Please connect a camera and try again.");
              setStatus("");
            } else if (err.name === "NotReadableError") {
              setError("Camera is already in use by another application.");
              setStatus("");
            } else {
              setError(`Camera error: ${err.message}`);
              setStatus("");
            }
          } else {
            setError("Failed to access camera");
            setStatus("");
          }
        }
      }
    };

    if (isInitialized) {
      startCamera();
    }

    return () => {
      isMounted = false;
      // Cleanup camera stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.pause();
      }
      setIsCameraReady(false);
      setCameraFps(0);
      cameraFrameCountRef.current = 0;
    };
  }, [isInitialized]);

  // Pose detection inference loop (runs on interval, not every frame)
  useEffect(() => {
    if (!isInitialized || !isCameraReady || !landmarkerRef.current || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    // Calculate interval in milliseconds (50-66ms for 15-20 FPS)
    const inferenceInterval = Math.max(50, Math.min(66, 1000 / inferenceFps));

    // Run inference on interval
    const runInference = () => {
      if (!video.videoWidth || !video.videoHeight) {
        return;
      }

      try {
        const now = performance.now();
        const results = landmarker.detectForVideo(video, now);

        // Store results for rendering
        lastPoseResultsRef.current = results;

        // Track pose detection FPS
        poseInferenceCountRef.current += 1;
        const timeSinceLastUpdate = now - poseLastFpsUpdateRef.current;
        
        // Update FPS every second
        if (timeSinceLastUpdate >= 1000) {
          const fps = Math.round((poseInferenceCountRef.current * 1000) / timeSinceLastUpdate);
          setPoseFps(fps);
          poseInferenceCountRef.current = 0;
          poseLastFpsUpdateRef.current = now;
        }

        // Mark as running (only set once)
        setIsRunning((prev) => {
          if (!prev) {
            return true;
          }
          return prev;
        });

        // Call callback if provided
        if (onPoseDetected && results.landmarks && results.landmarks.length > 0) {
          onPoseDetected(results.landmarks[0]);
        }
      } catch (err) {
        console.error("Error during pose inference:", err);
      }
    };

    // Initialize pose FPS tracking
    poseLastFpsUpdateRef.current = performance.now();
    poseInferenceCountRef.current = 0;

    // Start inference interval
    inferenceIntervalRef.current = setInterval(runInference, inferenceInterval);

    // Run initial inference
    runInference();

    return () => {
      // Cleanup inference interval
      if (inferenceIntervalRef.current !== null) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
      lastPoseResultsRef.current = null;
      setIsRunning(false);
      setPoseFps(0);
      poseInferenceCountRef.current = 0;
    };
  }, [isInitialized, isCameraReady, inferenceFps, onPoseDetected]);

  // Rendering loop (runs on requestAnimationFrame)
  useEffect(() => {
    if (!isCameraReady || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawingUtils = new DrawingUtils(ctx);

    // Set canvas size to match video
    const updateCanvasSize = () => {
      if (videoRef.current && videoRef.current.videoWidth && videoRef.current.videoHeight) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
      }
    };

    updateCanvasSize();
    if (videoRef.current) {
      videoRef.current.addEventListener("loadedmetadata", updateCanvasSize);
    }

    const render = () => {
      if (!videoRef.current || !videoRef.current.videoWidth || !videoRef.current.videoHeight) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Clear canvas
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw pose results if available
      if (lastPoseResultsRef.current && lastPoseResultsRef.current.landmarks) {
        if (mirrored) {
          ctx.scale(-1, 1);
          ctx.translate(-canvas.width, 0);
        }

        // Draw pose landmarks and connections
        for (const landmarks of lastPoseResultsRef.current.landmarks) {
          // Draw connections (skeleton)
          drawingUtils.drawConnectors(
            landmarks,
            PoseLandmarker.POSE_CONNECTIONS,
            { color: "#00FF00", lineWidth: 2 }
          );

          // Draw landmarks (keypoints)
          drawingUtils.drawLandmarks(landmarks, {
            color: "#FF0000",
            radius: 4,
          });
        }

        ctx.restore();
      } else {
        ctx.restore();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (videoRef.current) {
        videoRef.current.removeEventListener("loadedmetadata", updateCanvasSize);
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isCameraReady, mirrored]);

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-contain ${mirrored ? "scale-x-[-1]" : ""} ${showVideo ? "" : "hidden"}`}
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
      />
      {/* Status overlay - only show for loading states, not when running */}
      {(status || error) && status !== "Running..." && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-10">
          <div className="text-center px-4">
            {error ? (
              <div className="space-y-2">
                <p className="text-red-400 text-sm font-medium">{error}</p>
                <p className="text-muted-foreground text-xs">
                  Check your browser settings to allow camera access
                </p>
              </div>
            ) : (
              <p className="text-white text-sm font-medium">{status}</p>
            )}
          </div>
        </div>
      )}
      
      {/* Frame rate indicators (top-right corner) - only when actually running */}
      {isRunning && !error && !status && (
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <div className="bg-green-500/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white font-medium">
            Camera: {cameraFps} FPS
          </div>
          <div className="bg-yellow-500/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white font-medium">
            Pose: {poseFps} FPS
          </div>
        </div>
      )}
    </div>
  );
});

PoseCameraOverlay.displayName = "PoseCameraOverlay";
