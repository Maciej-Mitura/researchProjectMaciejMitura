import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MediaFrame } from '@/components/MediaFrame';
import { Screen } from '@/components/Screen';
import { CameraPermissionGate } from '@/features/camera/CameraPermissionGate';
import {
  TrainingCamera,
  type TrainingCameraHandle,
} from '@/features/camera/TrainingCamera';
import { useCameraPermission } from '@/features/camera/useCameraPermission';
import { CameraPrivacyDisclosure } from '@/features/privacy/CameraPrivacyDisclosure';
import { PRACTICE_COMPACT_NOTICE } from '@/features/privacy/copy';
import { shouldMountCameraPreview, shouldShowCameraDisclosure } from '@/features/privacy/gates';
import { PrivacyNotice } from '@/features/privacy/PrivacyNotice';
import { usePrivacyAcknowledgements } from '@/features/privacy/PrivacyAcknowledgementsContext';
import { ReferencePlaceholder } from '@/features/reference/ReferencePlaceholder';
import { ReferenceVideoPlayer } from '@/features/reference/ReferenceVideoPlayer';
import { TechniqueNotFound } from '@/features/techniques/TechniqueNotFound';
import type { Technique } from '@/features/techniques/types';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import { AnalysisErrorView } from '@/features/training/AnalysisErrorView';
import { AttemptReview } from '@/features/training/AttemptReview';
import { ProcessingView } from '@/features/training/ProcessingView';
import { setAcceptedAttempt } from '@/features/training/acceptedAttempt';
import {
  captureConfigForTechnique,
  GENERIC_PROCESSING_STEPS,
  usesGenericComparison,
} from '@/features/training/config';
import {
  CAMERA_MEDIA_ASPECT_RATIO,
  REFERENCE_MEDIA_ASPECT_RATIO,
} from '@/features/training/constants';
import { phaseLabel, useTrainingSession } from '@/features/training/useTrainingSession';
import { shouldSkipChooseAnalysis, shouldReturnToValidationResult, getValidationSession } from '@/features/validation/session';
import { scenarioDisplayLabel } from '@/features/validation/presentation';
import { chooseAnalysisHref, comparisonHref, privacyHref, validationResultHref } from '@/utils/routes';
import { radii } from '@/theme/radii';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';
import { useTechniqueIdParam } from '@/utils/techniqueParams';

export function TrainingScreen() {
  const techniqueId = useTechniqueIdParam();
  const { getById, loading } = useTechniqueLibrary();
  const technique = techniqueId ? getById(techniqueId) : undefined;

  if (loading && !technique) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading technique…
        </AppText>
      </Screen>
    );
  }

  if (!techniqueId || !technique) {
    return <TechniqueNotFound techniqueId={techniqueId} />;
  }

  return <TrainingSessionView key={technique.id} technique={technique} />;
}

function TrainingSessionView({ technique }: { technique: Technique }) {
  const theme = useAppTheme();
  const cameraRef = useRef<TrainingCameraHandle>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const { state: permissionState, requestPermission, openSettings } = useCameraPermission();
  const privacy = usePrivacyAcknowledgements();
  const generic = usesGenericComparison(technique);
  const capture = captureConfigForTechnique(technique);
  const validation = getValidationSession();
  const validationActive = validation?.techniqueId === technique.id;

  const onAnalysisReady = useCallback(
    (id: string) => {
      if (generic) {
        if (shouldReturnToValidationResult(id)) {
          router.replace(validationResultHref);
          return;
        }
        router.replace(comparisonHref(id));
        return;
      }
      router.replace({
        pathname: '/analysis/[techniqueId]',
        params: { techniqueId: id },
      });
    },
    [generic],
  );

  const getRecorder = useCallback(() => cameraRef.current, []);
  const analysisKind =
    generic ? 'generic' : technique.id === 'mmakick' ? 'unsupported' : 'jab';
  const { session, countdownLabel, startCountdown, stopRecording, retry, submitAttempt } =
    useTrainingSession({
      techniqueId: technique.id,
      analysisKind,
      capture,
      getRecorder,
      onAnalysisReady,
    });

  if (!generic) {
    return (
      <Screen>
        <AppText variant="caption" tone="muted">
          Built-in catalog
        </AppText>
        <AppText variant="title">{technique.name}</AppText>
        <AppText variant="body" tone="muted">
          Practice comparison uses a recorded human reference. This catalog technique cannot be
          scored or compared here.
        </AppText>
        <Button
          label="Back to Technique"
          onPress={() =>
            router.replace({
              pathname: '/technique/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      </Screen>
    );
  }

  if (!privacy.ready) {
    return (
      <Screen>
        <AppText variant="body" tone="muted">
          Loading privacy information…
        </AppText>
      </Screen>
    );
  }

  if (
    shouldShowCameraDisclosure(privacy.acknowledgements) &&
    (session.phase === 'idle' || session.phase === 'countdown' || session.phase === 'recording')
  ) {
    return (
      <CameraPrivacyDisclosure
        variant="practice"
        onCancel={() =>
          router.replace({
            pathname: '/get-ready/[techniqueId]',
            params: { techniqueId: technique.id },
          })
        }
        onContinue={() => {
          void privacy.acknowledgeCameraPrivacy();
        }}
      />
    );
  }

  const cameraAllowed = shouldMountCameraPreview(privacy.acknowledgements);
  const showLiveCamera =
    cameraAllowed &&
    permissionState === 'granted' &&
    (session.phase === 'idle' || session.phase === 'countdown' || session.phase === 'recording');
  const canStart =
    cameraAllowed &&
    permissionState === 'granted' &&
    cameraReady &&
    session.phase === 'idle' &&
    Platform.OS !== 'web';

  return (
    <Screen>
      <View style={styles.statusRow}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceMuted }]}>
          <AppText variant="caption">{phaseLabel(session.phase)}</AppText>
        </View>
        <AppText variant="caption" tone="muted">
          {validationActive && validation
            ? scenarioDisplayLabel(validation.scenarioType)
            : `Attempt ${session.attemptNumber}`}
        </AppText>
      </View>

      {session.lastError && session.phase !== 'error' ? (
        <AppText variant="body" tone="warning">
          {session.lastError}
        </AppText>
      ) : null}

      {mountError ? (
        <AppText variant="body" tone="warning">
          {mountError}
        </AppText>
      ) : null}

      {session.phase === 'review' && session.attempt ? (
        <AttemptReview
          techniqueName={technique.name}
          attempt={session.attempt}
          onRetry={retry}
          onAccept={() => {
            if (generic) {
              if (session.attempt) {
                setAcceptedAttempt(session.attempt);
                if (shouldSkipChooseAnalysis(technique.id)) {
                  void submitAttempt();
                  return;
                }
                router.replace(chooseAnalysisHref(technique.id));
              }
              return;
            }
            void submitAttempt();
          }}
        />
      ) : session.phase === 'processing' || session.phase === 'keyframe_review' ? (
        <ProcessingView
          steps={generic ? GENERIC_PROCESSING_STEPS : undefined}
        />
      ) : session.phase === 'error' ? (
        <AnalysisErrorView
          message={session.lastError ?? 'Attempt could not be analyzed.'}
          errorCode={session.lastErrorCode}
          onRetry={retry}
          onBack={() =>
            router.replace({
              pathname: '/get-ready/[techniqueId]',
              params: { techniqueId: technique.id },
            })
          }
        />
      ) : (
        <View style={styles.session}>
          {generic ? (
            <ReferenceVideoPlayer slug={technique.slug} />
          ) : (
            <Card style={styles.mediaCard}>
              <AppText variant="caption" tone="muted">
                Reference
              </AppText>
              <MediaFrame aspectRatio={REFERENCE_MEDIA_ASPECT_RATIO}>
                <ReferencePlaceholder techniqueName={technique.name} />
              </MediaFrame>
            </Card>
          )}

          {generic && capture.guidance.length > 0 ? (
            <Card>
              {capture.guidance.map((tip) => (
                <AppText key={tip} variant="body">
                  {`•  ${tip}`}
                </AppText>
              ))}
            </Card>
          ) : null}

          <PrivacyNotice title="Practice recording" body={PRACTICE_COMPACT_NOTICE} />

          <Card style={styles.mediaCard}>
            <AppText variant="caption" tone="muted">
              You
            </AppText>
            {permissionState === 'granted' ? (
              <MediaFrame aspectRatio={CAMERA_MEDIA_ASPECT_RATIO}>
                {showLiveCamera ? (
                  <>
                    <TrainingCamera
                      ref={cameraRef}
                      onReadyChange={setCameraReady}
                      onMountError={setMountError}
                    />
                    {countdownLabel ? (
                      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                        <AppText variant="stat">{countdownLabel}</AppText>
                      </View>
                    ) : null}
                    {session.phase === 'recording' ? (
                      <View style={[styles.recordingBadge, { backgroundColor: theme.accent }]}>
                        <AppText variant="caption" style={{ color: theme.accentText }}>
                          Recording {capture.maxDurationSeconds}s
                        </AppText>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </MediaFrame>
            ) : (
              <CameraPermissionGate
                state={permissionState}
                onRequestPermission={() => {
                  void requestPermission();
                }}
                onOpenSettings={openSettings}
              />
            )}
          </Card>

          {Platform.OS === 'web' ? (
            <AppText variant="body" tone="muted">
              Recording is supported on a real Android or iOS device, not in the web preview.
            </AppText>
          ) : null}

          {generic && (session.phase === 'idle' || session.phase === 'countdown') ? (
            <AppText variant="body" tone="muted">
              {`Recording matches the reference length (${capture.maxDurationSeconds}s).`}
            </AppText>
          ) : null}

          {session.phase === 'recording' && capture.allowManualStop ? (
            <Button label="Stop Recording" variant="secondary" onPress={stopRecording} />
          ) : (
            <Button
              label={session.phase === 'recording' ? 'Recording…' : 'Start Attempt'}
              disabled={!canStart}
              onPress={startCountdown}
            />
          )}
          <Button
            label="Privacy & Data"
            variant="ghost"
            accessibilityLabel="Open Privacy and Data information"
            onPress={() => router.push(privacyHref)}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  session: {
    gap: spacing.lg,
  },
  mediaCard: {
    gap: spacing.md,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
