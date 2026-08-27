# Prototype validation protocol

This is a **manual technical validation** protocol for MMA Trainer V2. It is not a clinical, professional-biomechanics, or statistically powered study. Scores measure similarity to a recorded human reference, not objective MMA correctness.

Do **not** start paid Gemini calls from automation. Repeatability runs are started only from Research Validation.

## Techniques

Perform the full set below for at least:

1. one punch (for example a recorded Jab)
2. one kick (for example a recorded Front Kick or MMA Kick)
3. one multi-action combo (3–4 meaningful actions)

Each technique must already exist as a confirmed recorded reference (`reference.mp4`).

## Per technique

Researcher labels are **manual**. The app does not certify that an attempt matches the chosen scenario.

### 1. Self comparison

On **Research Validation**, select the technique and **Self comparison**.

Expected:

- Quick overall near 100
- pose / path / timing near 100
- `Deterministic repeat check: PASS`

Gemini is not called.

### 2. Clean reproduction

Record an attempt that intentionally copies the reference as closely as possible. Label **Clean reproduction**. Save notes such as `Attempt intended as clean reproduction.`

Expected:

- relatively high Quick similarity
- if Detailed AI is used later, Gemini should generally recognize strong similarity

### 3. Minor deliberate error

Introduce **one** limited visible difference (slightly shorter punch, slightly reduced kick extension, or a small timing hesitation). Label **Minor deliberate error**. Notes example: `Third punch intentionally shortened.`

Expected:

- the relevant Quick component decreases
- unrelated components remain comparatively stable

### 4. Major deliberate error

Introduce one obvious difference (clearly different trajectory, omit a strike in a combo, very different recovery, or large posture deviation). Label **Major deliberate error**.

Expected:

- stronger Quick similarity reduction
- if Detailed AI is used, Gemini should mention the visible difference

### 5. Bad camera / measurement

Partially leave the frame, occlude the body, or otherwise break pose coverage. Label **Bad camera / measurement**. Notes example: `Left foot partially outside frame.`

Expected:

- invalid measurement
- **no fake 0 similarity**
- Gemini is not given invalid evidence
- save the invalid outcome (`comparisonValid=false`, coverage, reason)

## Multi-action check

For the combo technique, confirm the canonical window still contains the first and last action and that synchronization remains valid. Label **Multi-action test** when that is the experimental question.

## Optional Gemini prototype stability check

Only for selected **valid** comparisons, from Research Validation:

- run prototype stability check **1 time** or **3 times**
- the backend must reuse the exact prepared `ai-comparison.mp4`
- record overall, six criteria, actual model, latency, and summary
- treat min / max / mean / range as a **prototype stability check**, not scientific validation

Do not re-record or re-render between those repeats.

## After the session

1. Open **Validation summary**
2. **Export validation data** (JSON and CSV)
3. Keep notes on what was intended; do not ask the model to infer experimental conditions
