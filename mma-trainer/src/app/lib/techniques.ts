/**
 * Techniques Catalog
 *
 * Central catalog of all available MMA techniques.
 * Add new techniques here to make them available throughout the application.
 */

export interface Technique {
  id: string;
  name: string;
  description: string;
  assetUrl: string;
  animationName?: string; // Optional: specific animation name within the GLB file
  thumbnail?: string; // Optional: path to thumbnail image
  category?: "punch" | "kick" | "defense" | "grappling";
}

export const TECHNIQUES: Technique[] = [
  {
    id: "simple_jab",
    name: "Jab",
    description: "A quick, straight punch thrown with the lead hand. The most fundamental boxing technique.",
    assetUrl: "/animations/techniques/simple_jab.glb",
    category: "punch",
  },
  {
    id: "mmakick",
    name: "MMA Kick",
    description: "A rotated middlekick meant as a guard-breaker or a solid damage dealer if no guard is present. Could go to the ribs, liver or even head.",
    assetUrl: "/animations/techniques/mmakick.glb",
    category: "kick",
  },
];

/**
 * Get a technique by ID
 */
export function getTechniqueById(id: string): Technique | undefined {
  return TECHNIQUES.find((technique) => technique.id === id);
}

/**
 * Get all techniques
 */
export function getAllTechniques(): Technique[] {
  return TECHNIQUES;
}

/**
 * Get techniques by category
 */
export function getTechniquesByCategory(category: Technique["category"]): Technique[] {
  return TECHNIQUES.filter((technique) => technique.category === category);
}
