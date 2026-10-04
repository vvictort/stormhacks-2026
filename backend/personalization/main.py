import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException

from engine import recommend
from features import build_profile
from models import Profile, ProfileRequest, Recommendation, RecommendRequest


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("PERSONALIZATION_SERVICE_KEY"):
        raise RuntimeError("PERSONALIZATION_SERVICE_KEY is required")
    yield


def require_service_key(x_service_key: str | None = Header(default=None)):
    expected = os.environ.get("PERSONALIZATION_SERVICE_KEY")
    if not expected:
        raise HTTPException(503, "Service not configured")
    if not x_service_key or not secrets.compare_digest(x_service_key.encode(), expected.encode()):
        raise HTTPException(401, "Invalid service credential")


app = FastAPI(title="Scam Training Personalization", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "personalization"}


@app.post("/v1/profile", response_model=Profile, dependencies=[Depends(require_service_key)])
def profile(request: ProfileRequest):
    return build_profile(request.history)


@app.post("/v1/recommend", response_model=Recommendation, dependencies=[Depends(require_service_key)])
def recommendation(request: RecommendRequest):
    try:
        return recommend(request)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
