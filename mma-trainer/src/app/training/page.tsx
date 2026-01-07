"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TechniqueDisplay } from "@/app/components/training/TechniqueDisplay";
import SceneCanvas from "@/app/components/training/SceneCanvas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { getAllTechniques, type Technique } from "@/app/lib/techniques";

export default function TrainingPage() {
  const router = useRouter();
  const techniques = getAllTechniques();
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentTechnique = techniques[currentIndex] || null;

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : techniques.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < techniques.length - 1 ? prev + 1 : 0));
  };

  const handleSelect = () => {
    if (currentTechnique) {
      // Navigate to get-ready page with technique ID as query parameter
      router.push(`/get-ready?techniqueId=${currentTechnique.id}`);
    }
  };

  const handleBack = () => {
    router.push("/");
  };

  if (techniques.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">No techniques available. Add techniques to the catalog.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl overflow-hidden">
      <div className="space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={handleBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Button>

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Training</h1>
          <p className="text-muted-foreground">Select a technique to practice and view the reference animation</p>
        </div>

        {/* Technique Display - Above Animation */}
        <TechniqueDisplay currentTechnique={currentTechnique} currentIndex={currentIndex} totalTechniques={techniques.length} onPrevious={handlePrevious} onNext={handleNext} />

        {/* 3D Animation Preview with Side Arrows */}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold mb-4">Animation Preview</h2>
          <div className="relative flex items-center justify-center gap-4">
            {/* Left Arrow */}
            {techniques.length > 1 && (
              <Button variant="outline" size="icon" onClick={handlePrevious} className="h-12 w-12 shrink-0" aria-label="Previous technique">
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}

            {/* Animation Window - Smaller */}
            <div className="relative w-full max-w-md aspect-square bg-muted rounded-lg overflow-hidden">
              <SceneCanvas key={currentTechnique?.id || "no-technique"} className="w-full h-full" technique={currentTechnique} />
              {!currentTechnique && <p className="text-sm text-muted-foreground text-center mt-4 absolute inset-0 flex items-center justify-center">Select a technique to view its animation</p>}
            </div>

            {/* Right Arrow */}
            {techniques.length > 1 && (
              <Button variant="outline" size="icon" onClick={handleNext} className="h-12 w-12 shrink-0" aria-label="Next technique">
                <ChevronRight className="h-6 w-6" />
              </Button>
            )}
          </div>
        </div>

        {/* Select Button - Below Animation */}
        <div className="flex justify-center">
          <Button variant="default" size="lg" onClick={handleSelect} disabled={!currentTechnique} className="min-w-[200px]">
            Select Technique
          </Button>
        </div>
      </div>
    </div>
  );
}
