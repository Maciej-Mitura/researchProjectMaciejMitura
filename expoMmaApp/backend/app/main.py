from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.store import sweep_stale_attempts
from app.ai.jobs import sweep_stale_jobs
from app.api.ai import jobs_router, router as ai_router
from app.api.comparison import router as comparison_router
from app.api.reference import router as reference_router
from app.api.routes import router
from app.api.validation import router as validation_router
from app.config import ensure_runtime_directories
from app.video.store import sweep_stale_comparisons


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_runtime_directories()
    sweep_stale_attempts()
    sweep_stale_comparisons()
    sweep_stale_jobs()
    yield


app = FastAPI(
    title="MMA Trainer V2 Pose Backend",
    version="0.9.0",
    description=(
        "Phase 9 computer-vision backend: video → pose landmarks → "
        "jab user keyframes, generic reference capture, synchronized USER ↔ "
        "REFERENCE comparison video, deterministic Quick Movement Similarity, "
        "optional Detailed AI Analysis via Gemini, and local prototype validation."
    ),
    lifespan=lifespan,
)

# Development CORS for Expo web / LAN debugging.
# Native React Native fetch is not governed by browser CORS; this middleware
# is still useful for browser tools. It is not a production policy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
app.include_router(reference_router, prefix="/api")
app.include_router(comparison_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(validation_router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
