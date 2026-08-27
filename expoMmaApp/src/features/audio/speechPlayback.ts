export type SpeechPlaybackState = {
  speaking: boolean;
  error: string | null;
};

export type SpeechPlaybackEvent =
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'unmount' };

export const INITIAL_SPEECH_PLAYBACK: SpeechPlaybackState = {
  speaking: false,
  error: null,
};

/**
 * Always stop before speaking so utterances cannot overlap.
 */
export function speechPlayPlan(): readonly ['stop', 'speak'] {
  return ['stop', 'speak'];
}

export function speechStopPlan(): readonly ['stop'] {
  return ['stop'];
}

export function reduceSpeechPlayback(
  state: SpeechPlaybackState,
  event: SpeechPlaybackEvent,
): SpeechPlaybackState {
  switch (event.type) {
    case 'play':
      return { speaking: true, error: null };
    case 'stop':
    case 'done':
      return { speaking: false, error: state.error };
    case 'error':
      return { speaking: false, error: event.message };
    case 'unmount':
      return { speaking: false, error: null };
    default:
      return state;
  }
}

export function resultsRemainUsableOnSpeechError(): boolean {
  return true;
}
