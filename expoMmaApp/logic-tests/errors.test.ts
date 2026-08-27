import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analysisErrorPresentation } from '../src/features/analysis/errorPresentation.ts';

describe('analysis error presentation', () => {
  it('distinguishes Gemini configuration, quota, demand, and malformed responses', () => {
    assert.match(analysisErrorPresentation('gemini_auth').title, /not configured/i);
    assert.match(analysisErrorPresentation('gemini_quota').title, /usage limit/i);
    assert.match(analysisErrorPresentation('gemini_unavailable').title, /busy/i);
    assert.match(analysisErrorPresentation('ai_malformed').title, /could not be used/i);
    assert.match(analysisErrorPresentation('comparison_video_invalid').title, /comparison video/i);
    assert.match(analysisErrorPresentation('unreachable').title, /unavailable/i);
  });

  it('does not treat measurement failure as a technique score', () => {
    assert.match(analysisErrorPresentation('analysis_rejected').hint, /not a low technique score/i);
  });
});
