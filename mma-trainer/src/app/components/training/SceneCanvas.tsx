"use client";

import React, { useEffect, useRef, useState } from "react";
import { Engine, Scene, useScene } from "react-babylonjs";
import { Vector3, SceneLoader, AssetContainer, AnimationGroup, ArcRotateCamera, AbstractMesh, Skeleton, ParticleSystem, StandardMaterial, Color3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { Technique } from "@/app/lib/techniques";

type SceneCanvasProps = {
  className?: string;
  technique?: Technique | null;
};

// Component to handle technique loading inside the Scene
function TechniqueLoader({ technique }: { technique: Technique | null }) {
  const scene = useScene();
  const containerRef = useRef<AssetContainer | null>(null);
  const animationGroupsRef = useRef<AnimationGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Extract technique ID for dependency tracking
  const techniqueId = technique?.id || null;

  useEffect(() => {
    if (!scene) {
      console.log("Scene not ready yet");
      return;
    }

    if (!technique) {
      // Clean up if no technique
      if (containerRef.current) {
        console.log("Cleaning up - no technique selected");
        animationGroupsRef.current.forEach((group) => {
          group.stop();
        });
        animationGroupsRef.current = [];
        containerRef.current.removeAllFromScene();
        containerRef.current.dispose();
        containerRef.current = null;
      }
      return;
    }

    const loadTechnique = async () => {
      setIsLoading(true);
      try {
        console.log("Loading technique:", technique.name, "from:", technique.assetUrl);

        // Clean up previous technique - be very thorough
        if (containerRef.current) {
          console.log("Cleaning up previous technique");

          // Stop and dispose all animations
          animationGroupsRef.current.forEach((group) => {
            group.stop();
            group.dispose();
          });
          animationGroupsRef.current = [];

          // Get all meshes before removing
          const meshesToRemove = [...containerRef.current.meshes];
          const skeletonsToRemove = [...containerRef.current.skeletons];

          // Remove from scene first
          containerRef.current.removeAllFromScene();

          // Then dispose each mesh individually
          meshesToRemove.forEach((mesh) => {
            if (mesh && !mesh.isDisposed()) {
              mesh.dispose();
            }
          });

          skeletonsToRemove.forEach((skeleton) => {
            if (skeleton) {
              skeleton.dispose();
            }
          });

          // Dispose the container
          containerRef.current.dispose();
          containerRef.current = null;
        }

        // Also clean up any remaining meshes in scene that might be from previous loads
        // Filter out the ground mesh and camera
        const sceneMeshes = scene.meshes.filter((m) => m.name !== "ground" && m.name !== "__root__" && !m.name.startsWith("__"));
        if (sceneMeshes.length > 0) {
          console.log(
            "Removing orphaned meshes from scene:",
            sceneMeshes.map((m) => m.name)
          );
          sceneMeshes.forEach((mesh) => {
            if (!mesh.isDisposed()) {
              mesh.dispose();
            }
          });
        }

        // Small delay to ensure cleanup completes and scene updates
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify the file exists and is accessible
        // Note: HEAD requests may not return content-length, so we don't rely on it
        try {
          const response = await fetch(technique.assetUrl, { method: "HEAD" });
          if (!response.ok) {
            throw new Error(`File not found: ${technique.assetUrl} (Status: ${response.status})`);
          }
          const fileSize = response.headers.get("content-length");
          if (fileSize) {
            const sizeBytes = parseInt(fileSize, 10);
            console.log("File exists and is accessible, size:", (sizeBytes / 1024).toFixed(2), "KB");
          } else {
            console.log("File exists and is accessible (size not available from HEAD request)");
          }
        } catch (fetchError) {
          console.error("Error checking file:", fetchError);
          throw new Error(`Cannot access file: ${technique.assetUrl}. Please verify the file exists in the public folder.`);
        }

        // Load new technique using LoadAssetContainerAsync (as in ChatGPT example)
        // Example uses: LoadAssetContainerAsync(glbUrl, undefined, scene)
        console.log("Loading asset container...");

        let container: AssetContainer;
        try {
          // Try the example's approach: full URL as first param, undefined as second
          container = await SceneLoader.LoadAssetContainerAsync(technique.assetUrl, undefined, scene);
          console.log("LoadAssetContainerAsync (full URL) result:", {
            meshes: container.meshes.length,
            animationGroups: container.animationGroups.length,
            skeletons: container.skeletons.length,
          });
        } catch (error1) {
          console.warn("Full URL approach failed, trying with rootUrl/filename split:", error1);
          try {
            // Fallback: split URL into rootUrl and filename
            const urlParts = technique.assetUrl.split("/");
            const filename = urlParts.pop() || "";
            const rootUrl = urlParts.length > 0 ? urlParts.join("/") + "/" : "/";
            container = await SceneLoader.LoadAssetContainerAsync(rootUrl, filename, scene);
            console.log("LoadAssetContainerAsync (split) result:", {
              meshes: container.meshes.length,
              animationGroups: container.animationGroups.length,
              skeletons: container.skeletons.length,
            });
          } catch (error2) {
            console.error("Both LoadAssetContainerAsync approaches failed:", error2);
            throw new Error(`Failed to load GLB file: ${technique.assetUrl}. The file might be corrupted or in an unsupported format.`);
          }
        }

        console.log("Asset container loaded:", {
          meshes: container.meshes.length,
          animationGroups: container.animationGroups.length,
          skeletons: container.skeletons.length,
          lights: container.lights.length,
          cameras: container.cameras.length,
        });

        // Log all mesh names
        console.log(
          "All meshes:",
          container.meshes.map((m) => ({
            name: m.name,
            hasParent: !!m.parent,
            isEnabled: m.isEnabled(),
            isVisible: m.isVisible,
          }))
        );

        // Log all animation groups from scene
        console.log(
          "Scene animation groups:",
          scene.animationGroups.map((g) => g.name)
        );

        containerRef.current = container;

        // Add to scene (as in example: container.addAllToScene())
        container.addAllToScene();
        console.log("Added all to scene");

        // Check for animation groups in both container and scene
        let animationGroups = container.animationGroups;
        if (animationGroups.length === 0 && scene.animationGroups.length > 0) {
          animationGroups = scene.animationGroups;
          console.log("Using animation groups from scene instead of container");
        }

        animationGroupsRef.current = animationGroups;

        console.log(
          "Available animation groups:",
          animationGroups.map((g) => g.name)
        );

        if (animationGroups.length > 0) {
          // Play the first animation group, or the one specified by animationName
          let targetGroup: AnimationGroup | undefined;

          if (technique.animationName) {
            targetGroup = animationGroups.find((group) => group.name === technique.animationName);
            console.log("Looking for animation:", technique.animationName, "Found:", !!targetGroup);
          }

          // Fallback to first animation group if specific name not found
          if (!targetGroup && animationGroups.length > 0) {
            targetGroup = animationGroups[0];
            console.log("Using first animation group:", targetGroup.name);
          }

          if (targetGroup) {
            // Use start(true) for looping as in the example
            targetGroup.start(true); // loop = true
            console.log("Started animation:", targetGroup.name);
          } else {
            console.warn("No animation group found to play");
          }
        } else {
          console.warn("No animation groups found in the loaded model");
        }

        // Try to find meshes - check all meshes, not just root
        const allMeshes = container.meshes;
        const rootMeshes = allMeshes.filter((mesh) => !mesh.parent);
        const childMeshes = allMeshes.filter((mesh) => mesh.parent && mesh.name !== "__root__");

        console.log("Total meshes:", allMeshes.length);
        console.log("Root meshes:", rootMeshes.length);
        console.log("Child meshes:", childMeshes.length);

        // Prefer child meshes (actual geometry) over root mesh (often just a container)
        let targetMesh = childMeshes.length > 0 ? childMeshes[0] : rootMeshes.length > 0 ? rootMeshes[0] : allMeshes[0];

        // If root mesh is __root__ and has no size, try to find a child with actual geometry
        if (targetMesh && targetMesh.name === "__root__") {
          const meshWithGeometry = allMeshes.find((m) => {
            if (m.name === "__root__") return false;
            const bbox = m.getBoundingInfo();
            const size = bbox.boundingBox.extendSizeWorld;
            return Math.max(size.x, size.y, size.z) > 0;
          });
          if (meshWithGeometry) {
            targetMesh = meshWithGeometry;
          }
        }

        if (targetMesh) {
          console.log("Using mesh:", targetMesh.name);

          // Make sure mesh is visible
          targetMesh.setEnabled(true);
          targetMesh.isVisible = true;

          // Calculate bounding box - use all meshes for accurate bounds
          let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
          let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;
          let hasValidBounds = false;

          allMeshes.forEach((mesh) => {
            if (mesh.name === "__root__") return; // Skip root container
            const bbox = mesh.getBoundingInfo();
            const min = bbox.boundingBox.minimumWorld;
            const max = bbox.boundingBox.maximumWorld;
            const size = bbox.boundingBox.extendSizeWorld;

            if (Math.max(size.x, size.y, size.z) > 0) {
              minX = Math.min(minX, min.x);
              minY = Math.min(minY, min.y);
              minZ = Math.min(minZ, min.z);
              maxX = Math.max(maxX, max.x);
              maxY = Math.max(maxY, max.y);
              maxZ = Math.max(maxZ, max.z);
              hasValidBounds = true;
            }
          });

          if (hasValidBounds) {
            const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
            const sizeX = maxX - minX;
            const sizeY = maxY - minY;
            const sizeZ = maxZ - minZ;
            const maxDimension = Math.max(sizeX, sizeY, sizeZ);

            console.log("Model center:", center, "Size:", maxDimension);

            // Adjust camera to view the model
            const camera = scene.getCameraByName("camera") as ArcRotateCamera;
            if (camera) {
              camera.radius = maxDimension * 2.5;
              camera.target = center;
              console.log("Adjusted camera to view model, radius:", camera.radius);
            }
          } else {
            console.warn("Could not calculate valid bounds, using default camera position");
          }
        } else {
          console.error("No meshes found in the loaded model at all!");
          console.log("Checking scene meshes directly:", scene.meshes.length);
          console.log(
            "Scene meshes:",
            scene.meshes.map((m) => m.name)
          );
        }
      } catch (error) {
        console.error("Error loading technique:", error);
        if (error instanceof Error) {
          console.error("Error details:", error.message, error.stack);
        }
      } finally {
        setIsLoading(false);
      }
    };

    // Wait a bit for scene to be fully ready
    const timeoutId = setTimeout(() => {
      loadTechnique();
    }, 100);

    // Cleanup on unmount or technique change
    return () => {
      clearTimeout(timeoutId);
      // Cleanup will happen in loadTechnique before loading new one
      // But also clean up here if component unmounts
      if (containerRef.current) {
        animationGroupsRef.current.forEach((group) => {
          group.stop();
        });
        animationGroupsRef.current = [];
        containerRef.current.removeAllFromScene();
        containerRef.current.dispose();
        containerRef.current = null;
      }
    };
    // Use techniqueId instead of technique object to ensure proper re-renders when switching
  }, [scene, techniqueId, technique]);

  return null;
}

// Component to set ground material color
function GroundMaterial() {
  const scene = useScene();

  useEffect(() => {
    if (!scene) return;

    const ground = scene.getMeshByName("ground");
    if (ground) {
      const material = new StandardMaterial("groundMaterial", scene);
      material.diffuseColor = new Color3(0.5, 0.5, 0.5); // Grey color
      material.specularColor = new Color3(0.1, 0.1, 0.1); // Low specular for matte look
      ground.material = material;
    }
  }, [scene]);

  return null;
}

// Component to handle scroll-to-zoom
function ZoomController() {
  const scene = useScene();

  useEffect(() => {
    if (!scene) return;

    // Find the canvas element to attach the wheel listener
    const canvas = scene.getEngine().getRenderingCanvas();
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const camera = scene.getCameraByName("camera") as ArcRotateCamera;
      if (camera) {
        const delta = e.deltaY * 0.01;
        const newRadius = Math.max(1, Math.min(10, camera.radius + delta));
        camera.radius = newRadius;
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [scene]);

  return null;
}

export default function SceneCanvas({ className, technique }: SceneCanvasProps) {
  // Use technique ID in canvas ID to force a new Engine/Scene when technique changes
  // This ensures complete cleanup and prevents old meshes from persisting
  const canvasId = `training-canvas-${technique?.id || "none"}`;

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%" }}
      onWheel={(e) => {
        // Prevent page scroll when scrolling inside animation window
        e.stopPropagation();
      }}
    >
      <Engine antialias adaptToDeviceRatio canvasId={canvasId}>
        <Scene>
          <arcRotateCamera name="camera" target={new Vector3(0, 1, 0)} alpha={Math.PI / 2} beta={Math.PI / 3} radius={3} minZ={0.1} lowerRadiusLimit={1} upperRadiusLimit={10} />
          <hemisphericLight name="light" direction={new Vector3(0, 1, 0)} intensity={0.9} />
          <directionalLight name="directionalLight" direction={new Vector3(-1, -1, -1)} intensity={0.5} />
          <ground name="ground" width={4} height={4} />
          <GroundMaterial />
          <TechniqueLoader technique={technique || null} />
          <ZoomController />
        </Scene>
      </Engine>
    </div>
  );
}
