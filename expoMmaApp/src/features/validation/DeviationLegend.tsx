import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { HIGHLIGHT_MEANING, HIGHLIGHT_NOT_MEANING } from '@/features/validation/highlightCopy';

export function DeviationLegend({
  bodyPart,
  progressStart,
  progressEnd,
}: {
  bodyPart: string;
  progressStart: number;
  progressEnd: number;
}) {
  const label = bodyPart.replace(/_/g, ' ');
  const start = Math.round(progressStart * 100);
  const end = Math.round(progressEnd * 100);
  return (
    <Card>
      <AppText variant="caption" tone="accent">
        Joint deviation highlight
      </AppText>
      <AppText variant="body">
        {`USER ${label} is emphasized from ${start}% to ${end}% of the movement.`}
      </AppText>
      <AppText variant="body">{HIGHLIGHT_MEANING}</AppText>
      {HIGHLIGHT_NOT_MEANING.map((line) => (
        <AppText key={line} variant="body" tone="muted">
          {line}
        </AppText>
      ))}
    </Card>
  );
}
