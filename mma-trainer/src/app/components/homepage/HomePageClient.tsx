"use client";

import { useState, useEffect } from "react";
import { ProblemExplanation } from "./ProblemExplanation";
import { SolutionExplanation } from "./SolutionExplanation";
import { PrivacyStatement } from "./PrivacyStatement";
import { CameraTest } from "./CameraTest";
import { ActionButtons } from "./ActionButtons";
import { hasValidCameraInformation } from "@/app/lib/camera/cameraInformation";

export function HomePageClient() {
  const [showCameraTest, setShowCameraTest] = useState(false);
  const [cameraValidated, setCameraValidated] = useState(false);
  const [cameraTestKey, setCameraTestKey] = useState(0);

  // Don't auto-enable even if camera info exists - user must test camera in this session
  // Start with cameraValidated = false to require testing
  useEffect(() => {
    setCameraValidated(false);
  }, []);

  const handleTestCamera = () => {
    // Reset and show camera test component
    setCameraTestKey((prev) => prev + 1);
    setShowCameraTest(true);
    // Reset validation state when starting a new test
    setCameraValidated(false);
  };

  const handleValidationComplete = (isValid: boolean) => {
    // Only enable start training if camera test passed validation
    setCameraValidated(isValid);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          MMA Learning Platform
        </h1>
        <p className="text-lg text-muted-foreground">
          Real-time technique analysis and coaching in your browser
        </p>
      </div>

      {/* Problem Section */}
      <ProblemExplanation />

      {/* Solution Section */}
      <SolutionExplanation />

      {/* Privacy Statement */}
      <PrivacyStatement />

      {/* Camera Test - Conditionally rendered with key to force remount */}
      {showCameraTest && (
        <CameraTest
          key={cameraTestKey}
          autoStart={true}
          onValidationComplete={handleValidationComplete}
        />
      )}

      {/* Action Buttons */}
      <div className="pt-4">
        <ActionButtons
          onTestCamera={handleTestCamera}
          canStartTraining={cameraValidated}
        />
      </div>
    </div>
  );
}

