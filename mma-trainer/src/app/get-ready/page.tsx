"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TechniqueDisplay } from "@/app/components/training/TechniqueDisplay";
import { CameraTest } from "@/app/components/homepage/CameraTest";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTechniqueById, getAllTechniques, type Technique } from "@/app/lib/techniques";
import { ArrowLeft } from "lucide-react";

export default function GetReadyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [technique, setTechnique] = useState<Technique | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

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

        {/* Camera View */}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-4">Camera View</h2>
          <CameraTest autoStart={true} showStopButton={false} showSuccessNotification={false} showTitle={false} />
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
