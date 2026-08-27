import type { AnalysisErrorCode } from '@/features/analysis/types';

export type AnalysisErrorPresentation = {
  title: string;
  hint: string;
};

const DEFAULT_HINT = 'This is a measurement or service problem, not a technique score.';

export function analysisErrorPresentation(
  code: AnalysisErrorCode | null | undefined,
  fallbackHint?: string,
): AnalysisErrorPresentation {
  const hint = fallbackHint ?? DEFAULT_HINT;
  switch (code) {
    case 'missing_api_url':
    case 'unreachable':
      return {
        title: 'Analysis server unavailable',
        hint: 'The phone could not reach the MMA Trainer backend. Quick Comparison and Detailed AI both need that local server.',
      };
    case 'timeout':
      return {
        title: 'Analysis timed out',
        hint: 'The backend took too long to respond. Check that it is still running, then retry.',
      };
    case 'upload_failed':
    case 'http_413':
      return {
        title: 'Recording could not be uploaded',
        hint: 'Try recording again. Keep the clip short and stay on the same Wi-Fi as the computer.',
      };
    case 'analysis_rejected':
      return {
        title: 'Movement could not be measured',
        hint: 'Pose coverage or movement detection was not sufficient. This is not a low technique score.',
      };
    case 'reference_missing':
    case 'reference_incomplete':
      return {
        title: 'Reference is not ready',
        hint: 'This comparison needs a saved recorded technique. Add a technique, then try again.',
      };
    case 'comparison_video_invalid':
      return {
        title: 'Comparison video could not be prepared',
        hint: 'The complete movement could not be assembled for comparison. Retry the recording with a clearer full-body view.',
      };
    case 'gemini_not_configured':
    case 'gemini_auth':
      return {
        title: 'Google Gemini is not configured',
        hint: 'Detailed AI needs a valid backend Gemini key. Quick Comparison still works without it.',
      };
    case 'gemini_quota':
      return {
        title: 'Google Gemini usage limit',
        hint: 'Quota or billing stopped this Detailed AI request. Quick Comparison still works.',
      };
    case 'gemini_rate_limit':
    case 'gemini_unavailable':
      return {
        title: 'Google Gemini is busy',
        hint: 'Temporary high demand, retries, or backup-model exhaustion stopped Detailed AI. Quick Comparison still works.',
      };
    case 'gemini_timeout':
      return {
        title: 'Google Gemini timed out',
        hint: 'Detailed AI took too long. Quick Comparison still works.',
      };
    case 'ai_malformed':
      return {
        title: 'AI response could not be used',
        hint: 'Google Gemini returned a result that could not be validated. Please try again. Quick Comparison still works.',
      };
    case 'privacy_not_acknowledged':
      return {
        title: 'External AI acknowledgement needed',
        hint: 'Detailed AI Analysis sends the comparison video to Google Gemini only after that acknowledgement.',
      };
    case 'openai_not_configured':
    case 'openai_auth':
    case 'openai_quota':
    case 'openai_rate_limit':
    case 'openai_timeout':
    case 'openai_unavailable':
      return {
        title: 'Experimental analysis unavailable',
        hint: 'The experimental OpenAI still-image path is not a production option. Use Quick Comparison or Detailed AI Analysis.',
      };
    default:
      return {
        title: 'Attempt could not be analyzed',
        hint,
      };
  }
}
