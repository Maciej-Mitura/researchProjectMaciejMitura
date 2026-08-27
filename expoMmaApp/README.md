# MMA Trainer V2

Expo / React Native prototype for the MMA Trainer research project.

The athlete records a **human reference**, practices the same movement, then reviews:

- **Computer Vision Comparison** — local MediaPipe similarity, synchronized REFERENCE ↔ YOU video, measured feedback, on-device speech.
- **Detailed AI Analysis** — optional Google Gemini comparison of the synchronized video, six criteria, backend 0–100.

Built-in Jab and MMA Kick are catalog descriptions only. They are not comparison references.

Research Validation is a separate **developer / presentation** tool, not part of normal training.

Documentation:

- [Final architecture](docs/final-architecture.md)
- [Research architecture evolution](docs/research-architecture-evolution.md)
- [Limitations](docs/limitations.md)
- [Demo guide](docs/demo-guide.md)
- [Validation protocol](docs/validation-protocol.md)

`mma-trainer/` (V1) is the read-only browser baseline. Do not modify it here.

## Environment

Copy `.env.example` to `.env` in this folder:

```
EXPO_PUBLIC_API_BASE_URL=http://YOUR_COMPUTER_LAN_IP:8000
```

Do **not** use `http://localhost:8000` on a physical phone — that address is the phone itself.

Gemini and experimental OpenAI credentials belong in `backend/.env`, never in this Expo `.env` file and never in `EXPO_PUBLIC_*`.

### Windows: find your LAN IPv4

1. Open PowerShell.
2. Run `ipconfig`.
3. Under **Wireless LAN adapter Wi-Fi** (or Ethernet if you are wired), copy **IPv4 Address**.
4. Put that in `.env` as `http://THAT_ADDRESS:8000`.
5. Restart Expo (`npm run dev` or `npx expo start`) so `EXPO_PUBLIC_*` is picked up.

Phone and PC must be on the same Wi-Fi. Guest/client-isolation networks often block this.

## Scripts

```bash
npm run dev
npm start
npm run typecheck
npm run lint
npm run test:logic
npx expo-doctor
```

`npm run dev` starts Expo/Metro and FastAPI together in one terminal (`concurrently`). Ctrl+C stops both.

Backend tests:

```powershell
cd expoMmaApp/backend
.\.venv\Scripts\python.exe -m pytest
```
