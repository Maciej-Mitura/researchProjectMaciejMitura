import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { COUNTDOWN_LABELS } from '@/features/training/constants';

export type ReferenceRecorder = {
  startMutedRecording: (maxDurationSeconds: number) => Promise<string>;
  stopRecording: () => void;
};

type ReferenceRecordingPhase = 'idle' | 'countdown' | 'recording' | 'review' | 'error';

type UseReferenceRecordingParams = {
  getRecorder: () => ReferenceRecorder | null;
  onRecorded: (videoUri: string) => void;
  maxDurationSeconds: number;
};

export function useReferenceRecordingSession({
  getRecorder,
  onRecorded,
  maxDurationSeconds,
}: UseReferenceRecordingParams) {
  const [phase, setPhase] = useState<ReferenceRecordingPhase>('idle');
  const [countdownIndex, setCountdownIndex] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const recordingRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      recordingRef.current = false;
      getRecorder()?.stopRecording();
    };
  }, [getRecorder]);

  const beginRecording = useCallback(async () => {
    if (recordingRef.current) {
      return;
    }
    const recorder = getRecorder();
    if (!recorder) {
      setPhase('idle');
      setLastError('Camera is not ready. Try again.');
      return;
    }

    recordingRef.current = true;
    setPhase('recording');
    setLastError(null);

    try {
      const videoUri = await recorder.startMutedRecording(maxDurationSeconds);
      if (cancelledRef.current) {
        return;
      }
      setPhase('review');
      onRecorded(videoUri);
    } catch (error) {
      if (cancelledRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Recording failed. Please try again.';
      setPhase('idle');
      setLastError(message);
    } finally {
      recordingRef.current = false;
    }
  }, [getRecorder, maxDurationSeconds, onRecorded]);

  useEffect(() => {
    if (phase !== 'countdown') {
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
  }, [beginRecording, countdownIndex, phase]);

  const startCountdown = useCallback(() => {
    if (phase !== 'idle') {
      return;
    }
    setCountdownIndex(0);
    setPhase('countdown');
    setLastError(null);
  }, [phase]);

  const stopRecording = useCallback(() => {
    getRecorder()?.stopRecording();
  }, [getRecorder]);

  const retry = useCallback(() => {
    getRecorder()?.stopRecording();
    recordingRef.current = false;
    setCountdownIndex(0);
    setPhase('idle');
    setLastError(null);
  }, [getRecorder]);

  const countdownLabel = phase === 'countdown' ? (COUNTDOWN_LABELS[countdownIndex] ?? null) : null;

  return {
    phase,
    countdownLabel,
    lastError,
    startCountdown,
    stopRecording,
    retry,
    maxDurationLabel: `${maxDurationSeconds}s`,
    maxDurationMs: maxDurationSeconds * 1000,
    webUnsupported: Platform.OS === 'web',
  };
}
