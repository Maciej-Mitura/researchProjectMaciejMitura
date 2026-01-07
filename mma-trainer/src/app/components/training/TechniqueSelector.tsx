"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getAllTechniques, type Technique } from "@/app/lib/techniques";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface TechniqueSelectorProps {
  selectedTechniqueId?: string;
  onTechniqueSelect: (technique: Technique) => void;
}

export function TechniqueSelector({
  selectedTechniqueId,
  onTechniqueSelect,
}: TechniqueSelectorProps) {
  const techniques = getAllTechniques();
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentTechnique = techniques[currentIndex];

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : techniques.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < techniques.length - 1 ? prev + 1 : 0));
  };

  const handleSelect = () => {
    if (currentTechnique) {
      onTechniqueSelect(currentTechnique);
    }
  };

  if (techniques.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center">
            No techniques available. Add techniques to the catalog.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a Technique</CardTitle>
        <CardDescription>
          Scroll through available techniques and select one to practice
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Technique Info */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{currentTechnique.name}</h3>
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {techniques.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {currentTechnique.description}
          </p>
          {currentTechnique.category && (
            <span className="inline-block px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground capitalize">
              {currentTechnique.category}
            </span>
          )}
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevious}
            disabled={techniques.length <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="default"
            onClick={handleSelect}
            className="flex-1"
            disabled={selectedTechniqueId === currentTechnique.id}
          >
            {selectedTechniqueId === currentTechnique.id
              ? "Selected"
              : "Select Technique"}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={handleNext}
            disabled={techniques.length <= 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Technique List Indicator */}
        {techniques.length > 1 && (
          <div className="flex justify-center gap-1">
            {techniques.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`h-2 w-2 rounded-full transition-colors ${
                  index === currentIndex
                    ? "bg-primary"
                    : "bg-muted hover:bg-muted-foreground/50"
                }`}
                aria-label={`Go to technique ${index + 1}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

