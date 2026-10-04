"""Tellio's vocabulary, parsed from the TypeScript source of truth (no second copy)."""

import re
from functools import lru_cache
from pathlib import Path

from . import REPO_DIR

VOCAB_TS = REPO_DIR / 'backend' / 'app' / 'shared' / 'vocabulary.ts'
NEEDED = ('Channel', 'Tactic', 'ScamCategory', 'Difficulty')

# Tellio-derived heuristic tags that are not Tactics (fixed list from the
# output contract).
SIGNALS = (
    'suspicious_domain',
    'payment_request',
    'credential_request',
    'verification_code',
    'remote_access',
    'impersonation',
    'account_security',
    'attachment',
    'social_engineering',
)


def parse(source: str) -> dict[str, tuple[str, ...]]:
    enums = {}
    for name, body in re.findall(
        r'export const (\w+) = z\.enum\(\[(.*?)\]\)', source, re.S
    ):
        # either quote style (Prettier uses double)
        enums[name] = tuple(re.findall(r"""["']([a-z_]+)["']""", body))
    missing = [n for n in NEEDED if not enums.get(n)]
    if missing:
        raise ValueError(
            f'vocabulary.ts no longer declares z.enum([...]) for: {", ".join(missing)}'
        )
    return enums


@lru_cache
def load(path: Path = VOCAB_TS) -> dict[str, tuple[str, ...]]:
    return parse(path.read_text(encoding='utf-8'))
