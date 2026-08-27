/**
 * Privacy and data-processing copy.
 * This is GDPR-oriented transparency for a research prototype, not a legal
 * compliance certification.
 */

export const CAMERA_DISCLOSURE_TITLE = 'Camera & movement data';

export const CAMERA_DISCLOSURE_INTRO =
  'This app records video of people so it can compare movement with a technique reference. Please read how that recording is used before you continue.';

export const CAMERA_DISCLOSURE_POINTS = [
  'The app records video of your movement.',
  'The recording is sent to the configured MMA Trainer FastAPI backend.',
  'MediaPipe pose estimation is used to analyse movement.',
  'Pose landmarks and derived motion information may be generated.',
  'Quick Comparison (Computer Vision Comparison) does not require external generative AI.',
  'Recorded reference techniques are stored until you delete them.',
  'Normal practice attempts and generated temporary comparison assets are temporary. The backend cleans leftover files automatically; that cleanup is periodic rather than instant.',
] as const;

export const REFERENCE_STORAGE_TITLE = 'Recorded reference techniques';

export const REFERENCE_STORAGE_POINTS = [
  'Saving a recorded reference stores the reference video, stills, and technique details on the MMA Trainer backend.',
  'That reference stays until you delete the technique.',
] as const;

export const REFERENCE_DELETION_SENTENCE =
  'Deleting the technique permanently removes its saved reference media and technique data.';

export const REFERENCE_DELETION_DETAIL =
  'Delete Technique removes the saved technique, including its details, the reference video, extracted keyframes, and other technique-owned files. Unrelated temporary practice or comparison files are not deleted at the same moment and may remain until automatic cleanup.';

export const PRACTICE_STORAGE_TITLE = 'Practice attempts';

export const PRACTICE_STORAGE_POINTS = [
  'The attempt is processed for comparison.',
  'Temporary processing assets may be created on the MMA Trainer backend.',
  'Temporary attempts and comparison files are cleaned automatically. Cleanup is periodic, not a guaranteed instant deletion.',
  'Quick Comparison stays within the MMA Trainer client and backend flow.',
  'Detailed AI Analysis is optional and has a separate disclosure before any Google Gemini request.',
] as const;

export const PRACTICE_COMPACT_NOTICE =
  'Practice recordings are processed for comparison. Temporary files are cleaned automatically. Quick Comparison stays on the MMA Trainer backend. Detailed AI is optional and asks before sending video to Google Gemini.';

export const REFERENCE_COMPACT_NOTICE =
  'This recording is stored as the technique reference until you delete the technique.';

export const EXTERNAL_AI_DISCLOSURE_TITLE = 'Detailed AI Analysis';

export const EXTERNAL_AI_DISCLOSURE_INTRO =
  'Detailed AI Analysis sends the synchronized comparison video containing your recorded movement to Google Gemini for processing.';

export const EXTERNAL_AI_DISCLOSURE_POINTS = [
  'The purpose is to generate detailed movement-comparison feedback against your recorded human reference.',
  'Quick Comparison does not require this external AI processing.',
  'You may choose Quick Comparison instead.',
  'The Gemini provider or model may change through configured fallback.',
  'Google Gemini is not an expert MMA coach. Similarity to a recorded reference is not a correctness score.',
] as const;

export const EXTERNAL_AI_PROVIDER_LABEL = 'Google Gemini';

export const PRIVACY_SCREEN_TITLE = 'Privacy & Data';

export const CAMERA_RECORDINGS_SECTION = {
  title: 'Camera recordings',
  body: 'The app records video of your movement so it can compare that recording with a technique reference. Recordings are sent to the configured MMA Trainer FastAPI backend for pose analysis.',
} as const;

export const REFERENCE_TECHNIQUES_SECTION = {
  title: 'Reference technique storage',
  body: 'When you save a recorded reference technique, MMA Trainer stores it on the backend: the reference video, extracted stills, and technique details. Built-in Jab and MMA Kick are catalog entries, not user recordings, and they are not used as comparison references.',
} as const;

export const PRACTICE_ATTEMPTS_SECTION = {
  title: 'Temporary practice/comparison files',
  body: 'Practice recordings are processed for comparison. Temporary processing assets may be created. Those temporary attempts and comparison files are cleaned automatically. Cleanup is periodic rather than instant, so leftover files may remain for a short time after you leave Results.',
} as const;

export const COMPUTER_VISION_SECTION = {
  title: 'Computer Vision Comparison',
  body: 'Quick Comparison uses MediaPipe-based pose estimation on the MMA Trainer backend. It produces a Movement Similarity measurement and a synchronized comparison video. This path is deterministic computer vision. It does not send visual media to Google Gemini.',
} as const;

export const DETAILED_AI_SECTION = {
  title: 'Detailed AI / Google Gemini',
  body: 'Detailed AI Analysis sends the synchronized comparison video containing your recorded movement to Google Gemini. The model or fallback model is configured on the backend. Visual data leaves the local MMA Trainer environment only after you continue from the Detailed AI disclosure. This is AI-assisted comparison to a recorded human reference, not expert coaching.',
} as const;

export const DELETING_DATA_SECTION = {
  title: 'Data deletion',
  body: `${REFERENCE_DELETION_SENTENCE} ${REFERENCE_DELETION_DETAIL}`,
} as const;

export const PROTOTYPE_NOTICE_SECTION = {
  title: 'Prototype / research notice',
  body: 'This is a research prototype. The information here is GDPR-oriented privacy and data-processing transparency. It is not a certified GDPR compliance statement, and it is not legal advice.',
} as const;

export const HOW_ANALYSIS_WORKS_SECTION = {
  title: 'How analysis works',
  body: 'Record movement, then the MMA Trainer backend runs pose analysis. Quick Comparison is a deterministic Computer Vision Comparison. Optionally, the synchronized comparison video can be sent to Google Gemini for Detailed AI feedback. Audio feedback, when available, is generated on this device from text already shown on screen.',
} as const;

export const PRIVACY_SECTIONS = [
  CAMERA_RECORDINGS_SECTION,
  REFERENCE_TECHNIQUES_SECTION,
  PRACTICE_ATTEMPTS_SECTION,
  COMPUTER_VISION_SECTION,
  DETAILED_AI_SECTION,
  DELETING_DATA_SECTION,
  PROTOTYPE_NOTICE_SECTION,
] as const;

export const CANCEL_CAMERA_LABEL = 'Cancel';
export const CONTINUE_CAMERA_LABEL = 'I understand — continue';
export const USE_QUICK_INSTEAD_LABEL = 'Use Quick Comparison instead';
export const CONTINUE_AI_LABEL = 'Continue with AI Analysis';
export const RESET_ACKNOWLEDGEMENTS_LABEL = 'Reset privacy acknowledgements';
export const RESET_ACKNOWLEDGEMENTS_NOTICE =
  'Privacy acknowledgements were reset. Full disclosures will appear again before recording or Detailed AI Analysis. Recorded techniques were not deleted.';
export const REVIEW_PRIVACY_LABEL = 'Review privacy information';
export const PRIVACY_SCREEN_LINK_LABEL = 'Privacy & Data';
export const PLAY_FEEDBACK_LABEL = 'Play feedback';
export const STOP_FEEDBACK_LABEL = 'Stop';
export const REPLAY_FEEDBACK_LABEL = 'Replay';
export const AUDIO_UNAVAILABLE_MESSAGE = 'Audio feedback is unavailable on this device.';
export const DELETE_TECHNIQUE_CONFIRMATION = `${REFERENCE_DELETION_SENTENCE} ${REFERENCE_DELETION_DETAIL}`;
