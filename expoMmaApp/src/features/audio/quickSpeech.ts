import type { MovementSimilarityResult, SimilarityLargestDeviation } from '@/features/comparison/types';

function progressRegion(progress: number): string {
  if (progress < 0.2) {
    return 'the start';
  }
  if (progress < 0.4) {
    return 'the early part';
  }
  if (progress < 0.6) {
    return 'the middle';
  }
  if (progress < 0.8) {
    return 'the late part';
  }
  return 'the end';
}

function humanJointLabel(bodyPart: string): string {
  return bodyPart.replace(/_/g, ' ').trim();
}

function stripScoreSuffix(text: string): string {
  return text.replace(/\s*\(\s*\d+\s*\/\s*100\s*\)\.?/g, '').trim();
}

function spokenClosestMatch(strongest: string | null): string | null {
  if (!strongest) {
    return null;
  }
  const cleaned = stripScoreSuffix(strongest);
  const closestMatch = cleaned.match(/^Closest match:\s*(.+)$/i);
  if (closestMatch) {
    const label = closestMatch[1].replace(/\s*\/\s*/g, ' and ').trim();
    return `Your closest match was ${label}.`;
  }
  if (/[.!?]$/.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}.`;
}

function spokenLargestDifference(
  mainDifference: string | null,
  largestDeviation: SimilarityLargestDeviation | null,
): string | null {
  if (mainDifference) {
    const cleaned = stripScoreSuffix(mainDifference);
    const largest = cleaned.match(/^Largest difference:\s*(.+)$/i);
    if (largest) {
      const detail = largest[1].replace(/\.$/, '');
      return `The largest measured difference was ${detail}.`;
    }
    if (/[.!?]$/.test(cleaned)) {
      return cleaned;
    }
    return `${cleaned}.`;
  }
  if (!largestDeviation) {
    return null;
  }
  const mid = (largestDeviation.progressStart + largestDeviation.progressEnd) / 2;
  return `The largest measured difference was ${humanJointLabel(largestDeviation.bodyPart)} movement around ${progressRegion(mid)} of the sequence.`;
}

export function buildQuickSpeechText(
  similarity: MovementSimilarityResult | null,
): string | null {
  if (!similarity || !similarity.similarityValid || similarity.movementSimilarity == null) {
    return null;
  }
  const parts = [`Movement similarity is ${similarity.movementSimilarity} percent.`];
  const closest = spokenClosestMatch(similarity.feedback?.strongest ?? null);
  if (closest) {
    parts.push(closest);
  }
  const difference = spokenLargestDifference(
    similarity.feedback?.mainDifference ?? null,
    similarity.diagnostics?.largestDeviation ?? null,
  );
  if (difference) {
    parts.push(difference);
  }
  return parts.join(' ');
}
