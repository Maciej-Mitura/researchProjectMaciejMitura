export type TechniqueCategory = 'punch' | 'kick' | 'defense' | 'grappling' | 'other';

export type LeadSide = 'left' | 'right';

export type TechniqueSource = 'builtin' | 'recorded';

export type ReferenceStatus = 'missing' | 'available';

export type MovementPhaseId =
  | 'START'
  | 'EXTENSION'
  | 'PEAK'
  | 'RETRACTION'
  | 'RECOVERY';

export type GenericKeyframePhaseId = 'START' | 'EARLY' | 'MIDDLE' | 'LATE' | 'END';

/**
 * Bundled GLB metadata from V1. These are legacy demonstration assets, not
 * human recordings and not the V2 comparison reference.
 */
export type ReferenceAsset = {
  kind: 'glb';
  filename: string;
  v2RelativePath: string;
};

export type Technique = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: TechniqueCategory;
  source: TechniqueSource;
  referenceStatus: ReferenceStatus;
  leadSide: LeadSide | null;
  referenceAsset: ReferenceAsset | null;
  movementPhases: readonly MovementPhaseId[] | readonly GenericKeyframePhaseId[];
  rubricId: string | null;
  createdAt: string | null;
  recordingDurationSeconds: number | null;
};

export const GENERIC_REFERENCE_PHASES: readonly GenericKeyframePhaseId[] = [
  'START',
  'EARLY',
  'MIDDLE',
  'LATE',
  'END',
];
