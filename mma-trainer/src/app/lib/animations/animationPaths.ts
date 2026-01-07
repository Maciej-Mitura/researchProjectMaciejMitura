/**
 * Animation Paths Utility
 * 
 * Centralized paths for all 3D animation assets.
 * This ensures consistent path usage throughout the application.
 */

export const ANIMATION_BASE_PATH = "/animations";

/**
 * Technique animation paths
 */
export const TECHNIQUE_ANIMATIONS = {
  // Punches
  JAB_STRAIGHT: `${ANIMATION_BASE_PATH}/techniques/jab_straight.glb`,
  CROSS: `${ANIMATION_BASE_PATH}/techniques/cross.glb`,
  HOOK_LEFT: `${ANIMATION_BASE_PATH}/techniques/hook_left.glb`,
  HOOK_RIGHT: `${ANIMATION_BASE_PATH}/techniques/hook_right.glb`,
  UPPERCUT: `${ANIMATION_BASE_PATH}/techniques/uppercut.glb`,
  
  // Kicks
  FRONT_KICK: `${ANIMATION_BASE_PATH}/techniques/front_kick.glb`,
  ROUNDHOUSE_KICK: `${ANIMATION_BASE_PATH}/techniques/roundhouse_kick.glb`,
  SIDE_KICK: `${ANIMATION_BASE_PATH}/techniques/side_kick.glb`,
  BACK_KICK: `${ANIMATION_BASE_PATH}/techniques/back_kick.glb`,
  
  // Defense
  BLOCK_HIGH: `${ANIMATION_BASE_PATH}/techniques/block_high.glb`,
  BLOCK_LOW: `${ANIMATION_BASE_PATH}/techniques/block_low.glb`,
  DODGE: `${ANIMATION_BASE_PATH}/techniques/dodge.glb`,
  PARRY: `${ANIMATION_BASE_PATH}/techniques/parry.glb`,
} as const;

/**
 * Character animation paths
 */
export const CHARACTER_ANIMATIONS = {
  IDLE: `${ANIMATION_BASE_PATH}/characters/fighter_idle.glb`,
  WALK: `${ANIMATION_BASE_PATH}/characters/fighter_walk.glb`,
  RUN: `${ANIMATION_BASE_PATH}/characters/fighter_run.glb`,
  STANCE: `${ANIMATION_BASE_PATH}/characters/fighter_stance.glb`,
} as const;

/**
 * Environment paths
 */
export const ENVIRONMENT_ASSETS = {
  TRAINING_ROOM: `${ANIMATION_BASE_PATH}/environments/training_room.glb`,
  GYM_FLOOR: `${ANIMATION_BASE_PATH}/environments/gym_floor.glb`,
} as const;

/**
 * Reference animation paths
 */
export const REFERENCE_ANIMATIONS = {
  JAB_REFERENCE_FRONT: `${ANIMATION_BASE_PATH}/reference/jab_reference_front.glb`,
  JAB_REFERENCE_SIDE: `${ANIMATION_BASE_PATH}/reference/jab_reference_side.glb`,
  ROUNDHOUSE_REFERENCE_FRONT: `${ANIMATION_BASE_PATH}/reference/roundhouse_reference_front.glb`,
  ROUNDHOUSE_REFERENCE_SIDE: `${ANIMATION_BASE_PATH}/reference/roundhouse_reference_side.glb`,
} as const;

/**
 * UI 3D element paths
 */
export const UI_3D_ELEMENTS = {
  FEEDBACK_MARKER: `${ANIMATION_BASE_PATH}/ui/feedback_marker.glb`,
  SCORE_INDICATOR: `${ANIMATION_BASE_PATH}/ui/score_indicator.glb`,
} as const;

/**
 * Helper function to get technique animation path by name
 */
export function getTechniquePath(techniqueName: string): string {
  const upperName = techniqueName.toUpperCase().replace(/\s+/g, "_");
  return (TECHNIQUE_ANIMATIONS as Record<string, string>)[upperName] || 
         `${ANIMATION_BASE_PATH}/techniques/${techniqueName.toLowerCase().replace(/\s+/g, "_")}.glb`;
}

/**
 * Helper function to get reference animation path
 */
export function getReferencePath(technique: string, angle: "front" | "side" = "front"): string {
  const techniqueKey = `${technique.toUpperCase().replace(/\s+/g, "_")}_REFERENCE_${angle.toUpperCase()}`;
  return (REFERENCE_ANIMATIONS as Record<string, string>)[techniqueKey] || 
         `${ANIMATION_BASE_PATH}/reference/${technique.toLowerCase().replace(/\s+/g, "_")}_reference_${angle}.glb`;
}

