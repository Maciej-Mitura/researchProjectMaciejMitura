import type { AiMainCorrection, DetailedAssessmentResponse } from '@/features/ai/types';

const MAX_SPOKEN_CHARS = 700;
const MAX_SUMMARY_SENTENCES = 2;
const MAX_CORRECTIONS = 2;

function firstSentences(text: string, count: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) {
    return '';
  }
  const pieces = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!pieces) {
    return trimmed;
  }
  return pieces
    .slice(0, count)
    .map((item) => item.trim())
    .join(' ')
    .trim();
}

function spokenCorrection(item: AiMainCorrection, index: number): string {
  const title = item.title.trim().replace(/\.$/, '');
  const explanation = firstSentences(item.explanation, 1);
  if (title.length > 0 && explanation.length > 0) {
    return `${index + 1}. ${title}. ${explanation}`;
  }
  if (title.length > 0) {
    return `${index + 1}. ${title}.`;
  }
  return explanation;
}

export function truncateSpokenText(text: string, maxChars = MAX_SPOKEN_CHARS): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  const slice = compact.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const clipped = (lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trim();
  return `${clipped.replace(/[.,;:]+$/, '')}.`;
}

export function buildDetailedSpeechText(
  response: Pick<
    DetailedAssessmentResponse,
    'overallScore' | 'overallMax' | 'summary' | 'mainCorrections' | 'analysisValid' | 'comparisonValid'
  >,
): string | null {
  if (!response.analysisValid || response.comparisonValid === false) {
    return null;
  }
  const parts: string[] = [];
  if (response.overallScore != null) {
    parts.push(`Overall similarity is ${response.overallScore} out of ${response.overallMax}.`);
  }
  const summary = response.summary ? firstSentences(response.summary, MAX_SUMMARY_SENTENCES) : '';
  if (summary.length > 0) {
    parts.push(summary.endsWith('.') || summary.endsWith('!') || summary.endsWith('?') ? summary : `${summary}.`);
  }
  const corrections = (response.mainCorrections ?? [])
    .filter((item) => item.title.trim().length > 0 || item.explanation.trim().length > 0)
    .slice(0, MAX_CORRECTIONS);
  if (corrections.length > 0) {
    parts.push(corrections.length === 1 ? 'Main correction:' : 'Main differences:');
    corrections.forEach((item, index) => {
      parts.push(spokenCorrection(item, index));
    });
  }
  if (parts.length === 0) {
    return null;
  }
  return truncateSpokenText(parts.join(' '));
}
