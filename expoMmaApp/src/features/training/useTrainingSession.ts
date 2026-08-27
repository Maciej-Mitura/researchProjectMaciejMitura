import { useCallback, useEffect, useRef, useState } from 'react';

import { analyzeAttempt } from '@/features/analysis/api/analyzeAttempt';
import { toAnalysisClientError } from '@/features/analysis/api/errors';
import {
  ANALYSIS_SUPPORTED_TECHNIQUE_ID,
  KICK_UNSUPPORTED_MESSAGE,
} from '@/features/analysis/constants';
import { clearLatestAnalysis, setLatestAnalysis } from '@/features/analysis/latestAnalysis';
import { analyzeGenericAttempt } from '@/features/comparison/api/analyzeGenericAttempt';
import { clearLatestComparison, setLatestComparison } from '@/features/comparison/latestComparison';
import { clearLatestAiAssessment } from '@/features/ai/latestAssessment';
import { COUNTDOWN_LABELS } from '@/features/training/constants';
import type { TrainingCaptureConfig } from '@/features/training/config';
import { JAB_TRAINING_CAPTURE } from '@/features/training/config';
import { setAcceptedAttempt } from '@/features/training/acceptedAttempt';
import {
  createIdleSession,
  retrySession,
  type TrainingSession,
} from '@/features/training/types';

export type AttemptRecorder = {
  startMutedRecording: (maxDurationSeconds: number) => Promise<string>;
  stopRecording: () => void;
};

export type TrainingAnalysisKind = 'jab' | 'generic' | 'unsupported';

type UseTrainingSessionParams = {
  techniqueId: string;
  analysisKind?: TrainingAnalysisKind;
  capture?: TrainingCaptureConfig;
  getRecorder: () => AttemptRecorder | null;
  onAnalysisReady?: (techniqueId: string) => void;
};

export function useTrainingSession({
  techniqueId,
  analysisKind = 'jab',
  capture = JAB_TRAINING_CAPTURE,
  getRecorder,
  onAnalysisReady,
}: UseTrainingSessionParams) {
  const [session, setSession] = useState<TrainingSession>(() => createIdleSession(techniqueId));
  const [countdownIndex, setCountdownIndex] = useState(0);
  const cancelledRef = useRef(false);
  const recordingRef = useRef(false);
  const analyzingRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    return () => {
      cancelledRef.current = true;
      recordingRef.current = false;
      analyzingRef.current = false;
      getRecorder()?.stopRecording();
    };
  }, [getRecorder]);

  const beginRecording = useCallback(async () => {
    if (recordingRef.current) {
      return;
    }

    const recorder = getRecorder();
    if (!recorder) {
      setSession((current) => ({
        ...current,
        phase: 'idle',
        lastError: 'Camera is not ready. Try again.',
        lastErrorCode: null,
      }));
      return;
    }

    recordingRef.current = true;
    setSession((current) => ({
      ...current,
      phase: 'recording',
      startedAtMs: Date.now(),
      lastError: null,
      lastErrorCode: null,
    }));

    try {
      const videoUri = await recorder.startMutedRecording(capture.maxDurationSeconds);
      if (cancelledRef.current) {
        return;
      }

      if (__DEV__) {
        console.log('[training] recorded attempt', videoUri);
      }

      setSession((current) => ({
        ...current,
        phase: 'review',
        attempt: {
          videoUri,
          durationMs: capture.maxDurationSeconds * 1000,
          recordedAtMs: Date.now(),
          phaseTimestamps: null,
          keyframes: null,
        },
      }));
    } catch (error) {
      if (cancelledRef.current) {
        return;
      }

      const message =
        error instanceof Error ? error.message : 'Recording failed. Please try again.';
      console.warn('[training] recording failed', error);
      setSession((current) => ({
        ...current,
        phase: 'idle',
        startedAtMs: null,
        attempt: null,
        lastError: message,
        lastErrorCode: null,
      }));
    } finally {
      recordingRef.current = false;
    }
  }, [capture.maxDurationSeconds, getRecorder]);

  useEffect(() => {
    if (session.phase !== 'countdown') {
      return;
    }

    const currentLabel = COUNTDOWN_LABELS[countdownIndex];
    if (!currentLabel) {
      return;
    }

    const delayMs = currentLabel === 'GO' ? 700 : 1000;
    const timer = setTimeout(() => {
      if (currentLabel === 'GO') {
        void beginRecording();
        return;
      }
      setCountdownIndex((index) => index + 1);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [beginRecording, countdownIndex, session.phase]);

  const startCountdown = useCallback(() => {
    if (session.phase !== 'idle') {
      return;
    }

    setCountdownIndex(0);
    setSession((current) => ({
      ...current,
      phase: 'countdown',
      lastError: null,
      lastErrorCode: null,
    }));
  }, [session.phase]);

  const stopRecording = useCallback(() => {
    getRecorder()?.stopRecording();
  }, [getRecorder]);

  const retry = useCallback(() => {
    getRecorder()?.stopRecording();
    recordingRef.current = false;
    analyzingRef.current = false;
    setCountdownIndex(0);
    clearLatestAnalysis();
    clearLatestComparison();
    clearLatestAiAssessment();
    setSession((current) => retrySession(current));
  }, [getRecorder]);

  const submitAttempt = useCallback(async () => {
    if (analyzingRef.current) {
      return;
    }

    const attempt = session.attempt;
    if (!attempt || session.phase !== 'review') {
      return;
    }

    if (analysisKind === 'unsupported' || techniqueId === 'mmakick') {
      setSession((current) => ({
        ...current,
        phase: 'error',
        lastError:
          techniqueId === 'mmakick'
            ? KICK_UNSUPPORTED_MESSAGE
            : 'Automatic analysis for this technique is not implemented yet.',
        lastErrorCode: null,
      }));
      return;
    }

    if (analysisKind === 'jab' && techniqueId !== ANALYSIS_SUPPORTED_TECHNIQUE_ID) {
      setSession((current) => ({
        ...current,
        phase: 'error',
        lastError: 'Automatic analysis for this technique is not implemented yet.',
        lastErrorCode: null,
      }));
      return;
    }

    analyzingRef.current = true;
    setAcceptedAttempt(attempt);
    clearLatestAnalysis();
    clearLatestComparison();
    clearLatestAiAssessment();
    setSession((current) => ({
      ...current,
      phase: 'processing',
      lastError: null,
      lastErrorCode: null,
    }));

    try {
      if (analysisKind === 'generic') {
        const response = await analyzeGenericAttempt({
          slug: techniqueId,
          videoUri: attempt.videoUri,
        });
        if (cancelledRef.current) {
          return;
        }
        setLatestComparison({
          techniqueId,
          attemptVideoUri: attempt.videoUri,
          response,
          receivedAtMs: Date.now(),
        });
      } else {
        const response = await analyzeAttempt({
          techniqueId,
          videoUri: attempt.videoUri,
        });
        if (cancelledRef.current) {
          return;
        }
        setLatestAnalysis({
          techniqueId,
          attemptVideoUri: attempt.videoUri,
          response,
          receivedAtMs: Date.now(),
        });
      }
      setSession((current) => ({
        ...current,
        phase: 'keyframe_review',
      }));
      onAnalysisReady?.(techniqueId);
    } catch (error) {
      if (cancelledRef.current) {
        return;
      }

      const clientError = toAnalysisClientError(error);
      console.warn('[training] analysis failed', clientError.code, clientError.message);

      if (clientError.code === 'analysis_rejected') {
        if (analysisKind === 'generic' && clientError.comparison) {
          setLatestComparison({
            techniqueId,
            attemptVideoUri: attempt.videoUri,
            response: clientError.comparison,
            receivedAtMs: Date.now(),
          });
          setSession((current) => ({
            ...current,
            phase: 'keyframe_review',
            lastError: null,
            lastErrorCode: null,
          }));
          onAnalysisReady?.(techniqueId);
          return;
        }
        if (analysisKind === 'jab' && clientError.analysis) {
          setLatestAnalysis({
            techniqueId,
            attemptVideoUri: attempt.videoUri,
            response: clientError.analysis,
            receivedAtMs: Date.now(),
          });
          setSession((current) => ({
            ...current,
            phase: 'keyframe_review',
            lastError: null,
            lastErrorCode: null,
          }));
          onAnalysisReady?.(techniqueId);
          return;
        }
      }

      setSession((current) => ({
        ...current,
        phase: 'error',
        lastError: clientError.message,
        lastErrorCode: clientError.code,
      }));
    } finally {
      analyzingRef.current = false;
    }
  }, [analysisKind, onAnalysisReady, session.attempt, session.phase, techniqueId]);

  const countdownLabel =
    session.phase === 'countdown' ? (COUNTDOWN_LABELS[countdownIndex] ?? null) : null;

  return {
    session,
    countdownLabel,
    startCountdown,
    stopRecording,
    retry,
    submitAttempt,
  };
}

export function phaseLabel(phase: TrainingSession['phase']): string {
  switch (phase) {
    case 'idle':
      return 'Ready';
    case 'countdown':
      return 'Countdown';
    case 'recording':
      return 'Recording';
    case 'review':
      return 'Review';
    case 'processing':
      return 'Processing';
    case 'keyframe_review':
      return 'Keyframes';
    case 'error':
      return 'Needs retry';
  }
}
