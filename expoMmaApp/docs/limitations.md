# Limitations

These are **actual known limitations** of the MMA Trainer V2 prototype. They are not a claim list for a finished product.

## Measurement

- Pose estimation is **2D**. Depth, rotation around the camera axis, and true 3D joint location are not recovered.
- Results depend on **camera perspective**, distance, height, and framing.
- **Body / landmark visibility** limits measurement. Poor coverage yields `comparisonValid=false` / `similarityValid=false`, not a fake zero.
- Quick component weights and error mappings are **heuristic**. They are not scientifically validated.
- Quick measures **similarity to the recorded reference**, not objective MMA correctness and not coaching quality.
- The current **movement-gap heuristic** can merge nearby actions and can still miss unusually fragmented motion.

## Detailed AI

- Google Gemini is **probabilistic**. Repeating the same prepared video can produce different wording and scores.
- Provider **availability, quota, and cost** can stop Detailed AI during a live demo.
- Gemini video understanding uses **temporal sampling**. Even a slowed comparison clip is not frame-accurate biomechanics.
- The backend overall 0–100 is deterministic **given** Gemini’s criterion scores. The criterion scores themselves are model outputs.

## Prototype architecture

- The app uses a **local FastAPI backend**, not a hosted multi-user service.
- AI jobs are **in-memory**. Restarting the backend drops in-flight jobs.
- There is **no user account / history system**.
- V2 is **mobile (Expo)**, not a browser V2.
- **Recorded reference quality** determines comparison authority. A poor reference produces a poor comparison target.
- Built-in catalog techniques (Jab, MMA Kick) have **no recorded human reference** and are not comparison targets.

## What this is not

- Not a replacement for an MMA coach.
- Not certified GDPR compliance. The Privacy & Data screen is GDPR-oriented transparency for a research prototype.
- Not clinical or professional biomechanics accuracy.
- Not a 3D motion-capture product. V1 3D visualization was evaluated and de-emphasized.
