import type { TechniqueAssessment } from '@/features/results/types';

/**
 * Experimental / legacy Phase 1 placeholder scores.
 * Not used by production Results. Kept as research-history evidence only.
 */
export function getMockAssessment(techniqueId: string): TechniqueAssessment {
  return {
    techniqueId,
    overallScore: 82,
    overallMax: 100,
    criteria: [
      { id: 'guard', label: 'Guard', score: 3, maxScore: 4 },
      { id: 'extension', label: 'Extension', score: 4, maxScore: 4 },
      { id: 'body-mechanics', label: 'Body Mechanics', score: 3, maxScore: 4 },
      { id: 'recovery', label: 'Recovery', score: 4, maxScore: 4 },
      { id: 'similarity', label: 'Similarity', score: 3, maxScore: 4 },
    ],
    strength: 'Good extension and quick recovery.',
    mainCorrection: 'Keep your rear hand closer to your face.',
    capturedAtMs: Date.now(),
  };
}
