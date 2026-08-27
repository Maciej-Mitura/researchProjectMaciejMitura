# MMA Trainer V2 — Pose Analysis Backend

Computer-vision and comparison service for **MMA Trainer V2**. It lives inside the Expo app tree:

`expoMmaApp/backend/`

The current architecture is documented in [`../docs/final-architecture.md`](../docs/final-architecture.md). Quick Comparison is deterministic MediaPipe similarity. Detailed AI Analysis is optional Google Gemini. The experimental OpenAI still-image path is legacy research code and is not a production route.

```
Expo records an attempt
        ↓
  this backend
        ↓
VIDEO → POSE LANDMARKS → CANONICAL MOVEMENT WINDOW → SYNCHRONIZED COMPARISON
        ↓
Quick: full-sequence similarity    Detailed: Gemini video + backend 0–100
```

## Architecture

| Piece | Choice | Why |
| --- | --- | --- |
| HTTP | FastAPI + Uvicorn | Small typed API, multipart uploads |
| Pose | MediaPipe Tasks Pose Landmarker, `RunningMode.VIDEO` | Same model family as V1, server-side, not live scoring |
| Decode | OpenCV | FPS / size / chronological frames |
| Signal | `distance(lead wrist, lead shoulder) / torsoLength` | Body-relative, not pixels |
| Phases | Jab-only deterministic rules | Kick needs a different signal |

Pose estimation was moved out of Expo because V2 does not need live pose scoring. The phone records; the backend analyzes after the fact.

## Python version

Use **CPython 3.11**. This repo was developed with:

`Python 3.11.5` (`py -3.11` on Windows)

On this machine the bare `python` command is Inkscape’s 3.10.5 build. That interpreter is **not** suitable (no MediaPipe wheels). Prefer:

```powershell
py -3.11 --version
```

## Setup

From `expoMmaApp/backend/`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Unix:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Do **not** also install `opencv-python` or `opencv-python-headless`. MediaPipe 1.0.1 already depends on `opencv-contrib-python`. Installing a second OpenCV package overwrites `cv2` and breaks imports.

The pose model is copied (not moved) from V1:

- source: `mma-trainer/public/models/pose_landmarker_lite.task`
- runtime: `expoMmaApp/backend/assets/models/pose_landmarker_lite.task`

The backend never reads V1 paths.

## Run FastAPI

From `expoMmaApp/`, the usual local workflow is:

```powershell
npm run dev
```

That starts Expo and this backend together. Ctrl+C stops both. The backend script calls `backend/.venv/Scripts/python.exe` directly (no `Activate.ps1`). Dockerizing this service is a possible later deployment improvement; local Expo Go/LAN development stays on concurrently so the phone can reach `0.0.0.0:8000` on the PC.

You can still run FastAPI alone. For local CLI/curl on the same computer:

```powershell
cd expoMmaApp/backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For a **physical phone** on the same Wi-Fi (Phase 4), bind all interfaces:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`127.0.0.1` is only reachable from the computer. `0.0.0.0` lets the phone use `http://<PC-LAN-IP>:8000`.

Windows: find that IP with `ipconfig` → Wireless LAN adapter Wi-Fi (or Ethernet) → **IPv4 Address**.

If the phone cannot connect, Windows Firewall may be blocking port 8000. Allow it manually in Windows Defender Firewall if needed. This repo does not change firewall settings.

Health check: `http://127.0.0.1:8000/health` or `http://<PC-LAN-IP>:8000/health`  
OpenAPI: `http://127.0.0.1:8000/docs`

The Expo app reads `EXPO_PUBLIC_API_BASE_URL` (see `expoMmaApp/.env.example`). Do not use `localhost` on the phone. Do not put `GEMINI_API_KEY` or `OPENAI_API_KEY` in the Expo env file.

## Detailed AI Analysis (Phase 7.1)

Current OpenAI GPT vision models do not accept raw MP4 video. Production Detailed AI Analysis therefore:

1. Loads the stored full REFERENCE recording (`data/reference-techniques/<slug>/reference.mp4`)
2. Saves the USER attempt under `tmp/ai-attempts/<analysisId>/attempt.mp4`
3. Detects each active-movement window with the existing generic analyzer
4. Crops those windows (small configurable padding), temporally normalizes them, and builds one synchronized side-by-side MP4
5. Slows that composite to about **8 seconds** (`AI_COMPARISON_DURATION_MS`) and requests Gemini video sampling at **8 FPS** (`GEMINI_VIDEO_FPS`, valid range (0.0, 24.0])
6. Sends **one** labeled LEFT=REFERENCE / RIGHT=USER video to Gemini, plus original REFERENCE/USER active-movement durations in the prompt
7. Validates structured criterion grades (0–4 or N/A) for six observable criteria
8. Computes the overall 0–100 score in backend code from applicable criteria only (`sum / (4 × count) × 100`)
9. Deletes the temporary USER attempt and the AI-only slow video; keeps `tmp/comparisons/<analysisId>/comparison.mp4` for Watch Comparison until the stale sweep

Quick Visual Comparison (`POST /api/reference-techniques/{slug}/analyze-attempt`) never calls Gemini or OpenAI. It returns a real-time-ish synchronized `comparison.mp4` (optional pose overlay), debug stills, and a deterministic Movement Similarity from the complete MediaPipe pose sequences.

The Phase 7 OpenAI still-image path remains in `app/ai/experimental_images.py` for research comparison. It is not the production route.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/reference-techniques/{slug}/ai-analysis` | Synchronous Detailed AI (CLI/tests) |
| POST | `/api/reference-techniques/{slug}/ai-analysis/jobs` | Start async Detailed AI job |
| GET | `/api/ai-analysis/jobs/{jobId}` | Poll job stage/progress/result |
| GET | `/api/comparisons/{analysisId}/comparison.mp4` | Synchronized Quick / Watch Comparison video |
| GET | `/api/comparisons/{analysisId}/comparison-pose.mp4` | Optional post-processed skeleton overlay |

Backend-only env (`backend/.env`, see `backend/.env.example`):

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_MODEL=gemini-3.6-flash
GEMINI_TIMEOUT_SECONDS=180
GEMINI_VIDEO_FPS=8
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_BASE_SECONDS=2
QUICK_SIMILARITY_SAMPLES=60
QUICK_SIMILARITY_WARP_FRACTION=0.08

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol
OPENAI_TIMEOUT_SECONDS=120
```

Manual one-call smoke test (not part of pytest; requires `--confirm`):

```powershell
python -m app.tools.run_ai_analysis --slug front-kick --user path\to\attempt.mp4 --confirm
```

Visual data is sent to Gemini only when the athlete chooses Detailed AI Analysis. Quick Comparison stays on the phone and local FastAPI backend.

## Analyze an attempt (HTTP)

`POST /api/analyze-attempt` — `multipart/form-data`

Fields:

- `techniqueId` — currently only `simple_jab`
- `video` — MP4 / MOV / M4V / WebM, max 50 MB

```powershell
curl -X POST `
  -F "techniqueId=simple_jab" `
  -F "video=@attempt.mp4" `
  http://127.0.0.1:8000/api/analyze-attempt
```

`mmakick` returns HTTP 422 (not implemented). Do not reuse jab arm logic for kicks.

A **successful** body looks like:

```json
{
  "analysisId": "…",
  "techniqueId": "simple_jab",
  "analysisValid": true,
  "video": { "fps": 30, "durationMs": 3000, "width": 1080, "height": 1920, "frameCount": 90 },
  "poseCoverage": 0.94,
  "phases": [
    { "phase": "START", "frameIndex": 15, "timestampMs": 500, "keyframeFilename": "start.jpg", "keyframeUrl": "/api/debug/analyses/…/keyframes/start.jpg" }
  ]
}
```

`analysisValid: false` means **measurement** failed (no pose, no recovery, …). It is not a “bad jab” score.

## Reference technique library (Phase 5)

Human-recorded references are stored under `data/reference-techniques/<slug>/`. That folder is gitignored because it may contain real people. Drafts live in `tmp/reference-drafts/<draftId>/` until confirm.

Uvicorn creates `tmp/`, `tmp/reference-drafts/`, and `data/reference-techniques/` on startup. `npm run dev` is unchanged.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/reference-techniques` | Confirmed recorded technique metadata |
| POST | `/api/reference-techniques/drafts` | `name`, optional `description`, `video` |
| POST | `/api/reference-techniques/drafts/{draftId}/confirm` | Promote a valid draft to the library |
| DELETE | `/api/reference-techniques/drafts/{draftId}` | Discard a draft |
| DELETE | `/api/reference-techniques/{slug}` | Permanently delete a recorded technique |
| GET | `/api/reference-techniques/drafts/{draftId}/video` | Draft MP4 |
| GET | `/api/reference-techniques/drafts/{draftId}/keyframes/{filename}` | Draft JPEG (`01-start.jpg` …) |
| GET | `/api/reference-techniques/{slug}/video` | Permanent MP4 |
| GET | `/api/reference-techniques/{slug}/keyframes/{filename}` | Permanent JPEG |

Keyframe extraction for new techniques uses **generic whole-body motion**, not jab wrist-to-shoulder extension. Labels are START / EARLY / MIDDLE / LATE / END. Duplicate slugs return HTTP 409. Path parameters are validated; clients never send a filesystem destination.

Detailed AI Analysis is implemented on `POST /api/reference-techniques/{slug}/ai-analysis`. The Gemini API key stays on this backend, never in Expo. Quick Comparison does not call Gemini or OpenAI.

## Inspect keyframes

Canonical files (no skeleton overlay):

`backend/tmp/<analysisId>/start.jpg`  
`extension.jpg` `peak.jpg` `retraction.jpg` `recovery.jpg`

Debug HTTP (local development only):

```
GET /api/debug/analyses/{analysisId}
GET /api/debug/analyses/{analysisId}/keyframes/start.jpg
```

Temporary upload bytes are deleted after processing. Keyframes stay under `tmp/` for visual checks.

## Local video CLI

Same production functions as the API (no duplicated detector):

```powershell
python -m app.tools.analyze_video path\to\attempt.mp4 --technique simple_jab
```

Optional `--output-dir` writes the five JPEGs to a chosen folder.

Exit code `0` if `analysisValid` is true, `1` if analysis failed, `2` for usage/input errors.

### How to test a real Expo recording

1. Record a jab on device (front camera, ~3 s).
2. Copy the MP4 off the phone (Files / Android `cache`, AirDrop, etc.).
3. Run the CLI or curl against that file.
4. Open the five JPEGs and confirm they look like guard → punch going out → full extend → coming back → guard.

Until that visual check is done, treat the detector as **unvalidated** on real video.

## Supported technique

| Id | Status |
| --- | --- |
| `simple_jab` | Implemented. Lead side **left** (orthodox), matching V1 and V2 catalogs. |
| `mmakick` | Explicitly unsupported. |

Lead-arm indices are MediaPipe `LEFT_WRIST` / `LEFT_SHOULDER` (or right if config changes). Landmarks are **not** auto-flipped. Expo preview uses a mirrored front camera; the saved file may or may not be mirrored. Distances are flip-invariant; left vs right labels are not. If inspection shows the wrong arm, add an explicit `assume_mirrored_video` flag later.

## Jab phases (deterministic)

Smoothing: **5-frame centered moving average** (~167 ms at 30 FPS). Raw and smoothed series are kept internally.

1. **Baseline** — median of the lowest 20% of smoothed extension (V1 guard proxy).
2. **PEAK** — maximum smoothed extension.
3. **START** — last pre-peak frame at or below `baseline + 0.25 * delta` (V1 window start).
4. **EXTENSION** — first frame after START and before PEAK at or above `baseline + 0.50 * delta`.
5. **RETRACTION** — first post-peak frame at or below `baseline + 0.50 * delta`.
6. **RECOVERY** — first frame after RETRACTION at or below `baseline + 0.20 * delta` (V1 recoil-style return to guard).

Order must be START < EXTENSION < PEAK < RETRACTION < RECOVERY. No fabricated frames.

Thresholds live in `app/phases/jab_config.py`.

## Tests

```powershell
python -m pytest
```

Phase logic is tested with synthetic extension sequences. There is no real jab video fixture in the repo.

## Known limitations

- No real-attempt visual validation yet.
- Front-camera mirroring vs file orientation is unresolved.
- ~3 s clips; FPS metadata sometimes missing (fallback 30).
- Fast jabs at low FPS may not yield five distinct frames.
- MediaPipe lite model; occlusions and side-on views reduce coverage.
- No reference GLB playback.
- Built-in Jab still uses the arm-extension detector and is not AI-scored unless a human reference exists.
- MMA Kick remains unsupported.
- Keyframes for jab attempts remain local temp files. Confirmed references persist under `data/reference-techniques/` (gitignored).
- USER AI-attempt media is temporary under `tmp/ai-attempts/` and is not kept. Synchronized comparison videos live under `tmp/comparisons/` until the stale sweep.

## Layout

```
backend/
  app/
    main.py
    api/           HTTP (attempts + reference library + AI analysis)
    analysis/      jab attempt pipeline
    ai/            Detailed AI Analysis (Gemini video provider; experimental OpenAI stills)
    video/         Active-window crop, temporal normalization, synchronized MP4s
    comparison/    USER ↔ REFERENCE pairing + Quick Comparison orchestration
    reference/     generic motion, drafts, filesystem store
    pose/          OpenCV + MediaPipe
    phases/        jab detector
    keyframes/
    techniques/
    models/
    tools/         CLI + optional one-call AI smoke test
  assets/models/pose_landmarker_lite.task
  data/reference-techniques/   confirmed recorded refs (gitignored)
  tests/
  tmp/             attempt keyframes, reference drafts, AI USER temp
```
