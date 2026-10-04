"""Seeded baseline policy; no trained model or external provider calls."""
import random

from features import build_profile
from models import TACTICS, Recommendation, RecommendRequest


def recommend(request: RecommendRequest) -> Recommendation:
    # Recompute to prevent a stale profile silently changing the policy.
    profile = build_profile(request.history)
    if profile != request.profile:
        raise ValueError("Profile does not match assessment history")
    rng = random.Random(request.randomSeed)
    channel = rng.choice(request.enabledChannels)
    kind = "scam" if rng.random() < 0.7 else "legitimate"
    pool = sorted(
        [p for p in request.candidatePatterns if p.channel == channel and p.kind == kind],
        key=lambda p: str(p.id),
    )
    if not pool:
        raise ValueError(f"No {kind} patterns for enabled channel {channel}")

    target = None
    if kind == "scam":
        available = [t for t in TACTICS if any(t in p.tactics for p in pool)]
        values = profile.weaknesses.model_dump()
        experienced = [t for t in available if values[t]["evidenceCount"] >= 3]
        if experienced and rng.random() < 0.7:
            highest = max(values[t]["weakness"] for t in experienced)
            target = rng.choice([t for t in experienced if values[t]["weakness"] == highest])
            reason = "Practice a tactic with demonstrated weakness"
        else:
            lowest = min(values[t]["evidenceCount"] for t in available)
            target = rng.choice([t for t in available if values[t]["evidenceCount"] == lowest])
            reason = "Explore a less-tested tactic"
        pool = [p for p in pool if target in p.tactics]
    else:
        reason = "Practice distinguishing legitimate communications from scams"

    fresh = [p for p in pool if p.id not in request.recentPatternIds]
    if fresh:
        pool = fresh
    contexts = {s.strip().casefold() for s in request.interests}
    if request.profession:
        contexts.add(request.profession.strip().casefold())
    weights = [2 if contexts.intersection(tag.casefold() for tag in p.contextTags) else 1 for p in pool]
    pattern = rng.choices(pool, weights=weights, k=1)[0]
    return Recommendation(
        patternId=pattern.id,
        channel=channel,
        difficulty=profile.currentDifficulty,
        targetedTactics=[target] if target else [],
        explanation=reason,
        randomSeed=request.randomSeed,
    )
