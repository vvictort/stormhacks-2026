from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

CHANNELS = ("text", "email", "call")
TACTICS = ("urgency", "authority", "suspicious_links", "otp_requests", "information_sharing")
DIFFICULTIES = ("beginner", "intermediate", "advanced")
Channel = Literal["text", "email", "call"]
Tactic = Literal["urgency", "authority", "suspicious_links", "otp_requests", "information_sharing"]
Difficulty = Literal["beginner", "intermediate", "advanced"]
Kind = Literal["scam", "legitimate"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Finding(Model):
    tactic: Tactic
    outcome: Literal["caught", "missed", "unknown"]
    evidence: str = Field(min_length=1, max_length=4000)


class HistoryEntry(Model):
    attemptId: UUID
    rubricVersion: str = Field(min_length=1, max_length=100)
    score: float = Field(ge=0, le=100, strict=True)
    classification: Literal["correct", "incorrect", "unknown"]
    findings: list[Finding] = Field(max_length=5)
    feedback: str = Field(min_length=1, max_length=10000)
    assessedAt: datetime
    kind: Kind
    difficulty: Difficulty
    patternId: UUID
    channel: Channel

    @field_validator("assessedAt")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamp must include a timezone")
        return value

    @model_validator(mode="after")
    def unique_findings(self):
        if len({f.tactic for f in self.findings}) != len(self.findings):
            raise ValueError("Duplicate tactic")
        if self.kind == "legitimate" and self.findings:
            raise ValueError("Legitimate communications cannot carry scam tactic findings")
        return self


class Provenance(Model):
    synthetic: bool = Field(strict=True)
    sourceUrl: HttpUrl | None


class Pattern(Model):
    id: UUID
    kind: Kind
    channel: Channel
    category: str = Field(min_length=1)
    tactics: list[Tactic]
    contextTags: list[str]
    example: str = Field(min_length=1)
    warningSigns: list[str]
    provenance: Provenance

    @model_validator(mode="after")
    def valid_pattern(self):
        if (self.kind == "scam" and not self.tactics) or (self.kind == "legitimate" and self.tactics):
            raise ValueError("Pattern tactics must match kind")
        if len(set(self.tactics)) != len(self.tactics):
            raise ValueError("Duplicate tactic")
        if not self.provenance.synthetic and not self.provenance.sourceUrl:
            raise ValueError("Sourced patterns require a URL")
        return self


class Weakness(Model):
    weakness: float = Field(ge=0, le=1, strict=True)
    evidenceCount: int = Field(ge=0, le=20, strict=True)
    untested: bool = Field(strict=True)


class Weaknesses(Model):
    urgency: Weakness
    authority: Weakness
    suspicious_links: Weakness
    otp_requests: Weakness
    information_sharing: Weakness


class Rate(Model):
    rate: float | None = Field(ge=0, le=1, strict=True)
    errors: int = Field(ge=0, strict=True)
    assessed: int = Field(ge=0, strict=True)


class Profile(Model):
    weaknesses: Weaknesses
    falseAlarms: Rate
    scamMisses: Rate
    currentDifficulty: Difficulty
    assessedCount: int = Field(ge=0, strict=True)
    engineVersion: Literal["rules-v1"] = "rules-v1"


class ProfileRequest(Model):
    history: list[HistoryEntry]

    @field_validator("history")
    @classmethod
    def unique_attempts(cls, value):
        if len({h.attemptId for h in value}) != len(value):
            raise ValueError("Duplicate assessed attempt")
        return value


class RecommendRequest(ProfileRequest):
    profile: Profile
    enabledChannels: list[Channel] = Field(min_length=1, max_length=3)
    profession: str | None
    interests: list[str]
    candidatePatterns: list[Pattern] = Field(min_length=1)
    recentPatternIds: list[UUID] = Field(max_length=3)
    randomSeed: int = Field(ge=0, le=2147483647, strict=True)

    @field_validator("enabledChannels")
    @classmethod
    def unique_channels(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Duplicate channel")
        return value

    @field_validator("candidatePatterns")
    @classmethod
    def unique_patterns(cls, value):
        if len({p.id for p in value}) != len(value):
            raise ValueError("Duplicate pattern")
        return value


class Recommendation(Model):
    patternId: UUID
    channel: Channel
    difficulty: Difficulty
    targetedTactics: list[Tactic]
    explanation: str = Field(min_length=1)
    engineVersion: Literal["rules-v1"] = "rules-v1"
    randomSeed: int = Field(ge=0, le=2147483647, strict=True)
