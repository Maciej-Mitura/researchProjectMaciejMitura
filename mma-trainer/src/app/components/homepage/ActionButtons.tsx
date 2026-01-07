"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

interface ActionButtonsProps {
  onTestCamera?: () => void;
  canStartTraining?: boolean;
}

export function ActionButtons({
  onTestCamera,
  canStartTraining = false,
}: ActionButtonsProps) {
  const router = useRouter();

  const handleTestCamera = () => {
    if (onTestCamera) {
      onTestCamera();
    }
  };

  const handleStartTraining = () => {
    if (canStartTraining) {
      router.push("/training");
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center">
      <Button
        variant="outline"
        size="lg"
        onClick={handleTestCamera}
        className="min-w-[160px]"
      >
        Test Camera
      </Button>
      <Button
        variant="default"
        size="lg"
        onClick={handleStartTraining}
        disabled={!canStartTraining}
        className="min-w-[160px]"
        title={
          !canStartTraining
            ? "Please complete camera test first"
            : "Start training"
        }
      >
        Start Training
      </Button>
    </div>
  );
}

