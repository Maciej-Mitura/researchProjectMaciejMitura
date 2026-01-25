"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Engine, Scene, useScene } from "react-babylonjs";
import { Vector3, SceneLoader, AssetContainer, AnimationGroup, ArcRotateCamera, AbstractMesh, Skeleton, ParticleSystem, StandardMaterial, Color3, Scene as BabylonScene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { Technique } from "@/app/lib/techniques";
import { angleDeg3 } from "@/app/lib/scoring/geometry";
import { Button } from "@/components/ui/button";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut, Home } from "lucide-react";

type SceneCanvasProps = {
  className?: string;
  technique?: Technique | null;
  /**
   * Optional callback invoked at a fixed sampling rate (default ~15 FPS)
   * with animation timing and (when available) a simplified skeleton feature vector.
   */
  onReferenceFrame?: (frame: ReferenceFrame) => void;
  referenceFps?: number;
  animationMode?: "loop" | "once" | "paused";
  playToken?: number;
};

export type ReferenceFrame = {
  /** Timestamp (ms). Standardized to Date.now() for alignment. */
  timestampMs: number;
  /** Wall-clock timestamp (ms) from Date.now() */
  wallClockMs: number;
  /** Whether the configured skeleton bone-map validated successfully. */
  referenceValid: boolean;
  /** Optional list of missing required joints when mapping fails. */
  referenceMissingJoints?: string[];
  /** Last engine delta time (ms) */
  deltaMs: number;
  /**
   * Optional limb positions (world space) when available.
   * Used for movement onset detection (velocity threshold).
   */
  limbPositions?: {
    leftHip?: { x: number; y: number; z: number };
    rightHip?: { x: number; y: number; z: number };
    leftShoulder?: { x: number; y: number; z: number };
    rightShoulder?: { x: number; y: number; z: number };
    leftElbow?: { x: number; y: number; z: number };
    rightElbow?: { x: number; y: number; z: number };
    leftWrist?: { x: number; y: number; z: number };
    rightWrist?: { x: number; y: number; z: number };
    leftKnee?: { x: number; y: number; z: number };
    rightKnee?: { x: number; y: number; z: number };
    leftAnkle?: { x: number; y: number; z: number };
    rightAnkle?: { x: number; y: number; z: number };
  };
  animation: {
    from: number | null;
    to: number | null;
    currentFrame: number | null;
  };
  skeletonAvailable: boolean;
  /** Simplified reference pose feature vector (angles / rotations). */
  featureVector: number[];
};

type RequiredJointKey =
  | "leftHip"
  | "rightHip"
  | "leftShoulder"
  | "rightShoulder"
  | "leftElbow"
  | "rightElbow"
  | "leftWrist"
  | "rightWrist"
  | "leftKnee"
  | "rightKnee"
  | "leftAnkle"
  | "rightAnkle";

type BoneMap = Record<RequiredJointKey | "torso", string[]>;

// Explicit per-technique bone maps (normalized bone names; see normalizeBoneName()).
// Add a mapping for each new rig/technique here.
const BONE_MAPS_BY_TECHNIQUE_ID: Record<string, BoneMap> = {
  simple_jab: {
    torso: ["hips", "pelvis", "spine", "spine1", "chest"],
    leftHip: ["leftupleg"],
    rightHip: ["rightupleg"],
    leftShoulder: ["leftarm"],
    rightShoulder: ["rightarm"],
    leftElbow: ["leftforearm"],
    rightElbow: ["rightforearm"],
    leftWrist: ["lefthand"],
    rightWrist: ["righthand"],
    leftKnee: ["leftleg"],
    rightKnee: ["rightleg"],
    leftAnkle: ["leftfoot"],
    rightAnkle: ["rightfoot"],
  },
  mmakick: {
    torso: ["hips", "pelvis", "spine", "spine1", "chest"],
    leftHip: ["leftupleg"],
    rightHip: ["rightupleg"],
    leftShoulder: ["leftarm"],
    rightShoulder: ["rightarm"],
    leftElbow: ["leftforearm"],
    rightElbow: ["rightforearm"],
    leftWrist: ["lefthand"],
    rightWrist: ["righthand"],
    leftKnee: ["leftleg"],
    rightKnee: ["rightleg"],
    leftAnkle: ["leftfoot"],
    rightAnkle: ["rightfoot"],
  },
};

// Component to handle technique loading inside the Scene
function TechniqueLoader({
  technique,
  activeAnimationGroupRef,
  activeSkeletonRef,
  activeSkeletonMeshRef,
  activeBoneMapRef,
  activeReferenceValidRef,
  activeReferenceMissingRef,
  onAnimationGroupReady,
}: {
  technique: Technique | null;
  activeAnimationGroupRef: React.MutableRefObject<AnimationGroup | null>;
  activeSkeletonRef: React.MutableRefObject<Skeleton | null>;
  activeSkeletonMeshRef: React.MutableRefObject<AbstractMesh | null>;
  activeBoneMapRef: React.MutableRefObject<BoneMap | null>;
  activeReferenceValidRef: React.MutableRefObject<boolean>;
  activeReferenceMissingRef: React.MutableRefObject<string[]>;
  onAnimationGroupReady?: (group: AnimationGroup | null) => void;
}) {
  const scene = useScene();
  const containerRef = useRef<AssetContainer | null>(null);
  const animationGroupsRef = useRef<AnimationGroup[]>([]);

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
        activeAnimationGroupRef.current = null;
        activeSkeletonRef.current = null;
        activeSkeletonMeshRef.current = null;
        activeBoneMapRef.current = null;
        activeReferenceValidRef.current = false;
        activeReferenceMissingRef.current = [];
        containerRef.current.removeAllFromScene();
        containerRef.current.dispose();
        containerRef.current = null;
      }
      return;
    }

    const loadTechnique = async () => {
      try {
        // Set explicit bone-map for this technique (deterministic mapping).
        activeBoneMapRef.current = BONE_MAPS_BY_TECHNIQUE_ID[technique.id] ?? null;
        activeReferenceValidRef.current = false;
        activeReferenceMissingRef.current = [];

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
            // Defer playback control to the parent (loop/once/paused).
            activeAnimationGroupRef.current = targetGroup;
            if (typeof (targetGroup as any).goToFrame === "function") {
              const startFrame = typeof targetGroup.from === "number" ? targetGroup.from : 0;
              (targetGroup as any).goToFrame(startFrame);
            }
            console.log("Loaded animation group:", targetGroup.name);
          } else {
            console.warn("No animation group found to play");
            activeAnimationGroupRef.current = null;
          }
          onAnimationGroupReady?.(activeAnimationGroupRef.current);
        } else {
          console.warn("No animation groups found in the loaded model");
          activeAnimationGroupRef.current = null;
          onAnimationGroupReady?.(null);
        }

        // Track a primary skeleton reference if available
        activeSkeletonRef.current = container.skeletons && container.skeletons.length > 0 ? container.skeletons[0] : null;
        activeSkeletonMeshRef.current =
          (container.meshes.find((m) => (m as any)?.skeleton) as AbstractMesh | undefined) ?? null;

        // Validate required joints for scoring
        const sk = activeSkeletonRef.current;
        if (sk) {
          const v = validateBoneMap(sk, activeBoneMapRef.current);
          activeReferenceValidRef.current = v.ok;
          activeReferenceMissingRef.current = v.missing;
          if (!v.ok) {
            console.warn("Reference skeleton mapping failed (missing joints):", v.missing);
          }
        } else {
          activeReferenceValidRef.current = false;
          activeReferenceMissingRef.current = ["skeletonMissing"];
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
        activeAnimationGroupRef.current = null;
        activeSkeletonRef.current = null;
        activeSkeletonMeshRef.current = null;
        activeBoneMapRef.current = null;
        activeReferenceValidRef.current = false;
        activeReferenceMissingRef.current = [];
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

function getCurrentAnimationFrame(group: AnimationGroup | null): number | null {
  if (!group) return null;
  const anyGroup = group as unknown as { getCurrentFrame?: () => number; animatables?: Array<{ masterFrame?: number }> };
  if (typeof anyGroup.getCurrentFrame === "function") {
    try {
      return anyGroup.getCurrentFrame();
    } catch {
      // fall through
    }
  }
  const firstAnim = anyGroup.animatables?.[0];
  if (firstAnim && typeof firstAnim.masterFrame === "number") {
    return firstAnim.masterFrame;
  }
  return null;
}

function angleDeg(a: Vector3, b: Vector3, c: Vector3): number {
  // Keep reference angle calculation consistent with camera (3D, 0..180).
  return angleDeg3({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, { x: c.x, y: c.y, z: c.z });
}

function normalizePosePoints(
  points: {
    ls: Vector3;
    rs: Vector3;
    lh: Vector3;
    rh: Vector3;
    [k: string]: Vector3;
  },
  options?: { rotateShouldersHorizontal?: boolean }
): { [k: string]: Vector3 } {
  const rotate = options?.rotateShouldersHorizontal ?? true;
  const hipCenter = points.lh.add(points.rh).scale(0.5);
  const shoulderCenter = points.ls.add(points.rs).scale(0.5);
  const scale = Vector3.Distance(hipCenter, shoulderCenter);
  const invScale = scale > 1e-6 ? 1 / scale : 1;

  // Rotate in x/y plane so shoulders are horizontal.
  const ls0 = points.ls.subtract(hipCenter).scale(invScale);
  const rs0 = points.rs.subtract(hipCenter).scale(invScale);
  const dx = rs0.x - ls0.x;
  const dy = rs0.y - ls0.y;
  const rot = rotate ? -Math.atan2(dy, dx) : 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const out: { [k: string]: Vector3 } = {};
  for (const [k, p] of Object.entries(points)) {
    const p0 = p.subtract(hipCenter).scale(invScale);
    const x1 = p0.x * cos - p0.y * sin;
    const y1 = p0.x * sin + p0.y * cos;
    out[k] = new Vector3(x1, y1, p0.z);
  }
  return out;
}

function normalizeBoneName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^.*:/, "") // strip namespace like "mixamorig:"
    .replace(/[^a-z0-9]+/g, ""); // remove separators
}

function findBoneByMap(skeleton: Skeleton, candidates: string[]): any | null {
  // Deterministic mapping: match normalized bone name exactly to one of candidates.
  const wanted = new Set(candidates.map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  for (const b of skeleton.bones) {
    const n = normalizeBoneName(b.name);
    if (wanted.has(n)) return b;
  }
  return null;
}

function validateBoneMap(skeleton: Skeleton, boneMap: BoneMap | null): { ok: boolean; missing: string[] } {
  if (!boneMap) return { ok: false, missing: ["boneMapMissing"] };
  const required: RequiredJointKey[] = [
    "leftHip",
    "rightHip",
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
    "leftKnee",
    "rightKnee",
    "leftAnkle",
    "rightAnkle",
  ];
  const missing: string[] = [];
  for (const k of required) {
    const bone = findBoneByMap(skeleton, boneMap[k]);
    if (!bone) missing.push(k);
  }
  return { ok: missing.length === 0, missing };
}

function getBoneWorldPos(bone: any, mesh: AbstractMesh | null): Vector3 | null {
  if (!bone) return null;
  try {
    if (typeof bone.getAbsolutePosition === "function") {
      // Babylon Bone.getAbsolutePosition optionally accepts a mesh
      return mesh ? bone.getAbsolutePosition(mesh) : bone.getAbsolutePosition();
    }
  } catch {
    // ignore
  }
  try {
    if (typeof bone.getPosition === "function") {
      return bone.getPosition();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Build a 6-angle feature vector (degrees):
 * [L_elbow, R_elbow, L_knee, R_knee, L_shoulder, R_shoulder]
 *
 * Note: this uses best-effort bone name matching (Mixamo / common rigs).
 * If required bones aren't found, returns [] (caller can still align via animation time).
 */
function buildReferenceAngleVector(skeleton: Skeleton, mesh: AbstractMesh | null, boneMap: BoneMap | null): number[] {
  if (!boneMap) return [];

  const lShoulderBone = findBoneByMap(skeleton, boneMap.leftShoulder);
  const lElbowBone = findBoneByMap(skeleton, boneMap.leftElbow);
  const lWristBone = findBoneByMap(skeleton, boneMap.leftWrist);

  const rShoulderBone = findBoneByMap(skeleton, boneMap.rightShoulder);
  const rElbowBone = findBoneByMap(skeleton, boneMap.rightElbow);
  const rWristBone = findBoneByMap(skeleton, boneMap.rightWrist);

  const lHipBone = findBoneByMap(skeleton, boneMap.leftHip);
  const lKneeBone = findBoneByMap(skeleton, boneMap.leftKnee);
  const lAnkleBone = findBoneByMap(skeleton, boneMap.leftAnkle);

  const rHipBone = findBoneByMap(skeleton, boneMap.rightHip);
  const rKneeBone = findBoneByMap(skeleton, boneMap.rightKnee);
  const rAnkleBone = findBoneByMap(skeleton, boneMap.rightAnkle);

  const torsoBone = findBoneByMap(skeleton, boneMap.torso);

  const ls = getBoneWorldPos(lShoulderBone, mesh);
  const le = getBoneWorldPos(lElbowBone, mesh);
  const lw = getBoneWorldPos(lWristBone, mesh);
  const rs = getBoneWorldPos(rShoulderBone, mesh);
  const re = getBoneWorldPos(rElbowBone, mesh);
  const rw = getBoneWorldPos(rWristBone, mesh);

  const lh = getBoneWorldPos(lHipBone, mesh);
  const lk = getBoneWorldPos(lKneeBone, mesh);
  const la = getBoneWorldPos(lAnkleBone, mesh);
  const rh = getBoneWorldPos(rHipBone, mesh);
  const rk = getBoneWorldPos(rKneeBone, mesh);
  const ra = getBoneWorldPos(rAnkleBone, mesh);

  const torso = getBoneWorldPos(torsoBone, mesh);

  // If we can't even compute the core elbow/knee points, return [] and let alignment still happen via time.
  if (!ls || !le || !lw || !rs || !re || !rw || !lh || !lk || !la || !rh || !rk || !ra) {
    return [];
  }

  // Normalize reference pose similarly to camera:
  // center at mid-hips, scale by hip->shoulder distance, rotate shoulders horizontal.
  const norm = normalizePosePoints(
    {
      ls,
      rs,
      lh,
      rh,
      le,
      lw,
      re,
      rw,
      lk,
      la,
      rk,
      ra,
      ...(torso ? { torso } : {}),
    },
    { rotateShouldersHorizontal: true }
  );

  const leftElbow = angleDeg(norm.ls, norm.le, norm.lw);
  const rightElbow = angleDeg(norm.rs, norm.re, norm.rw);
  const leftKnee = angleDeg(norm.lh, norm.lk, norm.la);
  const rightKnee = angleDeg(norm.rh, norm.rk, norm.ra);

  // Shoulder angle: torso -> shoulder -> elbow (best-effort torso anchor)
  const leftShoulder = norm.torso ? angleDeg(norm.torso, norm.ls, norm.le) : NaN;
  const rightShoulder = norm.torso ? angleDeg(norm.torso, norm.rs, norm.re) : NaN;

  const vec = [leftElbow, rightElbow, leftKnee, rightKnee, leftShoulder, rightShoulder];
  // If shoulder angles are missing (NaN), still return vector with NaNs stripped? We'll keep vector as-is.
  return vec;
}

function buildReferenceLimbPositions(
  skeleton: Skeleton,
  mesh: AbstractMesh | null
): ReferenceFrame["limbPositions"] {
  // Deterministic mapping for limb positions uses the active bone map if available.
  // If no map is set, omit limbPositions (referenceValid will be false).
  return undefined;
}

function buildReferenceLimbPositionsFromMap(
  skeleton: Skeleton,
  mesh: AbstractMesh | null,
  boneMap: BoneMap | null
): ReferenceFrame["limbPositions"] {
  if (!boneMap) return undefined;

  const lsBone = findBoneByMap(skeleton, boneMap.leftShoulder);
  const rsBone = findBoneByMap(skeleton, boneMap.rightShoulder);
  const lhBone = findBoneByMap(skeleton, boneMap.leftHip);
  const rhBone = findBoneByMap(skeleton, boneMap.rightHip);

  const leBone = findBoneByMap(skeleton, boneMap.leftElbow);
  const reBone = findBoneByMap(skeleton, boneMap.rightElbow);
  const lwBone = findBoneByMap(skeleton, boneMap.leftWrist);
  const rwBone = findBoneByMap(skeleton, boneMap.rightWrist);
  const lkBone = findBoneByMap(skeleton, boneMap.leftKnee);
  const rkBone = findBoneByMap(skeleton, boneMap.rightKnee);
  const laBone = findBoneByMap(skeleton, boneMap.leftAnkle);
  const raBone = findBoneByMap(skeleton, boneMap.rightAnkle);

  const ls = getBoneWorldPos(lsBone, mesh);
  const rs = getBoneWorldPos(rsBone, mesh);
  const lh = getBoneWorldPos(lhBone, mesh);
  const rh = getBoneWorldPos(rhBone, mesh);
  const le = getBoneWorldPos(leBone, mesh);
  const re = getBoneWorldPos(reBone, mesh);
  const lw = getBoneWorldPos(lwBone, mesh);
  const rw = getBoneWorldPos(rwBone, mesh);
  const lk = getBoneWorldPos(lkBone, mesh);
  const rk = getBoneWorldPos(rkBone, mesh);
  const la = getBoneWorldPos(laBone, mesh);
  const ra = getBoneWorldPos(raBone, mesh);

  const out: NonNullable<ReferenceFrame["limbPositions"]> = {};
  if (lh) out.leftHip = { x: lh.x, y: lh.y, z: lh.z };
  if (rh) out.rightHip = { x: rh.x, y: rh.y, z: rh.z };
  if (ls) out.leftShoulder = { x: ls.x, y: ls.y, z: ls.z };
  if (rs) out.rightShoulder = { x: rs.x, y: rs.y, z: rs.z };
  if (le) out.leftElbow = { x: le.x, y: le.y, z: le.z };
  if (re) out.rightElbow = { x: re.x, y: re.y, z: re.z };
  if (lw) out.leftWrist = { x: lw.x, y: lw.y, z: lw.z };
  if (rw) out.rightWrist = { x: rw.x, y: rw.y, z: rw.z };
  if (lk) out.leftKnee = { x: lk.x, y: lk.y, z: lk.z };
  if (rk) out.rightKnee = { x: rk.x, y: rk.y, z: rk.z };
  if (la) out.leftAnkle = { x: la.x, y: la.y, z: la.z };
  if (ra) out.rightAnkle = { x: ra.x, y: ra.y, z: ra.z };
  return Object.keys(out).length > 0 ? out : undefined;
}

function ReferenceSampler({
  activeAnimationGroupRef,
  activeSkeletonRef,
  activeSkeletonMeshRef,
  activeBoneMapRef,
  activeReferenceValidRef,
  activeReferenceMissingRef,
  onReferenceFrame,
  referenceFps,
}: {
  activeAnimationGroupRef: React.MutableRefObject<AnimationGroup | null>;
  activeSkeletonRef: React.MutableRefObject<Skeleton | null>;
  activeSkeletonMeshRef: React.MutableRefObject<AbstractMesh | null>;
  activeBoneMapRef: React.MutableRefObject<BoneMap | null>;
  activeReferenceValidRef: React.MutableRefObject<boolean>;
  activeReferenceMissingRef: React.MutableRefObject<string[]>;
  onReferenceFrame?: (frame: ReferenceFrame) => void;
  referenceFps: number;
}) {
  const scene = useScene();
  const onFrameRef = useRef<typeof onReferenceFrame>(onReferenceFrame);
  const accumulatorMsRef = useRef(0);

  useEffect(() => {
    onFrameRef.current = onReferenceFrame;
  }, [onReferenceFrame]);

  useEffect(() => {
    if (!scene) return;

    const minIntervalMs = 1000 / Math.max(1, referenceFps);

    const obs = scene.onBeforeRenderObservable.add(() => {
      const cb = onFrameRef.current;
      if (!cb) return;

      const deltaMs = scene.getEngine().getDeltaTime();
      accumulatorMsRef.current += deltaMs;

      if (accumulatorMsRef.current < minIntervalMs) return;
      accumulatorMsRef.current = accumulatorMsRef.current % minIntervalMs;

      const group = activeAnimationGroupRef.current;
      // Only emit while animation is actually playing.
      // This ensures "recording active" (callback provided) AND "animation playing".
      if (!group || !(group as any).isPlaying) return;
      const skeleton = activeSkeletonRef.current;
      const skelMesh = activeSkeletonMeshRef.current;
      const boneMap = activeBoneMapRef.current;
      const referenceValid = activeReferenceValidRef.current;
      const referenceMissingJoints = activeReferenceMissingRef.current;

      const featureVector = skeleton && referenceValid ? buildReferenceAngleVector(skeleton, skelMesh, boneMap) : [];
      const limbPositions = skeleton && referenceValid ? buildReferenceLimbPositionsFromMap(skeleton, skelMesh, boneMap) : undefined;
      const wallClockNow = Date.now();

      cb({
        // Standardize timestamps for alignment: use Date.now() for both pose + reference.
        timestampMs: wallClockNow,
        wallClockMs: wallClockNow,
        referenceValid,
        referenceMissingJoints: referenceValid ? undefined : referenceMissingJoints,
        deltaMs,
        limbPositions,
        animation: {
          from: group ? group.from : null,
          to: group ? group.to : null,
          currentFrame: getCurrentAnimationFrame(group),
        },
        skeletonAvailable: !!skeleton,
        featureVector,
      });
    });

    return () => {
      scene.onBeforeRenderObservable.remove(obs);
    };
  }, [scene, activeAnimationGroupRef, activeSkeletonRef, activeSkeletonMeshRef, referenceFps]);

  return null;
}

// Component to provide scene reference (renders inside Scene)
function SceneProvider({ sceneRef, onSceneReady }: { sceneRef: React.MutableRefObject<BabylonScene | null>; onSceneReady?: (scene: BabylonScene) => void }) {
  const scene = useScene();
  const onSceneReadyRef = useRef<typeof onSceneReady>(onSceneReady);
  const lastSceneRef = useRef<BabylonScene | null>(null);

  useEffect(() => {
    onSceneReadyRef.current = onSceneReady;
  }, [onSceneReady]);

  useEffect(() => {
    if (scene) {
      sceneRef.current = scene;
      // Call only once per scene instance to avoid render loops.
      if (lastSceneRef.current !== scene) {
        lastSceneRef.current = scene;
        onSceneReadyRef.current?.(scene);
      }
    }
    return () => {
      sceneRef.current = null;
    };
  }, [scene, sceneRef]);

  return null;
}

// Component for camera controls (rotate, zoom, reset)
function CameraControls({ sceneRef, isSceneReady }: { sceneRef: React.MutableRefObject<BabylonScene | null>; isSceneReady: boolean }) {
  const initialCameraStateRef = useRef<{
    alpha: number;
    beta: number;
    radius: number;
    target: Vector3;
  } | null>(null);

  const getCamera = (): ArcRotateCamera | null => {
    const currentScene = sceneRef.current;
    if (!currentScene) return null;
    return currentScene.getCameraByName("camera") as ArcRotateCamera;
  };

  const handleRotateLeft = () => {
    const camera = getCamera();
    if (camera) {
      camera.alpha += Math.PI / 8; // Rotate 22.5 degrees
    }
  };

  const handleRotateRight = () => {
    const camera = getCamera();
    if (camera) {
      camera.alpha -= Math.PI / 8; // Rotate 22.5 degrees
    }
  };

  const handleZoomIn = () => {
    const camera = getCamera();
    if (camera) {
      const newRadius = Math.max(1, camera.radius * 0.8);
      camera.radius = newRadius;
    }
  };

  const handleZoomOut = () => {
    const camera = getCamera();
    if (camera) {
      const newRadius = Math.min(10, camera.radius * 1.25);
      camera.radius = newRadius;
    }
  };

  const handleReset = () => {
    const camera = getCamera();
    if (camera && initialCameraStateRef.current) {
      camera.alpha = initialCameraStateRef.current.alpha;
      camera.beta = initialCameraStateRef.current.beta;
      camera.radius = initialCameraStateRef.current.radius;
      camera.target = initialCameraStateRef.current.target.clone();
    }
  };

  // Update initial state when scene becomes available
  useEffect(() => {
    const currentScene = sceneRef.current;
    if (!currentScene) return;

    const camera = currentScene.getCameraByName("camera") as ArcRotateCamera;
    if (camera && !initialCameraStateRef.current) {
      // Store initial camera state for reset
      initialCameraStateRef.current = {
        alpha: camera.alpha,
        beta: camera.beta,
        radius: camera.radius,
        target: camera.target.clone(),
      };
    }
  }, [sceneRef, isSceneReady]);

  // Don't render if scene is not available
  if (!isSceneReady) return null;

  return (
    <div className="absolute top-2 right-2 z-10 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={handleRotateLeft} className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90" aria-label="Rotate left" title="Rotate left">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={handleRotateRight} className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90" aria-label="Rotate right" title="Rotate right">
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={handleZoomIn} className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90" aria-label="Zoom in" title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={handleZoomOut} className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90" aria-label="Zoom out" title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>
      <Button variant="outline" size="icon-sm" onClick={handleReset} className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90" aria-label="Reset camera" title="Reset camera">
        <Home className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function SceneCanvas({ className, technique, onReferenceFrame, referenceFps = 15, animationMode = "loop", playToken }: SceneCanvasProps) {
  // Use technique ID in canvas ID to force a new Engine/Scene when technique changes
  // This ensures complete cleanup and prevents old meshes from persisting
  const canvasId = `training-canvas-${technique?.id || "none"}`;
  const sceneRef = useRef<BabylonScene | null>(null);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const activeAnimationGroupRef = useRef<AnimationGroup | null>(null);
  const activeSkeletonRef = useRef<Skeleton | null>(null);
  const activeSkeletonMeshRef = useRef<AbstractMesh | null>(null);
  const activeBoneMapRef = useRef<BoneMap | null>(null);
  const activeReferenceValidRef = useRef<boolean>(false);
  const activeReferenceMissingRef = useRef<string[]>([]);
  const [animationReadyToken, setAnimationReadyToken] = useState(0);
  const lastPlayTokenRef = useRef<number | null>(null);

  // Reset scene ready state when technique changes
  useEffect(() => {
    setIsSceneReady(false);
  }, [technique?.id]);

  const handleSceneReady = useCallback((_scene: BabylonScene) => {
    setIsSceneReady(true);
  }, []);

  useEffect(() => {
    const group = activeAnimationGroupRef.current;
    if (!group) return;

    if (animationMode === "loop") {
      if (!(group as any).isPlaying) {
        group.start(true);
      }
      return;
    }

    if (animationMode === "paused") {
      group.stop();
      if (typeof (group as any).goToFrame === "function") {
        const startFrame = typeof group.from === "number" ? group.from : 0;
        (group as any).goToFrame(startFrame);
      }
      return;
    }

    if (animationMode === "once") {
      if (playToken == null) return;
      if (lastPlayTokenRef.current === playToken) return;
      lastPlayTokenRef.current = playToken;

      group.stop();
      if (typeof (group as any).goToFrame === "function") {
        const startFrame = typeof group.from === "number" ? group.from : 0;
        (group as any).goToFrame(startFrame);
      }
      group.start(false);
    }
  }, [animationMode, playToken, animationReadyToken, technique?.id]);

  useEffect(() => {
    const group = activeAnimationGroupRef.current;
    if (!group || animationMode !== "once") return;
    const observer = group.onAnimationGroupEndObservable.add(() => {
      group.stop();
      if (typeof (group as any).goToFrame === "function") {
        const startFrame = typeof group.from === "number" ? group.from : 0;
        (group as any).goToFrame(startFrame);
      }
    });
    return () => {
      group.onAnimationGroupEndObservable.remove(observer);
    };
  }, [animationMode, animationReadyToken, technique?.id]);

  return (
    <div
      className={`${className} relative`}
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
          <TechniqueLoader
            technique={technique || null}
            activeAnimationGroupRef={activeAnimationGroupRef}
            activeSkeletonRef={activeSkeletonRef}
            activeSkeletonMeshRef={activeSkeletonMeshRef}
            activeBoneMapRef={activeBoneMapRef}
            activeReferenceValidRef={activeReferenceValidRef}
            activeReferenceMissingRef={activeReferenceMissingRef}
            onAnimationGroupReady={() => setAnimationReadyToken((v) => v + 1)}
          />
          <ZoomController />
          <SceneProvider sceneRef={sceneRef} onSceneReady={handleSceneReady} />
          <ReferenceSampler
            activeAnimationGroupRef={activeAnimationGroupRef}
            activeSkeletonRef={activeSkeletonRef}
            activeSkeletonMeshRef={activeSkeletonMeshRef}
            activeBoneMapRef={activeBoneMapRef}
            activeReferenceValidRef={activeReferenceValidRef}
            activeReferenceMissingRef={activeReferenceMissingRef}
            onReferenceFrame={onReferenceFrame}
            referenceFps={referenceFps}
          />
        </Scene>
      </Engine>
      <CameraControls sceneRef={sceneRef} isSceneReady={isSceneReady} />
    </div>
  );
}
