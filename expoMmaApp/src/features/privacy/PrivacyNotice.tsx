import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';

type PrivacyNoticeProps = {
  title: string;
  body: string;
};

export function PrivacyNotice({ title, body }: PrivacyNoticeProps) {
  return (
    <Card>
      <AppText variant="caption" tone="muted">
        {title}
      </AppText>
      <AppText variant="body" tone="muted">
        {body}
      </AppText>
    </Card>
  );
}
