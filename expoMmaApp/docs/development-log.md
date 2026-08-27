# MMA Trainer V2 Development Log

## Phase 0 — Analysis

A V1 inspection was performed against `mma-trainer/` as a read-only baseline. V1 is a Next.js 16 web application. Its runtime depends on browser-specific APIs and packages: DOM rendering, `localStorage`, web asset URLs, ShadCN/Radix, Vaul, Howler, Recharts, Babylon.js, MediaPipe, and TensorFlow.js.

V1 technique metadata in `mma-trainer/src/app/lib/techniques.ts` is useful (Jab and MMA Kick, names, descriptions, categories, lead side). Scoring, DTW, penalty constants, AI feedback prompts, and the large live-demo route were treated as unreliable or web-specific and will not be migrated.

The decision for V2 is a rebuild in Expo / React Native rather than a port of the V1 web stack. `mma-trainer/` remains intact as the baseline and reference. It was not modified during this phase.

V1 assets were checked on disk (not moved):

- `public/animations/techniques/simple_jab.glb` — exists
- `public/animations/techniques/mmakick.glb` — exists
- `public/models/pose_landmarker_lite.task` — exists
- `public/audio/321_countdown_beep.mp3` — exists
- `public/audio/jab_stretch_sound.mp3` — exists
- `public/audio/kick_whoosh_sound.mp3` — exists

## Phase 1 — Expo Foundation

`expoMmaApp/` was empty. The app was initialized in that folder with:

`npx create-expo-app@latest . --template default@sdk-57`

Nested git initialization was skipped because this already lives in the parent repository.

### Versions

- Expo SDK 57 (`expo@57.0.16`)
- React Native `0.86.2`
- React `19.2.3`
- Expo Router `57.0.16`
- TypeScript `6.0.3`
- ESLint `9.39.5` with `eslint-config-expo@57.0.1`

### Routing

Expo Router file-based routing with a root stack. `techniqueId` is a path param on technique, get-ready, training, and results screens.

Flow:

Home → Technique Selection → Technique Detail → Get Ready → Training → Results

Routes:

- `/`
- `/techniques`
- `/technique/[techniqueId]`
- `/get-ready/[techniqueId]`
- `/training/[techniqueId]`
- `/results/[techniqueId]`

Route files in `src/app/` are thin. Screen logic lives in `src/features/`.

### Folder architecture

```
src/
  app/                 # Expo Router routes
  components/          # native UI primitives
  features/
    home/
    techniques/
    training/
    results/
    reference/         # Phase 2 placeholder
    camera/            # Phase 3 placeholder
  hooks/
  theme/
  types/
  utils/
```

Empty feature folders were not created for pose, keyframes, AI analysis, audio, or storage.

### Domain types

- `Technique` with id, name, category, description, leadSide, referenceAsset, movementPhases, rubricId
- Catalog: `simple_jab` and `mmakick`
- `TrainingPhase`, `MovementPhase`, `PhaseKeyframe`, `TrainingSession`
- `TechniqueAssessment` / `AssessmentCriterion` as a future scoring contract
- Mock result data only (overall 82, 3–4 / 4 criteria, strength and main correction copy)

Reference assets are recorded as V1 filenames (`simple_jab.glb`, `mmakick.glb`). Web URLs were not copied. Binary files were not copied.

### Screens

- Home: short product intro and Start Training
- Technique Selection: Jab and MMA Kick
- Technique Detail: description, reference placeholder, Start Practice
- Get Ready: positioning guidance, camera placeholder, Continue
- Training: reference panel, user panel, countdown, mock complete action
- Results: mock structured scores, Try Again, Back to Techniques

### UI architecture

A small native design system using React Native primitives (no ShadCN/Radix):

- centralized colors, spacing, radii, typography
- `Screen`, `Button`, `Card`, `AppText`, `Stat`
- dark/light palettes via `userInterfaceStyle: "automatic"`

The layout is a training product flow, not the V1 research dashboard.

### Deliberately not implemented

- pose detection, MoveNet, MediaPipe
- AI API calls
- scoring / DTW / MAE
- keyframe extraction
- Babylon.js / GLB rendering
- real camera permissions and capture
- copying V1 binary assets into V2

### Technical issues and solutions

1. **Template demo code and unused packages**  
   The SDK 57 default template included tabs, demo screens, `@expo/ui`, `expo-glass-effect`, `expo-symbols`, `expo-image`, `expo-device`, `expo-font`, and `expo-web-browser`. Those were removed after the MMA flow replaced the template UI so the foundation would not carry dead dependencies.

2. **React Compiler experiment**  
   The default template enabled `experiments.reactCompiler`. It was turned off for Phase 1 in favor of the stable Expo Router + TypeScript setup. `experiments.typedRoutes` was kept.

3. **ESLint `react-hooks/set-state-in-effect`**  
   `eslint-config-expo` flagged synchronous `setState` inside `useEffect` in the mock countdown and in the template web color-scheme hook. The countdown now advances inside a `setTimeout` callback. The web color-scheme hook was rewritten with `useSyncExternalStore`.

4. **ESLint install location**  
   `npx expo install eslint eslint-config-expo` placed `eslint-config-expo` in `dependencies`. It was moved to `devDependencies`.

5. **Expo Doctor**  
   `npx expo-doctor` reported 21/21 checks passed.

6. **TypeScript and lint**  
   `npx tsc --noEmit` and `npx expo lint` both passed after the effect/hook fixes. Strict mode is on. No `any` was used.

7. **Web smoke check**  
   `npx expo start --web` bundled successfully. HTTP 200 responses were returned for `/`, `/techniques`, `/technique/simple_jab`, `/get-ready/simple_jab`, `/training/mmakick`, and `/results/mmakick`. Interactive click-through in a device/simulator was not performed in this phase (no browser automation tools were available).

8. **npm audit**  
   11 moderate findings remain in Expo’s own tree (`uuid` via `@expo/config-plugins` / `xcode`). `npm audit fix --force` would install an unrelated old Expo version and was not applied.

9. **eslint@9.39.5 deprecation warning**  
   npm reports ESLint 9.39.5 as deprecated. It is the version installed with Expo SDK 57’s `eslint-config-expo`. It was not upgraded independently.

10. **Unused template assets**  
    After replacing the demo tabs UI, unused Expo starter images (tab icons, React logos, tutorial/badge art) were deleted. App icon, splash, favicon, and Android adaptive icons were kept.

## Phase 2 — Camera & Attempt Recording

Media recording was implemented before pose/AI because later computer-vision and scoring layers need a reliable short video as their source. V1 stored pose landmarks first; V2 treats the recorded attempt video as the canonical input.

Phase 1 did not request camera permission. That was expected: the Training screen still used a mock camera placeholder.

### Packages

Installed with `npx expo install`:

- `expo-camera@57.0.4`
- `expo-video@57.0.2`

No TensorFlow, MediaPipe, Babylon, audio, or storage packages were added.

### Camera implementation

`TrainingCamera` is a reusable front-facing `CameraView` (`mode="video"`, `mute`, `mirror`). Recording is exposed through a ref (`startMutedRecording`, `stopRecording`) so session orchestration stays in `useTrainingSession`.

Only the Training screen mounts a live camera. Get Ready still uses a positioning illustration. The camera unmounts in the review state and `stopRecording` runs if the user leaves the screen.

### Permission strategy

Permission is requested on the Training screen only after the user taps **Allow Camera**. States handled: loading, undetermined, denied, granted, blocked (open Settings).

Microphone permission is not requested. `app.json` sets `microphonePermission: false` and `recordAudioAndroid: false`. Audio is unnecessary for visual technique analysis and would add extra permission and data.

The user-facing camera copy is: “MMA Trainer uses the camera to record your technique for analysis.” V1’s “nothing leaves the device” claim was not reused.

### Front camera and duration

Front-facing camera is used so the user can see themselves while striking. Recording is muted, approximately 3 seconds (`maxDuration: 3`), with a slightly later `stopRecording` fallback.

### Training state machine

`idle → countdown → recording → review`

`processing` and `results` remain as future states. Countdown is 3 → 2 → 1 → GO, then recording starts once. Duplicate `recordAsync` calls are locked out.

### `videoUri` representation

`AttemptData` stores:

- `videoUri` (temporary local cache URI)
- `durationMs`
- `recordedAtMs`
- nullable `phaseTimestamps` / `keyframes` for later phases

Accepting an attempt keeps it in an in-memory `acceptedAttempt` module. Permanent history is not built. Retry drops the URI from session state and returns to idle; files are not aggressively deleted.

### Review / playback

After recording, `expo-video` (`VideoView` + `useVideoPlayer`) plays the clip with native controls. Retry records a new attempt. **Use This Attempt** currently continues to the mock Results screen. That mock jump is isolated and must later become pose → keyframes → AI → real assessment.

### Real-device UI overflow

Phase 1 testing showed Reference/You media placeholders overflowing their parent cards. Cause: `flex: 1` cards plus inner `minHeight: 220`.

Fix: cards wrap content; media uses width + `aspectRatio` + `overflow: 'hidden'`. Reference is 16:9 (compact). User/camera is 3:4 (larger). The Training screen scrolls on short phones instead of clipping children.

### Typography

Phase 1 type felt prototype-like on device. Typography now uses native/system sans-serif (Android `sans-serif`, iOS system font — `fontFamily: 'System'` was avoided because it can fall back to a serif face). Hierarchy is size/weight/spacing, not a custom font package.

### GLB asset migration

Copied, not moved:

- `mma-trainer/public/animations/techniques/simple_jab.glb` → `expoMmaApp/assets/animations/techniques/simple_jab.glb` (1,856,240 bytes)
- `mma-trainer/public/animations/techniques/mmakick.glb` → `expoMmaApp/assets/animations/techniques/mmakick.glb` (1,890,204 bytes)

V1 originals remain. Technique metadata now stores `filename` + `v2RelativePath`. GLBs are not rendered; Metro was not changed for 3D.

Audio and MediaPipe `.task` files were not copied.

### Technical issues

1. **Store Expo Go vs SDK 57** (found after Phase 1): App Store / Play Store Expo Go is still SDK 54. Phase 2 camera APIs need an SDK 57 Expo Go (from expo.dev/go) or a development build. The config plugin audio flags apply fully to custom native builds.
2. **`StyleSheet.absoluteFillObject`**: React Native 0.86 TypeScript types expose `absoluteFill` only. Fill styles were written explicitly.
3. **Web**: `recordAsync` is Android/iOS only. Web compiles and shows a fallback; it does not record.

### Current limitations

- No pose detection, keyframes, AI, or scoring
- Results after accept are still mock
- GLBs are stored, not played
- No countdown/technique audio
- No permanent attempt history
- Interactive real-device camera testing was not performed in this agent session

### Project decisions recorded

- V1 remains the intact baseline; V2 owns independent asset copies
- Recorded video is the canonical attempt, unlike V1 landmark-first storage
- One attempt at a time; no three-attempt averaging yet
- No recorded audio
- Camera/playback validated before pose/AI
- Mobile layout was corrected from real-device overflow before adding more complexity

## Phase 3 — Backend Pose Analysis & Keyframe Extraction

Pose estimation was moved out of Expo on purpose. V2 does not need live pose scoring. The phone records a ~3-second muted clip; a Python backend analyzes the file after recording. That keeps MediaPipe, OpenCV, and model files off the React Native client and matches the intended later pipeline: upload → pose → phases → user keyframes → (later) reference pairing → multimodal AI → Results.

Expo camera/review/mock Results were not changed. The backend is proven independently.

### Stack

- FastAPI 0.141.1 + Uvicorn 0.52.4: small typed HTTP API with multipart uploads.
- MediaPipe Tasks Pose Landmarker 1.0.1, `RunningMode.VIDEO`, `num_poses=1`: same model family V1 used in the browser, run on decoded frames with monotonically increasing `timestampMs`.
- OpenCV 5.0.0 (`opencv-contrib-python`, required by MediaPipe 1.0.1): FPS, size, chronological BGR frames. Original pixels are not resized. Keyframes are JPEG exports of those source frames, without skeleton overlay.
- NumPy 2.4.6, python-multipart 0.0.32, Pydantic 2.13.4.
- Python: CPython **3.11.5** via `py -3.11`. The `python` on PATH here is Inkscape 3.10.5 and cannot install MediaPipe wheels.

Installing `opencv-python-headless` alongside `opencv-contrib-python` broke `cv2` (empty namespace package). Headless was removed. Do not install two OpenCV distributions in this venv.

No TensorFlow, MoveNet, PyTorch, AI SDKs, databases, or FFmpeg wrappers.

### Model copy

Copied, not moved (SHA-256 match, 5,777,746 bytes):

- `mma-trainer/public/models/pose_landmarker_lite.task`
- → `expoMmaApp/backend/assets/models/pose_landmarker_lite.task`

Runtime uses only the V2 path.

### Jab-only scope

Automated phases are implemented only for `simple_jab`. Lead side is **left**, from V1 `techniques.ts` and V2 `catalog.ts`. `mmakick` returns HTTP 422: kick needs a different signal and must not reuse jab arm extension.

### Movement signal

`extension(t) = distance(lead_wrist, lead_shoulder) / torso_length`

Torso length is 3D distance between shoulder-center and hip-center, with a 10-sample running median (V1 stability idea). Coordinates are MediaPipe image-normalized landmarks, so the ratio is body-relative, not pixel-size-dependent. Landmark indices use `PoseLandmarkIndex` (no scattered magic numbers). Landmarks are **not** auto-mirrored: distances are flip-invariant, left/right labels are not. Expo preview uses a mirrored front camera; file orientation is unknown until a real recording is inspected.

V1 also translated/rotated into a hip-centered frame before measuring extension. That rigid transform does not change the wrist–shoulder / torso ratio, so Phase 3 uses the documented formula on raw landmarks.

Not ported: DTW, score weights, penalties, `scoreSingleAttempt`, 0–100 scores, ComparisonResult.

### Smoothing

Centered **5-frame moving average** (~167 ms at 30 FPS). A jab extension lasts a few hundred milliseconds, so this reduces MediaPipe jitter without flattening the peak. Raw and smoothed series are both retained. No Kalman filter.

### Phase definitions

Thresholds are centralized in `app/phases/jab_config.py`.

| Phase | Rule |
| --- | --- |
| Baseline | Median of the lowest 20% of smoothed extension (V1 guard proxy). |
| PEAK | Max smoothed extension. `delta = peak - baseline`. Minimum delta 0.20 (V1 `EXT_MIN_DELTA`) is a **measurement** gate, not a jab score. |
| START | Last pre-peak frame ≤ `baseline + 0.25 * delta` (V1 window start). No fallback to frame 0. |
| EXTENSION | First frame after START and before PEAK ≥ `baseline + 0.50 * delta`. |
| RETRACTION | First post-peak frame ≤ `baseline + 0.50 * delta`. |
| RECOVERY | First frame after RETRACTION ≤ `baseline + 0.20 * delta`. V1 window *end* used 0.35; V1 recoil used 0.20 of excursion. Recovery means “back toward guard,” so 0.20 was used. |

START < EXTENSION < PEAK < RETRACTION < RECOVERY by timestamp and frame index, or the analysis fails without fabricating frames.

### Quality vs technique score

`analysisValid` only answers “can this video be measured?” Coverage, key upper-body visibility, meaningful extension delta, recovery, phase order, decode, duration. A failed pose read is not reported as a bad jab.

### API / CLI / keyframes

`POST /api/analyze-attempt` with `techniqueId` + `video`. Upload saved to a temp file, deleted after analysis. Keyframes remain in `backend/tmp/<analysisId>/` as `start.jpg` … `recovery.jpg` (no overlay). Debug GET routes serve those JPEGs. CLI `python -m app.tools.analyze_video` calls the same `analyze_attempt` function.

### Why AI was postponed

Keyframe selection has to be visually right on real Expo clips before any model sees the images. No Gemini/OpenAI packages, prompts, rubrics, or Results wiring.

### Tests

`python -m pytest`: 20 passed.

- Synthetic valid jab, flat (no movement), no recovery, noisy jab, short sequence, missing START (no frame-0 fabrication).
- Smoothing, extension formula, FPS fallback.
- API: health, `mmakick` 422, empty file, bad extension, garbage bytes → `invalid_video`.
- Generated blank MP4 through the real MediaPipe pipeline → not a valid jab.

No real jab recording exists in `expoMmaApp`. Accuracy on device video is **not** claimed.

### Technical issues

1. Default `python` was Inkscape 3.10.5. Switched to CPython 3.11.5 (`py -3.11`).
2. Dual OpenCV installs destroyed `cv2`. One package only: `opencv-contrib-python`.
3. OpenCV FPS of 0/NaN is documented as 30 FPS fallback.
4. Starlette TestClient warned that `httpx` is deprecated toward `httpx2`. Ignored; no extra test stack.

### Limitations

- Unvalidated on real Expo jabs.
- Mirroring / lead-arm assignment needs a visual check.
- Fast motion + low FPS may not yield five distinct frames.
- Lite model; occlusion and cropped views reduce coverage.
- Local temp keyframes only.
- Kick, GLB reference, AI, Expo upload, and real Results are out of scope.

### Architectural decisions recorded

- **Pose is server-side.** V2 does not require real-time pose scoring.
- **MediaPipe, not MoveNet.** Reuse the V1 Pose Landmarker family on the server instead of TensorFlow in Expo.
- **Pose does not score technique.** It only finds movement moments.
- **Jab first.** Kick must not reuse jab arm logic.
- **Keyframes before AI.** Visual validation of selected frames comes first.

`mma-trainer/` was not modified in this phase.

## Phase 4 — Mobile/Backend Integration & Real Keyframe Validation

Expo was connected to the Phase 3 FastAPI backend **before AI** so real user keyframes can be inspected. If the five frames are wrong, sending them to a multimodal model would only automate a bad crop.

### Why this order

The phone is a capture client. Heavy pose processing stays on the computer. The research question for this phase is only: does the existing jab detector pick sensible frames from an Expo-recorded MP4?

### Environment-variable API configuration

The app reads `EXPO_PUBLIC_API_BASE_URL`. It never assumes `localhost` (that is the phone on a physical device). `.env.example` documents `http://YOUR_COMPUTER_LAN_IP:8000`. `.env` is gitignored so a machine IP is not committed. Expo must be restarted after changing the public env var.

### Physical-device LAN architecture

Uvicorn should bind `0.0.0.0:8000`. The phone uses `http://<PC-IPv4>:8000`. Windows: `ipconfig` → IPv4 Address. Windows Firewall can block inbound 8000; this repo does not change firewall rules. iOS `NSAllowsLocalNetworking` is set for local HTTP. Android `usesCleartextTraffic` is not a valid Expo `app.json` field (expo-doctor rejected it); Expo Go already allows LAN HTTP. A future custom native build may need `expo-build-properties` if cleartext is blocked.

Native React Native `fetch` is not browser-CORS. Development CORS (`allow_origins=["*"]`, no credentials) was still added so Expo web / curl-from-browser debugging works. That is not a production policy.

### Video multipart upload

`src/features/analysis/api/analyzeAttempt.ts` builds `FormData` with `techniqueId` and `video` (`uri`, `name: attempt.mp4`, `type: video/mp4`). The local file URI is sent; no Base64. Timeout is 45 seconds via `AbortController`.

### Session / UI

Training phases: `idle → countdown → recording → review → processing → keyframe_review | error`.

Use This Attempt on Jab uploads and shows **Analyzing your movement…** (spinner + static step labels, not fake percentages). Success `router.replace`s to `/analysis/[techniqueId]`. Invalid analysis still goes there and shows the backend failure message — not mock Results. Network failures stay on Training as `error` with Retry and optional **Check Analysis Server** (`GET /health`).

MMA Kick does not upload. It shows: “Automatic analysis for MMA Kick is not implemented yet.”

Retry clears `latestAnalysis` and records a new attempt / new `analysisId`. **Keyframes Look Correct** is a temporary research control that opens the existing mock Results screen.

Keyframe URLs from the backend are relative (`/api/debug/analyses/...`). The client prefixes `EXPO_PUBLIC_API_BASE_URL`.

### Limitations

Keyframe accuracy on real jabs is **not** claimed until those images are inspected on a device. Lead-arm vs mirrored front camera is still an open observation. Kick, GLB, AI, and real scores are still out of scope.

### Architectural decisions recorded

- **The phone is a capture client.** Expo owns camera UX; pose stays server-side.
- **Real media before AI.** No multimodal calls until keyframes look right.
- **Backend address is environment-configured.** No localhost default on device.
- **Invalid measurement is not bad technique.** Failures ask for retry, not a low score.
- **Kick remains unsupported.** Jab arm logic is not reused.

`mma-trainer/` was not modified in this phase.

## Phase 4.1 — Real-device upload hotfix

Two issues showed up during real-device Phase 4 testing. The FastAPI `/health` endpoint was reachable from the PC and from the physical phone using the PC LAN IP, so this was not primarily a LAN/backend connectivity problem.

### Video upload

`POST /api/analyze-attempt` failed before a real HTTP upload with `Unsupported FormDataPart implementation`. The client was appending a React Native `{ uri, name, type }` object to `FormData` and sending it with global `fetch`. That part type is not a supported Expo File / Blob, so multipart construction failed on device.

Upload now uses:

- `File` from `expo-file-system@57.0.5`
- `fetch` from `expo/fetch`
- standard `FormData`

The recorded local URI is turned into `new File(videoUri)`. Existence is checked with `videoFile.exists` before upload. A native filename is passed through when present. The video is not Base64-encoded. The 45-second `AbortController` timeout, API base URL logic, response parsing, and backend DTO types are unchanged.

### Error classification

The FormDataPart failure was previously mapped to `unreachable` (“Could not reach the analysis server”). Unknown client errors now default to `upload_failed`, not connectivity. Categories used by the client:

- `unreachable` — genuine network failure (`SERVER_UNREACHABLE`)
- `upload_failed` — local file missing or multipart/upload construction failed (`UPLOAD_FAILED`)
- `timeout` — AbortController timeout (`REQUEST_TIMEOUT`)
- `analysis_rejected` — HTTP 200 with `analysisValid=false` (`ANALYSIS_REJECTED`); still opens keyframe review with the backend failure message
- `http_500` — backend 5xx (`SERVER_ERROR`)

Stack traces are not shown on the Training error UI. **Check Analysis Server** is shown only for `unreachable` and `missing_api_url`.

### One-command local development

`concurrently@10.0.5` was added as a development dependency. From `expoMmaApp/`:

- `npm run dev:app` — Expo/Metro
- `npm run dev:backend` — `cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` (Windows `cmd` requires backslashes; `.venv/Scripts/...` is parsed as a switch)
- `npm run dev` — both in one terminal; Ctrl+C stops both

Dockerizing FastAPI was deliberately postponed. Concurrently keeps Expo Go / LAN development simple.

A follow-up device run showed `java.net.MalformedURLException: no protocol` when `.env` had `EXPO_PUBLIC_API_BASE_URL=10.102.84.145:8000` without `http://`. `getApiBaseUrl()` now prefixes `http://` when the scheme is missing. Expo must still be restarted after `.env` changes.

`mma-trainer/` was not modified in this hotfix.

## Phase 5 — Dynamic Reference Technique Library

Human-recorded references are now the library source of truth. Built-in Jab and MMA Kick remain selectable, but their bundled GLBs are **not** treated as human references. A trainer can add a new technique by recording one clean performance on device. Runtime media is stored on the FastAPI host, not in Expo `assets/` (that folder is bundled source, not persistence).

### Why backend files, not a database

Confirmed techniques live under `backend/data/reference-techniques/<slug>/` with `metadata.json`, `reference.mp4`, and five JPEGs. This is a local prototype store. No database was added. Drafts stay in `backend/tmp/reference-drafts/<draftId>/` until the user confirms. Failed or retaken drafts never become permanent folders.

### Privacy / gitignore

Recorded videos, keyframes, and per-technique metadata can contain real people. They are gitignored:

```
backend/data/reference-techniques/*
!backend/data/reference-techniques/.gitkeep
```

`tmp/` was already ignored, so drafts are not committed either.

### Display name vs slug

The on-screen name is what the user typed (trimmed). The directory id is a sanitized slug: lowercase, hyphens, no path traversal, max length 80. Duplicate slugs are rejected (HTTP 409), including reserved builtin ids (`simple_jab`, `mmakick`, and their hyphenated forms). There is no silent overwrite.

### Draft → review → confirm

Upload creates a draft and runs analysis. Expo shows START / EARLY / MIDDLE / LATE / END frames. **Confirm Reference** copies the draft into the permanent directory atomically (staging folder, then replace). **Retake** discards the draft. `npm run dev` still starts Expo and FastAPI; runtime directories are created on backend startup.

### Generic motion, not jab extension

Jab wrist-to-shoulder extension is punch-specific and was not reused. The reference detector builds a body-scale movement signal from major joints (shoulders, elbows, wrists, hips, knees, ankles), smooths it with the existing 5-frame moving average, then takes the dominant contiguous burst above a baseline/threshold. Five keyframes are spaced at 0 / 25 / 50 / 75 / 100% of that window. Labels are generic temporal names, not EXTENSION / PEAK / RETRACTION.

Quality gates are measurement-only: decode, duration, pose coverage, major-landmark visibility, meaningful movement, a valid window, and five distinct ordered timestamps. The performer is responsible for technique correctness.

### Technique list

Expo keeps builtin catalog entries and fetches `GET /api/reference-techniques`. The two lists are merged in a library provider. If the backend is unreachable, Jab and MMA Kick still appear, with a non-blocking warning. Both builtins currently report `referenceStatus = missing` unless a human reference is recorded later. Recorded techniques report `available`. Starting practice on a recorded custom technique shows a comparison placeholder — no fake scores, no jab detector reuse.

### Postponed on purpose

- Live camera skeleton overlay would require a second native pose stack. Pose stays on the Python backend.
- OpenAI / multimodal comparison waits until reference capture is validated. The API key must remain backend-only.
- Existing mock Results scores (82/84-style) are unchanged and are not shown after Add Technique.

`mma-trainer/` was not modified in this phase.

## Phase 6 — Generic USER ↔ REFERENCE Pairing

A recorded technique cannot be scored by a multimodal model until USER and REFERENCE frames are the same kind of evidence. Phase 5 already extracts five generic temporal keyframes from a human reference. Phase 6 runs that **same** detector on a USER attempt and pairs the frames by normalized movement progress, not by absolute timestamps.

### Why this comes before AI

If START/EARLY/MIDDLE/LATE/END are the wrong moments, later OpenAI calls would only automate a bad crop. This phase produces a reviewable comparison package and stops there. The OpenAI API key is present in the environment but is not used.

### Shared analyzer

Reference capture and USER generic analysis both call `analyze_generic_motion` in `backend/app/reference/analyzer.py`. That function is the production implementation of:

- MediaPipe pose on the uploaded video
- whole-body motion signal (torso-normalized, visibility-filtered major joints)
- 5-frame moving-average smoothing
- technique window from the first sustained movement to the first pose held for 1 second (or the last movement if the clip ends first)
- 0 / 25 / 50 / 75 / 100% keyframe sampling on that window only

JPEG extraction still uses `extract_named_frames`. There is no second “training version” of the detector. Pose thresholds were not retuned.

### Normalized pairing

Reference and USER windows may have different durations. Comparison is:

START ↔ START, EARLY ↔ EARLY, MIDDLE ↔ MIDDLE, LATE ↔ LATE, END ↔ END

Those labels are temporal positions inside the detected window. They are not Jab EXTENSION / PEAK / RETRACTION. Video is not time-stretched. DTW is not used.

`POST /api/reference-techniques/{slug}/analyze-attempt` returns explicit `pairs[]`. Expo does not match arrays by index. Incomplete reference metadata or missing keyframe files return HTTP 422. Unknown slugs return HTTP 404. Invalid measurement returns HTTP 200 with `analysisValid: false` and no score fields.

### Temporary USER storage

USER frames live under `backend/tmp/comparison-attempts/<analysisId>/` as `01-start.jpg` … `05-end.jpg`. They are served from `GET /api/comparison-attempts/{analysisId}/keyframes/{filename}` with UUID + filename allowlists. They are not copied into the permanent reference library. `tmp/` remains gitignored.

### Expo training for recorded techniques

A technique with `source = recorded` and `referenceStatus = available` is trainable. Technique Detail and Get Ready play the human reference with `expo-video` from `GET /api/reference-techniques/{slug}/video` (resolved against `EXPO_PUBLIC_API_BASE_URL`). Built-in Jab and MMA Kick do not load that URL.

Custom-technique capture reuses `TrainingCamera` (muted, front camera). Recording length is chosen on Add Technique after name and description (`/add-technique/duration`, 1–15 seconds, default 3). The reference clip auto-stops at that length. Practice recordings for an already-saved technique have no slider: the attempt timer matches the stored reference video duration. The Jab 3-second auto-stop workflow is unchanged.

Processing reuses the existing upload/error UI with static steps (Uploading attempt / Detecting movement / Preparing comparison). No fake percentages.

### Comparison review

`/comparison/[techniqueId]` shows measurement quality (pose coverage, USER and REFERENCE active-movement durations) and five USER ↔ REFERENCE cards. On a phone the frames stack vertically. **Comparison Looks Correct** does not open mock Results. It shows “Comparison package validated / Ready for AI assessment in the next phase.” Retry clears temporary USER comparison state, keeps the recorded reference, and starts a new analysis id.

### What stayed the same

- Built-in Jab still uses the Phase 3/4 arm-extension detector (START / EXTENSION / PEAK / RETRACTION / RECOVERY) and the existing keyframe review.
- MMA Kick still cannot be analyzed. It does not reuse the jab detector or pretend a custom-technique comparison applies.
- Measurement quality is not technique quality. A rejected attempt is not a low score.
- `npm run dev` still starts Expo and FastAPI only.

`mma-trainer/` was not modified in this phase.

## Phase 7 — Quick Comparison & Detailed AI Assessment

After a recorded-technique USER attempt is accepted, the app offers two analysis modes. Built-in Jab still uses the existing keyframe review. MMA Kick remains unsupported. `mma-trainer/` was not modified.

### Two comparison modes

**Quick Comparison** reuses the Phase 6 five-frame package (START / EARLY / MIDDLE / LATE / END). USER and REFERENCE frames are shown side by side. There is no OpenAI request and no numeric technique score.

**Detailed AI Analysis** uses both complete recordings. The phone uploads only the USER attempt. The backend already owns the stored human reference video.

### Full reference video persistence

Confirmed techniques already kept the original recording at:

`backend/data/reference-techniques/<slug>/reference.mp4`

plus `metadata.json` (`referenceVideo` is the relative filename `reference.mp4`) and five Quick Comparison JPEGs. Confirmation was not changed to recreate existing references. Absolute machine paths are not stored. Reference media remains gitignored.

### USER attempt temporary video

Detailed AI saves the upload under `backend/tmp/ai-attempts/<analysisId>/attempt.mp4` with prepared frames in `frames/`. The MP4 is kept until the pipeline finishes reading it, then the folder is deleted (success, unrecoverable failure, or explicit cleanup). A startup sweep removes leftover folders older than one hour. USER attempts are never copied into the reference library and are not committed (`tmp/` is gitignored).

### Why OpenAI receives images, not video

Current GPT vision models accept image input and do not accept raw MP4 video. FastAPI / OpenCV therefore detect each active-movement window, sample a dense ordered frame sequence, and send those JPEGs. Product copy may say “Detailed AI Analysis” or “Detailed full-motion analysis.” Technically OpenAI receives an ordered image sequence extracted from both complete recordings.

### Dense sampling

The existing generic movement analyzer finds the REFERENCE window and the USER window independently. Absolute timestamps are not compared. Each window is normalized to 12 evenly spaced positions:

`i / 11` rounded to two decimals → 0.00, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.64, 0.73, 0.82, 0.91, 1.00

Each frame stores sequence index, normalized position, original timestampMs, and source (`user` / `reference`). That is 24 images for a normal request.

### Image preparation

AI JPEGs are downscaled so the longest side is at most **768 px**, aspect ratio preserved (`cv2.INTER_AREA`), JPEG quality **80**, no pose overlay, no limb crop, no stretching. 768 is enough to inspect whole-body posture without shipping native camera resolution.

### OpenAI integration

- Official Python OpenAI SDK, **Responses API** (`responses.parse` + strict Pydantic schema).
- Expo never calls OpenAI. Flow: Expo → FastAPI → OpenAI.
- Default model `gpt-5.6-sol` via `OPENAI_MODEL` (backend `.env` only). Changing the env var does not require source edits.
- `OPENAI_API_KEY` is backend-only. It is not in Expo source, `EXPO_PUBLIC_*`, `app.json`, or committed files.

The recorded human reference is the comparison authority. The model is asked how the USER execution differs visually from the REFERENCE, not whether the clip is objectively “correct MMA.”

### Scoring

Anchored 0–4 scores per START / EARLY / MIDDLE / LATE / END:

4 very close / 3 minor / 2 noticeable / 1 major / 0 substantially different

The backend computes overall as `sum(phase scores) / 20 × 100`. Example: 4, 3, 2, 3, 4 → 80. The model does not choose the 0–100 result.

Measurement validity (MediaPipe) and AI comparison validity are separate. `comparisonValid = false` does not become a low technique score.

### Timeouts and errors

Expo → FastAPI detailed request: 240 seconds. Backend → OpenAI: `OPENAI_TIMEOUT_SECONDS` (default 120). Missing key, auth, quota, rate limit, timeout, malformed structured output, missing reference, invalid measurement, and network failures map to athlete-safe messages. Quick Comparison stays available when the key is missing or OpenAI is down.

### Privacy

Reference recordings, USER temp frames, and API keys are gitignored. Image/video bytes are not logged. Visual data is transmitted to OpenAI only when the user explicitly chooses Detailed AI Analysis.

### Why this approach

Five generic keyframes are useful for a fast visual check but too sparse for movement feedback. Sending MP4s is not supported by current GPT vision models. Dense ordered stills from both full recordings, with the human reference as authority and backend-owned scoring, matches the research architecture without putting secrets on the phone.

`mma-trainer/` was not modified in this phase.

## Phase 7.1 — Continuous Video Comparison Redesign

Real-device evaluation of Phase 7 showed that dense still-image comparison is not reliable enough for fast MMA movement. A clean Front Kick reference (~1.24 s active) and a visually very similar USER execution (~1.23 s) produced unstable Detailed AI scores around 20/100 and 55/100, with the main penalties in EARLY / MIDDLE / LATE stills. Isolated temporal samples were therefore rejected as the primary assessment method. This is documented as an observed prototype limitation and a design iteration, not as a prompt- or weight-tweak.

### What changed

- **Quick Visual Comparison** is now a synchronized side-by-side video (LEFT = REFERENCE, RIGHT = YOU). Five START/EARLY/MIDDLE/LATE/END stills remain as secondary debug material only.
- MediaPipe still finds `movementStartMs` / `movementEndMs` and measurement quality. It does not judge technique.
- Active windows are cropped with a small configurable padding (`ACTIVE_WINDOW_PADDING_MS`, default 100 ms), then mapped onto the same 0–100% progress axis. Absolute timestamps are not compared.
- Quick Comparison keeps a real-time-ish length (`max(reference, user)` active duration) so both sides start and finish together.
- Detailed Analysis builds the same composite, then **slows it to about 8 seconds** (`AI_COMPARISON_DURATION_MS`) before sending **one** video to Gemini. Gemini’s normal video understanding samples at ~1 FPS, which is unsuitable for raw 1-second MMA motion.
- OpenAI GPT remains isolated as experimental/legacy image-sequence code (`app/ai/experimental_images.py`, `app/ai/providers/openai_images.py`). It is not the production Detailed Analysis provider because current GPT vision models do not accept raw video.
- Production provider: official `google-genai` SDK, default model `gemini-3.7-flash`, backend-only `GEMINI_API_KEY`. Inline upload is used under 20 MB; otherwise the Files API. Expo never talks to Gemini.
- Scoring moved from START/EARLY/MIDDLE/LATE/END to generalized observable criteria: movementPath, rangeOfMotion, bodyPositioning, sequencingAndTiming, balanceAndControl, recoveryOrCompletion, overallSimilarity. Each is 0–4 or `notApplicable`. N/A does not reduce the overall. The backend still computes 0–100 as `sum(applicable) / max(applicable) × 100`, rounded with one centralized rule.
- Optional post-processed pose overlay (`comparison-pose.mp4`) draws MediaPipe joints and conventional pose connections on the already-analyzed landmarks. It is not live camera pose. `reference.mp4` is never modified.
- Quick Comparison stays entirely on phone ↔ local FastAPI. Only Detailed AI Analysis sends visual media to Gemini. Generated comparison videos and USER attempts remain temporary under gitignored `tmp/`.

`mma-trainer/` was not modified in this phase.

## Phase 7.1.1 — Gemini sampling FPS, duration metadata, scoring cleanup

Phase 7.1 already sends one temporally normalized side-by-side comparison video to Gemini. This hotfix keeps that architecture and tightens sampling, prompt context, and scoring.

Gemini’s default video sampling is about **1 FPS**. Stretching the comparison clip to ~8 seconds therefore used to give the model roughly eight sampled frames of a 1-second kick. The installed `google-genai==2.20.0` API supports explicit sampling through `types.VideoMetadata(fps=...)` on the video `Part` (`video_metadata` is a sibling of `inline_data` / `file_data`). Detailed Analysis now requests **8 FPS** by default (`GEMINI_VIDEO_FPS`, valid range (0.0, 24.0], clamped to the API maximum). The 8-second AI comparison duration is unchanged so quality can be validated before duration/cost work. Effective intended input is therefore: normalized synchronized comparison video + Gemini sampling at 8 FPS, not merely an 8-second video at default 1 FPS. The same metadata is attached for inline bytes and Files API `file_data`. Still-image extraction is not reintroduced.

The normalized video retimes both active movements to the same comparison duration, so it does not preserve original absolute speed. Original REFERENCE and USER active-movement durations (plus difference/ratio) are supplied as factual prompt metadata. `sequencingAndTiming` is scored as relative sequencing/coordination, not as absolute execution speed. The API id is unchanged; the Results UI label is “Sequencing / coordination”.

Holistic `overallSimilarity` was removed from the model numeric criterion set and from criterion averaging so a second holistic 0–4 grade cannot double-count the six concrete criteria. Gemini may still return textual `summary`. The backend remains the sole owner of the final 0–100 score: `sum(applicable criterion scores) / (4 × applicable count) × 100`. `comparisonValid=false` still produces no overall.

The assessment prompt was calibrated so natural human variation is not treated as severe error: the recorded REFERENCE is the authority; two human repetitions are never frame-perfect; negligible posture, tiny positional differences, minor timing, body proportions, clothing, and camera/background must not be penalized; a USER execution that visibly follows the same path, range, organization, sequencing, and recovery should receive mostly 3s and 4s; scores ≤ 2 need a concrete observable reason; insufficient evidence is `notApplicable`, not a low invented grade.

Quick Comparison is unchanged: synchronized video, optional pose overlay, seek/replay/speeds, no AI, no score.

`mma-trainer/` was not modified in this phase.

## Phase 7.1.2 — Deterministic Continuous Movement Similarity

Five-frame still pairing was replaced earlier by synchronized continuous video. Quick mode now also analyses the **complete MediaPipe pose sequence** inside each detected active window. The score is **Movement Similarity** to the recorded human reference, not objective MMA correctness, coaching quality, or expert technique judgement.

Per frame, landmarks are translated to hip center and scaled by torso length. Left/right orientation is preserved; sequences are not mirrored. Face landmarks are unused. Both windows are sampled onto 60 points from 0% to 100% (`QUICK_SIMILARITY_SAMPLES`). Invisible joints are not fabricated.

Pose/form similarity uses major joint angles (elbows, shoulders, hips, knees) plus normalized relative geometry. Movement-path similarity compares extremity trajectories (wrists, elbows, knees, ankles), weighted by how far each joint travels in the REFERENCE sequence. Timing uses original active durations plus the small warp used for alignment. Overall prototype weights are pose 45%, path 40%, timing 15% — heuristic, not scientifically validated, and required to sum to 1.

Constrained Sakoe–Chiba DTW (±8% of normalized progress by default) is only an alignment step so nearby pose states can be compared. It is not the V1 DTW scorer and is not treated as MMA quality. Unrestricted warping is not allowed.

Self-comparison of a sequence with itself yields approximately 100 on every component. Deterministic feedback names the strongest component, the largest observed joint deviation, and original durations. Upper/lower-body summaries are diagnostic only and are not mixed into the overall. Insufficient pose coverage returns `similarityValid=false` with no numeric score (poor measurement is not a zero). Quick Comparison does not call Gemini or OpenAI. Gemini remains Detailed mode only; 403/auth failures now log sanitized stage/status/code without keys, bytes, or filesystem paths.

`mma-trainer/` was not modified in this phase.

## Phase 7.1.3 — Reliability, Progress UX & Technique Management

Real-device Detailed AI reached Gemini successfully, then failed with HTTP 503 `UNAVAILABLE` / high demand. That is transient provider capacity, not authentication.

Detailed Analysis now retries transient Gemini failures (503 / UNAVAILABLE, transient 500 / INTERNAL, timeouts) with exponential backoff (`GEMINI_MAX_RETRIES=3`, `GEMINI_RETRY_BASE_SECONDS=2`). Auth, permission, quota/billing, 400, and malformed input are not retried and do not trigger fallback. After primary retries are exhausted, the backend may try `GEMINI_FALLBACK_MODEL` (`gemini-3.6-flash` by default). Expo uses an in-memory job (`POST .../ai-analysis/jobs` + `GET /api/ai-analysis/jobs/{jobId}` polling at 800 ms). Progress is **pipeline milestone percent**, not Gemini inference completion. The processing screen shows the current activity, retry/fallback copy, elapsed time, and a checklist. The existing synchronous AI route remains for CLI/tests and shares `run_detailed_analysis`.

Recorded techniques can be permanently deleted (`DELETE /api/reference-techniques/{slug}`) after confirmation. Built-in Jab / MMA Kick cannot be deleted. Paths are safe-slug validated under the reference-techniques root.

Missing **Show pose** was caused by pose-overlay encode soft-failing (`comparisonPoseVideoUrl=null`, so the toggle was hidden). `avc1`/`libopenh264` can open a writer then fail; encode now tries a full write per codec and falls back to `mp4v`. If pose overlay still cannot be created, Quick Comparison remains usable and the player shows **Pose overlay unavailable** instead of hiding the control. Clean `comparison.mp4` is not discarded when pose encode fails.

Quick Movement Similarity copy is labeled Computer Vision / Measured Movement Feedback so it is not mistaken for Gemini output.

`mma-trainer/` was not modified in this phase.

## Phase 7.1.4 — Canonical Full-Technique Video Pipeline

### Real-device failures (invalid Gemini evidence)

**Failure 1:** After Detailed AI Analysis, the USER side of the comparison contained only a late fragment of a multi-hit technique, stretched into slow motion. The REFERENCE side showed the complete technique.

**Failure 2:** A newly recorded custom combo replayed correctly on Technique Detail (permanent `reference.mp4`). Detailed AI then scored about 50/100. In the comparison used for AI, USER showed the complete attempt, but REFERENCE started around halfway through and looked about 0.25x–0.5x while USER looked full and smooth.

Those scores are **not valid evaluation evidence**. Gemini was grading incomplete or mismatched clips, not necessarily the athlete’s execution.

### Root causes found in the then-current code

1. **Incomplete multi-burst windows (both sides).** `detect_active_window` used a **global peak** to set the onset threshold, then ended at the first ~1 s hold. Weaker early combo actions could sit below `baseline + 0.30 × (peak − baseline)`, so the window started at the loudest later burst. That matches REFERENCE starting halfway and USER showing only a late fragment.
2. **Watch Comparison ≠ Gemini input.** Detailed Analysis rendered `comparison.mp4` at Quick duration (`max(reference, user)`), rendered `ai-comparison.mp4` at ~8 s for Gemini, **deleted** `ai-comparison.mp4` after the provider call, and returned the Quick file URL. The athlete therefore watched a different retiming than Gemini.
3. **Asymmetric visual speed in the Quick preview.** Quick duration is `max(refWindow, userWindow)`. A short (partial) REFERENCE window stretched to a full USER window looks ~0.25x–0.5x while USER plays near 1×. That matches Failure 2’s preview, even though Gemini’s 8 s file would have stretched both sides.
4. **No file-level double crop** of a temp clip being re-analyzed. Both sides always ran pose on the RAW files (`data/reference-techniques/<slug>/reference.mp4` and the uploaded attempt). The “starts halfway” effect was **onset skipping**, not a second crop of an already cropped MP4.
5. **No second slow of an already-slowed composite.** AI was a separate render from RAW to 8 s, not “slow the Quick file again.” The bug was two different target durations plus incomplete windows, not stacked retimers on one file.
6. **Independent re-analysis.** Quick and Detailed each called `analyze_generic_motion` again. Same function, but windows were not stored as a canonical result for the rest of a job. FPS fallback for 0/NaN already existed; encoded files were not reopened for duration/FPS invariants before Gemini.

### What changed

- **Canonical video states:** `RAW_REFERENCE`, `RAW_USER`, `CANONICAL_ACTIVE_*` (timestamps into the RAW file, not a second on-disk crop), `SYNCHRONIZED_COMPARISON`, `AI_RETIMER_OUTPUT`. `analyze_generic_motion` and AI retiming reject derived filenames (`ai-comparison.mp4`, `comparison.mp4`, `comparison-pose.mp4`) and non-RAW `VideoAsset` stages.
- **Complete multi-burst segmentation (shared):** smoothed normalized energy → all meaningful regions → reject sub-`min_onset_ms` noise → merge gaps ≤ `GENERIC_MOVEMENT_MAX_GAP_MS` (default **500 ms**, 15 frames at 30 FPS) → pick the longest cluster → extend through recovery / held pose → pad once (`ACTIVE_WINDOW_PADDING_MS`). REFERENCE capture, USER Quick, and USER Detailed all call this same `detect_active_window` / `analyze_generic_motion`.
- **One canonical window per analysis:** crop timestamps and similarity use that result; comparison rendering does not redetect. Padding is applied once (`padding_applied`); render uses `windows_already_canonical=True`.
- **One AI retime:** Detailed builds only `tmp/comparisons/<analysisId>/ai-comparison.mp4` (~8 s, 30 FPS) from RAW + canonical windows. That file is uploaded to Gemini and is the Watch Comparison URL. It is **not** deleted after the provider returns. Stale cleanup still removes the analysis directory after `COMPARISON_MAX_AGE_SECONDS`.
- **FPS/timebase:** encoded composites are reopened; duration is checked against `frame_count / fps` within encoder tolerance. Source 0/NaN FPS still falls back to 30.
- **Invalid evidence blocks Gemini:** incomplete windows, failed composite invariants, or preview/Gemini path mismatch return `comparison_video_invalid` with *The complete movement could not be prepared for AI analysis. Please retry the recording.* The provider is not called.
- **Diagnostics:** sanitized per-side raw/canonical/region metadata; Results “Analysis details” shows movement durations, region counts, and AI comparison duration. CLI: `python -m app.tools.inspect_video_pipeline --slug <slug> --user <path>` (no Gemini).
- Gemini prompt, six criteria, scoring, 8 FPS Gemini metadata, retry/fallback, and Quick similarity weights were **not** changed.

`mma-trainer/` was not modified in this phase.

## Phase 8 — Privacy, Consent & Audio Feedback

Recording visual data of people requires an application-level disclosure in addition to the OS camera permission. The OS prompt only grants device access. It does not explain where video goes, which derived pose data is created, or when media is stored versus temporary. MMA Trainer therefore shows GDPR-oriented privacy and data-processing transparency before the first recording. This is not a certified GDPR compliance statement.

Two processing situations stay separate:

- **Camera / local MMA Trainer processing.** Video is recorded, sent to the configured FastAPI backend, and analysed with MediaPipe pose estimation. Quick Comparison (Computer Vision Comparison) stays in that client/backend flow and does not send visual media to Google Gemini.
- **Optional Google Gemini processing.** Detailed AI Analysis sends the synchronized comparison video to Gemini. That path has its own acknowledgement and is never implied by the camera disclosure.

Reference recordings are persistent: `reference.mp4`, extracted keyframes, and metadata remain under `backend/data/reference-techniques/<slug>/` until the user deletes the technique. Practice attempts and generated comparison assets are temporary and cleaned automatically; leftover files may remain until periodic backend cleanup rather than disappearing instantly.

Acknowledgements (`cameraPrivacyAcknowledged`, `externalAiAcknowledged`) are stored on-device with `@react-native-async-storage/async-storage`. There are no user accounts. Resetting acknowledgements on Privacy & Data does not delete recorded techniques.

A Gemini job is blocked until external-AI acknowledgement is stored. The UI shows a dedicated disclosure first; `useDetailedAnalysis` and `createAiAnalysisJob` / `requestAiAnalysis` also refuse to start without that acknowledgement. That is application UX protection, not legal proof of consent.

Device-side text-to-speech (`expo-speech`) reads a concise Quick Comparison summary and a presentation-friendly Detailed AI summary. Audio is supplementary. Results remain usable if TTS is unavailable. Speech stops on Stop, before a new utterance, and when leaving the screen.

`mma-trainer/` was not modified in this phase.

## Phase 9 — Validation & Explainability

Implementation alone is not enough to evaluate the prototype. Scoring code can be internally consistent and still be misleading in real recordings. Phase 9 adds **prototype / technical validation** tooling so a researcher can collect labelled evidence for:

- identical input (self comparison)
- clean reproduction
- a single minor deliberate error
- a single major deliberate error
- poor camera / pose coverage
- multi-action techniques
- repeated Gemini analysis of the **same** prepared video

This is not clinical or professional biomechanics accuracy, and the UI does not present aggregates as statistically significant conclusions.

### Controlled scenarios

Research Validation lets the researcher pick a recorded technique and a **manual** scenario label (Self comparison, Clean reproduction, Minor/Major deliberate error, Bad camera / measurement, Multi-action test, Custom). The app does not claim that an attempt satisfies the label.

### Deterministic self-comparison

REFERENCE vs the same REFERENCE runs Quick similarity without a new recording and without Gemini. The expected invariant is approximately 100. A **deterministic repeat check** runs the same stored pose sequences twice and reports `Deterministic repeat check: PASS` when outputs are identical.

### Gemini repeatability

A development-only prototype stability check (1 or 3 runs, bounded) reuses the exact validated `ai-comparison.mp4` plus `ai-context.json`. It does not re-record, resegment, or re-render. Min / max / mean / range of overall scores are descriptive stability numbers, not scientific validation. Automated tests use a fake provider.

### Latency

Where already observable, the pipeline records pose analysis, comparison-video creation, Quick similarity, AI-video preparation, Gemini provider latency, and total Quick / Detailed times. These are for research documentation, not micro-optimization.

### Validation records and export

JSON records live under gitignored `backend/data/validation-runs/`. They store metrics, validity, provenance (actual Gemini model, fallback, provider latency, analysis id), optional researcher notes, and optional repeatability — not duplicate personal videos, pose arrays, prompts, or API keys. Invalid measurement is a valid experimental outcome (`comparisonValid=false`, reason, coverage, no fake score). Export produces JSON and CSV of numeric/text metrics only.

### Joint-deviation visualization

Quick already identifies the largest-deviation body part and a normalized progress range. The post-processed USER pose overlay emphasizes that joint/segment only inside that range. The highlight means: this joint had the largest measured trajectory deviation from the reference during this portion of the movement. It does not mean injury risk, objectively incorrect MMA, or that a coach would necessarily correct it. A legend states that distinction. `reference.mp4` is unchanged. Overlay still works when no highlight data is present.

Explainability here is visualization of an existing deterministic measurement, not a new coaching claim and not a score-calibration pass. Quick weights, DTW limits, and the Gemini rubric were not tuned in this phase.

`mma-trainer/` was not modified in this phase.

## Phase 9.1 — Research Validation UX Simplification

Real-device testing showed the Phase 9 validation UI was functionally complete but difficult to understand. Scenario labels and actions were mixed together. Duplicated Self Comparison terminology caused confusion. Researcher and developer controls cluttered the primary workflow.

The validation experience was redesigned around: Choose technique → Choose test → Run → Review → Save. Only four presentation-relevant tests remain primary (Reference self-test, Clean attempt, Deliberate difference, Poor recording test). Advanced and repeatability tools remain available but secondary. Saved results and export were separated from test creation. Backend validation architecture and scoring were not changed.

Internal scenario enums are unchanged. Old records still load, with presentation labels mapped for `self_comparison`, `clean_reproduction`, minor/major deliberate error, `bad_camera`, and legacy `multi_action` / `custom` values.

`mma-trainer/` was not modified in this phase.

## Phase 10 — Final Polish, Research Alignment & Demo Readiness

The technical architecture was treated as frozen. Quick similarity weights, MediaPipe analysis, Gemini analysis, and validation methodology were not redesigned. No new scoring path, database, account system, or 3D engine was added.

### Architecture freeze and UX consistency

Athlete Home now separates Start Training / Techniques from Privacy & Data and a clearly labelled Research Tools card (Research Validation, Developer / presentation). Built-in catalog techniques no longer offer a practice-comparison path. Recorded techniques remain the production training target, with replay, practice, delete, and a visible success state after confirming a reference.

Computer Vision Comparison and Detailed AI Analysis were reordered so video, scores, measured/Gemini feedback, Watch Comparison, and Play feedback sit above collapsed Analysis details. The Detailed processing screen uses real pipeline milestones, starts at 0% until the first job update, and surfaces retry / backup-model copy. Error titles distinguish camera, backend, pose/segmentation, comparison-video, Gemini configuration/quota/demand, malformed AI, and TTS/overlay failures without stack traces. Development mode still shows a sanitized diagnostic code.

### Mock / legacy isolation

The mock overall-82 Results screen is retired. Built-in Jab five-frame review no longer continues to fake scores and is labelled experimental / legacy. The experimental OpenAI still-image path remains in backend source only. Five-frame stills stay as optional debug material on Quick Comparison.

### Research-question alignment

V1 was a browser/Next.js prototype with Babylon/Mixamo GLB, camera, MediaPipe, an experimental scorer, and audio that was not meaningfully integrated. V2 is Expo/mobile with recorded human reference video as the comparison authority, deterministic full-sequence similarity, optional Gemini, on-device TTS, privacy transparency, and validation tooling. 3D was inspected and **not** implemented: the Expo stack has no stable low-risk GLB viewer, and a new 3D subsystem would have violated the freeze. 3D is documented as a V1 evaluated representation that was de-emphasized.

Presentation docs added: `docs/demo-guide.md`, `docs/final-architecture.md`, `docs/limitations.md`, `docs/research-architecture-evolution.md`.

`mma-trainer/` was not modified in this phase.


