"""Transparent feature extraction; only known, finalized findings count."""
import pandas as pd

from models import DIFFICULTIES, TACTICS, HistoryEntry, Profile, Rate, Weakness, Weaknesses


def has_evidence(entry: HistoryEntry) -> bool:
    return entry.classification != "unknown" or (
        entry.kind == "scam" and any(f.outcome != "unknown" for f in entry.findings)
    )


def build_profile(history: list[HistoryEntry]) -> Profile:
    ordered = sorted(history, key=lambda h: (h.assessedAt, str(h.attemptId)))
    rows = [
        {"tactic": f.tactic, "outcome": f.outcome}
        for h in ordered if h.kind == "scam"
        for f in h.findings if f.outcome != "unknown"
    ]
    frame = pd.DataFrame(rows, columns=["tactic", "outcome"])
    recent = frame.groupby("tactic", sort=False).tail(20)
    weaknesses = {}
    for tactic in TACTICS:
        values = recent.loc[recent["tactic"] == tactic, "outcome"]
        missed = int((values == "missed").sum())
        n = len(values)
        weaknesses[tactic] = Weakness(weakness=(missed + 1) / (n + 2), evidenceCount=n, untested=n == 0)

    def classification_rate(kind):
        known = [h for h in ordered if h.kind == kind and h.classification != "unknown"]
        errors = sum(h.classification == "incorrect" for h in known)
        return Rate(rate=errors / len(known) if known else None, errors=errors, assessed=len(known))

    level = 0
    window = []
    for h in ordered:
        if h.kind != "scam" or not has_evidence(h) or h.difficulty != DIFFICULTIES[level]:
            continue
        window = (window + [h.score])[-5:]
        if len(window) < 5:
            continue
        mean = sum(window) / 5
        next_level = min(2, level + 1) if mean >= 80 else max(0, level - 1) if mean < 50 else level
        if next_level != level:
            level = next_level
            window = []

    return Profile(
        weaknesses=Weaknesses(**weaknesses),
        falseAlarms=classification_rate("legitimate"),
        scamMisses=classification_rate("scam"),
        currentDifficulty=DIFFICULTIES[level],
        assessedCount=sum(has_evidence(h) for h in ordered),
    )
