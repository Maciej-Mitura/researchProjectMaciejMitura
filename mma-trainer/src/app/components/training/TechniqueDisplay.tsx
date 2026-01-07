"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getAllTechniques, type Technique } from "@/app/lib/techniques";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface TechniqueDisplayProps {
  currentTechnique: Technique;
  currentIndex: number;
  totalTechniques: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function TechniqueDisplay({
  currentTechnique,
  currentIndex,
  totalTechniques,
  onPrevious,
  onNext,
}: TechniqueDisplayProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle>{currentTechnique.name}</CardTitle>
            <CardDescription className="mt-1">
              {currentTechnique.description}
            </CardDescription>
          </div>
          {totalTechniques > 1 && (
            <span className="text-sm text-muted-foreground min-w-[3rem] text-center">
              {currentIndex + 1} / {totalTechniques}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {currentTechnique.category && (
          <span className="inline-block px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground capitalize">
            {currentTechnique.category}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

