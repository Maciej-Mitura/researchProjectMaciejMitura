import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useDetailedAnalysis } from '@/features/ai/useDetailedAnalysis';
import { AiProcessingView } from '@/features/ai/AiProcessingView';
import { QUICK_PROCESSING_STEPS } from '@/features/ai/constants';
import { analyzeGenericAttempt } from '@/features/comparison/api/analyzeGenericAttempt';
import { setLatestComparison } from '@/features/comparison/latestComparison';
import {
  AnalysisClientError,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import type { AnalysisErrorCode } from '@/features/analysis/types';
import { ExternalAiDisclosure } from '@/features/privacy/ExternalAiDisclosure';
import { nextDetailedAnalysisAction } from '@/features/privacy/gates';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { AnalysisErrorView } from '@/features/training/AnalysisErrorView';
import { ProcessingView } from '@/features/training/ProcessingView';
import { getAcceptedAttempt } from '@/features/training/acceptedAttempt';
import { usesGenericComparison } from '@/features/training/config';
import { spacing } from '@/theme/spacing';
import { shouldReturnToValidationResult } from '@/features/validation/session';
import { comparisonHref, privacyHref, validationResultHref } from '@/utils/routes';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

type QuickPhase = 'choose' | 'processing' | 'error';

export function ChooseAnalysisScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;
  const attempt = getAcceptedAttempt();
  const detailed = useDetailedAnalysis();
  const privacy = usePrivacyAcknowledgements();
  const [quickPhase, setQuickPhase] = useState<QuickPhase>('choose');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickErrorCode, setQuickErrorCode] = useState<AnalysisErrorCode | null>(null);
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);

  const retryRecording = useCallback(() => {
    if (!technique) {
      return;
    }
    detailed.reset();
    setQuickPhase('choose');
    setQuickError(null);
    setQuickErrorCode(null);
    setShowAiDisclosure(false);
    router.replace({
      pathname: '/training/[techniqueId]',
      params: { techniqueId: technique.id },
    });
  }, [detailed, technique]);

  const runQuickComparison = useCallback(async () => {
    if (!technique || !attempt) {
      return;
    }
    setShowAiDisclosure(false);
    setQuickPhase('processing');
    setQuickError(null);
    setQuickErrorCode(null);
    try {
      const response = await analyzeGenericAttempt({
        slug: technique.id,
        videoUri: attempt.videoUri,
      });
      setLatestComparison({
        techniqueId: technique.id,
        attemptVideoUri: attempt.videoUri,
        response,
        receivedAtMs: Date.now(),
      });
      router.replace(
        shouldReturnToValidationResult(technique.id)
          ? validationResultHref
          : comparisonHref(technique.id),
      );
    } catch (error) {
      const clientError =
        error instanceof AnalysisClientError ? error : toAnalysisClientError(error);
      if (clientError.code === 'analysis_rejected' && clientError.comparison) {
        setLatestComparison({
          techniqueId: technique.id,
          attemptVideoUri: attempt.videoUri,
          response: clientError.comparison,
          receivedAtMs: Date.now(),
        });
        router.replace(
          shouldReturnToValidationResult(technique.id)
            ? validationResultHref
            : comparisonHref(technique.id),
        );
        return;
      }
      setQuickPhase('error');
      setQuickError(clientError.message);
      setQuickErrorCode(clientError.code);
    }
  }, [attempt, technique]);

  const requestDetailedAnalysis = useCallback(() => {
    if (!technique || !attempt || !privacy.ready) {
      return;
    }
    if (nextDetailedAnalysisAction(privacy.acknowledgements) === 'show-disclosure') {
      setShowAiDisclosure(true);
      return;
    }
    void detailed.run(technique.id, attempt.videoUri);
  }, [attempt, detailed, privacy.acknowledgements, privacy.ready, technique]);

  const continueWithAi = useCallback(async () => {
    if (!technique || !attempt) {
      return;
    }
    await privacy.acknowledgeExternalAi();
    setShowAiDisclosure(false);
    void detailed.run(technique.id, attempt.videoUri);
  }, [attempt, detailed, privacy, technique]);

  if (loading && !technique) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading technique…
        </AppText>
      </Screen>
    );
  }

  if (!techniqueId || !technique || !usesGenericComparison(technique)) {
    return <TechniqueNotFound techniqueId={techniqueId} />;
  }

  if (!attempt) {
    return (
      <Screen>
        <AppText variant="title">No attempt to analyze</AppText>
        <AppText variant="body" tone="muted">
          Record an attempt first, then choose Quick Comparison or Detailed AI Analysis.
        </AppText>
        <Button
          label="Back to Training"
          onPress={() =>
            router.replace({
              pathname: '/training/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      </Screen>
    );
  }

  if (detailed.phase === 'processing') {
    return (
      <Screen>
        <AiProcessingView job={detailed.job} />
      </Screen>
    );
  }

  if (quickPhase === 'processing') {
    return (
      <Screen>
        <ProcessingView
          title="Preparing comparison…"
          description="The server is detecting movement, calculating similarity, and preparing the synchronized replay. This is not a percentage of remaining time."
          steps={QUICK_PROCESSING_STEPS}
          currentIndex={0}
        />
      </Screen>
    );
  }

  if (detailed.phase === 'error') {
    return (
      <Screen>
        <AnalysisErrorView
          message={detailed.errorMessage ?? 'Detailed AI Analysis could not be completed.'}
          errorCode={detailed.errorCode}
          hint="Quick Comparison still works if you want a visual check without AI."
          onRetry={retryRecording}
          onBack={() => {
            detailed.reset();
          }}
        />
      </Screen>
    );
  }

  if (quickPhase === 'error') {
    return (
      <Screen>
        <AnalysisErrorView
          message={quickError ?? 'Quick Comparison could not be completed.'}
          errorCode={quickErrorCode}
          onRetry={retryRecording}
          onBack={() => {
            setQuickPhase('choose');
            setQuickError(null);
            setQuickErrorCode(null);
          }}
        />
      </Screen>
    );
  }

  if (showAiDisclosure) {
    return (
      <ExternalAiDisclosure
        onUseQuickComparison={() => {
          void runQuickComparison();
        }}
        onContinue={() => {
          void continueWithAi();
        }}
      />
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="caption" tone="accent">
          Choose Analysis
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          Your attempt is ready. Choose Computer Vision Comparison or Detailed AI Analysis.
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Computer Vision Comparison. No external AI."
        onPress={() => {
          void runQuickComparison();
        }}>
        <Card>
          <AppText variant="caption" tone="success">
            Fast · No external AI
          </AppText>
          <AppText variant="subtitle">Computer Vision Comparison</AppText>
          <AppText variant="body" tone="muted">
            Synchronized REFERENCE ↔ YOU video plus Movement Similarity (Pose / Form, Movement
            Path, Timing). Stays on the MMA Trainer backend. Not an expert correctness score.
          </AppText>
        </Card>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Detailed AI Analysis. Sends comparison video to Google Gemini."
        onPress={requestDetailedAnalysis}>
        <Card>
          <AppText variant="caption" tone="accent">
            Uses Google Gemini · Takes longer
          </AppText>
          <AppText variant="subtitle">Detailed AI Analysis</AppText>
          <AppText variant="body" tone="muted">
            Optionally send a slowed, aligned comparison video to Google Gemini for detailed
            movement-comparison feedback. This is separate from Quick Comparison.
          </AppText>
        </Card>
      </Pressable>

      <Button label="Record Again" variant="secondary" onPress={retryRecording} />
      <Button
        label="Privacy & Data"
        variant="ghost"
        accessibilityLabel="Open Privacy and Data information"
        onPress={() => router.push(privacyHref)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
});
