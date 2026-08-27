import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';

import { createAiAnalysisJob, fetchAiAnalysisJob } from '@/features/ai/api/requestAiJob';
import { AI_ANALYZE_TIMEOUT_MS, AI_JOB_POLL_MS } from '@/features/ai/constants';
import { setLatestAiAssessment } from '@/features/ai/latestAssessment';
import type { AiAnalysisJob } from '@/features/ai/types';
import {
  AnalysisClientError,
  toAnalysisClientError,
} from '@/features/analysis/api/errors';
import type { AnalysisErrorCode } from '@/features/analysis/types';
import { isExternalAiAcknowledged } from '@/features/privacy/store';
import { aiResultsHref } from '@/utils/routes';

type DetailedAnalysisPhase = 'idle' | 'processing' | 'error';

export function isTerminalAiJob(job: Pick<AiAnalysisJob, 'status'>): boolean {
  return job.status === 'complete' || job.status === 'failed';
}

export function useDetailedAnalysis() {
  const [phase, setPhase] = useState<DetailedAnalysisPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AnalysisErrorCode | null>(null);
  const [job, setJob] = useState<AiAnalysisJob | null>(null);
  const runningRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const fail = useCallback(
    (clientError: AnalysisClientError) => {
      stopPolling();
      runningRef.current = false;
      setPhase('error');
      setErrorMessage(clientError.message);
      setErrorCode(clientError.code);
    },
    [stopPolling],
  );

  const reset = useCallback(() => {
    runningRef.current = false;
    stopPolling();
    setPhase('idle');
    setErrorMessage(null);
    setErrorCode(null);
    setJob(null);
  }, [stopPolling]);

  const run = useCallback(
    async (techniqueId: string, videoUri: string, options?: { navigateOnComplete?: boolean }) => {
      if (runningRef.current) {
        return;
      }
      runningRef.current = true;
      const acknowledged = await isExternalAiAcknowledged();
      if (!acknowledged) {
        runningRef.current = false;
        setPhase('error');
        setErrorCode('privacy_not_acknowledged');
        setErrorMessage(
          'Detailed AI Analysis needs a separate acknowledgement before sending video to Google Gemini.',
        );
        return;
      }
      stopPolling();
      setPhase('processing');
      setErrorMessage(null);
      setErrorCode(null);
      setJob(null);
      startedAtRef.current = Date.now();

      try {
        const created = await createAiAnalysisJob({ slug: techniqueId, videoUri });

        const poll = async () => {
          if (!runningRef.current) {
            return;
          }
          if (Date.now() - startedAtRef.current > AI_ANALYZE_TIMEOUT_MS) {
            fail(
              new AnalysisClientError(
                'gemini_timeout',
                'Detailed AI Analysis took too long. Please try again.',
              ),
            );
            return;
          }
          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;
          try {
            const next = await fetchAiAnalysisJob(created.jobId, controller.signal);
            if (!runningRef.current) {
              return;
            }
            setJob(next);
            if (next.status === 'complete' && next.result) {
              stopPolling();
              runningRef.current = false;
              setLatestAiAssessment({
                techniqueId,
                attemptVideoUri: videoUri,
                response: next.result,
                receivedAtMs: Date.now(),
              });
              setPhase('idle');
              if (options?.navigateOnComplete !== false) {
                router.replace(aiResultsHref(techniqueId));
              }
              return;
            }
            if (next.status === 'failed') {
              fail(
                new AnalysisClientError(
                  (next.error?.code as AnalysisErrorCode | undefined) ?? 'gemini_unavailable',
                  next.error?.message ?? 'Detailed AI Analysis could not be completed.',
                ),
              );
              return;
            }
            pollTimerRef.current = setTimeout(() => {
              void poll();
            }, AI_JOB_POLL_MS);
          } catch (error) {
            const clientError =
              error instanceof AnalysisClientError ? error : toAnalysisClientError(error);
            fail(clientError);
          }
        };

        void poll();
      } catch (error) {
        const clientError =
          error instanceof AnalysisClientError ? error : toAnalysisClientError(error);
        fail(clientError);
      }
    },
    [fail, stopPolling],
  );

  return {
    phase,
    errorMessage,
    errorCode,
    job,
    run,
    reset,
  };
}
