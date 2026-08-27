import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

import { AUDIO_UNAVAILABLE_MESSAGE } from '@/features/privacy/copy';
import {
  INITIAL_SPEECH_PLAYBACK,
  reduceSpeechPlayback,
  type SpeechPlaybackState,
} from '@/features/audio/speechPlayback';

export function useFeedbackSpeech() {
  const [state, setState] = useState<SpeechPlaybackState>(INITIAL_SPEECH_PLAYBACK);
  const generationRef = useRef(0);

  const stop = useCallback(async () => {
    generationRef.current += 1;
    try {
      await Speech.stop();
    } catch {
      // Device TTS may already be unavailable; keep Results usable.
    }
    setState((current) => reduceSpeechPlayback(current, { type: 'stop' }));
  }, []);

  const play = useCallback(
    async (text: string) => {
      const spoken = text.trim();
      if (spoken.length === 0) {
        setState((current) =>
          reduceSpeechPlayback(current, { type: 'error', message: AUDIO_UNAVAILABLE_MESSAGE }),
        );
        return;
      }
      generationRef.current += 1;
      const generation = generationRef.current;
      try {
        await Speech.stop();
      } catch {
        setState((current) =>
          reduceSpeechPlayback(current, { type: 'error', message: AUDIO_UNAVAILABLE_MESSAGE }),
        );
        return;
      }
      try {
        setState((current) => reduceSpeechPlayback(current, { type: 'play' }));
        Speech.speak(spoken, {
          onDone: () => {
            if (generationRef.current === generation) {
              setState((current) => reduceSpeechPlayback(current, { type: 'done' }));
            }
          },
          onStopped: () => {
            if (generationRef.current === generation) {
              setState((current) => reduceSpeechPlayback(current, { type: 'stop' }));
            }
          },
          onError: () => {
            if (generationRef.current === generation) {
              setState((current) =>
                reduceSpeechPlayback(current, {
                  type: 'error',
                  message: AUDIO_UNAVAILABLE_MESSAGE,
                }),
              );
            }
          },
        });
      } catch {
        setState((current) =>
          reduceSpeechPlayback(current, { type: 'error', message: AUDIO_UNAVAILABLE_MESSAGE }),
        );
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      void Speech.stop();
    };
  }, []);

  return {
    speaking: state.speaking,
    error: state.error,
    play,
    stop,
  };
}
