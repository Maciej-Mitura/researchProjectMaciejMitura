import type { MovementPhaseId, Technique } from '@/features/techniques/types';

const STRIKE_PHASES: readonly MovementPhaseId[] = [
  'START',
  'EXTENSION',
  'PEAK',
  'RETRACTION',
  'RECOVERY',
];

export const TECHNIQUES: readonly Technique[] = [
  {
    id: 'simple_jab',
    slug: 'simple_jab',
    name: 'Jab',
    category: 'punch',
    description:
      'A quick, straight punch thrown with the lead hand. The most fundamental striking technique.',
    source: 'builtin',
    referenceStatus: 'missing',
    leadSide: 'left',
    referenceAsset: {
      kind: 'glb',
      filename: 'simple_jab.glb',
      v2RelativePath: 'assets/animations/techniques/simple_jab.glb',
    },
    movementPhases: STRIKE_PHASES,
    rubricId: 'jab-foundation',
    createdAt: null,
    recordingDurationSeconds: 3,
  },
  {
    id: 'mmakick',
    slug: 'mmakick',
    name: 'MMA Kick',
    category: 'kick',
    description:
      'A rotated middle kick used to break a guard or land damage to the body or head.',
    source: 'builtin',
    referenceStatus: 'missing',
    leadSide: 'left',
    referenceAsset: {
      kind: 'glb',
      filename: 'mmakick.glb',
      v2RelativePath: 'assets/animations/techniques/mmakick.glb',
    },
    movementPhases: STRIKE_PHASES,
    rubricId: 'mma-kick-foundation',
    createdAt: null,
    recordingDurationSeconds: 3,
  },
];

export function getBuiltinTechniques(): readonly Technique[] {
  return TECHNIQUES;
}

export function getAllTechniques(): readonly Technique[] {
  return TECHNIQUES;
}

export function getTechniqueById(id: string): Technique | undefined {
  return TECHNIQUES.find((technique) => technique.id === id);
}

export function techniqueSupportsTrainingCapture(technique: Technique): boolean {
  return technique.source === 'recorded' && technique.referenceStatus === 'available';
}

/** Built-in Jab five-frame detector. Isolated experimental/legacy path, not athlete training. */
export function techniqueSupportsAttemptAnalysis(technique: Technique): boolean {
  return technique.source === 'builtin' && technique.id === 'simple_jab';
}

export function techniqueSupportsGenericComparison(technique: Technique): boolean {
  return technique.source === 'recorded' && technique.referenceStatus === 'available';
}

export function isBuiltinCatalogTechnique(technique: Technique): boolean {
  return technique.source === 'builtin';
}
