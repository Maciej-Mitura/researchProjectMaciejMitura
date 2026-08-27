import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PRIVACY_ACKNOWLEDGEMENTS,
  parseAcknowledgements,
  serializeAcknowledgements,
  withCameraAcknowledged,
  withExternalAiAcknowledged,
} from '../src/features/privacy/acknowledgements.ts';
import {
  COMPUTER_VISION_SECTION,
  DELETING_DATA_SECTION,
  DELETE_TECHNIQUE_CONFIRMATION,
  DETAILED_AI_SECTION,
  EXTERNAL_AI_DISCLOSURE_INTRO,
  EXTERNAL_AI_PROVIDER_LABEL,
  PRIVACY_SCREEN_TITLE,
  PRIVACY_SECTIONS,
  PROTOTYPE_NOTICE_SECTION,
  REFERENCE_DELETION_SENTENCE,
  RESET_ACKNOWLEDGEMENTS_NOTICE,
} from '../src/features/privacy/copy.ts';
import {
  canCreateGeminiJob,
  canRunQuickComparison,
  decideDetailedAiRequest,
  geminiSubmissionBlocked,
  nextDetailedAnalysisAction,
  shouldMountCameraPreview,
  shouldShowCameraDisclosure,
  shouldShowCompactRecordingNotice,
  shouldShowExternalAiDisclosure,
} from '../src/features/privacy/gates.ts';

const unacked = DEFAULT_PRIVACY_ACKNOWLEDGEMENTS;
const cameraAcked = withCameraAcknowledged(unacked);
const bothAcked = withExternalAiAcknowledged(cameraAcked);

describe('privacy acknowledgements', () => {
  it('requires first-recording disclosure until camera privacy is acknowledged', () => {
    assert.equal(shouldShowCameraDisclosure(unacked), true);
    assert.equal(shouldMountCameraPreview(unacked), false);
    assert.equal(shouldShowCameraDisclosure(cameraAcked), false);
    assert.equal(shouldMountCameraPreview(cameraAcked), true);
    assert.equal(shouldShowCompactRecordingNotice(cameraAcked), true);
  });

  it('skips the full camera disclosure after acknowledgement', () => {
    const roundTrip = parseAcknowledgements(serializeAcknowledgements(cameraAcked));
    assert.equal(shouldShowCameraDisclosure(roundTrip), false);
    assert.equal(roundTrip.cameraPrivacyAcknowledged, true);
  });

  it('requires a separate external-AI acknowledgement for Detailed AI', () => {
    assert.equal(shouldShowExternalAiDisclosure(cameraAcked), true);
    assert.equal(canCreateGeminiJob(cameraAcked), false);
    assert.equal(geminiSubmissionBlocked(cameraAcked), true);
    assert.equal(nextDetailedAnalysisAction(cameraAcked), 'show-disclosure');
    assert.equal(canCreateGeminiJob(bothAcked), true);
    assert.equal(nextDetailedAnalysisAction(bothAcked), 'start-gemini');
  });

  it('lets Quick Comparison run without external-AI acknowledgement', () => {
    assert.equal(canRunQuickComparison(unacked), true);
    assert.equal(canRunQuickComparison(cameraAcked), true);
    assert.equal(decideDetailedAiRequest(cameraAcked, 'quick'), 'use-quick');
    assert.equal(geminiSubmissionBlocked(cameraAcked), true);
  });

  it('does not create a Gemini job when the AI disclosure is cancelled', () => {
    let created = false;
    const decision = decideDetailedAiRequest(cameraAcked, 'quick');
    if (decision === 'start-gemini') {
      created = true;
    }
    assert.equal(decision, 'use-quick');
    assert.equal(created, false);
  });

  it('reset restores unacknowledged state without implying technique deletion', () => {
    const reset = parseAcknowledgements(null);
    assert.deepEqual(reset, unacked);
    assert.match(RESET_ACKNOWLEDGEMENTS_NOTICE, /Recorded techniques were not deleted/);
  });
});

describe('privacy copy', () => {
  it('exposes a Privacy & Data screen with the required sections', () => {
    assert.equal(PRIVACY_SCREEN_TITLE, 'Privacy & Data');
    const titles = PRIVACY_SECTIONS.map((section) => section.title);
    assert.deepEqual(titles, [
      'Camera recordings',
      'Reference technique storage',
      'Temporary practice/comparison files',
      'Computer Vision Comparison',
      'Detailed AI / Google Gemini',
      'Data deletion',
      'Prototype / research notice',
    ]);
  });

  it('matches recorded-technique deletion semantics', () => {
    assert.equal(
      REFERENCE_DELETION_SENTENCE,
      'Deleting the technique permanently removes its saved reference media and technique data.',
    );
    assert.match(DELETE_TECHNIQUE_CONFIRMATION, /reference video/i);
    assert.match(DELETE_TECHNIQUE_CONFIRMATION, /keyframes/i);
    assert.match(DELETE_TECHNIQUE_CONFIRMATION, /technique details|details/i);
    assert.match(DELETING_DATA_SECTION.body, /temporary/i);
    assert.match(DELETING_DATA_SECTION.body, /automatic cleanup/i);
    assert.doesNotMatch(DELETE_TECHNIQUE_CONFIRMATION, /GDPR compliant/i);
  });

  it('distinguishes Quick CV processing from Google Gemini', () => {
    assert.match(COMPUTER_VISION_SECTION.body, /does not send visual media to Google Gemini/i);
    assert.match(DETAILED_AI_SECTION.body, /Google Gemini/);
    assert.equal(EXTERNAL_AI_PROVIDER_LABEL, 'Google Gemini');
    assert.match(EXTERNAL_AI_DISCLOSURE_INTRO, /synchronized comparison video/);
    assert.doesNotMatch(PROTOTYPE_NOTICE_SECTION.body, /GDPR compliant/i);
    assert.match(PROTOTYPE_NOTICE_SECTION.body, /research prototype/i);
  });
});
