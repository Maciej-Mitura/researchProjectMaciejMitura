"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { TechniqueDisplay } from "@/app/components/training/TechniqueDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTechniqueById, getAllTechniques, type Technique } from "@/app/lib/techniques";
import { ArrowLeft, Video, VideoOff } from "lucide-react";
import type { PoseCameraOverlayHandle } from "@/app/components/pose/PoseCameraOverlay";

// Dynamically import PoseCameraOverlay to keep it out of other routes' bundles
const PoseCameraOverlay = dynamic(() => import("@/app/components/pose/PoseCameraOverlay").then((mod) => ({ default: mod.PoseCameraOverlay })), { ssr: false });

export default function GetReadyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [technique, setTechnique] = useState<Technique | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const poseCameraOverlayRef = useRef<PoseCameraOverlayHandle>(null);

  useEffect(() => {
    const techniqueId = searchParams.get("techniqueId");
    if (techniqueId) {
      const foundTechnique = getTechniqueById(techniqueId);
      if (foundTechnique) {
        setTechnique(foundTechnique);
        // Find the index of this technique
        const allTechniques = getAllTechniques();
        const index = allTechniques.findIndex((t) => t.id === techniqueId);
        if (index !== -1) {
          setCurrentIndex(index);
        }
      }
    }
  }, [searchParams]);

  const allTechniques = getAllTechniques();

  const handlePrevious = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : allTechniques.length - 1;
    setCurrentIndex(newIndex);
    setTechnique(allTechniques[newIndex]);
    router.replace(`/get-ready?techniqueId=${allTechniques[newIndex].id}`);
  };

  const handleNext = () => {
    const newIndex = currentIndex < allTechniques.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(newIndex);
    setTechnique(allTechniques[newIndex]);
    router.replace(`/get-ready?techniqueId=${allTechniques[newIndex].id}`);
  };

  const handleBack = () => {
    router.push("/training-setup");
  };

  const handleRequestCameraPermission = async () => {
    setIsRequestingPermission(true);
    try {
      // Check if getUserMedia is available
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera access is not supported in this browser.");
        setIsRequestingPermission(false);
        return;
      }

      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });

      // Permission granted - stop the stream immediately (we just needed permission)
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermissionGranted(true);
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          alert("Camera permission was denied. Please allow camera access in your browser settings and try again.");
        } else if (err.name === "NotFoundError") {
          alert("No camera found. Please connect a camera and try again.");
        } else {
          alert(`Failed to access camera: ${err.message}`);
        }
      } else {
        alert("Failed to access camera. Please try again.");
      }
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const handleStopCamera = () => {
    // Stop the camera overlay component
    if (poseCameraOverlayRef.current) {
      poseCameraOverlayRef.current.stop();
    }
    // Reset permission state to show "Enable Camera" button again
    setCameraPermissionGranted(false);
  };

  if (!technique) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">Technique not found. Redirecting...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={handleBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Setup
        </Button>

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Get Ready</h1>
          <p className="text-muted-foreground">Position yourself in front of the camera and prepare to practice</p>
          <p className="text-muted-foreground">Make sure you're fully in the frame and have some space for movement</p>
        </div>

        {/* Technique Display - Using reusable component */}
        {/* <TechniqueDisplay currentTechnique={technique} currentIndex={currentIndex} totalTechniques={allTechniques.length} onPrevious={handlePrevious} onNext={handleNext} /> */}

        {/* Pose Detection Camera View */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Pose Detection</h2>
            {cameraPermissionGranted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopCamera}
                className="bg-background/80 backdrop-blur-sm hover:bg-background/90"
              >
                <VideoOff className="h-4 w-4 mr-2" />
                Stop Camera
              </Button>
            )}
          </div>
          {!cameraPermissionGranted ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <p className="text-muted-foreground text-center">Enable camera access to see pose detection overlay</p>
              <Button variant="default" size="lg" onClick={handleRequestCameraPermission} disabled={isRequestingPermission} className="min-w-[200px]">
                <Video className="h-4 w-4 mr-2" />
                {isRequestingPermission ? "Requesting Permission..." : "Enable Camera"}
              </Button>
            </div>
          ) : (
            <PoseCameraOverlay ref={poseCameraOverlayRef} showVideo={true} mirrored={true} inferenceFps={15} />
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center">
          <Button variant="default" size="lg" className="min-w-[200px]">
            Start Practice
          </Button>
        </div>
      </div>
    </div>
  );
}
