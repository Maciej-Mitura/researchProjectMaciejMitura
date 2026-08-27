import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';

type TechniqueNotFoundProps = {
  techniqueId?: string | null;
};

export function TechniqueNotFound({ techniqueId }: TechniqueNotFoundProps) {
  return (
    <Screen>
      <AppText variant="title">Technique not found</AppText>
      <AppText variant="body" tone="muted">
        {techniqueId
          ? `No technique is registered for “${techniqueId}”.`
          : 'A technique id is required for this screen.'}
      </AppText>
      <Button label="Back to techniques" onPress={() => router.replace('/techniques')} />
    </Screen>
  );
}
