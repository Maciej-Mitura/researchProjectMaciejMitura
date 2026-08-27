# Research Architecture Evolution

This section records **prototype / research design decisions** for MMA Trainer. It does not claim a universal architecture for sports coaching software.

The original research explored integration of:

- 3D visualization;
- audio feedback;
- camera input;
- motion capture;
- browser-based interaction.

V2 keeps those research questions visible, but the **authoritative comparison representation** and the **interaction platform** changed after evaluating V1.

## V1 (read-only baseline)

`mma-trainer/` remains the V1 baseline. It was not modified for V2.

V1 was a **browser / Next.js** application. It combined:

- Babylon.js / Mixamo GLB technique animations;
- camera input in the browser;
- MediaPipe pose estimation in the client;
- an experimental deterministic scorer;
- audio assets that were **not meaningfully integrated** into the training loop.

The 3D animation could demonstrate a technique visually. It could not stand in for an expert-performed human movement. Browser camera capture was possible, but a laptop-plus-webcam workflow is awkward for full-body striking practice.

## V2 (current prototype)

`expoMmaApp/` is V2. It is **not** browser-based.

V2 uses:

- Expo / React Native mobile interaction;
- phone camera recording;
- MediaPipe full-sequence pose analysis on a local FastAPI backend;
- a **recorded human reference video** as the comparison authority;
- deterministic continuous movement comparison (Computer Vision Comparison);
- optional Google Gemini video-assisted detailed comparison;
- on-device text-to-speech audio feedback;
- privacy / data transparency;
- research validation tooling.

## Why recorded human video is the comparison authority

Recorded human video became the authoritative comparison representation because it can represent an **expert-performed technique directly**. A generic Mixamo / Babylon animation is a useful demonstration asset. It is not treated as sport-technically authoritative.

Therefore **3D is not the authoritative comparison representation in V2**. Existing GLB files remain as legacy V1 assets. A new 3D scoring path was not added.

## Why mobile rather than a browser V2

Mobile was selected because camera-based physical practice is more practical on a phone than a browser/laptop workflow. The athlete can set the phone down, step back until the full body is visible, and record.

This is a prototype scope decision, not a claim that browser-based motion analysis is impossible.

## Audio

V1 had audio files but did not integrate spoken feedback into the results loop. V2 uses device text-to-speech:

- Computer Vision Comparison reads deterministic measured feedback;
- Detailed AI Analysis reads a concise Gemini-assisted summary.

Audio is supplementary. Results remain usable if speech is unavailable.

## What V2 intentionally does not claim

- V2 is not a replacement for an MMA coach.
- Similarity is not objective correctness.
- Gemini output is probabilistic assistance, not expert judgement.
- The prototype runs against a local backend. It is not a multi-user cloud product.
