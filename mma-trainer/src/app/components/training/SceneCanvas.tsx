"use client";

import React from "react";
import { Engine, Scene } from "react-babylonjs";
import { Vector3 } from "@babylonjs/core";

type SceneCanvasProps = {
  className?: string;
};

export default function SceneCanvas({ className }: SceneCanvasProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Engine antialias adaptToDeviceRatio canvasId="training-canvas">
        <Scene>
          <arcRotateCamera name="camera" target={new Vector3(0, 1, 0)} alpha={Math.PI / 2} beta={Math.PI / 3} radius={3} />
          <hemisphericLight name="light" direction={new Vector3(0, 1, 0)} intensity={0.9} />
          {/* Placeholder mesh */}
          <box name="box" size={0.25} position={new Vector3(0, 1, 0)} />
          <ground name="ground" width={4} height={4} />
        </Scene>
      </Engine>
    </div>
  );
}
