import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from engine import recommend
from features import build_profile
from main import app
from models import HistoryEntry, RecommendRequest

ROOT = Path(__file__).resolve().parents[2]


def entry(n=1, tactic="urgency", outcome="missed", kind="scam", classification="incorrect", score=20, difficulty="beginner"):
    return HistoryEntry(
        attemptId=UUID(int=n), rubricVersion="fixture-v1", score=score,
        classification=classification,
        findings=[{"tactic": tactic, "outcome": outcome, "evidence": "Observed fixture action"}] if kind == "scam" else [],
        feedback="Fixture feedback", assessedAt=datetime(2026, 1, 1, tzinfo=timezone.utc)+timedelta(minutes=n),
        kind=kind, difficulty=difficulty, patternId=UUID(int=100), channel="text",
    )


def request(history=None, seed=42, channels=None, recent=None):
    history = history or []
    raw = json.loads((ROOT/"contracts/recommend.request.json").read_text())
    raw.update(history=history, profile=build_profile(history), randomSeed=seed,
               enabledChannels=channels or ["text", "email", "call"], recentPatternIds=recent or [])
    return RecommendRequest.model_validate(raw)


def test_shared_contracts():
    expected = json.loads((ROOT/"contracts/profile.response.json").read_text())
    assert build_profile([]).model_dump(mode="json") == expected
    r = request()
    assert len(r.candidatePatterns) == 24
    assert len([p for p in r.candidatePatterns if p.kind == "legitimate"]) == 9
    assert all(p.provenance.synthetic for p in r.candidatePatterns)
    expected_recommendation=json.loads((ROOT/"contracts/recommend.response.json").read_text())
    assert recommend(r).model_dump(mode="json") == expected_recommendation


def test_latest_twenty_known_findings():
    history = [entry(n, outcome="caught" if n <= 10 else "missed") for n in range(1,31)]
    history.append(entry(31, outcome="unknown", classification="unknown", score=100))
    w = build_profile(history).weaknesses.urgency
    assert w.evidenceCount == 20
    assert w.weakness == 21/22
    assert not w.untested
    assert build_profile([]).weaknesses.urgency.untested


def test_legitimate_false_alarms_do_not_change_tactic_weakness():
    p = build_profile([entry(kind="legitimate"), entry(2, kind="legitimate", classification="correct")])
    assert p.falseAlarms.rate == .5
    assert p.scamMisses.rate is None
    assert all(w["untested"] for w in p.weaknesses.model_dump().values())


def test_unknown_attempts_cannot_improve_difficulty():
    history=[entry(n,outcome="unknown",classification="unknown",score=100) for n in range(1,10)]
    p=build_profile(history)
    assert p.assessedCount == 0
    assert p.currentDifficulty == "beginner"
    assert p.scamMisses.rate is None


def test_progression_window_resets_and_downgrades():
    history=[entry(n,outcome="caught",classification="correct",score=90) for n in range(1,6)]
    assert build_profile(history).currentDifficulty == "intermediate"
    # Old beginner results cannot advance the intermediate window.
    history += [entry(n,outcome="caught",classification="correct",score=100) for n in range(6,11)]
    assert build_profile(history).currentDifficulty == "intermediate"
    history += [entry(n,difficulty="intermediate",score=40) for n in range(11,16)]
    assert build_profile(history).currentDifficulty == "beginner"


def test_difficulty_boundaries_and_chronological_replay():
    history=[entry(n,outcome="caught",classification="correct",score=80) for n in range(1,6)]
    history += [entry(n,difficulty="intermediate",score=80) for n in range(6,11)]
    history += [entry(n,difficulty="advanced",score=100) for n in range(11,16)]
    assert build_profile(list(reversed(history))).currentDifficulty == "advanced"
    assert build_profile([entry(n,score=0) for n in range(1,6)]).currentDifficulty == "beginner"


def test_seeded_recommendations_and_enabled_channels():
    assert recommend(request()) == recommend(request())
    for channel in ["text", "email", "call"]:
        for seed in range(30):
            result=recommend(request(seed=seed,channels=[channel]))
            assert result.channel == channel
            assert result.difficulty == "beginner"
    assert {recommend(request(seed=n)).channel for n in range(30)} == {"text","email","call"}


def test_weaknesses_change_recommendations():
    urgency=[entry(n,tactic="urgency") for n in range(1,4)]
    authority=[entry(n,tactic="authority") for n in range(1,4)]
    results_a=[recommend(request(urgency,seed=n)).targetedTactics for n in range(200)]
    results_b=[recommend(request(authority,seed=n)).targetedTactics for n in range(200)]
    assert results_a.count(["urgency"]) > results_a.count(["authority"])
    assert results_b.count(["authority"]) > results_b.count(["urgency"])
    assert results_a != results_b


def test_mix_and_channel_randomness():
    r=request()
    kinds={p.id:p.kind for p in r.candidatePatterns}
    results=[recommend(request(seed=n)) for n in range(1000)]
    scam_count=sum(kinds[x.patternId]=="scam" for x in results)
    assert 630 < scam_count < 770
    assert all(270 < sum(x.channel==c for x in results) < 400 for c in ["text","email","call"])


def test_recent_pattern_avoidance_and_exhausted_pool():
    r=request(seed=1,channels=["text"])
    original=recommend(r)
    # Add an alternative for the targeted tactic (or legitimate category).
    p=next(p for p in r.candidatePatterns if p.id==original.patternId)
    clone=p.model_copy(update={"id":UUID(int=999)})
    r.candidatePatterns.append(clone)
    r.recentPatternIds=[p.id]
    assert recommend(r).patternId != p.id
    r.candidatePatterns.remove(clone)
    assert recommend(r).patternId == p.id


def test_context_weighting():
    r=request(channels=["text"])
    # All legitimate originals match shopping; clones deliberately do not.
    legitimate=[p for p in r.candidatePatterns if p.kind=="legitimate" and p.channel=="text"]
    r.candidatePatterns=[p for p in r.candidatePatterns if p.kind=="scam"]
    originals=set()
    for n,p in enumerate(legitimate):
        matching=p.model_copy(update={"contextTags":["shopping"]})
        originals.add(p.id)
        r.candidatePatterns.extend([matching,p.model_copy(update={"id":UUID(int=2000+n),"contextTags":["other"]})])
    counts=[0,0]
    for seed in range(1500):
        r.randomSeed=seed
        result=recommend(r)
        if not result.targetedTactics:
            counts[0 if result.patternId in originals else 1]+=1
    assert counts[0] > counts[1]*1.5


def test_invalid_and_stale_inputs():
    raw=json.loads((ROOT/"contracts/recommend.request.json").read_text())
    raw["enabledChannels"]=["fax"]
    with pytest.raises(ValidationError): RecommendRequest.model_validate(raw)
    r=request()
    r.profile.currentDifficulty="advanced"
    with pytest.raises(ValueError,match="Profile does not match"): recommend(r)
    r=request(channels=["call"])
    r.candidatePatterns=[p for p in r.candidatePatterns if p.channel=="email"]
    with pytest.raises(ValueError,match="No .* patterns"): recommend(r)


def test_service_auth_and_validation(monkeypatch):
    monkeypatch.setenv("PERSONALIZATION_SERVICE_KEY","test-personalization-secret")
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/v1/profile",json={"history":[]}).status_code == 401
        headers={"X-Service-Key":"test-personalization-secret"}
        assert client.post("/v1/profile",json={"history":[]},headers=headers).status_code == 200
        raw=request().model_dump(mode="json")
        assert client.post("/v1/recommend",json=raw,headers=headers).status_code == 200
        raw["randomSeed"]=-1
        assert client.post("/v1/recommend",json=raw,headers=headers).status_code == 422


def test_duplicate_assessments_and_findings_rejected():
    raw=request().model_dump(mode="json")
    h=entry().model_dump(mode="json")
    raw["history"]=[h,h]
    with pytest.raises(ValidationError): RecommendRequest.model_validate(raw)
    h["findings"]*=2
    with pytest.raises(ValidationError): HistoryEntry.model_validate(h)
