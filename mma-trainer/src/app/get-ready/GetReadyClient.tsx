"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import type { PoseCameraOverlayHandle } from "@/app/components/pose/PoseCameraOverlay";
import { getAllTechniques, getTechniqueById, type Technique } from "@/app/lib/techniques";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Dynamically import PoseCameraOverlay to keep it out of other routes' bundles
const PoseCameraOverlay = dynamic(
  () => import("@/app/components/pose/PoseCameraOverlay").then((mod) => ({ default: mod.PoseCameraOverlay })),
  { ssr: false }
);

export default function GetReadyClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [technique, setTechnique] = useState<Technique | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
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

  const handleStartPractice = () => {
    if (!technique || !cameraReady) return;
    router.push(`/training/live-demo?techniqueId=${technique.id}`);
  };

  const handleCameraReady = (isReady: boolean) => {
    setCameraReady(isReady);
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
        <Button variant="ghost" onClick={handleBack} className="mb-4 cursor-pointer">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Setup
        </Button>

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Get Ready</h1>
          <p className="text-muted-foreground">
            This is an example of what the camera will see & show you during your practice session
          </p>
          <p className="text-muted-foreground">Position yourself in front of the camera and prepare to practice</p>
          <p className="text-muted-foreground">Make sure you're fully in the frame and have some space for movement</p>
        </div>

        {/* Technique Display (optional) */}
        {/* <TechniqueDisplay currentTechnique={technique} currentIndex={currentIndex} totalTechniques={allTechniques.length} onPrevious={handlePrevious} onNext={handleNext} /> */}

        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Pose Detection</h2>
            {cameraReady && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Ready
              </div>
            )}
          </div>
          <div className="relative">
            <PoseCameraOverlay
              ref={poseCameraOverlayRef}
              showVideo={true}
              mirrored={true}
              inferenceFps={30}
              onReady={handleCameraReady}
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-20 rounded-lg">
                <div className="text-center space-y-3">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
                  <p className="text-sm text-muted-foreground">Loading camera and pose detection...</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          {!cameraReady && (
            <p className="text-sm text-muted-foreground text-center">Please wait for the camera to finish loading</p>
          )}
          <Button
            variant="default"
            size="lg"
            className="min-w-[200px] hover:cursor-pointer" 
            onClick={handleStartPractice}
            disabled={!cameraReady || !technique}
          >
            Start Practice
          </Button>
        </div>
      </div>
    </div>
  );
}

