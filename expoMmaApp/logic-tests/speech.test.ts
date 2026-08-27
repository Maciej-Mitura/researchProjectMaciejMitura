import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDetailedSpeechText, truncateSpokenText } from '../src/features/audio/detailedSpeech.ts';
import { buildQuickSpeechText } from '../src/features/audio/quickSpeech.ts';
import {
  INITIAL_SPEECH_PLAYBACK,
  reduceSpeechPlayback,
  resultsRemainUsableOnSpeechError,
  speechPlayPlan,
  speechStopPlan,
} from '../src/features/audio/speechPlayback.ts';
import type { MovementSimilarityResult } from '../src/features/comparison/types.ts';
import { AUDIO_UNAVAILABLE_MESSAGE } from '../src/features/privacy/copy.ts';

function validSimilarity(overrides: Partial<MovementSimilarityResult> = {}): MovementSimilarityResult {
  return {
    similarityValid: true,
    invalidReason: null,
    movementSimilarity: 86,
    components: {
      poseSimilarity: 90,
      movementPathSimilarity: 80,
      timingSimilarity: 88,
    },
    diagnostics: {
      referenceDurationMs: 1200,
      userDurationMs: 1180,
      largestDeviation: {
        bodyPart: 'right_wrist',
        progressStart: 0.2,
        progressEnd: 0.4,
      },
      upperBodySimilarity: 85,
      lowerBodySimilarity: 90,
      timeline: [80, 86, 90],
    },
    feedback: {
      strongest: 'Closest match: pose / form (92 / 100).',
      mainDifference: 'Largest difference: right wrist movement around the early part of the sequence.',
    },
    ...overrides,
  };
}

describe('quick spoken feedback', () => {
  it('builds a concise Movement Similarity summary', () => {
    const spoken = buildQuickSpeechText(validSimilarity());
    assert.equal(
      spoken,
      'Movement similarity is 86 percent. Your closest match was pose and form. The largest measured difference was right wrist movement around the early part of the sequence.',
    );
  });

  it('does not invent speech when similarity is invalid', () => {
    assert.equal(
      buildQuickSpeechText(
        validSimilarity({
          similarityValid: false,
          movementSimilarity: null,
          invalidReason: 'Insufficient pose coverage',
        }),
      ),
      null,
    );
  });
});

describe('detailed spoken feedback', () => {
  it('reads overall similarity, summary, and main correction without the full screen', () => {
    const spoken = buildDetailedSpeechText({
      analysisValid: true,
      comparisonValid: true,
      overallScore: 80,
      overallMax: 100,
      summary:
        'Your path stayed close to the reference. The kick recovered a little early. Extra criterion notes should not all be spoken because they are too long for a presentation summary.',
      mainCorrections: [
        {
          title: 'Keep the guard up through recovery',
          explanation: 'The lead hand dropped near the end of the sequence.',
          relevantCriterion: 'recoveryOrCompletion',
        },
      ],
    });
    assert.match(spoken ?? '', /Overall similarity is 80 out of 100/);
    assert.match(spoken ?? '', /Your path stayed close to the reference/);
    assert.match(spoken ?? '', /Main correction/);
    assert.match(spoken ?? '', /Keep the guard up through recovery/);
    assert.doesNotMatch(spoken ?? '', /Extra criterion notes should not all be spoken/);
  });
});

describe('speech playback', () => {
  it('stops before starting a new utterance so playback cannot overlap', () => {
    assert.deepEqual(speechPlayPlan(), ['stop', 'speak']);
    const secondPlay = reduceSpeechPlayback(
      reduceSpeechPlayback(INITIAL_SPEECH_PLAYBACK, { type: 'play' }),
      { type: 'play' },
    );
    assert.equal(secondPlay.speaking, true);
  });

  it('stops on explicit stop and on unmount', () => {
    assert.deepEqual(speechStopPlan(), ['stop']);
    const speaking = reduceSpeechPlayback(INITIAL_SPEECH_PLAYBACK, { type: 'play' });
    assert.equal(reduceSpeechPlayback(speaking, { type: 'stop' }).speaking, false);
    assert.equal(reduceSpeechPlayback(speaking, { type: 'unmount' }).speaking, false);
  });

  it('keeps Results usable when TTS fails', () => {
    const failed = reduceSpeechPlayback(INITIAL_SPEECH_PLAYBACK, {
      type: 'error',
      message: AUDIO_UNAVAILABLE_MESSAGE,
    });
    assert.equal(failed.speaking, false);
    assert.equal(failed.error, AUDIO_UNAVAILABLE_MESSAGE);
    assert.equal(resultsRemainUsableOnSpeechError(), true);
    assert.ok(truncateSpokenText('ok').length > 0);
  });
});
