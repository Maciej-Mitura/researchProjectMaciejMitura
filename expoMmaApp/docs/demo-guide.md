# Demo guide

Recommended live presentation flow for MMA Trainer V2. Use a **recorded human reference technique**, not a built-in catalog entry.

Do not start paid Gemini calls unless the presentation specifically needs Detailed AI.

## Before the demo

1. Computer and phone on the same Wi-Fi (not a guest/client-isolation network).
2. Copy `expoMmaApp/.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to `http://YOUR_LAN_IP:8000`.
3. Copy `expoMmaApp/backend/.env.example` to `backend/.env`. Gemini is required only for Detailed AI.
4. From `expoMmaApp/`, start the app and backend together with `npm run dev`.
5. Open the project in Expo Go on the phone.
6. Confirm at least one recorded technique exists, or create one first (Add Technique).
7. Do **not** fabricate saved AI results.

## Recommended live flow

1. **Home / architecture overview**
   Athlete actions: Start Training, Techniques. Secondary: Privacy & Data. Separate: Research Validation (Developer / presentation).
2. **Privacy & Data** briefly
   Camera recordings, reference storage, temporary files, Computer Vision, Detailed AI / Google Gemini, deletion, prototype notice.
3. **Select a recorded technique**
   Built-in Jab / MMA Kick are catalog descriptions only.
4. **Show the reference**
   Replay the saved human recording on Technique Detail.
5. **Record an attempt**
   Get Ready → Training → Use This Attempt.
6. **Computer Vision Comparison (Quick)**
   Choose Computer Vision Comparison.
7. **Explain deterministic comparison**
   MediaPipe pose sequence, Pose / Form, Movement Path, Timing, pose overlay, largest-deviation legend.
8. **Play audio feedback**
   Play feedback reads the measured summary.
9. **Run Detailed AI**
   Acknowledge external AI if prompted.
10. **Show the processing screen**
    Pipeline percent, current activity, elapsed time, retry / backup-model copy. 100% only when complete.
11. **Show the Gemini result + comparison**
    Overall Similarity, six criteria, What matched well, Main differences, Summary, Watch Comparison, Play feedback. Open Analysis details only if asked.
12. **Research Validation**
    Choose technique → Choose test → Run → Review → Save.
13. **Saved validation evidence**
    Open Saved Results / export if useful.
14. **Delete a disposable technique** if that helps show data deletion.

## Demo fallback plan

If Gemini internet/API fails during the presentation:

- Computer Vision Comparison remains fully functional on the phone ↔ local backend path.
- Saved validation / previous Detailed results can still demonstrate Gemini-assisted findings **where they already exist**.
- Do not make the whole demonstration depend on a live API response.
- Do not fabricate saved AI results.

If the backend is unreachable, show Privacy & Data, the technique library, and Research Validation empty/saved-state rather than inventing scores.

## Exact physical-device smoke test

1. `npm run dev` from `expoMmaApp/`.
2. Confirm Expo starts and FastAPI is listening on the configured LAN address.
3. Open Expo Go and load Home.
4. Open Privacy & Data; confirm the seven sections.
5. Open Techniques. If no recorded technique exists, Add Technique, record, confirm, and land on Technique Detail with a success notice.
6. Start Practice → record → Use This Attempt → Computer Vision Comparison.
7. Confirm synchronized video, Movement Similarity, Play feedback, and collapsed Analysis details.
8. Optional: Detailed AI Analysis. If Gemini is unavailable, confirm the error distinguishes configuration / quota / high demand and that Quick Comparison remains offered.
9. Open Research Validation, run Reference self-test, save, open Saved Results.
10. Delete a disposable recorded technique if one was created for the test.
