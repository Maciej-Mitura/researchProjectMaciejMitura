import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isBuiltinCatalogTechnique,
  techniqueSupportsAttemptAnalysis,
  techniqueSupportsGenericComparison,
  techniqueSupportsTrainingCapture,
  TECHNIQUES,
} from '../src/features/techniques/catalog.ts';

describe('technique catalog capabilities', () => {
  it('does not offer practice comparison for built-in catalog techniques', () => {
    for (const technique of TECHNIQUES) {
      assert.equal(isBuiltinCatalogTechnique(technique), true);
      assert.equal(techniqueSupportsTrainingCapture(technique), false);
      assert.equal(techniqueSupportsGenericComparison(technique), false);
    }
  });

  it('keeps the experimental Jab five-frame detector isolated', () => {
    const jab = TECHNIQUES.find((item) => item.id === 'simple_jab');
    const kick = TECHNIQUES.find((item) => item.id === 'mmakick');
    assert.ok(jab);
    assert.ok(kick);
    assert.equal(techniqueSupportsAttemptAnalysis(jab), true);
    assert.equal(techniqueSupportsAttemptAnalysis(kick), false);
  });
});
