import { GENERIC_REFERENCE_PHASES, type Technique } from '@/features/techniques/types';
import type { RecordedTechniqueSummary } from '@/features/reference/types';

export function recordedSummaryToTechnique(summary: RecordedTechniqueSummary): Technique {
  return {
    id: summary.id,
    slug: summary.slug,
    name: summary.name,
    description: summary.description ?? '',
    category: 'other',
    source: 'recorded',
    referenceStatus: 'available',
    leadSide: null,
    referenceAsset: null,
    movementPhases: GENERIC_REFERENCE_PHASES,
    rubricId: null,
    createdAt: summary.createdAt,
    recordingDurationSeconds: summary.recordingDurationSeconds,
  };
}

export function mergeTechniqueLibrary(
  builtins: readonly Technique[],
  recorded: readonly Technique[],
): Technique[] {
  const reserved = new Set<string>();
  for (const technique of builtins) {
    reserved.add(technique.id);
    reserved.add(technique.slug);
  }

  const extras = recorded.filter(
    (technique) => !reserved.has(technique.id) && !reserved.has(technique.slug),
  );
  return [...builtins, ...extras];
}
