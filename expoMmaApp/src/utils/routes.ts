import type { Href } from 'expo-router';

/** New Phase 5 routes. Casts keep `tsc` passing until Expo regenerates typed routes. */
export const privacyHref = '/privacy' as Href;
export const addTechniqueHref = '/add-technique' as Href;
export const addTechniqueDurationHref = '/add-technique/duration' as Href;
export const recordReferenceHref = '/add-technique/record' as Href;
export const reviewReferenceHref = '/add-technique/review' as Href;
export const referenceKeyframesHref = '/add-technique/keyframes' as Href;

export function comparisonUnavailableHref(techniqueId: string): Href {
  return `/comparison-unavailable/${techniqueId}` as Href;
}

export function comparisonHref(techniqueId: string): Href {
  return `/comparison/${techniqueId}` as Href;
}

export function getReadyHref(techniqueId: string): Href {
  return `/get-ready/${techniqueId}` as Href;
}

export const validationHref = '/validation' as Href;
export const validationSummaryHref = '/validation/summary' as Href;
export const validationResultHref = '/validation/result' as Href;

export function chooseAnalysisHref(techniqueId: string): Href {
  return `/choose-analysis/${techniqueId}` as Href;
}

export function aiResultsHref(techniqueId: string): Href {
  return `/ai-results/${techniqueId}` as Href;
}
