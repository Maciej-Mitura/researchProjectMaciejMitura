import { Button } from "@/components/ui/button";

export default function TrainingPage() {
  return (
    <div>
      <Button>Click me</Button>
    </div>
  );
}

// Waar worden keypoints naar Babylon doorgegeven?

// Suggestie: training/page.tsx is orchestrator:

// Haalt keypoints uit hook

// Geeft ze door als props naar SkeletonOverlay of SceneCanvas.
